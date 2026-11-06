// Опечатки из переписки за 30 дней, на которых бот не узнавал город или
// зону и переспрашивал то, что клиент уже написал.
import { describe, it, expect } from 'vitest';
import { parseCity, parseZones, isSurveyAnswer } from '../ai/price';

describe('опечатки в городе', () => {
  it.each(['Касписк', 'Кайспийск, вес 72 кг зона бедер', 'Каспийс Вес 77кг'])('%j → Каспийск', t => {
    expect(parseCity(t)).toBe('kaspiysk');
  });
  it.each(['Moskva', 'Масква', 'Moscow'])('%j → Москва', t => {
    expect(parseCity(t)).toBe('moscow');
  });
});

describe('опечатки в зоне', () => {
  it.each(['Голифе', 'Зона голифе'])('%j → галифе', t => {
    expect(parseZones(t)).toEqual(['galife']);
  });
  it.each(['Зона живота и баков', 'Зона баков'])('%j → талия (бока)', t => {
    expect(parseZones(t)).toContain('waist');
  });
});

describe('опечатка не цепляет чужие слова', () => {
  it('«микроигольчатый лифтинг» — не галифе', () => {
    expect(parseZones('Цена рф микроигольчатоголифтинга?')).not.toContain('galife');
  });
});

describe('ответ с опечаткой — всё ещё ответ опросу', () => {
  it.each(['Касписк', 'Moskva', 'Зона живота и баков', 'Голифе', 'Кайспийск, вес 72 кг зона бедер'])('%j', t => {
    expect(isSurveyAnswer(t)).toBe(true);
  });
});
