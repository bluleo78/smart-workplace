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
