// Сквозная проверка сценария смены города на реальной БД.
// Запуск: DATABASE_URL=... npx tsx src/ai/city-switch.manual.ts
import { handleMessage, isCollecting, isCitySwitch, loadState, resetState } from './price-dialog';

const CO = '00000000-0000-0000-0000-000000000001';
const CH = 'probe';
const TID = 'city-switch-test';

async function say(text: string) {
  // Ровно та же развилка, что в routes/ai.ts
  const collecting = await isCollecting(CO, CH, TID) || await isCitySwitch(CO, CH, TID, text);
  const out = await handleMessage({
    companyId: CO, channel: CH, threadId: TID, text,
    fresh: !collecting,
  });
  const reply = String(out.reply || out.reason || '').replace(/\n+/g, ' | ').slice(0, 150);
  console.log(`  клиент: ${text}`);
  console.log(`  бот:    [${out.kind}] ${reply}`);
  return out;
}

(async () => {
  await resetState(CO, CH, TID);
  console.log('=== случай madina.dii__: цена по одному городу, потом «а в Каспийске?» ===');
  await say('Сколько стоит липосакция');
  await say('Москва');
  await say('70');
  await say('живот и бока');
  console.log('  --- цена названа, теперь смена города ---');
  const out = await say('а в Каспийске?');

  const st = await loadState(CO, CH, TID);
  console.log(`\n  состояние: город=${st.city} вес=${st.weight} зоны=${st.zones.join(',')}`);
  const okKind = out.kind === 'quote';
  const okZones = st.zones.length === 2;
  const okCity = st.city === 'kaspiysk';
  console.log(`\n  пересчёт выдан цену: ${okKind ? 'ДА' : 'НЕТ — ' + out.kind}`);
  console.log(`  зоны сохранены:      ${okZones ? 'ДА' : 'НЕТ'}`);
  console.log(`  город переключён:    ${okCity ? 'ДА' : 'НЕТ'}`);

  // Обратно в Москву — переключение должно работать в обе стороны и
  // сколько угодно раз, а не единожды.
  console.log('\n  --- и обратно в Москву ---');
  const back = await say('а в москве?');
  const okBack = back.kind === 'quote' && (await loadState(CO, CH, TID)).city === 'moscow';
  console.log(`  обратно в Москву:    ${okBack ? 'ДА' : 'НЕТ — ' + back.kind}`);

  // Тот же город повторно — пересчитывать нечего, это НЕ смена города.
  // Такое сообщение должно уйти обычным путём (к классификатору), иначе
  // бот будет отвечать ценой на любое упоминание города.
  const same = await isCitySwitch(CO, CH, TID, 'в москве');
  console.log(`  тот же город не триггер: ${same === false ? 'ДА' : 'НЕТ'}`);

  // Вопрос без города после цены — тоже обычный путь.
  const noCity = await isCitySwitch(CO, CH, TID, 'а когда можно записаться?');
  console.log(`  вопрос без города не триггер: ${noCity === false ? 'ДА' : 'НЕТ'}`);

  await resetState(CO, CH, TID);
  const allOk = okKind && okZones && okCity && okBack && same === false && noCity === false;
  console.log(`\n  ИТОГ: ${allOk ? 'всё верно' : 'ЕСТЬ ОШИБКИ'}`);
  process.exit(allOk ? 0 : 1);
})().catch(e => { console.error('ОШИБКА:', e.message); process.exit(1); });
