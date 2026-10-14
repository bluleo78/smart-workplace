// 이슈 챗 질문 상태(WP-373 §5.1) — 질문한 AI 가 지금도 답변을 기다리는지(작업 상태 INPUT_REQUIRED)로 판정한다.
// 질문 글(삭제 안 됨)은 (1) 그 AI 의 마지막 질문이고 (2) 이슈의 AI 작업 목록에서 그 AI 가 INPUT_REQUIRED 일 때만 열린 질문, 나머지는 답변됨.
// 사람 글이 뒤에 있는지는 보지 않는다 — 사람이 AI 도구로 올린 진행 보고 글은 사람 작성이지만 AI 를 WORKING 으로 되돌리지 않으므로(서버 규칙),
// 글 작성자가 아니라 AI 의 실제 상태를 따라야 AI 작업 화면의 「답변 필요」와 어긋나지 않는다. 사람이 진짜로 답하면 서버가 AI 를 WORKING 으로 바꿔 답변됨이 된다.
// 답변 여부는 저장하지 않고 로드된 메시지 범위에서 도출한다 — 위쪽 이전 페이지가 로드되면 같은 규칙으로 다시 판정된다.
import type { ChatMessageResponse } from '@/types/chat'

export type QuestionState = 'open' | 'answered'

/**
 * 오래된 순 메시지 → 질문 글 id 별 상태. 뒤에서부터 한 번 훑는다(O(n)).
 * @param waitingAgentIds 답변을 기다리는(INPUT_REQUIRED) AI 사용자 id 집합. undefined = 이슈 데이터 미로드 → 대기 중으로 간주(첫 화면에서 「답변됨」이 깜빡이지 않게).
 */
export function questionStates(
  sortedAsc: ChatMessageResponse[],
  waitingAgentIds: ReadonlySet<number> | undefined,
): Map<number, QuestionState> {
  const out = new Map<number, QuestionState>()
  // 이미 마지막 질문이 나온 AI — 그보다 앞선 같은 AI 의 질문은 무조건 답변됨.
  const seenAuthors = new Set<number>()
  for (let i = sortedAsc.length - 1; i >= 0; i--) {
    const m = sortedAsc[i]
    if (m.deleted || !m.question) continue
    const isLatest = !seenAuthors.has(m.authorId)
    seenAuthors.add(m.authorId)
    const waiting = waitingAgentIds === undefined || waitingAgentIds.has(m.authorId)
    out.set(m.id, isLatest && waiting ? 'open' : 'answered')
  }
  return out
}
