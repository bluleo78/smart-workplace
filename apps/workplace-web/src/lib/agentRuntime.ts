// 에이전트 실행 방식(내부·외부) 관련 순수 헬퍼 — 라벨·설명·키 사용 상태.
// 화면과 분리해 vitest 로 검증한다.

import type { AgentResponse, AgentRuntime } from '../types/agent';
import { formatRelativeTime } from './formatters';

/** 실행 방식 한국어 라벨(목록 배지용 짧은 형). */
export function runtimeBadgeLabel(runtime: AgentRuntime): string {
  return runtime === 'EXTERNAL' ? '외부' : '내부';
}

/** 실행 방식 선택 옵션(세그먼트 컨트롤용 긴 라벨). */
export const RUNTIME_OPTIONS: { value: AgentRuntime; label: string }[] = [
  { value: 'INTERNAL', label: '내부 (서버에서 실행)' },
  { value: 'EXTERNAL', label: '외부 (내 컴퓨터 등)' },
];

/** 실행 방식별 한 줄 설명. */
export function runtimeDescription(runtime: AgentRuntime): string {
  return runtime === 'EXTERNAL'
    ? '담당 이슈를 서버가 처리하지 않습니다. 이 AI의 키로 접속한 외부 에이전트가 이슈 챗으로 진행 상황을 남기고 질문합니다.'
    : '담당 이슈와 멘션을 서버의 AI가 처리합니다. AI 연결(토큰)이 필요해요.';
}

/** 공통·개인 비서는 AI Chat 을 서버에서 돌려야 하므로 외부로 바꿀 수 없다. */
export function isRuntimeLocked(type: AgentResponse['type']): boolean {
  return type === 'WORKSPACE' || type === 'PERSONAL';
}

export const RUNTIME_LOCKED_REASON =
  '공통 비서·개인 비서로 지정된 AI는 AI Chat을 서버에서 실행해야 해서 외부로 바꿀 수 없어요. 비서 지정을 먼저 해제하세요.';

/** 목록의 외부 에이전트 키 사용 상태 텍스트. */
export function externalKeyStatusText(lastKeyUsedAt: string | null): string {
  return lastKeyUsedAt ? `키 사용 ${formatRelativeTime(lastKeyUsedAt)}` : '키 미사용';
}
