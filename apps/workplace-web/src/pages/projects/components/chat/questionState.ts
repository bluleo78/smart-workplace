// 이슈 챗 질문 상태(WP-373 §5.1) — 질문 글 뒤에 사람 글(삭제 안 됨, 보내는 중 포함)이 하나라도 있으면 답변됨, 없으면 열린 질문.
// 답변 여부는 저장하지 않고 로드된 메시지 범위에서 도출한다 — 위쪽 이전 페이지가 로드되면 같은 규칙으로 다시 판정된다.
import type { ChatMessageResponse } from '@/types/chat'

export type QuestionState = 'open' | 'answered'

/** 오래된 순 메시지 → 질문 글 id 별 상태. 뒤에서부터 한 번 훑는다(O(n)). */
export function questionStates(sortedAsc: ChatMessageResponse[]): Map<number, QuestionState> {
  const out = new Map<number, QuestionState>()
  let humanAfter = false
  for (let i = sortedAsc.length - 1; i >= 0; i--) {
    const m = sortedAsc[i]
    if (m.deleted) continue
    if (m.question) out.set(m.id, humanAfter ? 'answered' : 'open')
    if (m.authorKind === 'HUMAN') humanAfter = true
  }
  return out
}
