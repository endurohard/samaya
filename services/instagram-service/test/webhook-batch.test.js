// Ответ на пачку сообщений: один вызов ассистента на всё, что клиент
// написал подряд, вступление только вместе с отправленным ответом и
// подпись «Ассистент» на всём, что отправил бот.
//
// Запуск: node --test --experimental-test-module-mocks test/webhook-batch.test.js
// (флаг нужен для mock.module; в npm test он уже указан).
import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.INSTAGRAM_AUTOREPLY = 'true';
process.env.INSTAGRAM_REPLY_DELAY_MS = '30';
process.env.INSTAGRAM_REPLY_JITTER_MS = '0';

const calls = { send: [], parts: [], mark: [], draft: [], saved: [] };
let saveCounter = 0;

mock.module('../src/store.js', {
  namedExports: {
    upsertThread: async () => null,
    // Каждое входящее новое — иначе сработала бы защита от повторной доставки.
    saveMessages: async (threadId, items) => { calls.saved.push(items); saveCounter++; return { saved: 1 }; },
    saveDraft: async (...a) => { calls.draft.push(a); },
    clearDraft: async () => {},
    findClientByPhone: async () => null,
    linkThreadToClient: async () => {},
    threadHasName: async () => true,
    threadUsername: async () => 'client',
    channelSettings: async () => ({ testMode: false, testUsers: [] }),
    markBot: async (threadId, body) => { calls.mark.push(body); return 1; },
  },
});
mock.module('../src/graph.js', {
  namedExports: {
    sendMessage: async (threadId, text) => { calls.send.push(text); return { ok: true }; },
    fetchProfile: async () => null,
  },
});
mock.module('../src/parts.js', {
  namedExports: {
    sendParts: async (threadId, parts) => { calls.parts.push(parts); return { ok: true, sent: parts.length }; },
  },
});

let assistant = async () => ({ ok: true, action: 'sent', topic: 't', reply: 'Ответ', reply_parts: [] });
const asked = [];
globalThis.fetch = async (url, init) => {
  if (String(url).endsWith('/ai/reply')) {
    const body = JSON.parse(init.body);
    asked.push(body.text);
    return { ok: true, json: async () => assistant(body) };
  }
  return { ok: true, json: async () => ({}), text: async () => '' };
};

const { handleMessages } = await import('../src/webhook.js');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const msg = (text, threadId = 't1') => ({ threadId, fromMe: false, text, type: 'text', at: new Date() });
// Ожидание с запасом: пауза очереди 30 мс плюс асинхронная обработка.
const settle = () => sleep(120);

beforeEach(() => {
  for (const k of Object.keys(calls)) calls[k].length = 0;
  asked.length = 0;
  assistant = async () => ({ ok: true, action: 'sent', topic: 't', reply: 'Ответ', reply_parts: [] });
});

test('сообщения подряд дают один вопрос ассистенту и один ответ', async () => {
  await handleMessages([msg('Москва')]);
  await sleep(10);
  await handleMessages([msg('65')]);
  await settle();
  assert.deepEqual(asked, ['Москва\n65']);
  assert.deepEqual(calls.send, ['Ответ']);
  assert.deepEqual(calls.mark, ['Ответ']);
});

test('черновик ничего не отправляет клиенту, даже если пришли части', async () => {
  assistant = async () => ({ ok: true, action: 'draft', reply: 'Черновик',
    reply_parts: [{ type: 'text', text: 'Описание' }] });
  await handleMessages([msg('внутренняя поверхность бедра')]);
  await settle();
  assert.equal(calls.send.length, 0);
  assert.equal(calls.parts.length, 0);
  assert.deepEqual(calls.draft.map(a => a[1]), ['Черновик']);
});

test('вступление уходит перед ответом, и его тексты подписаны как бот', async () => {
  assistant = async () => ({ ok: true, action: 'sent', topic: 'liposakciya_ruk', reply: 'Какой город?',
    intro_key: 'legs_intro',
    reply_parts: [{ type: 'image', asset: 'legs-zones-front' }, { type: 'text', text: 'Описание методики' }] });
  await handleMessages([msg('круговая липосакция ног')]);
  await sleep(4000);
  assert.equal(calls.parts.length, 1);
  assert.deepEqual(calls.send, ['Какой город?']);
  assert.deepEqual(calls.mark, ['Описание методики', 'Какой город?']);
});

test('разные диалоги отвечают каждый на своё', async () => {
  await handleMessages([msg('Здравствуйте', 'a'), msg('Цена?', 'b')]);
  await settle();
  assert.deepEqual(asked.sort(), ['Здравствуйте', 'Цена?']);
});
