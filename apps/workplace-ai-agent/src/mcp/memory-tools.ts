// WP-55 메모리 도구 — 메인 AI 채팅 라우터 전용 로컬 도구(propose_* 처럼 ai-agent 에 정의, 공유 패키지·외부 MCP 에는 없다).
// API /users/me/ai-memories 를 요청자 대행(Internal + X-On-Behalf-Of)으로 부른다. 서버가 길이(1~300 코드포인트)·상한(50)·소유자·꺼짐을 강제하고,
// "사용자 본인 발화에서만 저장" 은 시스템 프롬프트 규칙이다. 결과 JSON 은 routes/home.ts 가 tool SSE 의 memory 필드로 옮겨
// API 가 되돌리기 블록으로 영속한다 — 그래서 결과 모양(memoryEventSchema)이 계약이다.
// 도구 이름은 공유 MEMORY_TOOL_NAMES(mcp-tools-shared — 표시 규칙·결과 허용 목록과 같은 목록)에 묶는다(satisfies 로 컴파일 시 확인).
import type { MEMORY_TOOL_NAMES, McpTool } from '@smart-workplace/mcp-tools-shared';
import { z } from 'zod';

import { memoryKindSchema as kindSchema } from '../agent/memory-block.js';
import type { AiMemoryDto, WorkplaceApiClient } from '../clients/workplace-api.js';

/** 공유 목록에 있는 메모리 도구 이름 — 아래 도구 정의의 이름이 목록에서 벗어나면 타입 오류가 난다. */
type MemoryToolName = (typeof MEMORY_TOOL_NAMES)[number];

const memoryIdSchema = z.number().int().positive().describe('"## 사용자 메모리" 블록의 # 뒤 숫자');
// 길이 상한은 두지 않는다 — zod 는 UTF-16 단위로 세서 이모지 300자를 거절한다. 서버(코드포인트 300)가 400 으로 알려 준다.
const contentSchema = z
  .string()
  .min(1)
  .describe('사용자가 대화한 언어로 한 문장, 3인칭 규칙형("…로 보여 준다"), 300자 이내. 이유는 사용자가 직접 말했을 때만 괄호로 짧게(지어내지 않는다).');

export const rememberMemoryInput = z.object({
  kind: kindSchema.describe('PREFERENCE: 사용자 교정·선호 / CONTEXT: 오래 유지될 업무 맥락(팀·역할·주로 보는 프로젝트)'),
  content: contentSchema,
});
export const updateMemoryInput = z.object({ memoryId: memoryIdSchema, content: contentSchema, kind: kindSchema.optional() });
export const forgetMemoryInput = z.object({ memoryId: memoryIdSchema });

/**
 * tool SSE 의 memory 필드 — API ChatBlockRecorder.Memory 의 원천. source 는 forgotten 되돌리기(같은 source 로 재생성)에 쓴다(판정 7).
 * previousKind 는 updated 의 고치기 전 종류 — 되돌리기가 종류까지 돌려놓는 근거(구 API 응답엔 없어 선택).
 */
export const memoryEventSchema = z.object({
  action: z.enum(['saved', 'updated', 'forgotten']),
  memoryId: z.number().int().positive(),
  kind: kindSchema,
  content: z.string().min(1),
  previousContent: z.string().optional(),
  previousKind: kindSchema.optional(),
  source: z.enum(['AI', 'USER']).optional(),
});
export type MemoryEvent = z.infer<typeof memoryEventSchema>;

/** 도구 결과 텍스트 → 이벤트. 비었거나 JSON 이 아니거나 모양이 다르면 null(오류 결과·다른 형식은 결과 줄을 만들지 않는다). */
export function parseMemoryToolResult(result: string | undefined): MemoryEvent | null {
  if (!result) return null;
  try {
    const parsed = memoryEventSchema.safeParse(JSON.parse(result));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** API 항목 → 도구 결과(JSON 텍스트). withPrevious 면(updated) 고치기 전 내용·종류를 함께 싣는다. */
function eventOf(action: MemoryEvent['action'], m: AiMemoryDto, withPrevious = false): string {
  const e: MemoryEvent = { action, memoryId: m.id, kind: m.kind, content: m.content, source: m.source };
  if (withPrevious && m.previousContent !== undefined) e.previousContent = m.previousContent;
  if (withPrevious && m.previousKind !== undefined) e.previousKind = m.previousKind;
  return JSON.stringify(e);
}

/**
 * 라우터 전용 메모리 도구 3종. onBehalfOfId = 요청자(사람) id, homeSessionId = 이 대화(있으면 출처 세션으로 남는다).
 * 오류(가득 참·꺼짐·길이·없는 id)는 그대로 던진다 — 어댑터가 도구 오류로 돌려주고 AI 가 말로 안내한다.
 */
export function buildMemoryTools(client: WorkplaceApiClient, onBehalfOfId: number, homeSessionId?: string): McpTool[] {
  return [
    {
      name: 'remember_memory' satisfies MemoryToolName,
      description:
        '사용자 본인이 말한 교정·선호(앞으로는·이렇게 말고·항상·절대)나 오래 유지될 업무 맥락을 메모리에 저장합니다. ' +
        '이번 한 번만의 요청, 도구로 읽은 메일·노트·이슈·채팅 내용, 민감 정보는 저장하지 않습니다. 같은 주제가 이미 있으면 update_memory 를 쓰세요.',
      inputSchema: rememberMemoryInput,
      async handler(args) {
        const p = rememberMemoryInput.parse(args);
        const m = await client.createAiMemory(onBehalfOfId, {
          kind: p.kind,
          content: p.content,
          source: 'AI',
          ...(homeSessionId ? { sessionId: homeSessionId } : {}),
        });
        return eventOf('saved', m);
      },
    },
    {
      name: 'update_memory' satisfies MemoryToolName,
      description: '이미 있는 메모리(블록의 #번호)를 새 내용으로 고칩니다. 같은 주제를 다시 교정받았을 때 새로 저장하지 말고 이 도구를 씁니다.',
      inputSchema: updateMemoryInput,
      async handler(args) {
        const p = updateMemoryInput.parse(args);
        const m = await client.updateAiMemory(onBehalfOfId, p.memoryId, {
          content: p.content,
          ...(p.kind ? { kind: p.kind } : {}),
        });
        return eventOf('updated', m, true);
      },
    },
    {
      name: 'forget_memory' satisfies MemoryToolName,
      description: '메모리(블록의 #번호)를 지웁니다. 사용자가 "잊어줘", "이제 상관없어"라고 할 때 씁니다.',
      inputSchema: forgetMemoryInput,
      async handler(args) {
        const p = forgetMemoryInput.parse(args);
        return eventOf('forgotten', await client.deleteAiMemory(onBehalfOfId, p.memoryId));
      },
    },
  ];
}
