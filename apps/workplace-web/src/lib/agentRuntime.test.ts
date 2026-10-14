import { describe, expect, it } from 'vitest';

import {
  externalKeyStatusText,
  isRuntimeLocked,
  runtimeBadgeLabel,
  runtimeDescription,
} from './agentRuntime';

describe('agentRuntime', () => {
  it('배지 라벨', () => {
    expect(runtimeBadgeLabel('INTERNAL')).toBe('내부');
    expect(runtimeBadgeLabel('EXTERNAL')).toBe('외부');
  });
  it('설명은 방식별로 다르다', () => {
    expect(runtimeDescription('INTERNAL')).toContain('AI 연결(토큰)');
    expect(runtimeDescription('EXTERNAL')).toContain('외부 에이전트');
  });
  it('비서 유형은 잠긴다', () => {
    expect(isRuntimeLocked('WORKSPACE')).toBe(true);
    expect(isRuntimeLocked('PERSONAL')).toBe(true);
    expect(isRuntimeLocked('REGULAR')).toBe(false);
  });
  it('키 사용 상태', () => {
    expect(externalKeyStatusText(null)).toBe('키 미사용');
    expect(externalKeyStatusText(new Date(Date.now() - 5 * 60_000).toISOString())).toBe('키 사용 5분 전');
  });
});
