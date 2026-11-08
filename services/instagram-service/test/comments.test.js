// Комментарии к постам: разбор вебхука и ограничения приватного ответа.
import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.DEFAULT_COMPANY_ID = '00000000-0000-0000-0000-000000000001';
let row = null;
const queries = [];
const calls = [];
mock.module('../src/store.js', {
  namedExports: {
    pool: {
      query: async (sql, params) => {
        queries.push([sql, params]);
        if (/SELECT \* FROM instagram.comments/.test(sql)) return { rows: row ? [row] : [] };
        if (/INSERT INTO instagram.comments/.test(sql)) return { rows: [{ inserted: true }] };
        return { rows: [], rowCount: 1 };
      },
    },
  },
});
mock.module('../src/graph.js', {
  namedExports: {
    credentials: async () => ({ username: 'balakerimova_zukhra' }),
    graphCall: async (method, path, opts) => { calls.push([method, path, opts]); return { ok: true, data: { id: 'new-1', message_id: 'm1' } }; },
  },
});
const C = await import('../src/comments.js');

beforeEach(() => { row = null; queries.length = 0; calls.length = 0; });

test('вебхук comments разбирается в комментарий с постом и автором', () => {
  const out = C.parseCommentChanges({ entry: [{ time: 1793980000, changes: [
    { field: 'comments', value: { id: 'c1', text: 'Цена?', from: { id: 'u1', username: 'anna' }, media: { id: 'p1' } } },
    { field: 'mentions', value: {} },
  ] }] });
  assert.equal(out.length, 1);
  assert.deepEqual({ id: out[0].comment_id, media: out[0].media_id, user: out[0].username, text: out[0].text },
    { id: 'c1', media: 'p1', user: 'anna', text: 'Цена?' });
});

test('приватный ответ уходит по comment_id, не по нику', async () => {
  row = { comment_id: 'c1', media_id: 'p1', commented_at: new Date(), private_sent_at: null };
  const r = await C.replyPrivate('c1', 'Здравствуйте! Написали вам в директ');
  assert.equal(r.ok, true);
  assert.deepEqual(calls[0][2].body.recipient, { comment_id: 'c1' });
});

test('второй приватный ответ на тот же комментарий не отправляется', async () => {
  row = { comment_id: 'c1', media_id: 'p1', commented_at: new Date(), private_sent_at: new Date() };
  const r = await C.replyPrivate('c1', 'ещё раз');
  assert.equal(r.ok, false);
  assert.equal(calls.length, 0);
});

test('через 7 дней приватный ответ не отправляется', async () => {
  row = { comment_id: 'c1', media_id: 'p1', commented_at: new Date(Date.now() - 8 * 86400_000), private_sent_at: null };
  const r = await C.replyPrivate('c1', 'поздно');
  assert.equal(r.ok, false);
  assert.match(r.error, /7 дней/);
  assert.equal(calls.length, 0);
});

test('ответ на ответ уходит в ветку родительского комментария', async () => {
  row = { comment_id: 'c2', parent_id: 'c1', media_id: 'p1', commented_at: new Date() };
  const r = await C.replyPublic('c2', 'Спасибо!');
  assert.equal(r.ok, true);
  assert.equal(calls[0][1], 'c1/replies');
});

test('наш собственный комментарий сразу считается обработанным', async () => {
  await C.upsertComment({ comment_id: 'c9', media_id: 'p1', username: 'Balakerimova_Zukhra', text: 'ответ' });
  const ins = queries.find(q => /INSERT INTO instagram.comments/.test(q[0]));
  assert.equal(ins[1][7], true);
});
