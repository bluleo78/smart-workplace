// src/mcp-tool.ts — MCP 도구 정의 타입. 두 앱 공유.
// inputSchema 는 z.ZodTypeAny — ai-agent 의 중첩 래퍼 스키마(show_* 의 {params,layout})까지 포용하는 상위집합.
// 핸들러는 문자열(주로 JSON) 또는 content 블록 배열(이미지 등, WP-240)을 반환하고,
// SDK 응답 변환(toMcpContent)·에러 래핑은 각 앱 서버 레이어가 담당한다.
import type { z } from 'zod';

import type { McpToolResult } from './mcp-content.js';

export interface McpTool {
  name: string;
  description: string;
  inputSchema: z.ZodTypeAny;
  handler: (args: unknown) => Promise<McpToolResult>;
  /**
   * MCP 표준 도구 힌트(WP-342). 클라이언트(Claude·ChatGPT 등)가 실행 전 확인·병렬 실행 여부를 정하는 데 쓴다.
   * 공유 도구는 `toolAnnotations()` 가 계산한 값을 각 앱이 실어 보낸다. 로컬 전용 도구는 비워 둔다(힌트 없음).
   */
  annotations?: McpToolAnnotations;
}

/** MCP `ToolAnnotations` 와 같은 모양(SDK 타입에 의존하지 않으려고 구조만 맞춰 둔다). */
export interface McpToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

/**
 * 도구가 일으키는 부작용의 등급(#853). 노출 범위 결정의 근거다.
 * - read: 상태를 바꾸지 않는다.
 * - write: 상태를 바꾸지만 되돌릴 수 있다(다시 쓰기·재추가·복원 API 가 있다). 워크스페이스 안의 알림·메시지
 *   (멘션·RSVP 알림·DM 생성)는 사용자가 앱에서 직접 해도 생기는 정상 부작용이라 write 다.
 * - destructive: 되돌릴 수 없거나(영구 삭제·복원 API 없는 삭제) 워크스페이스 밖으로 나간다(메일 발송·외부 공개 링크)
 *   — PAT(workplace-mcp)에는 노출하지 않는다.
 */
export type ToolKind = 'read' | 'write' | 'destructive';

/**
 * 쓰기 도구의 연산 성격(WP-342) — `kind`(노출 범위)와 **별개**다. kind 가 write 여도 덮어쓰거나 지우는 도구는 destructive=true 로
 * 알려야 클라이언트가 확인을 받는다(MCP 에서 destructiveHint 는 "추가만 하는 변경"이 아니라는 뜻이고 기본값이 true 다).
 * - destructive: 기존 값을 덮어쓰거나(집합 교체 포함) 제거·해제하면 true. 새로 추가만 하면 false.
 * - idempotent: 같은 인자로 다시 불러도 저장 상태가 더 바뀌지 않고, 이력·알림이 추가로 쌓이지 않으며, 오류 없이 같은 결과면 true.
 *   근거를 서버 코드에서 못 찾으면 false(기본값과 같다) — true 는 클라이언트의 자동 재시도를 부른다.
 * - openWorld: 워크스페이스 밖 시스템(원본 메일 서버 등)에 닿으면 true. 생략하면 false.
 */
export interface ToolHints {
  destructive: boolean;
  idempotent: boolean;
  openWorld?: boolean;
}

// 공유 도구도 문자열(JSON) 또는 content 블록 배열(이미지 등)을 반환할 수 있다(WP-345) — McpTool.handler 와 같은 반환 타입을 그대로 쓴다.
type SharedToolBase = Omit<McpTool, 'annotations'>;

/**
 * 공유 패키지 도구 — kind 가 **필수**라 태그를 빠뜨리면 타입 오류가 난다(fail-closed).
 * PAT 에는 스코프가 없어 사용자 RBAC 를 그대로 가지므로, 등급 없이 공유 도구가 추가되면 PAT 로 조용히 새어 나간다.
 * write·destructive 는 `hints` 도 필수다(WP-342) — 연산 성격을 빠뜨리면 typecheck 가 실패한다. read 는 힌트가 필요 없다.
 */
export type SharedTool = SharedToolBase &
  ({ kind: 'read'; hints?: never } | { kind: 'write' | 'destructive'; hints: ToolHints });
