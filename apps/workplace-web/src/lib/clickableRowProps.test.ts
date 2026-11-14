import type { KeyboardEvent } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { clickableRowProps } from './clickableRowProps'

// node 환경(DOM 없음)이라 가짜 키 이벤트 객체로 onKeyDown 을 직접 호출한다.
function fakeKey(key: string, target: object, currentTarget: object) {
  const preventDefault = vi.fn()
  const event = { key, target, currentTarget, preventDefault } as unknown as KeyboardEvent
  return { event, preventDefault }
}

describe('clickableRowProps onKeyDown', () => {
  it('행 자신에서 누른 Enter·Space 는 onActivate 를 부르고 preventDefault 한다', () => {
    const onActivate = vi.fn()
    const row = {}
    const props = clickableRowProps(onActivate)
    const enter = fakeKey('Enter', row, row)
    const space = fakeKey(' ', row, row)
    props.onKeyDown(enter.event)
    props.onKeyDown(space.event)
    expect(onActivate).toHaveBeenCalledTimes(2)
    expect(enter.preventDefault).toHaveBeenCalledTimes(1)
    expect(space.preventDefault).toHaveBeenCalledTimes(1)
  })

  it('자식에서 올라온 Enter 는 무시한다 (WP-1555)', () => {
    const onActivate = vi.fn()
    const props = clickableRowProps(onActivate)
    const { event, preventDefault } = fakeKey('Enter', {}, {})
    props.onKeyDown(event)
    expect(onActivate).not.toHaveBeenCalled()
    expect(preventDefault).not.toHaveBeenCalled()
  })

  it('다른 키는 무시한다', () => {
    const onActivate = vi.fn()
    const row = {}
    const props = clickableRowProps(onActivate)
    const { event, preventDefault } = fakeKey('a', row, row)
    props.onKeyDown(event)
    expect(onActivate).not.toHaveBeenCalled()
    expect(preventDefault).not.toHaveBeenCalled()
  })
})
