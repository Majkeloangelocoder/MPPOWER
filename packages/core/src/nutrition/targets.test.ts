import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeNutritionTargets, dailyGap } from './targets.ts';

describe('cele żywieniowe', () => {
  it('mężczyzna 30 lat, 180 cm, 80 kg, umiarkowana aktywność, redukcja 0,5%/tydz.', () => {
    const r = computeNutritionTargets({ sex: 'male', ageYears: 30, heightCm: 180, weightKg: 80, activity: 'moderate', goal: 'fat_loss' });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.targets.bmrKcal, 1780);
    assert.equal(r.targets.tdeeKcal, 2759);
    assert.equal(r.targets.caloriesKcal, 2320);
    assert.equal(r.targets.proteinG, 160);
    assert.deepEqual(r.targets.proteinRangeG, [145, 175]);
    assert.equal(r.targets.fatG, 64);
    assert.equal(r.targets.carbsG, 276);
    assert.equal(r.targets.fiberG, 32);
    assert.deepEqual(r.targets.flags, []);
  });

  it('bezpieczniki: zbyt agresywne tempo → limit deficytu i dolna granica kalorii', () => {
    const r = computeNutritionTargets({ sex: 'female', ageYears: 25, heightCm: 160, weightKg: 55, activity: 'sedentary', goal: 'fat_loss', weeklyLossPct: 1 });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.targets.caloriesKcal, 1270);
    assert.ok(r.targets.flags.includes('DEFICIT_CAPPED'));
    assert.ok(r.targets.flags.includes('CALORIE_FLOOR_APPLIED'));
  });

  it('BMI ≥ 30 → białko liczone od masy referencyjnej', () => {
    const r = computeNutritionTargets({ sex: 'male', ageYears: 40, heightCm: 175, weightKg: 120, activity: 'light', goal: 'fat_loss' });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.targets.proteinG, 190);
    assert.ok(r.targets.flags.includes('ADJUSTED_PROTEIN_REFERENCE'));
  });

  it('osoby niepełnoletnie nie dostają celów kalorycznych', () => {
    const r = computeNutritionTargets({ sex: 'female', ageYears: 16, heightCm: 165, weightKg: 55, activity: 'light', goal: 'fat_loss' });
    assert.deepEqual(r.ok ? null : r.reason, 'UNDER_18');
  });

  it('„brakuje 45 g białka”', () => {
    assert.deepEqual(dailyGap({ caloriesKcal: 2200, proteinG: 155 }, { kcal: 1850, proteinG: 110 }), { kcalLeft: 350, proteinLeftG: 45 });
  });
});
