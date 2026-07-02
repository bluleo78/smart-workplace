// src/tools/types.ts — MCP 도구 정의. 핸들러는 문자열(주로 JSON)을 반환하고,
// SDK 응답 형태로의 변환·에러 래핑은 서버 레이어(Task 8)가 담당한다.
import type { z } from 'zod';

export interface McpTool {
  name: string;
  description: string;
  inputSchema: z.ZodObject<z.ZodRawShape>;
  handler: (args: unknown) => Promise<string>;
}
