import { describe, expect, it } from 'vitest'

import type { IssueResponse } from '@/types/issue'

import { buildMyTaskRows, dueLabel } from './myTasks'

// 테스트용 이슈 팩토리 — 필요한 필드만 채우고 나머지는 기본값.
function issue(over: Partial<IssueResponse>): IssueResponse {
  return {
    id: 1,
    projectKey: 'API',
    number: 1,
    title: 't',
    status: 'TODO',
    priority: 'MID',
    dueDate: null,
    startDate: null,
    milestoneId: null,
    reporterId: 1,
    createdAt: '2026-06-20T00:00:00Z',
    updatedAt: '2026-06-20T00:00:00Z',
    labels: [],
    attachmentCount: 0,
    type: null,
    assignees: [],
    parent: null,
    childCount: 0,
    childDoneCount: 0,
    blockedBy: [],
    blocks: [],
    blocked: false,
    customFields: [],
    ...over,
  }
}

const NOW = new Date('2026-06-23T09:00:00Z')

describe('buildMyTaskRows', () => {
  it('버킷 순서대로 정렬한다: due → blocked → in_progress', () => {
    const assigned = [
      issue({ id: 10, number: 10, status: 'IN_PROGRESS' }),
      issue({ id: 11, number: 11, blocked: true }),
      issue({ id: 12, number: 12, dueDate: '2026-06-23' }),
    ]
    const r = buildMyTaskRows(assigned, [], 5, NOW)
    expect(r.rows.map((x) => x.bucket)).toEqual(['due', 'blocked', 'in_progress'])
    expect(r.waitingCount).toBe(3)
    expect(r.isEmpty).toBe(false)
  })

  it('한 이슈가 여러 버킷에 해당하면 최상위 버킷 1회만', () => {
    // 마감 임박 + blocked 동시 → due 에서만 1회.
    const assigned = [issue({ id: 20, number: 20, dueDate: '2026-06-23', blocked: true })]
    const r = buildMyTaskRows(assigned, [], 5, NOW)
    expect(r.rows).toHaveLength(1)
    expect(r.rows[0].bucket).toBe('due')
  })

  it('DONE/CANCELED 담당은 어떤 버킷에도 안 들어간다', () => {
    const assigned = [
      issue({ id: 30, number: 30, status: 'DONE', dueDate: '2026-06-23' }),
      issue({ id: 31, number: 31, status: 'CANCELED', blocked: true }),
    ]
    const r = buildMyTaskRows(assigned, [], 5, NOW)
    expect(r.rows).toHaveLength(0)
    expect(r.isEmpty).toBe(true)
  })

  it('담당기반 행이 있으면 워치로 limit 까지 채우되 중복 id 제외', () => {
    const assigned = [issue({ id: 40, number: 40, status: 'IN_PROGRESS' })]
    const watched = [
      issue({ id: 40, number: 40, updatedAt: '2026-06-23T01:00:00Z' }), // 중복 → 제외
      issue({ id: 41, number: 41, updatedAt: '2026-06-23T02:00:00Z' }),
      issue({ id: 42, number: 42, updatedAt: '2026-06-21T00:00:00Z' }),
    ]
    const r = buildMyTaskRows(assigned, watched, 5, NOW)
    expect(r.rows.map((x) => x.issue.id)).toEqual([40, 41, 42])
    expect(r.rows[1].bucket).toBe('watched')
  })

  it('담당기반 0 이면 isEmpty=true 이고 워치는 행으로 넣지 않는다', () => {
    const watched = [
      issue({ id: 50, number: 50, updatedAt: '2026-06-23T01:00:00Z' }),
      issue({ id: 51, number: 51, updatedAt: '2026-06-20T00:00:00Z' }),
    ]
    const r = buildMyTaskRows([], watched, 5, NOW)
    expect(r.isEmpty).toBe(true)
    expect(r.rows).toHaveLength(0)
    expect(r.watchedTotal).toBe(2)
    expect(r.watchedToday).toBe(1) // id50 만 오늘
  })

  it('limit 을 초과하면 잘라낸다', () => {
    const assigned = Array.from({ length: 8 }, (_, i) =>
      issue({ id: 60 + i, number: 60 + i, status: 'IN_PROGRESS' }),
    )
    const r = buildMyTaskRows(assigned, [], 5, NOW)
    expect(r.rows).toHaveLength(5)
    expect(r.waitingCount).toBe(8) // waitingCount 는 slice 전 담당기반 총수
  })

  it('버킷 내 priority desc 정렬', () => {
    const assigned = [
      issue({ id: 70, number: 70, status: 'IN_PROGRESS', priority: 'LOW' }),
      issue({ id: 71, number: 71, status: 'IN_PROGRESS', priority: 'HIGH' }),
    ]
    const r = buildMyTaskRows(assigned, [], 5, NOW)
    expect(r.rows.map((x) => x.issue.id)).toEqual([71, 70])
  })

  it('미시작 TODO는 todo 버킷으로 in_progress 아래에 온다', () => {
    const assigned = [
      issue({ id: 80, number: 80, status: 'IN_PROGRESS' }),
      issue({ id: 81, number: 81, status: 'TODO' }), // 마감·blocked 없음
    ]
    const r = buildMyTaskRows(assigned, [], 5, NOW)
    expect(r.rows.map((x) => x.bucket)).toEqual(['in_progress', 'todo'])
    expect(r.waitingCount).toBe(2)
    expect(r.isEmpty).toBe(false)
  })

  it('미시작 TODO만 있어도 isEmpty=false (빈상태 아님)', () => {
    const r = buildMyTaskRows([issue({ id: 82, number: 82, status: 'TODO' })], [], 5, NOW)
    expect(r.isEmpty).toBe(false)
    expect(r.rows).toHaveLength(1)
    expect(r.rows[0].bucket).toBe('todo')
  })
})

describe('dueLabel', () => {
  const NOW2 = new Date('2026-06-23T09:00:00Z')
  it('지난 마감은 "지남"', () => {
    expect(dueLabel('2026-06-22', NOW2)).toBe('지남')
  })
  it('오늘 마감은 "오늘"', () => {
    expect(dueLabel('2026-06-23', NOW2)).toBe('오늘')
  })
  it('미래 마감은 "D-n"', () => {
    expect(dueLabel('2026-06-25', NOW2)).toBe('D-2')
  })
})
