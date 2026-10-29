// AI 위임 작업 에픽 묶음(WP-375) 모킹 데이터 — 데스크톱·모바일 spec 과 캡처가 함께 쓴다.
// 서버가 묶음 단위로 정렬해 준 순서 그대로: WP-412 묶음(에픽 자신 행 + 413·414·415), WP-420 묶음(에픽 행 없음, 421·422),
// 「에픽 없음」 묶음 430·431(WP-1211 — 431 은 비에픽 부모라 부모 칩을 남긴다).
import { createAgentWork, humanWorker, minutesAgo } from '../factories/agentWork.factory'
import { createIssue } from '../factories/issue.factory'
import { makeEpicType, makeSubtaskType } from '../factories/issueType.factory'
import type { AiTaskGroup, IssueResponse } from '../../src/types/issue'
import type { UserSummary } from '../../src/types/user'

export const cody: UserSummary = { id: 21, username: 'cody', name: '코디', kind: 'AGENT' }
export const lumi: UserSummary = { id: 22, username: 'lumi', name: '루미', kind: 'AGENT' }

const epicType = makeEpicType()
const g = (epicNumber: number, size: number, epicChildCount: number, epicChildDoneCount: number): AiTaskGroup => ({
  epicNumber, size, epicChildCount, epicChildDoneCount,
})
/** 「에픽 없음」 묶음(WP-1211) — 에픽 번호 없음. */
const none = (size: number): AiTaskGroup => ({ epicNumber: null, size, epicChildCount: 0, epicChildDoneCount: 0 })
const parentOf = (number: number, title: string) => ({ number, title, type: epicType, status: 'IN_PROGRESS' as const })

export const GROUPED_ROWS: IssueResponse[] = [
  createIssue({
    id: 412, number: 412, title: '결제 모듈 개편', type: epicType, status: 'IN_PROGRESS', assignees: [cody], childCount: 5, childDoneCount: 1,
    aiGroup: g(412, 4, 5, 1),
    agentWork: [createAgentWork({ worker: cody, state: 'WORKING', note: '하위 3건 진행 중', updatedAt: minutesAgo(8) })],
  }),
  createIssue({
    id: 413, number: 413, title: '결제 실패 재시도 정책', status: 'IN_PROGRESS', assignees: [cody], parent: parentOf(412, '결제 모듈 개편'),
    aiGroup: g(412, 4, 5, 1),
    agentWork: [createAgentWork({ worker: cody, state: 'INPUT_REQUIRED', note: '재시도 횟수 3회와 5회 중 어느 쪽으로 할까요?', updatedAt: minutesAgo(12) })],
  }),
  createIssue({
    id: 414, number: 414, title: 'PG사 응답 코드 매핑', status: 'IN_PROGRESS', assignees: [cody], parent: parentOf(412, '결제 모듈 개편'),
    aiGroup: g(412, 4, 5, 1),
    agentWork: [createAgentWork({ worker: cody, state: 'WORKING', note: '응답 코드 42종 중 25종 매핑', progress: 60, updatedAt: minutesAgo(15) })],
  }),
  createIssue({
    id: 415, number: 415, title: '환불 API 연동', status: 'TODO', assignees: [cody], parent: parentOf(412, '결제 모듈 개편'),
    aiGroup: g(412, 4, 5, 1),
    agentWork: [createAgentWork({ worker: cody, state: 'SUBMITTED', tool: null, updatedAt: minutesAgo(5) })],
  }),
  createIssue({
    id: 421, number: 421, title: '알림 채널별 켜기/끄기', status: 'IN_PROGRESS', assignees: [humanWorker], parent: parentOf(420, '알림 설정 화면'),
    aiGroup: g(420, 2, 6, 2),
    agentWork: [createAgentWork({ worker: humanWorker, state: 'REVIEW', note: 'PR #88 검토 대기', progress: 100, updatedAt: minutesAgo(25) })],
  }),
  createIssue({
    id: 422, number: 422, title: '푸시 권한 안내', status: 'IN_PROGRESS', assignees: [lumi], parent: parentOf(420, '알림 설정 화면'),
    aiGroup: g(420, 2, 6, 2),
    agentWork: [createAgentWork({ worker: lumi, state: 'BLOCKED', note: 'iOS 권한 문구 확정 필요', updatedAt: minutesAgo(48) })],
  }),
  createIssue({
    id: 430, number: 430, title: '검색 결과 하이라이트', status: 'IN_PROGRESS', assignees: [lumi],
    aiGroup: none(2),
    agentWork: [createAgentWork({ worker: lumi, state: 'WORKING', note: '하이라이트 범위 계산 중', stepsDone: 2, stepsTotal: 5, updatedAt: minutesAgo(33) })],
  }),
  createIssue({
    id: 431, number: 431, title: '엑셀 내보내기 열 순서', type: makeSubtaskType(), status: 'IN_PROGRESS', assignees: [humanWorker],
    parent: parentOf(377, 'AI 작업 기록'),
    aiGroup: none(2),
    agentWork: [createAgentWork({ worker: humanWorker, state: 'PAUSED', note: '회의 후 이어서 진행', updatedAt: minutesAgo(125) })],
  }),
]
