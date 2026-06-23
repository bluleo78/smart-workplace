import type { IssuePriority,IssueResponse } from '@/types/issue'

// 위젯 행의 출처 버킷 — 위급도 정렬 순서를 표현한다. ③④는 향후 백엔드 신호용 자리.
export type MyTaskBucket =
  | 'due'
  | 'blocked'
  | 'ai_followup'
  | 'mention'
  | 'in_progress'
  | 'todo'         // ⑤-b 미시작 배정(status=TODO, 마감·blocked 없음)
  | 'watched'

export interface MyTaskRow {
  issue: IssueResponse
  bucket: MyTaskBucket
}

export interface MyTaskResult {
  rows: MyTaskRow[]
  waitingCount: number
  isEmpty: boolean
  watchedTotal: number
  watchedToday: number
}

const PRIORITY_RANK: Record<IssuePriority, number> = { HIGH: 0, MID: 1, LOW: 2 }

// 로컬 타임존 기준 YYYY-MM-DD 키.
function dateKeyLocal(d: Date): string {
  const y = d.getFullYear()
  const m = `${d.getMonth() + 1}`.padStart(2, '0')
  const day = `${d.getDate()}`.padStart(2, '0')
  return `${y}-${m}-${day}`
}

// "오늘+1"(내일) 날짜 키 — 마감 임박 상한.
function tomorrowKey(now: Date): string {
  const t = new Date(now)
  t.setDate(t.getDate() + 1)
  return dateKeyLocal(t)
}

// 담당 버킷 내 정렬: priority desc → dueDate asc(null 뒤) → updatedAt desc.
function compareAssigned(a: IssueResponse, b: IssueResponse): number {
  const p = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]
  if (p !== 0) return p
  const ad = a.dueDate ?? '￿'
  const bd = b.dueDate ?? '￿'
  if (ad !== bd) return ad < bd ? -1 : 1
  return a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0
}

/**
 * 홈 "내 작업" 위젯 행 구성 — 담당/워치 이슈를 위급도 버킷으로 분류·정렬·중복제거한다.
 * - 담당기반(due/blocked/in_progress) 행이 주인공, 워치는 limit 까지 채움(담당 0 이면 행 없음).
 * - now 를 주입받아 마감/오늘 판정을 결정적으로 한다(테스트 용이).
 */
export function buildMyTaskRows(
  assigned: IssueResponse[],
  watched: IssueResponse[],
  limit: number,
  now: Date,
): MyTaskResult {
  const dueLimit = tomorrowKey(now)
  const active = assigned.filter((i) => i.status !== 'DONE' && i.status !== 'CANCELED')

  const due = active
    .filter((i) => i.dueDate != null && i.dueDate <= dueLimit)
    .sort(compareAssigned)
  const dueIds = new Set(due.map((i) => i.id))

  const blocked = active
    .filter((i) => i.blocked && !dueIds.has(i.id))
    .sort(compareAssigned)
  const blockedIds = new Set(blocked.map((i) => i.id))

  const inProgress = active
    .filter((i) => i.status === 'IN_PROGRESS' && !dueIds.has(i.id) && !blockedIds.has(i.id))
    .sort(compareAssigned)

  // 미시작 배정 — status=TODO 이면서 due/blocked 에 안 잡힌 것. (in_progress 는 status 로 자연 배제)
  const todo = active
    .filter((i) => i.status === 'TODO' && !dueIds.has(i.id) && !blockedIds.has(i.id))
    .sort(compareAssigned)

  const assignedRows: MyTaskRow[] = [
    ...due.map((issue) => ({ issue, bucket: 'due' as const })),
    ...blocked.map((issue) => ({ issue, bucket: 'blocked' as const })),
    ...inProgress.map((issue) => ({ issue, bucket: 'in_progress' as const })),
    ...todo.map((issue) => ({ issue, bucket: 'todo' as const })),
  ]
  const waitingCount = assignedRows.length

  const todayKey = dateKeyLocal(now)
  const watchedToday = watched.filter((i) => dateKeyLocal(new Date(i.updatedAt)) === todayKey).length

  if (waitingCount === 0) {
    return { rows: [], waitingCount: 0, isEmpty: true, watchedTotal: watched.length, watchedToday }
  }

  const usedIds = new Set(assignedRows.map((r) => r.issue.id))
  const watchedRows: MyTaskRow[] = [...watched]
    .filter((i) => !usedIds.has(i.id))
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0))
    .map((issue) => ({ issue, bucket: 'watched' as const }))

  const rows = [...assignedRows, ...watchedRows].slice(0, limit)
  return { rows, waitingCount, isEmpty: false, watchedTotal: watched.length, watchedToday }
}

// 마감 메타 텍스트 — 지남/오늘/D-n. dueDate 는 YYYY-MM-DD, now 기준 로컬 자정 일수 차.
export function dueLabel(dueDate: string, now: Date): string {
  const [y, m, d] = dueDate.split('-').map(Number)
  const due = new Date(y, m - 1, d)
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const days = Math.round((due.getTime() - today.getTime()) / 86_400_000)
  if (days < 0) return '지남'
  if (days === 0) return '오늘'
  return `D-${days}`
}
