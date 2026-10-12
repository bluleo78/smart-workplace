// src/tool-annotations.ts — 공유 도구 → MCP 표준 annotations 변환(WP-342).
// 클라이언트(Claude·ChatGPT 등)는 이 힌트로 실행 전 확인 여부·병렬 실행 여부를 정한다. kind(노출 범위)와 분리된 연산 성격을 알린다.
import type { McpToolAnnotations, SharedTool } from './mcp-tool.js';
import { TOOL_LABELS } from './tool-labels.js';

/**
 * 도구의 MCP annotations 를 계산한다. 순수 함수 — workplace-mcp 와 ai-agent 가 같은 값을 쓴다.
 * - read: 읽기 전용이라 destructive·idempotent 힌트는 의미가 없어 싣지 않는다. 워크스페이스 안에서만 동작(openWorld=false).
 * - write/destructive: `hints` 를 그대로 옮긴다. openWorld 는 생략하면 false(워크스페이스 안에서만 동작).
 * - title: 표시 이름(TOOL_LABELS). 라벨이 없는 이름이면 생략한다(공유 도구 전부는 tool-labels.test.ts 가 강제).
 */
export function toolAnnotations(tool: SharedTool): McpToolAnnotations {
  const title = TOOL_LABELS[tool.name]?.label;
  const base: McpToolAnnotations = title ? { title } : {};
  if (tool.kind === 'read') {
    return { ...base, readOnlyHint: true, openWorldHint: false };
  }
  return {
    ...base,
    readOnlyHint: false,
    destructiveHint: tool.hints.destructive,
    idempotentHint: tool.hints.idempotent,
    openWorldHint: tool.hints.openWorld ?? false,
  };
}
