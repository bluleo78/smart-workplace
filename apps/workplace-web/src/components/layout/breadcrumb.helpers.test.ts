import { describe, expect, it } from 'vitest'

import { collapseBreadcrumbItems } from './breadcrumb.helpers'

const make = (n: number) => Array.from({ length: n }, (_, i) => ({ key: i, label: `L${i}` }))

describe('collapseBreadcrumbItems', () => {
  it('상한 이하이면 접지 않는다', () => {
    const items = make(4)
    expect(collapseBreadcrumbItems(items, 4)).toEqual({ visible: items, hidden: null })
  })

  it('상한을 넘으면 시작·마지막만 남기고 가운데를 접는다', () => {
    const { visible, hidden } = collapseBreadcrumbItems(make(5), 4)
    expect(visible.map((i) => i.key)).toEqual([0, 4])
    expect(hidden?.map((i) => i.key)).toEqual([1, 2, 3])
  })

  it('폭 부족 접기(max=2)도 같은 규칙 — 3단계면 가운데 하나를 접는다', () => {
    const { visible, hidden } = collapseBreadcrumbItems(make(3), 2)
    expect(visible.map((i) => i.key)).toEqual([0, 2])
    expect(hidden?.map((i) => i.key)).toEqual([1])
  })

  it('2단계 이하는 접을 가운데가 없다', () => {
    expect(collapseBreadcrumbItems(make(2), 1).hidden).toBeNull()
  })

  it('시작점까지 접기(keepStart=false) — 현재만 남고 앞의 모든 단계가 접힌다', () => {
    const { visible, hidden } = collapseBreadcrumbItems(make(3), 2, { keepStart: false })
    expect(visible.map((i) => i.key)).toEqual([2])
    expect(hidden?.map((i) => i.key)).toEqual([0, 1])
  })
})
