import type { ModelRoute, TaskPolicy } from './gateway.ts';
import { SESSION_REVIEW_PROMPT_VERSION } from './tasks/session-review.ts';

export interface ModelConfig {
  /** Szybki, tani model do krótkich tekstów (podsumowanie treningu). */
  fast: ModelRoute;
  /** Model rozmowy AI Coach. */
  coach: ModelRoute;
  /** Model wizyjny (Food Scanner, w MVP2 opis analizy techniki). */
  vision: ModelRoute;
  fallback?: { fast?: ModelRoute; coach?: ModelRoute; vision?: ModelRoute };
}

export function createDefaultPolicies(c: ModelConfig): Record<string, TaskPolicy> {
  return {
    session_review: {
      primary: c.fast,
      fallback: c.fallback?.fast,
      maxTokens: 400,
      timeoutMs: 6_000,
      temperature: 0.4,
      promptVersion: SESSION_REVIEW_PROMPT_VERSION,
    },
    coach_chat: {
      primary: c.coach,
      fallback: c.fallback?.coach,
      maxTokens: 1_200,
      timeoutMs: 30_000,
      temperature: 0.5,
      promptVersion: 'coach_chat@1',
    },
    food_scan: {
      primary: c.vision,
      fallback: c.fallback?.vision,
      maxTokens: 900,
      timeoutMs: 20_000,
      temperature: 0,
      promptVersion: 'food_scan@1',
    },
  };
}
