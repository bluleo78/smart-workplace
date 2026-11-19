// 사람 카드 「일 맡기기」 연결(WP-1767) — 맡길 곳(새 이슈 창)을 가진 화면이 처리기를 깔아 두면, 그 아래 어느 카드든 AI 카드에 「일 맡기기」를 보인다.
// 이슈 상세는 코멘트·담당자·보고자·이슈 챗처럼 여는 곳이 흩어져 있어 처리기를 하나씩 넘기지 않고 컨텍스트 하나로 내려 준다.
// 앱 셸(AppLayout)이 프로젝트를 고르는 전역 처리기를 깔고(WP-1768), 이슈 상세는 그 이슈 프로젝트로 고정한 처리기로 덮는다.
// 처리기가 없는 곳(앱 셸 밖에서 따로 그린 화면)에서는 undefined 라 「일 맡기기」가 숨는다.
import { createContext, useContext } from 'react'

/** AI id 를 받아 그 AI 를 골라 둔 새 이슈 창을 연다. */
export type AssignWorkHandler = (agentId: number) => void

export const PersonCardAssignContext = createContext<AssignWorkHandler | undefined>(undefined)

/** 가까운 화면이 깐 「일 맡기기」 처리기 — 없으면 undefined. */
export function usePersonCardAssign(): AssignWorkHandler | undefined {
  return useContext(PersonCardAssignContext)
}
