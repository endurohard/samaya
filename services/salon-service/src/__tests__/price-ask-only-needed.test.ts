// Опросник не спрашивает лишнего.
//
// Требование владельца: цена круговой липосакции ног фиксированная, и если
// клиент сразу спросил про ноги, вопрос о весе задавать нельзя. На живом
// диалоге клиентка заметила это сама: «А мой вес вы не уточняли» — то есть
// поняла, что цену посчитали без её ответа.
import { describe, it, expect } from 'vitest';
import { parseAskTemplate, askOnlyNeeded, weightNeeded } from '../ai/price';

const TPL = parseAskTemplate(
  'Здравствуйте 🌹\n\nУкажите пожалуйста:\n\n'
  + '1️⃣Какой город вас интересует Каспийск или Москва\n\n'
  + '2️⃣Ваш вес ?\n\n'
  + '3️⃣Какая зона вас интересует? 🤍',
);

describe('askOnlyNeeded', () => {
  it('ноги названы — спрашиваем только город, без веса', () => {
    const r = askOnlyNeeded(TPL, { city: true, weight: false, zone: false });
    expect(r).toContain('Какой город');
    expect(r).not.toContain('Ваш вес');
    expect(r).not.toContain('Какая зона');
    // Приветствие обязано остаться: без него ответ начинается с «1️⃣».
    expect(r).toContain('Здравствуйте');
  });

  it('нужны все три — отдаём шаблон целиком, как правит владелец', () => {
    const r = askOnlyNeeded(TPL, { city: true, weight: true, zone: true });
    expect(r).toBe(TPL.full);
  });

  it('город уже назван, зона нет — только вопрос о зоне', () => {
    const r = askOnlyNeeded(TPL, { city: false, weight: false, zone: true });
    expect(r).toContain('Какая зона');
    expect(r).not.toContain('Какой город');
    expect(r).not.toContain('Ваш вес');
  });

  it('вес нужен для рук — пункт остаётся', () => {
    const r = askOnlyNeeded(TPL, { city: true, weight: true, zone: false });
    expect(r).toContain('Ваш вес');
    expect(r).not.toContain('Какая зона');
  });

  it('спрашивать нечего — отдаём осмысленный текст, а не пустую строку', () => {
    const r = askOnlyNeeded(TPL, { city: false, weight: false, zone: false });
    expect(r.trim().length).toBeGreaterThan(0);
  });

  it('между пунктами ровно один пустой абзац', () => {
    const r = askOnlyNeeded(TPL, { city: true, weight: true, zone: false });
    expect(r).not.toMatch(/\n{3,}/);
  });
});

describe('weightNeeded — от каких зон зависит вопрос о весе', () => {
  it('круговая липосакция ног считается без веса', () => {
    expect(weightNeeded(['legs_circular'])).toBe(false);
  });

  it('руки и живот без веса посчитать нельзя', () => {
    expect(weightNeeded(['arms'])).toBe(true);
    expect(weightNeeded(['belly'])).toBe(true);
  });

  it('ноги вместе с руками — вес нужен из-за рук', () => {
    expect(weightNeeded(['legs_circular', 'arms'])).toBe(true);
  });

  it('подбородок, холка, галифе, голень — без веса', () => {
    expect(weightNeeded(['chin'])).toBe(false);
    expect(weightNeeded(['holka'])).toBe(false);
    expect(weightNeeded(['galife'])).toBe(false);
    expect(weightNeeded(['shin'])).toBe(false);
  });
});
