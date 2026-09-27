// src/mcp-tool.ts — MCP 도구 정의 타입. 두 앱 공유.
// inputSchema 는 z.ZodTypeAny — ai-agent 의 중첩 래퍼 스키마(show_* 의 {params,layout})까지 포용하는 상위집합.
// 핸들러는 문자열(주로 JSON)을 반환하고, SDK 응답 변환·에러 래핑은 각 앱 서버 레이어가 담당한다.
import type { z } from 'zod';

export interface McpTool {
  name: string;
  description: string;
  inputSchema: z.ZodTypeAny;
  handler: (args: unknown) => Promise<string>;
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
 * 공유 패키지 도구 — kind 가 **필수**라 태그를 빠뜨리면 타입 오류가 난다(fail-closed).
 * PAT 에는 스코프가 없어 사용자 RBAC 를 그대로 가지므로, 등급 없이 공유 도구가 추가되면 PAT 로 조용히 새어 나간다.
 */
export interface SharedTool extends McpTool {
  kind: ToolKind;
}
