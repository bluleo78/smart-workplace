// src/mcp-content.ts — MCP 도구 결과 콘텐츠 블록(WP-240).
// 도구는 문자열(대부분) 또는 content 블록 배열을 반환한다. 배열은 이미지처럼 텍스트로 표현할 수 없는
// 결과를 모델에 그대로 넘길 때 쓴다(WP-233 실측: Claude SDK·opencode 모두 MCP image 블록을 모델에 전달).
// 각 앱 서버 레이어는 toMcpContent 로 MCP 응답 content 를 만들고, 로그에는 summarizeToolResult 를 남긴다.

/**
 * MCP 응답 content 블록 — 우리가 쓰는 text·image 두 종류만. SDK 의 TextContent/ImageContent 와 구조적으로 호환되는
 * 의도적 부분집합이다(이 패키지는 zod 외 의존이 없어 @modelcontextprotocol/sdk 타입을 끌어오지 않는다).
 */
export type McpContent =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string }; // data = base64

/** 도구 핸들러 반환값 — 문자열은 text 블록 하나로 취급한다. */
export type McpToolResult = string | McpContent[];

/** 핸들러 반환값 → MCP 응답 content. 문자열은 text 블록 하나로 감싸 기존 도구 동작을 그대로 유지한다. */
export function toMcpContent(out: McpToolResult): McpContent[] {
  return typeof out === 'string' ? [{ type: 'text', text: out }] : out;
}

/**
 * 로그·진행 표시용 요약 문자열. 이미지 base64 가 로그나 콜백으로 새지 않도록 `[image/png 6KB]` 로 줄인다.
 * 크기는 base64 길이에서 원본 바이트를 역산(× 3/4)해 KB 로 반올림하고, 최소 1KB 로 표시한다.
 */
export function summarizeToolResult(out: McpToolResult): string {
  if (typeof out === 'string') return out;
  return out
    .map((b) =>
      b.type === 'text' ? b.text : `[${b.mimeType} ${Math.max(1, Math.round((b.data.length * 3) / 4 / 1024))}KB]`,
    )
    .join('\n');
}
