import { describe, expect, it } from 'vitest';

import { externalKeyStatusText } from './agentRuntime';

describe('agentRuntime', () => {
  it('외부 AI 마지막 접속', () => {
    expect(externalKeyStatusText(null)).toBe('아직 접속 안 함');
    expect(externalKeyStatusText(new Date(Date.now() - 5 * 60_000).toISOString())).toBe('마지막 접속 5분 전');
  });
});
