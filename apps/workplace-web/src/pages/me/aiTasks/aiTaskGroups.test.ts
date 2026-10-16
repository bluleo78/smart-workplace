import { describe, expect, it } from 'vitest'

import type { AiTaskGroup, AiTaskProject, IssueResponse } from '@/types/issue'

import { groupAiTasks, splitByProject } from './aiTaskGroups'

const epicType = { id: 1, name: 'EPIC', colorToken: 'INDIGO', icon: 'Flag' }
const it_ = (number: number, aiGroup: AiTaskGroup | null, extra: Partial<IssueResponse> = {}) =>
  ({ id: number, number, projectKey: 'WP', title: `t${number}`, type: null, parent: null, aiGroup, agentWork: [], ...extra }) as unknown as IssueResponse
const g = (epicNumber: number, size: number): AiTaskGroup => ({ epicNumber, size, epicChildCount: 5, epicChildDoneCount: 1 })

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
  it('size 1·aiGroup 없음은 단독 행', () => {
    const out = groupAiTasks([it_(430, null), it_(431, g(400, 1))])
    expect(out.map((e) => e.kind)).toEqual(['row', 'row'])
  })
  it('페이지가 이어 붙어도 같은 묶음은 하나(연속 행)', () => {
    const parent = { number: 420, title: '알림', type: epicType, status: 'TODO' }
    const page1 = [it_(421, g(420, 3), { parent } as never)]
    const page2 = [it_(422, g(420, 3), { parent } as never), it_(423, g(420, 3), { parent } as never), it_(430, null)]
    const out = groupAiTasks([...page1, ...page2])
    expect(out).toHaveLength(2)
    expect(out[0]).toMatchObject({ kind: 'group', children: [{ number: 421 }, { number: 422 }, { number: 423 }] })
  })
})

describe('splitByProject', () => {
  // 프로젝트 키·번호만 다른 최소 행 — aiProject 는 필요한 테스트만 싣는다.
  const row = (projectKey: string, number: number, aiProject?: AiTaskProject) =>
    ({ id: number, number, projectKey, title: `t${number}`, aiProject }) as unknown as IssueResponse

  it('연속한 같은 프로젝트를 한 구간으로, 서버 순서 유지', () => {
    const a = row('WP', 1)
    const b = row('WP', 2)
    const c = row('HR', 3)
    const d = row('MKT', 4)
    const e = row('MKT', 5)
    const out = splitByProject([a, b, c, d, e])
    expect(out.map((r) => r.key)).toEqual(['WP', 'HR', 'MKT'])
    expect(out.map((r) => r.items)).toEqual([[a, b], [c], [d, e]])
  })
  it('이름·건수는 aiProject 에서', () => {
    const out = splitByProject([row('HR', 1, { name: '인사팀', size: 7 })])
    expect(out[0]).toMatchObject({ key: 'HR', name: '인사팀', size: 7 })
  })
  it('aiProject 가 없으면 키·구간 행 수로 대체', () => {
    const out = splitByProject([row('WP', 1), row('WP', 2)])
    expect(out[0]).toMatchObject({ name: 'WP', size: 2 })
  })
  it('이어 붙은 페이지의 같은 프로젝트 행은 앞 구간에 합쳐진다', () => {
    const page1 = [row('HR', 1), row('WP', 2)]
    const page2 = [row('WP', 3), row('MKT', 4)]
    const out = splitByProject([...page1, ...page2])
    expect(out.map((r) => r.key)).toEqual(['HR', 'WP', 'MKT'])
    expect(out[1].items.map((i) => i.number)).toEqual([2, 3])
  })
  it('빈 목록은 빈 배열', () => {
    expect(splitByProject([])).toEqual([])
  })
  it('이름이 빈 문자열이면 키로 대체', () => {
    const out = splitByProject([row('HR', 1, { name: '', size: 3 })])
    expect(out[0]).toMatchObject({ name: 'HR', size: 3 })
  })
  it('스크롤 중 정렬 키가 바뀌어 다음 페이지에 다시 온 행은 처음 것만 둔다 — 머리 줄·행이 두 번 그려지지 않게', () => {
    const page1 = [row('WP', 1), row('WP', 2), row('HR', 3)]
    // 보고가 들어와 WP 가 커서 뒤로 밀린 경우 — WP 행이 다음 페이지에 다시 온다.
    const page2 = [row('HR', 4), row('WP', 1), row('WP', 2), row('MKT', 5)]
    const out = splitByProject([...page1, ...page2])
    expect(out.map((r) => r.key)).toEqual(['WP', 'HR', 'MKT'])
    expect(out.map((r) => r.items.map((i) => i.number))).toEqual([[1, 2], [3, 4], [5]])
  })
})
