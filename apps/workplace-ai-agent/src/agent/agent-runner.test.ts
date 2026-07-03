import { describe, expect, it } from 'vitest';

import { runnerFor } from './agent-runner.js';
import { ClaudeSdkRunner } from './claude-sdk-runner.js';
import { OpencodeRunner } from './opencode-runner.js';

describe('runnerFor', () => {
  it('anthropic credential → ClaudeSdkRunner (재호출 시 동일 인스턴스 캐시)', () => {
    const r1 = runnerFor({ provider: 'anthropic', token: 't', model: null });
    const r2 = runnerFor({ provider: 'anthropic', token: 't2', model: null });
    expect(r1).toBeInstanceOf(ClaudeSdkRunner);
    expect(r1).toBe(r2);
  });

  it('opencode credential → OpencodeRunner (더 이상 throw 하지 않음, 재호출 시 동일 인스턴스 캐시)', () => {
    const r1 = runnerFor({ provider: 'opencode', payload: { providerId: 'openai', options: {} }, model: null });
    const r2 = runnerFor({ provider: 'opencode', payload: { providerId: 'anthropic', options: {} }, model: null });
    expect(r1).toBeInstanceOf(OpencodeRunner);
    expect(r1).toBe(r2);
  });
});
