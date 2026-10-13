// 에이전트 실행 방식(내부·외부) 관련 순수 헬퍼 — 라벨·설명·MCP 연결 명령 생성.
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

/**
 * 외부 에이전트가 접속할 공개 MCP 엔드포인트.
 * 웹 앱에 별도 env(VITE_*)가 없고, 같은 origin 의 /mcp 로 라우팅되므로 현재 접속 origin 에서 유도한다.
 * 운영은 Ingress(mcpPathOnWeb)가, 로컬 개발은 Vite 개발 서버 프록시(vite.config.ts 의 /mcp → 6090)가 MCP 서버로 보낸다.
 */
export function resolveMcpUrl(origin: string = window.location.origin): string {
  return `${origin}/mcp`;
}

/** 세션마다 genia-works 접속 토큰을 바꿔 끼우는 환경변수 이름. */
export const TOKEN_ENV = 'GENIA_WORKS_TOKEN';

/**
 * Claude Code 의 사용자 범위 genia-works 연결을 "환경변수 우선, 없으면 내 토큰" 헤더로 다시 등록하는 명령(한 번만).
 * 연결은 하나로 유지하면서(다른 플러그인·MCP 그대로) 세션을 띄울 때 환경변수만 주면 AI 로 접속하게 하려는 것.
 * Claude Code 는 ~/.claude.json 에 `${...}` 를 글자 그대로 저장하고 세션 시작 때 띄운 셸의 환경변수로 치환한다(실측).
 * 작은따옴표로 감싸 등록 시점 셸이 `${...}` 를 먼저 풀어 버리지 않게 한다.
 */
export function buildMcpSetupCommand(mcpUrl: string): string {
  return [
    'claude mcp remove genia-works -s user',
    `claude mcp add -s user --transport http genia-works ${mcpUrl} --header 'Authorization: Bearer \${${TOKEN_ENV}:-<내 API 토큰>}'`,
  ].join('\n');
}

/** 이 AI 로 접속하는 Claude Code 세션을 띄우는 명령. key 가 없으면 플레이스홀더를 둔다. */
export function buildAgentLaunchCommand(key?: string | null): string {
  return `${TOKEN_ENV}=${key ?? '<발급한 키>'} claude`;
}

/** 목록의 외부 에이전트 키 사용 상태 텍스트. */
export function externalKeyStatusText(lastKeyUsedAt: string | null): string {
  return lastKeyUsedAt ? `키 사용 ${formatRelativeTime(lastKeyUsedAt)}` : '키 미사용';
}
