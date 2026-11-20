import { describe, expect, it } from 'vitest';

import { runnerFor } from './agent-runner.js';

// WP-1828: runnerFor 는 기록 감싸개로 감싼 러너를 provider 별로 캐시해 돌려준다(구현체 인스턴스 검사는 불가).
describe('runnerFor', () => {
  it('anthropic credential → 재호출 시 동일 인스턴스 캐시', () => {
    const r1 = runnerFor({ provider: 'anthropic', token: 't', model: null });
    const r2 = runnerFor({ provider: 'anthropic', token: 't2', model: null });
    expect(r1).toBe(r2);
  });

  it('opencode credential → 재호출 시 동일 인스턴스 캐시, anthropic 과는 다른 인스턴스', () => {
    const r1 = runnerFor({ provider: 'opencode', payload: { providerId: 'openai', options: {} }, model: null });
    const r2 = runnerFor({ provider: 'opencode', payload: { providerId: 'anthropic', options: {} }, model: null });
    expect(r1).toBe(r2);
    expect(r1).not.toBe(runnerFor({ provider: 'anthropic', token: 't', model: null }));
  });
});
