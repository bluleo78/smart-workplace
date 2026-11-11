// 이슈 챗 작성창 안내 — 멘션 없이도 답하는 AI(외부 실행 AI·담당 AI)를 알린다.
// WP-1499: 외부 실행 AI(WP-373) 안내도 담당 AI(WP-1377)와 같은 형식 하나 — 짧은 placeholder + 입력칸 아래 한 줄.
import { SHIFT_ENTER_HINT } from '@/lib/submitEnter'
import type { ChatImplicitAgent } from '@/types/chat'

/** 멘션 없이도 답하는 AI(외부 실행 AI·담당 AI)의 작성창 안내(WP-1377·WP-1499) — placeholder 와 입력칸 아래 한 줄. */
export interface AgentHint {
  placeholder: string;
  note: string;
}

/**
 * 안내 문구를 만든다(WP-1499) — 외부 실행 AI·담당 AI 가 같은 문구를 쓰도록 한곳에 둔다.
 * 아래 한 줄은 「이(가)」 조사를 붙이지 않는다 — 영문·숫자·괄호로 끝나는 이름은 받침 판정이 안 돼 어색해서다.
 * 터치 셸은 Enter 가 줄바꿈이라 Shift+Enter 안내를 뺀다(ChatComposer 의 기본 문구와 같은 기준).
 */
function agentHint(name: string, touchShell: boolean): AgentHint {
  return {
    placeholder: `${name}에게 메시지${touchShell ? '' : SHIFT_ENTER_HINT}`,
    note: `담당 AI ${name} · 멘션 없이도 답합니다`,
  }
}

/**
 * 외부 실행 AI(WP-373)가 담당한 이슈의 작성창 안내(WP-1499). 이름이 없거나 공백이면 undefined(기본 안내를 쓴다).
 * 외부 실행 AI 는 멘션 없는 글에도 늘 이어 답하므로 담당 AI 와 달리 차례 판정을 하지 않는다(ALWAYS 취급).
 */
export function externalAgentHint(
  name: string | null | undefined,
  touchShell = false,
): AgentHint | undefined {
  const n = name?.trim()
  if (!n) return undefined
  return agentHint(n, touchShell)
}

/**
 * 담당 AI(실행 일정, WP-1377)가 지금 보내는 멘션 없는 글에 답하는지 판정해 안내를 만든다. 답하지 않으면 undefined.
 * - mode ALWAYS 면 늘 답한다(mode 는 ALWAYS | AFTER_AI_REPLY 둘뿐 — ChatImplicitAgent).
 * - AFTER_AI_REPLY 면 삭제되지 않은 마지막 글이 그 AI 의 글일 때만 — 서버도 「직전 글」에서 삭제된 글을 건너뛰므로 같게 본다.
 * 마지막 글은 서버 id 로 고른다(서버의 「직전 글」 판정도 id 순) — createdAt 은 낙관적 글(내 브라우저 시계)과 서버 시각이 섞여 순서를 믿을 수
 *   없다(WP-1377). 아직 저장 중인 내 낙관적 글(음수 임시 id, useCreateChatMessage)은 늘 가장 마지막 글로 본다 — 방금 보낸 글이다.
 * 문구는 외부 실행 AI 안내와 같다(agentHint, WP-1499).
 */
export function implicitAgentHint(
  agent: ChatImplicitAgent | null | undefined,
  messages: readonly { id: number; authorId: number; deleted: boolean }[],
  touchShell = false,
): AgentHint | undefined {
  const name = agent?.name?.trim()
  if (!agent || !name) return undefined
  if (agent.mode === 'AFTER_AI_REPLY') {
    let last: { id: number; authorId: number } | undefined
    for (const m of messages) {
      if (m.deleted) continue
      // 낙관적 글(음수 id)이 보이면 그 글이 마지막이다 — 서버 id 와 견주지 않는다.
      if (m.id < 0) {
        last = m
        break
      }
      if (!last || m.id > last.id) last = m
    }
    if (!last || last.authorId !== agent.id) return undefined
  }
  return agentHint(name, touchShell)
}
