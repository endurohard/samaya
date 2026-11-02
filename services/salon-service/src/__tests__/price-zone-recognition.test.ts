// Каждая услуга прайса распознаётся ровно как одна зона.
// Подстроки не должны добавлять соседнюю услугу: «лобок» раньше содержал
// корень «бок» и ошибочно превращался в набор «талия + лобок».
import { describe, it, expect } from 'vitest';
import { parseZones } from '../ai/price';

const cases: Array<[string, string]> = [
  ['Подбородок', 'chin'],
  ['Contour Lift', 'contour_lift'],
  ['Холка', 'holka'],
  ['Руки', 'arms'],
  ['Живот', 'belly'],
  ['Талия', 'waist'],
  ['Ноги', 'legs_circular'],
  ['Внутренняя поверхность ног до колен', 'inner_legs'],
  ['Галифе', 'galife'],
  ['Лобок', 'pubis'],
  ['Голень', 'shin'],
  ['Уменьшение ягодиц', 'buttocks'],
];

describe('распознавание всех услуг прайса', () => {
  it.each(cases)('%s → только %s', (phrase, zone) => {
    expect(parseZones(phrase)).toEqual([zone]);
  });

  it.each(['бок', 'бока', 'на боках', 'убрать бока'])('%s → талия', (phrase) => {
    expect(parseZones(phrase)).toEqual(['waist']);
  });
});
