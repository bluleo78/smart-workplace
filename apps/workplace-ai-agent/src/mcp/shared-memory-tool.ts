// WP-386 remember_shared_memory — 메인 AI 채팅 라우터 전용 로컬 도구. 사용자가 "이건 팀 규칙으로 기억해"처럼 팀 공간에 남기라고 직접 말할 때만 쓴다.
// API POST /shared-ai-memories/requests 를 요청자 대행으로 부른다. API 가 추가 권한·공용성 검사(별도 AI, 동기)·한도를 강제하고,
// 통과하면 USER_REQUESTED 로 저장해 그 공간 기록 id(changeId)를 돌려준다. 결과 JSON(shared 이벤트)은 routes/home.ts 가 tool SSE memory 필드로 옮겨
// API 가 결과 줄(되돌리기 = 그 기록 되돌리기)로 영속한다.
// 알려진 실패(개인적 내용·검사 불가·공간 못 정함·권한·가득 참)는 던지지 않고 안내 문장을 결과로 돌려준다 — 모델이 다음 행동을 정확히 고르게(JSON 이 아니라 결과 줄은 생기지 않는다).
// 로그는 남기지 않는다 — 내용·요청자는 기존 메모리 도구처럼 어디에도 찍지 않는다.
import type { MEMORY_TOOL_NAMES, McpTool } from '@smart-workplace/mcp-tools-shared';
import axios from 'axios';
import { z } from 'zod';

import type { WorkplaceApiClient } from '../clients/workplace-api.js';
import type { SharedMemoryEvent } from './memory-tools.js';

/** 공유 목록에 있는 메모리 도구 이름 — 아래 도구 이름이 목록에서 벗어나면 타입 오류가 난다. */
type MemoryToolName = (typeof MEMORY_TOOL_NAMES)[number];

// 길이 상한은 스키마(.max)가 아니라 핸들러에서 코드포인트로 센다 — 개인 메모리 도구(memory-tools.ts contentSchema)처럼 zod 는 UTF-16 단위로 세서
// 이모지 300자를 거절하고, parse 단계에서 던지면 모델이 안내를 못 받는다. 서버 규칙(코드포인트 300)과 같게 세어 API 를 부르기 전에 invalid 안내를 돌려준다.
const SHARED_CONTENT_MAX = 300;
export const rememberSharedMemoryInput = z.object({
  content: z
    .string()
    .min(1)
    .describe('팀 규칙·관례·결정·사실을 사용자가 대화한 언어로 한 문장, 3인칭 규칙형("…로 쓴다", "…한다"), 300자 이내. 사람 이름·"나/내" 를 넣지 않는다.'),
  space: z
    .string()
    .optional()
    .describe('저장할 공간 — 프로젝트 이름·키 또는 노트 스페이스 이름. 생략하면 지금 공간("## 공용 메모리" 블록의 "지금 공간" 줄).'),
});

/**
 * 오류 코드별 안내 — 도구 결과로 모델에 간다(사용자에게 그대로 말하지 않아도 되는 지시 포함).
 * personal: 메모리 사용 설정이 꺼진 사용자(요청 앞 "메모리 꺼짐" 줄)는 개인 메모리 도구를 못 쓰므로 개인으로 돌리지 않고 저장 안 했음을 알린다.
 */
export const SHARED_TOOL_MESSAGES = {
  personal:
    '공용 메모리에 넣지 않았다 — 개인적인 내용이 들어 있어 팀 공용으로 맞지 않는다. "메모리 꺼짐" 줄이 없으면 remember_memory 로 개인 메모리에 저장하고 ' +
    '"개인 메모리로 기억했어요"라고 알린다. "메모리 꺼짐" 줄이 있으면 저장하지 말고 "개인적인 내용 같고 개인 메모리가 꺼져 있어 아무것도 저장하지 않았어요"라고만 알린다.',
  unavailable:
    '지금은 공용 메모리에 저장하지 못했어요 — 내용 확인이 끝나지 않았다. 사용자에게 그대로 알리고 개인 메모리로 대신 저장하지 않는다. 다시 시도하지 않는다.',
  spaceUnresolved: '어느 공간에 저장할지 정하지 못했다 — 도구를 다시 쓰기 전에 사용자에게 어느 프로젝트·노트 스페이스인지 묻는다.',
  forbidden: '이 공간의 공용 메모리에 추가할 수 없다 — 사유를 짧게 알린다.',
  full: '공용 메모리가 가득 찼다 — 다시 시도하지 말고 설정에서 정리해 달라고 안내한다.',
  invalid: '공용 메모리에 저장하지 못했다 — 내용이 비었거나 300자를 넘는다. 더 짧은 한 문장으로 줄여 한 번만 다시 시도하고, 그래도 안 되면 사용자에게 알린다.',
  notFound: '공용 메모리에 저장하지 못했다 — 그 공간을 찾을 수 없거나 더는 접근할 수 없다. 사용자에게 어느 프로젝트·노트 스페이스인지 다시 묻는다.',
} as const;

/** 안내로 바꾸는 API 오류 코드 → 안내 키. 서버 메시지(후보 공간 이름·사유)는 괄호로 덧붙인다. */
const HANDLED: Record<string, keyof typeof SHARED_TOOL_MESSAGES> = {
  SHARED_MEMORY_PERSONAL: 'personal',
  SHARED_MEMORY_CHECK_UNAVAILABLE: 'unavailable',
  SHARED_MEMORY_SPACE_UNRESOLVED: 'spaceUnresolved',
  SHARED_MEMORY_FORBIDDEN: 'forbidden',
  SHARED_MEMORY_FULL: 'full',
  SHARED_MEMORY_INVALID: 'invalid',
  SHARED_MEMORY_NOT_FOUND: 'notFound',
};

/** API 오류 → 안내 문장(다루는 코드가 아니면 null — 호출자가 던진다). 개인·검사 불가 안내는 서버 메시지를 붙이지 않는다(지시가 흐려지지 않게). */
function guidanceOf(e: unknown): string | null {
  if (!axios.isAxiosError(e) || !e.response) return null;
  const data = e.response.data as { message?: unknown; errors?: { code?: unknown } } | undefined;
  const key = typeof data?.errors?.code === 'string' ? HANDLED[data.errors.code] : undefined;
  if (!key) return null;
  const base = SHARED_TOOL_MESSAGES[key];
  const detail = typeof data?.message === 'string' ? data.message.trim() : '';
  return key === 'personal' || key === 'unavailable' || !detail ? base : `${base} (${detail})`;
}

/** 라우터 전용 공용 메모리 직접 요청 도구. onBehalfOfId = 요청자(사람), homeSessionId = 이 대화(API 가 지금 공간을 찾는 근거). */
export function buildSharedMemoryTool(client: WorkplaceApiClient, onBehalfOfId: number, homeSessionId?: string): McpTool {
  return {
    name: 'remember_shared_memory' satisfies MemoryToolName,
    description:
      '사용자가 "이건 팀·프로젝트·스페이스 규칙으로 기억해", "공용으로 기억해"처럼 팀 공간에 남기라고 직접 말할 때만, 그 공간 구성원 모두에게 적용되는 ' +
      '규칙·관례·결정·사실을 공용 메모리에 저장합니다. 그냥 "기억해"는 remember_memory(개인)를 씁니다. space 를 생략하면 지금 공간에 저장합니다 — ' +
      '지금 공간이 없고 사용자가 공간을 말하지 않았으면 이 도구를 쓰지 말고 어느 프로젝트·노트 스페이스인지 먼저 묻고, 조직 지침은 저장하지 않습니다' +
      '(관리자가 설정에서 직접 추가). 저장 전에 별도 확인이 개인적인 내용을 걸러 냅니다.',
    inputSchema: rememberSharedMemoryInput,
    async handler(args) {
      const p = rememberSharedMemoryInput.parse(args);
      // 서버(앞뒤 공백 제거 뒤 코드포인트 300)와 같게 센다 — 넘으면 API 를 부르지 않고 안내(던지지 않는다, 결과 줄 없음).
      if ([...p.content.trim()].length > SHARED_CONTENT_MAX) return SHARED_TOOL_MESSAGES.invalid;
      const space = p.space?.trim();
      try {
        const r = await client.requestSharedMemory(onBehalfOfId, {
          content: p.content,
          // 비었거나 "current" 면 생략 — API 가 이 대화의 지금 공간을 쓴다.
          ...(space && space.toLowerCase() !== 'current' ? { space } : {}),
          ...(homeSessionId ? { sessionId: homeSessionId } : {}),
        });
        const e: SharedMemoryEvent = { action: 'shared', changeId: r.changeId, memoryId: r.memoryId, spaceName: r.spaceName, content: r.content };
        return JSON.stringify(e);
      } catch (e) {
        const guidance = guidanceOf(e);
        if (guidance) return guidance;
        throw e;
      }
    },
  };
}
