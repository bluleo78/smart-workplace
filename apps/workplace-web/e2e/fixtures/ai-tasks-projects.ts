// AI 위임 작업 프로젝트 머리 줄(WP-426) E2E 모킹 — 서버가 프로젝트 단위로 정렬해 준 세 프로젝트(WP·HR·MKT) 행.
// aiProject.size 는 일부러 불러온 행 수와 다른 값(WP 5 · HR 4 · MKT 2)으로 둔다 — 머리 건수가 서버 값임을 검증하려고.
import { agentWorker, createAgentWork, humanWorker, minutesAgo } from '../factories/agentWork.factory'
import { createIssue } from '../factories/issue.factory'
import { makeEpicType } from '../factories/issueType.factory'
import type { AiTaskGroup, AiTaskProject, IssueResponse } from '../../src/types/issue'
import type { UserSummary } from '../../src/types/user'

const cody: UserSummary = { id: 21, username: 'cody', name: '코디', kind: 'AGENT' }
const lumi: UserSummary = { id: 22, username: 'lumi', name: '루미', kind: 'AGENT' }
const epicType = makeEpicType()
const g = (epicNumber: number, size: number, c: number, d: number): AiTaskGroup => ({ epicNumber, size, epicChildCount: c, epicChildDoneCount: d })
/** 「에픽 없음」 묶음(WP-1211) — 에픽 번호 없음. 각 프로젝트의 에픽 없는 행은 2건씩. */
const none: AiTaskGroup = { epicNumber: null, size: 2, epicChildCount: 0, epicChildDoneCount: 0 }
const parentOf = (number: number, title: string) => ({ number, title, type: epicType, status: 'IN_PROGRESS' as const })

const PROJECTS: Record<string, AiTaskProject> = {
  WP: { name: 'Smart Workplace', size: 5 },
  HR: { name: '인사팀', size: 4 },
  MKT: { name: '마케팅', size: 2 },
}
const mk = (projectKey: string, o: Partial<IssueResponse>): IssueResponse =>
  ({ ...createIssue({ projectKey, ...o }), aiProject: PROJECTS[projectKey] })

export function projectRows() {
  const r = {
    wp412: mk('WP', {
      id: 412, number: 412, title: '결제 모듈 개편', type: epicType, status: 'IN_PROGRESS', assignees: [cody], childCount: 5, childDoneCount: 1,
      aiGroup: g(412, 3, 5, 1),
      agentWork: [createAgentWork({ worker: cody, state: 'WORKING', note: '하위 3건 진행 중', updatedAt: minutesAgo(8) })],
    }),
    wp413: mk('WP', {
      id: 413, number: 413, title: '결제 실패 재시도 정책', status: 'IN_PROGRESS', priority: 'HIGH', assignees: [cody], parent: parentOf(412, '결제 모듈 개편'),
      aiGroup: g(412, 3, 5, 1),
      agentWork: [createAgentWork({ worker: cody, state: 'INPUT_REQUIRED', note: '재시도 횟수 3회와 5회 중 어느 쪽으로 할까요?', updatedAt: minutesAgo(12) })],
    }),
    wp414: mk('WP', {
      id: 414, number: 414, title: 'PG사 응답 코드 매핑', status: 'IN_PROGRESS', assignees: [cody], parent: parentOf(412, '결제 모듈 개편'),
      aiGroup: g(412, 3, 5, 1),
      agentWork: [createAgentWork({ worker: cody, state: 'WORKING', note: '응답 코드 42종 중 25종 매핑', progress: 60, updatedAt: minutesAgo(15) })],
    }),
    hr12: mk('HR', {
      id: 1012, number: 12, title: '신규 입사자 온보딩 체크리스트 정리', status: 'IN_PROGRESS', assignees: [lumi],
      aiGroup: none,
      agentWork: [createAgentWork({ worker: lumi, state: 'INPUT_REQUIRED', note: '계정 발급 담당자가 누구인가요?', updatedAt: minutesAgo(22) })],
    }),
    mkt58: mk('MKT', {
      id: 2058, number: 58, title: '10월 뉴스레터 초안 작성', status: 'IN_PROGRESS', assignees: [agentWorker],
      aiGroup: none,
      agentWork: [createAgentWork({ state: 'REVIEW', tool: 'cursor', note: '초안 3안 작성 완료 — 검토 부탁드려요', progress: 100, updatedAt: minutesAgo(35) })],
    }),
    wp418: mk('WP', {
      id: 418, number: 418, title: '메일 첨부 미리보기 깨짐 수정', status: 'IN_PROGRESS', assignees: [humanWorker],
      aiGroup: none,
      agentWork: [createAgentWork({ worker: humanWorker, state: 'REVIEW', note: 'PR #88 검토 대기', progress: 100, updatedAt: minutesAgo(48) })],
    }),
    mkt61: mk('MKT', {
      id: 2061, number: 61, title: '경쟁사 가격표 조사', status: 'IN_PROGRESS', assignees: [agentWorker],
      aiGroup: none,
      agentWork: [createAgentWork({ state: 'WORKING', tool: 'cursor', note: '3개사 중 2개사 정리', stepsDone: 2, stepsTotal: 3, updatedAt: minutesAgo(18) })],
    }),
    wp430: mk('WP', {
      id: 430, number: 430, title: '검색 결과 하이라이트', status: 'IN_PROGRESS', assignees: [lumi],
      aiGroup: none,
      agentWork: [createAgentWork({ worker: lumi, state: 'WORKING', note: '하이라이트 범위 계산 중', stepsDone: 2, stepsTotal: 5, updatedAt: minutesAgo(33) })],
    }),
    hr15: mk('HR', {
      id: 1015, number: 15, title: '상반기 평가 양식 정리', status: 'IN_PROGRESS', assignees: [humanWorker],
      aiGroup: none,
      agentWork: [createAgentWork({ worker: humanWorker, state: 'PAUSED', note: '회의 후 이어서 진행', updatedAt: minutesAgo(125) })],
    }),
  }
  // 서버 순서 — 가장 급한 이슈를 가진 프로젝트 먼저, 프로젝트 안은 급한 순(에픽 묶음은 연속).
  return [r.wp412, r.wp413, r.wp414, r.wp418, r.wp430, r.hr12, r.hr15, r.mkt58, r.mkt61]
}
