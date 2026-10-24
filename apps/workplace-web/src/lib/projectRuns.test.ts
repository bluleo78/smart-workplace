import { describe, expect, it } from 'vitest'

import type { AiTaskProject, IssueResponse } from '@/types/issue'

import { splitByProject } from './projectRuns'

describe('splitByProject', () => {
  // 프로젝트 키·번호만 다른 최소 행 — aiProject·projectGroup 은 필요한 테스트만 싣는다.
  const row = (projectKey: string, number: number, aiProject?: AiTaskProject, projectGroup?: AiTaskProject) =>
    ({ id: number, number, projectKey, title: `t${number}`, aiProject, projectGroup }) as unknown as IssueResponse

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
  it('projectGroup을 aiProject보다 먼저 읽는다', () => {
    const out = splitByProject([row('EX', 1, { name: 'AI쪽', size: 9 }, { name: '예제', size: 4 })])
    expect(out[0]).toMatchObject({ key: 'EX', name: '예제', size: 4 })
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
  it('같은 id가 두 번 오면 한 번만 둔다', () => {
    const g = { name: '예제', size: 4 }
    const out = splitByProject([row('EX', 1, undefined, g), row('EX', 1, undefined, g)])
    expect(out).toHaveLength(1)
    expect(out[0].items).toHaveLength(1)
    expect(out[0].size).toBe(4)
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
