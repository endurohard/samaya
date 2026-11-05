// Очередь ответов по диалогу: сообщения клиента, написанные подряд,
// обрабатываются одной пачкой и никогда — параллельно в одном диалоге.
//
// Без неё 4 ноября в 54 диалогах бот отвечал на уже устаревшую реплику
// («Ваш вес?» после того, как клиент его написал), а два ответа одного
// диалога готовились одновременно и читали состояние опроса до записи друг
// друга.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createThreadQueue } from '../src/queue.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));

test('сообщения, пришедшие в пределах окна, уходят одной пачкой по порядку', async () => {
  const calls = [];
  const q = createThreadQueue({ delayMs: 40, handle: async (id, batch) => { calls.push([id, batch]); } });
  q.push('t1', 'a');
  await sleep(15);
  q.push('t1', 'b');
  await sleep(15);
  q.push('t1', 'c');
  await q.drain();
  assert.deepEqual(calls, [['t1', ['a', 'b', 'c']]]);
});

test('окно отсчитывается от последнего сообщения, а не от первого', async () => {
  const calls = [];
  const q = createThreadQueue({ delayMs: 40, handle: async (id, batch) => { calls.push(batch); } });
  q.push('t1', 'a');
  await sleep(30);
  q.push('t1', 'b');
  await sleep(30);
  // 60 мс от первого сообщения, но только 30 от последнего — ещё ждём.
  assert.equal(calls.length, 0);
  await q.drain();
  assert.deepEqual(calls, [['a', 'b']]);
});

test('разные диалоги не ждут друг друга и не смешиваются', async () => {
  const calls = [];
  const q = createThreadQueue({ delayMs: 20, handle: async (id, batch) => { calls.push([id, batch]); } });
  q.push('t1', 'a');
  q.push('t2', 'x');
  q.push('t1', 'b');
  await q.drain();
  assert.deepEqual(calls.sort(), [['t1', ['a', 'b']], ['t2', ['x']]]);
});

test('сообщение во время обработки ждёт её окончания и идёт следующей пачкой', async () => {
  const calls = [];
  let active = 0;
  let maxActive = 0;
  const q = createThreadQueue({
    delayMs: 20,
    handle: async (id, batch) => {
      active++; maxActive = Math.max(maxActive, active);
      calls.push(batch);
      await sleep(60);
      active--;
    },
  });
  q.push('t1', 'a');
  await sleep(40); // первая пачка уже обрабатывается
  q.push('t1', 'b');
  q.push('t1', 'c');
  await q.drain();
  assert.equal(maxActive, 1);
  assert.deepEqual(calls, [['a'], ['b', 'c']]);
});

test('ошибка обработки не останавливает следующие пачки диалога', async () => {
  const calls = [];
  const errors = [];
  const q = createThreadQueue({
    delayMs: 10,
    handle: async (id, batch) => { calls.push(batch); if (batch[0] === 'a') throw new Error('сбой'); },
    onError: (e) => errors.push(e.message),
  });
  q.push('t1', 'a');
  await q.drain();
  q.push('t1', 'b');
  await q.drain();
  assert.deepEqual(calls, [['a'], ['b']]);
  assert.deepEqual(errors, ['сбой']);
});

import { joinTexts } from '../src/queue.js';

test('пачка склеивается через перевод строки в порядке написания', () => {
  assert.equal(joinTexts(['Москва', '65']), 'Москва\n65');
});

test('повтор одной реплики подряд не дублируется', () => {
  assert.equal(joinTexts(['?', '?', 'Ответьте']), '?\nОтветьте');
});

test('пустые реплики пропускаются', () => {
  assert.equal(joinTexts(['', '  ', 'Живот']), 'Живот');
});

test('длинная пачка обрезается с начала: последние реплики важнее', () => {
  const long = 'а'.repeat(3990);
  const out = joinTexts([long, 'Москва', '65'], 20);
  assert.equal(out, 'Москва\n65');
});
