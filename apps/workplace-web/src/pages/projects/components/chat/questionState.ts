// 이슈 챗 질문 상태(WP-373 §5.1) — 질문한 AI 가 지금도 답변을 기다리는지(작업 상태 INPUT_REQUIRED)로 판정한다.
// 질문 글(삭제 안 됨)은 (1) 그 AI 의 마지막 질문이고 (2) 이슈의 AI 작업 목록에서 그 AI 가 INPUT_REQUIRED 일 때만 열린 질문, 나머지는 답변됨.
// 사람 글이 뒤에 있는지는 보지 않는다 — 사람이 AI 도구로 올린 진행 보고 글은 사람 작성이지만 AI 를 WORKING 으로 되돌리지 않으므로(서버 규칙),
// 글 작성자가 아니라 AI 의 실제 상태를 따라야 AI 작업 화면의 「답변 필요」와 어긋나지 않는다. 사람이 진짜로 답하면 서버가 AI 를 WORKING 으로 바꿔 답변됨이 된다.
// WP-391: 질문 글이 실시간으로 먼저 오고 이슈(작업 상태)는 1~2초 뒤 다시 받는다 — 그 사이 작업 상태는 질문 전 값이라, 작업의 마지막 갱신이 질문 글보다
// 이르면 아직 그 질문을 반영하지 못한 것으로 보고 열린 질문으로 둔다(답은 질문 뒤에 오므로 갱신 시각이 질문보다 늦다). 이슈를 아직 받는 중이면 대기 중으로
// 보고(첫 화면에서 「답변됨」이 깜빡이지 않게), 마지막 조회가 실패했으면 어느 쪽으로도 단정하지 않는다(unknown).
// 답변 여부는 저장하지 않고 로드된 메시지 범위에서 도출한다 — 위쪽 이전 페이지가 로드되면 같은 규칙으로 다시 판정된다.
import type { AgentQuestionWork } from '@/lib/agentWork'
import type { ChatMessageResponse } from '@/types/chat'

export type QuestionState = 'open' | 'answered' | 'unknown'

/** 질문 판정에 쓰는 이슈 쪽 재료 — AI 구성원 id → 작업 재료(agentQuestionWorks), 아직 받는 중('loading'), 마지막 조회 실패('failed'). */
export type QuestionWorks = ReadonlyMap<number, AgentQuestionWork> | 'loading' | 'failed'

/**
 * 오래된 순 메시지 → 질문 글 id 별 상태. 뒤에서부터 한 번 훑는다(O(n)).
 * @param works 이슈 쪽 재료. 'loading' 이면 각 AI 의 마지막 질문은 open, 'failed' 면 unknown.
 */
export function questionStates(sortedAsc: ChatMessageResponse[], works: QuestionWorks): Map<number, QuestionState> {
  const out = new Map<number, QuestionState>()
  // 이미 마지막 질문이 나온 AI — 그보다 앞선 같은 AI 의 질문은 무조건 답변됨.
  const seenAuthors = new Set<number>()
  for (let i = sortedAsc.length - 1; i >= 0; i--) {
    const m = sortedAsc[i]
    if (m.deleted || !m.question) continue
    const isLatest = !seenAuthors.has(m.authorId)
    seenAuthors.add(m.authorId)
    out.set(m.id, isLatest ? latestState(m, works) : 'answered')
  }
  return out
}

/** AI 의 마지막 질문 상태 — 받는 중이면 open, 조회 실패면 unknown, 답변 대기이거나 작업 상태가 질문보다 오래된 값이면 open. */
function latestState(m: ChatMessageResponse, works: QuestionWorks): QuestionState {
  if (works === 'loading') return 'open'
  if (works === 'failed') return 'unknown'
  const w = works.get(m.authorId)
  // 진행 중 작업이 없으면(끝남·취소) 더 기다리는 질문이 아니다.
  if (!w) return 'answered'
  return w.waiting || w.updatedAt < Date.parse(m.createdAt) ? 'open' : 'answered'
}
