import { describe, expect, it } from 'vitest'

import type { AiTaskGroup, IssueResponse } from '@/types/issue'

import { groupAiTasks } from './aiTaskGroups'

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
