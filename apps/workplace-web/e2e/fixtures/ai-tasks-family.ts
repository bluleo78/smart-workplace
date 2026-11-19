// AI 위임 작업 가족 행(WP-1800) 모킹 — 데스크톱·모바일 페이지 테스트가 함께 쓴다.
// 「에픽 없음」 묶음에 머리 501(자기 보고는 3시간 전이지만 가족 최근 보고는 30분 전) + 하위 502, 그리고 부모(999)가 목록에 없는 단독 하위 503.
import { createAgentWork, minutesAgo } from '../factories/agentWork.factory'
import { createIssue } from '../factories/issue.factory'
import { makeEpicType } from '../factories/issueType.factory'
import type { IssueResponse } from '../../src/types/issue'

const parentOf = (number: number, title: string) => ({ number, title, type: makeEpicType(), status: 'IN_PROGRESS' as const })
const group = (family?: { headNumber?: number; lastReportAt?: string; stale?: boolean }) => ({
  epicNumber: null, size: 3, epicChildCount: 0, epicChildDoneCount: 0, family,
})

/** stale — 머리의 family.stale 값(가족 기준 정체 여부). grandchild — 하위 502 의 하위(손자) 504 를 머리 가족으로 더한다. */
export function familyRows(stale = false, grandchild = false): IssueResponse[] {
  const rows: IssueResponse[] = [
    createIssue({
      id: 501, number: 501, title: '가족 머리 작업', status: 'IN_PROGRESS', childCount: 1,
      aiGroup: group({ lastReportAt: minutesAgo(30), stale }),
      agentWork: [createAgentWork({ state: 'WORKING', updatedAt: minutesAgo(180), stale: true })],
    }),
    createIssue({
      id: 502, number: 502, title: '가족 하위 작업', status: 'IN_PROGRESS', parent: parentOf(501, '가족 머리 작업'),
      aiGroup: group({ headNumber: 501 }),
      agentWork: [createAgentWork({ state: 'WORKING', updatedAt: minutesAgo(30) })],
    }),
    createIssue({
      id: 503, number: 503, title: '부모가 없는 하위', status: 'IN_PROGRESS', parent: parentOf(999, '목록에 없는 부모'),
      aiGroup: group(),
      agentWork: [createAgentWork({ state: 'WORKING', updatedAt: minutesAgo(20) })],
    }),
  ]
  if (grandchild) {
    // 손자는 서버가 가족 머리(501) 번호를 싣고 하위 502 뒤에 준다 — 화면에서 같은 들여쓰기라 실제 부모 칩이 필요하다.
    rows.splice(2, 0, createIssue({
      id: 504, number: 504, title: '가족 손자 작업', status: 'IN_PROGRESS', parent: parentOf(502, '가족 하위 작업'),
      aiGroup: group({ headNumber: 501 }),
      agentWork: [createAgentWork({ state: 'WORKING', updatedAt: minutesAgo(10) })],
    }))
  }
  return rows
}
