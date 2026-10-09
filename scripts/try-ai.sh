#!/usr/bin/env bash
# Прогон тестовых сообщений через классификатор тем.
#
# Проверяет не «сервис поднялся», а то единственное, что имеет значение:
# правильно ли бот определяет тему и что он ответил бы клиенту. Ошибка в
# описании темы видна только на примерах — прочитать её в тексте нельзя.
#
# Вызывается внутренняя функция classify через salon-service, поэтому
# результат ровно тот же, что получит живой клиент.
#
# Запуск: ssh iTTEST 'cd ~/samaya && bash scripts/try-ai.sh'

set -uo pipefail
cd "$(dirname "$0")/.."

# Типовые сообщения клиники: простые темы, медицинские (должны уходить
# врачу), конфликтные и намеренно спорное — на нём проверяется, что бот
# признаёт неуверенность, а не угадывает.
MESSAGES=(
  "Здравствуйте!"
  "сколько стоит чистка лица?"
  "до скольки вы работаете в субботу?"
  "где вы находитесь, парковка есть?"
  "хочу записаться на четверг на чистку"
  "у меня розацеа и купероз, мне можно лазерную шлифовку?"
  "больно ли это и сколько заживать будет?"
  "мне сделали ужасно, требую вернуть деньги"
  "запишите сегодня срочно, готова приехать через час"
  "спасибо большое, всё поняла"
  "Здравствуйте, вы ищете косметолога? хочу у вас работать"
  "Предлагаем продвижение вашего аккаунта, первые 100 клиентов бесплатно"
  "а липосакцию делаете? сколько по цене и кто врач"
)

echo "Прогон ${#MESSAGES[@]} сообщений через классификатор"
echo

for msg in "${MESSAGES[@]}"; do
  # Экранируем кавычки для JSON.
  esc=$(printf '%s' "$msg" | sed 's/\\/\\\\/g; s/"/\\"/g')
  out=$(docker compose exec -T salon-service node -e "
    const { classify } = require('./dist/ai/classifier.js');
    (async () => {
      try {
        const d = await classify(process.env.DEFAULT_COMPANY_ID, $(printf '"%s"' "$esc"));
        const act = { sent: 'ОТПРАВИТ САМ', draft: 'черновик', skipped: 'не отвечает', failed: 'СБОЙ' }[d.action] || d.action;
        console.log(JSON.stringify({
          topic: d.topic, conf: d.confidence, act,
          reply: (d.reply || '').slice(0, 70),
          reason: d.reason || '',
        }));
      } catch (e) { console.log(JSON.stringify({ err: e.message })); }
    })();
  " 2>/dev/null | tail -1)

  topic=$(printf '%s' "$out" | sed -n 's/.*"topic":"\([^"]*\)".*/\1/p')
  conf=$(printf '%s' "$out"  | sed -n 's/.*"conf":\([0-9.]*\).*/\1/p')
  act=$(printf '%s' "$out"   | sed -n 's/.*"act":"\([^"]*\)".*/\1/p')
  reply=$(printf '%s' "$out" | sed -n 's/.*"reply":"\([^"]*\)".*/\1/p')
  reason=$(printf '%s' "$out"| sed -n 's/.*"reason":"\([^"]*\)".*/\1/p')
  err=$(printf '%s' "$out"   | sed -n 's/.*"err":"\([^"]*\)".*/\1/p')

  echo "«$msg»"
  if [ -n "$err" ]; then
    echo "   ОШИБКА: $err"
  else
    printf '   тема: %-12s уверенность: %-6s %s\n' "${topic:-—}" "${conf:-—}" "$act"
    [ -n "$reply" ]  && echo "   ответ:  $reply…"
    [ -n "$reason" ] && echo "   почему: $reason"
  fi
  echo
done
