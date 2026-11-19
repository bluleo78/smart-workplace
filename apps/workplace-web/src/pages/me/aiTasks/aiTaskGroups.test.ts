import { describe, expect, it } from 'vitest'

import type { AgentWorkView, AiTaskFamily, AiTaskGroup, IssueResponse } from '@/types/issue'

import { familyLastReport, groupAiTasks } from './aiTaskGroups'

const epicType = { id: 1, name: 'EPIC', colorToken: 'INDIGO', icon: 'Flag' }
const it_ = (number: number, aiGroup: AiTaskGroup | null, extra: Partial<IssueResponse> = {}) =>
  ({ id: number, number, projectKey: 'WP', title: `t${number}`, type: null, parent: null, aiGroup, agentWork: [], ...extra }) as unknown as IssueResponse
const g = (epicNumber: number, size: number): AiTaskGroup => ({ epicNumber, size, epicChildCount: 5, epicChildDoneCount: 1 })
const none = (size: number): AiTaskGroup => ({ epicNumber: null, size, epicChildCount: 0, epicChildDoneCount: 0 })

describe('groupAiTasks', () => {
  it('size 2 이상 묶음은 머리 + 하위, 에픽 자신 행이 머리', () => {
    const e = it_(412, g(412, 3), { type: epicType as never })
    const c1 = it_(413, g(412, 3), { parent: { number: 412, title: '결제', type: epicType, status: 'IN_PROGRESS' } as never })
    const c2 = it_(414, g(412, 3), { parent: { number: 412, title: '결제', type: epicType, status: 'IN_PROGRESS' } as never })
    const out = groupAiTasks([e, c1, c2])
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ kind: 'group', head: e, children: [c1, c2], epic: { number: 412, title: 't412', childCount: 5, childDoneCount: 1 } })
  })
  it('에픽 행이 없으면 하위의 부모 참조로 머리를 만든다', () => {
    const parent = { number: 420, title: '알림', type: epicType, status: 'TODO' }
    const out = groupAiTasks([it_(421, g(420, 2), { parent } as never), it_(422, g(420, 2), { parent } as never)])
    expect(out[0]).toMatchObject({ kind: 'group', head: null, epic: { number: 420, title: '알림' } })
  })
  it('첫 행이 하위 태스크(부모 = 스토리)면 머리 제목·색은 부모가 아니라 조부모 에픽 것(WP-1692)', () => {
    const storyType = { id: 2, name: 'STORY', colorToken: 'GREEN', icon: 'Book' }
    const epic = { number: 500, title: '온보딩', type: epicType, status: 'TODO' }
    const story = { number: 501, title: '가입 화면', type: storyType, status: 'TODO', epic }
    const sub = it_(502, g(500, 1), { parent: story } as never)
    const out = groupAiTasks([sub])
    expect(out[0]).toMatchObject({ kind: 'group', head: null, children: [sub], epic: { number: 500, title: '온보딩', type: epicType } })
  })
  it('하위가 1개뿐인 에픽도 머리 + 하위 묶음(WP-1211)', () => {
    const parent = { number: 400, title: '검색', type: epicType, status: 'TODO' }
    const c = it_(431, g(400, 1), { parent } as never)
    const out = groupAiTasks([c])
    expect(out).toEqual([expect.objectContaining({ kind: 'group', head: null, children: [c], epic: expect.objectContaining({ number: 400, title: '검색' }) })])
  })
  it('에픽 번호가 없는 행은 프로젝트의 「에픽 없음」 묶음 하나로 모이고 건수는 서버 size(WP-1211)', () => {
    const a = it_(440, none(3))
    const b = it_(441, none(3), { parent: { number: 900, title: '다른 프로젝트 에픽', type: epicType, status: 'TODO' } } as never)
    const out = groupAiTasks([a, b])
    expect(out).toEqual([{ kind: 'noEpic', key: 'WP-no-epic', projectKey: 'WP', size: 3, children: [a, b], subRows: {} }])
  })
  it('「에픽 없음」 묶음은 서버 순서대로 에픽 묶음 앞·뒤 어디에나 온다', () => {
    const parent = { number: 420, title: '알림', type: epicType, status: 'TODO' }
    const out = groupAiTasks([it_(440, none(1)), it_(421, g(420, 1), { parent } as never)])
    expect(out.map((e) => e.kind)).toEqual(['noEpic', 'group'])
  })
  it('aiGroup 없는 행(이전 서버 응답)만 머리 없는 단독 행', () => {
    const out = groupAiTasks([it_(430, null)])
    expect(out.map((e) => e.kind)).toEqual(['row'])
  })
  it('페이지 경계를 넘어도 「에픽 없음」 묶음은 하나', () => {
    const page1 = [it_(440, none(2))]
    const page2 = [it_(441, none(2))]
    const out = groupAiTasks([...page1, ...page2])
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ kind: 'noEpic', children: [{ number: 440 }, { number: 441 }] })
  })
  it('페이지가 이어 붙어도 같은 묶음은 하나(연속 행)', () => {
    const parent = { number: 420, title: '알림', type: epicType, status: 'TODO' }
    const page1 = [it_(421, g(420, 3), { parent } as never)]
    const page2 = [it_(422, g(420, 3), { parent } as never), it_(423, g(420, 3), { parent } as never), it_(430, none(1))]
    const out = groupAiTasks([...page1, ...page2])
    expect(out).toHaveLength(2)
    expect(out[0]).toMatchObject({ kind: 'group', children: [{ number: 421 }, { number: 422 }, { number: 423 }] })
  })

  // 가족 정보(WP-1800) — 서버는 머리 행 뒤에 하위·손자를 연속으로 준다.
  const fam = (family: AiTaskFamily) => ({ ...none(5), family }) as AiTaskGroup
  it('family.headNumber 가 앞선 머리를 가리키는 연속 행은 그 머리의 subRows 로 간다(WP-1800)', () => {
    const p2 = it_(2, fam({ lastReportAt: '2026-01-01T00:00:00Z', stale: false }))
    const g2 = it_(12, fam({ headNumber: 2 }))
    const c2 = it_(13, fam({ headNumber: 2 }))
    const p1 = it_(1, fam({ lastReportAt: '2026-01-01T00:00:00Z', stale: false }))
    const c1 = it_(11, fam({ headNumber: 1 }))
    const out = groupAiTasks([p2, g2, c2, p1, c1])
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ kind: 'noEpic', children: [p2, p1], subRows: { [p2.id]: [g2, c2], [p1.id]: [c1] } })
  })
  it('에픽 묶음에서도 하위는 머리 행 subRows 로 간다(WP-1800)', () => {
    const e = it_(412, g(412, 3), { type: epicType as never })
    const parent = { number: 412, title: '결제', type: epicType, status: 'IN_PROGRESS' } as never
    const p = it_(413, { ...g(412, 3), family: { lastReportAt: '2026-01-01T00:00:00Z', stale: true } }, { parent })
    const c = it_(414, { ...g(412, 3), family: { headNumber: 413 } }, { parent })
    const out = groupAiTasks([e, p, c])
    expect(out[0]).toMatchObject({ kind: 'group', head: e, children: [p], subRows: { [p.id]: [c] } })
  })
  it('머리를 찾지 못한 하위는 단독 행으로 남는다(행을 잃지 않음)', () => {
    const c = it_(11, fam({ headNumber: 999 }))
    const out = groupAiTasks([c])
    expect(out[0]).toMatchObject({ kind: 'noEpic', children: [c], subRows: {} })
  })
  it('family 가 없는 응답은 지금과 같다', () => {
    const a = it_(440, none(2))
    const b = it_(441, none(2))
    const out = groupAiTasks([a, b])
    expect(out[0]).toMatchObject({ children: [a, b], subRows: {} })
  })
})

describe('familyLastReport', () => {
  const w = { updatedAt: '2026-01-02T00:00:00Z', stale: false, state: 'WORKING' } as unknown as AgentWorkView
  it('진행 중일 때만 가족 최근 보고로 바꾼다(WP-1800)', () => {
    const head = it_(1, { ...none(1), family: { lastReportAt: '2026-01-05T00:00:00Z', stale: true } })
    expect(familyLastReport(head, w)).toEqual({ ...w, updatedAt: '2026-01-05T00:00:00Z', stale: false })
    const noStale = it_(1, { ...none(1), family: { lastReportAt: '2026-01-05T00:00:00Z' } })
    expect(familyLastReport(noStale, w).stale).toBe(false)
  })
  it('정체 경고는 가족 값이 끄기만 하고 켜지 않는다 — 대표 작업이 무소식일 때만 가족 stale 을 따른다', () => {
    const staleW = { ...w, stale: true }
    const fresh = it_(1, { ...none(1), family: { lastReportAt: '2026-01-05T00:00:00Z', stale: false } })
    expect(familyLastReport(fresh, staleW).stale).toBe(false)
    const old = it_(1, { ...none(1), family: { lastReportAt: '2026-01-05T00:00:00Z', stale: true } })
    expect(familyLastReport(old, staleW).stale).toBe(true)
  })
  it('종료된 작업(endedAt)이나 family 없는 행은 그대로', () => {
    const head = it_(1, { ...none(1), family: { lastReportAt: '2026-01-05T00:00:00Z', stale: true } })
    const ended = { ...w, endedAt: '2026-01-03T00:00:00Z' }
    expect(familyLastReport(head, ended)).toBe(ended)
    expect(familyLastReport(it_(2, none(1)), w)).toBe(w)
    expect(familyLastReport(it_(3, { ...none(1), family: { headNumber: 1 } }), w)).toBe(w)
  })
})
