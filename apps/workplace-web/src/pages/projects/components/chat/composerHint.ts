// 이슈 챗 작성창 안내(WP-373 §5.2) — 외부 실행 AI 가 담당한 이슈에서 사람이 멘션 없이 답해도 그 AI 가 읽고 이어 간다는 것을 알린다.
import { SHIFT_ENTER_HINT } from '@/lib/submitEnter'
import { subjectParticle } from '@/lib/utils'
import type { ChatImplicitAgent } from '@/types/chat'

/** 외부 실행 AI 이름 → 작성창 안내. 이름이 없으면 undefined(기본 안내를 쓴다). */
export function agentReplyHint(name: string | null | undefined): string | undefined {
  const n = name?.trim()
  if (!n) return undefined
  return `답변 입력… 멘션 없이 보내도 ${n}${subjectParticle(n)} 이어받아요`
}

/** 멘션 없이도 답하는 담당 AI 의 작성창 안내(WP-1377) — placeholder 와 입력칸 아래 한 줄. */
export interface ImplicitAgentHint {
  placeholder: string;
  note: string;
}

/**
 * 담당 AI(실행 일정, WP-1377)가 지금 보내는 멘션 없는 글에 답하는지 판정해 안내를 만든다. 답하지 않으면 undefined.
 * - mode ALWAYS 면 늘 답한다(mode 는 ALWAYS | AFTER_AI_REPLY 둘뿐 — ChatImplicitAgent).
 * - AFTER_AI_REPLY 면 삭제되지 않은 마지막 글이 그 AI 의 글일 때만 — 서버도 「직전 글」에서 삭제된 글을 건너뛰므로 같게 본다.
 * 마지막 글은 서버 id 로 고른다(서버의 「직전 글」 판정도 id 순) — createdAt 은 낙관적 글(내 브라우저 시계)과 서버 시각이 섞여 순서를 믿을 수
 *   없다(WP-1377). 아직 저장 중인 내 낙관적 글(음수 임시 id, useCreateChatMessage)은 늘 가장 마지막 글로 본다 — 방금 보낸 글이다.
 * 터치 셸은 Enter 가 줄바꿈이라 Shift+Enter 안내를 뺀다(ChatComposer 의 기본 문구와 같은 기준).
 */
export function implicitAgentHint(
  agent: ChatImplicitAgent | null | undefined,
  messages: readonly { id: number; authorId: number; deleted: boolean }[],
  touchShell = false,
): ImplicitAgentHint | undefined {
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
  return {
    placeholder: `${name}에게 메시지${touchShell ? '' : SHIFT_ENTER_HINT}`,
    note: `이 작업의 담당 AI ${name}${subjectParticle(name)} 멘션 없이도 답합니다`,
  }
}
