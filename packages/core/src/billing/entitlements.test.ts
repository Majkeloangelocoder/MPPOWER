import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { hasFeature, resolveEntitlements } from './entitlements.ts';

const now = new Date('2026-10-08T12:00:00Z');
const future = '2026-11-08T12:00:00Z';
const past = '2026-10-01T12:00:00Z';

describe('entitlements', () => {
  it('brak subskrypcji → FREE z ograniczonym AI Coach', () => {
    const e = resolveEntitlements({ subscriptions: [], now });
    assert.equal(e.planCode, 'free');
    assert.equal(e.source, 'default');
    assert.equal(hasFeature(e, 'food_scanner'), false);
    assert.deepEqual(e.features.ai_coach.quota, { limit: 5, period: 'week' });
  });

  it('aktywna subskrypcja PRO ze Stripe', () => {
    const e = resolveEntitlements({ subscriptions: [{ provider: 'stripe', planCode: 'pro', status: 'active', currentPeriodEnd: future }], now });
    assert.equal(e.planCode, 'pro');
    assert.equal(hasFeature(e, 'food_scanner'), true);
    assert.equal(hasFeature(e, 'body_scan'), false);
  });

  it('trial PREMIUM z App Store', () => {
    const e = resolveEntitlements({ subscriptions: [{ provider: 'app_store', planCode: 'premium', status: 'trialing', currentPeriodEnd: future }], now });
    assert.equal(e.planCode, 'premium');
    assert.equal(hasFeature(e, 'technique_analysis'), true);
  });

  it('nieudana płatność: 3 dni temu → okres łaski; 10 dni temu → FREE', () => {
    const grace = resolveEntitlements({ subscriptions: [{ provider: 'stripe', planCode: 'pro', status: 'past_due', currentPeriodEnd: future, pastDueSince: '2026-10-05T12:00:00Z' }], now });
    assert.equal(grace.planCode, 'pro');
    assert.equal(grace.inGracePeriod, true);
    const expired = resolveEntitlements({ subscriptions: [{ provider: 'stripe', planCode: 'pro', status: 'past_due', currentPeriodEnd: future, pastDueSince: '2026-09-28T12:00:00Z' }], now });
    assert.equal(expired.planCode, 'free');
  });

  it('okres rozliczeniowy minął (zgubiony webhook) → FREE, bez darmowego dostępu', () => {
    const e = resolveEntitlements({ subscriptions: [{ provider: 'stripe', planCode: 'pro', status: 'active', currentPeriodEnd: past }], now });
    assert.equal(e.planCode, 'free');
  });

  it('grant trenera PREMIUM wygrywa z PRO; anulowana subskrypcja nic nie daje', () => {
    const e = resolveEntitlements({
      subscriptions: [
        { provider: 'stripe', planCode: 'pro', status: 'active', currentPeriodEnd: future },
        { provider: 'play_store', planCode: 'premium', status: 'canceled', currentPeriodEnd: future },
      ],
      grants: [{ planCode: 'premium', expiresAt: null, reason: 'MP Power Challenge' }],
      now,
    });
    assert.equal(e.planCode, 'premium');
    assert.equal(e.source, 'grant');
    assert.equal(e.validUntil, null);
  });
});
