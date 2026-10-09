// Проверка официального токена Instagram до того, как писать под него код.
//
// Зачем отдельный скрипт: у Meta два разных пути к Direct, и по виду токена
// они не различаются, а код для них нужен разный:
//
//   1. Instagram API with Instagram Login — хост graph.instagram.com,
//      токен пользователя Instagram. Страница Facebook не нужна.
//   2. Instagram Messaging через страницу Facebook — хост graph.facebook.com,
//      токен страницы. Нужна привязанная страница и разрешения
//      instagram_basic + instagram_manage_messages + pages_manage_metadata.
//
// Скрипт пробует оба и печатает, какой путь живой, какой это аккаунт и
// каких разрешений не хватает. Токен берётся из окружения и НЕ печатается:
// в выводе только его длина и префикс, чтобы не светить в логах и скриншотах.
//
// Запуск:
//   node services/instagram-service/scripts/check-token.mjs
// Токен ищется в INSTAGRAM_API_TOKEN, затем в IG_ACCESS_TOKEN.

const TOKEN = process.env.INSTAGRAM_API_TOKEN || process.env.IG_ACCESS_TOKEN || '';
const V = process.env.IG_API_VERSION || 'v23.0';

if (!TOKEN) {
  console.error('Токена нет. Задайте INSTAGRAM_API_TOKEN в окружении или в .env рядом с проектом.');
  process.exit(1);
}

console.log(`Токен: длина ${TOKEN.length}, начинается с "${TOKEN.slice(0, 4)}…"`);
console.log(`Версия API: ${V}\n`);

async function get(url) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    const body = await r.json().catch(() => ({}));
    return { status: r.status, body };
  } catch (e) {
    return { status: 0, body: { error: { message: e.message } } };
  }
}

const err = r => r.body?.error?.message || JSON.stringify(r.body).slice(0, 200);

// ── Путь 1: Instagram Login (graph.instagram.com) ──
console.log('── Путь 1: graph.instagram.com (Instagram Login) ──');
const ig = await get(`https://graph.instagram.com/${V}/me?fields=id,username,account_type&access_token=${TOKEN}`);
if (ig.status === 200) {
  console.log(`  РАБОТАЕТ. Аккаунт: @${ig.body.username}, id=${ig.body.id}, тип=${ig.body.account_type || 'н/д'}`);
  console.log('  Отправка сообщений: POST https://graph.instagram.com/<ver>/<IG_ID>/messages');
} else {
  console.log(`  нет (HTTP ${ig.status}): ${err(ig)}`);
}

// ── Путь 2: страница Facebook (graph.facebook.com) ──
console.log('\n── Путь 2: graph.facebook.com (через страницу Facebook) ──');
const me = await get(`https://graph.facebook.com/${V}/me?fields=id,name&access_token=${TOKEN}`);
if (me.status === 200) {
  console.log(`  Токен принят. Объект: ${me.body.name || '(без имени)'}, id=${me.body.id}`);

  // Какие разрешения реально выданы: без instagram_manage_messages
  // читать и отправлять Direct нельзя, даже если токен валиден.
  const perm = await get(`https://graph.facebook.com/${V}/me/permissions?access_token=${TOKEN}`);
  if (perm.status === 200 && Array.isArray(perm.body.data)) {
    const granted = perm.body.data.filter(p => p.status === 'granted').map(p => p.permission);
    console.log(`  Выданные разрешения: ${granted.join(', ') || '(нет)'}`);
    for (const need of ['instagram_basic', 'instagram_manage_messages', 'pages_manage_metadata']) {
      console.log(`    ${granted.includes(need) ? '✓' : '✗ НЕ ХВАТАЕТ'} ${need}`);
    }
  } else {
    console.log(`  Разрешения прочитать не удалось: ${err(perm)} (обычно это токен страницы, а не пользователя)`);
  }

  // Привязанный аккаунт Instagram. Для токена страницы — прямой запрос,
  // для токена пользователя — сначала список страниц.
  const linked = await get(`https://graph.facebook.com/${V}/me?fields=instagram_business_account{id,username}&access_token=${TOKEN}`);
  if (linked.body?.instagram_business_account) {
    const a = linked.body.instagram_business_account;
    console.log(`  Привязанный Instagram: @${a.username}, id=${a.id}`);
  } else {
    const pages = await get(`https://graph.facebook.com/${V}/me/accounts?fields=id,name,instagram_business_account{id,username}&access_token=${TOKEN}`);
    const list = pages.body?.data || [];
    if (list.length) {
      console.log('  Страницы и их аккаунты Instagram:');
      for (const p of list) {
        const a = p.instagram_business_account;
        console.log(`    - ${p.name} (id=${p.id}): ${a ? `@${a.username}, id=${a.id}` : 'Instagram НЕ привязан'}`);
      }
    } else {
      console.log(`  Привязанного Instagram не видно: ${err(linked)}`);
    }
  }
} else {
  console.log(`  нет (HTTP ${me.status}): ${err(me)}`);
}

// Срок жизни и приложение токена: короткоживущий токен через час станет
// причиной «бот молчит», и это надо знать заранее, а не в бою.
console.log('\n── Срок жизни токена ──');
const dbg = await get(`https://graph.facebook.com/${V}/debug_token?input_token=${TOKEN}&access_token=${TOKEN}`);
const d = dbg.body?.data;
if (d) {
  console.log(`  тип: ${d.type || 'н/д'}, приложение: ${d.app_id || 'н/д'}`);
  console.log(`  действителен: ${d.is_valid ? 'да' : 'НЕТ'}`);
  console.log(`  истекает: ${d.expires_at ? new Date(d.expires_at * 1000).toLocaleString('ru-RU') : 'бессрочный'}`);
  if (d.scopes) console.log(`  scopes: ${d.scopes.join(', ')}`);
} else {
  console.log(`  прочитать не удалось: ${err(dbg)}`);
}
