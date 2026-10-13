import { describe, expect, it } from 'vitest';

import {
  buildAgentLaunchCommand,
  buildMcpSetupCommand,
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
  it('연결 설정 — 사용자 범위를 다시 등록하고 헤더는 환경변수 우선·내 토큰 기본값(작은따옴표로 셸 치환 방지)', () => {
    expect(buildMcpSetupCommand('https://x')).toBe(
      [
        'claude mcp remove genia-works -s user',
        "claude mcp add -s user --transport http genia-works https://x/mcp --header 'Authorization: Bearer ${GENIA_WORKS_TOKEN:-<내 API 토큰>}'",
      ].join('\n'),
    );
  });
  it('실행 명령 — 키 없으면 플레이스홀더, 있으면 실제 키', () => {
    expect(buildAgentLaunchCommand()).toBe('GENIA_WORKS_TOKEN=<발급한 키> claude');
    expect(buildAgentLaunchCommand('ak_abc')).toBe('GENIA_WORKS_TOKEN=ak_abc claude');
  });
  it('키 사용 상태', () => {
    expect(externalKeyStatusText(null)).toBe('키 미사용');
    expect(externalKeyStatusText(new Date(Date.now() - 5 * 60_000).toISOString())).toBe('키 사용 5분 전');
  });
});
