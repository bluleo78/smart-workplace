import { act, render, screen } from '@testing-library/react'
import { Component, type ReactNode, Suspense, useEffect } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { preloadableLazy } from './preloadableLazy'

/** 로더가 실패했을 때 오류 경계 동작을 확인하기 위한 최소 경계. */
class Boundary extends Component<{ children: ReactNode; onError?: (e: unknown) => void }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(e: unknown) {
    this.props.onError?.(e)
  }
  render() {
    return this.state.failed ? <p>오류 경계</p> : this.props.children
  }
}

function Body() {
  return <p>본문</p>
}

describe('preloadableLazy', () => {
  it('미리 받은 모듈은 Suspense fallback 없이 바로 그린다', async () => {
    const [C, load] = preloadableLazy(() => Promise.resolve({ default: Body }))
    await load()
    render(
      <Suspense fallback={<p>로딩</p>}>
        <C />
      </Suspense>,
    )
    expect(screen.getByText('본문')).toBeTruthy()
    expect(screen.queryByText('로딩')).toBeNull()
  })

  it('받지 않은 모듈은 fallback 뒤 그린다', async () => {
    const [C] = preloadableLazy(() => Promise.resolve({ default: Body }))
    render(
      <Suspense fallback={<p>로딩</p>}>
        <C />
      </Suspense>,
    )
    expect(screen.getByText('로딩')).toBeTruthy()
    expect(await screen.findByText('본문')).toBeTruthy()
  })

  it('이름 있는 내보내기를 고른다', async () => {
    const Named = () => <p>이름 있음</p>
    const [C, load] = preloadableLazy(() => Promise.resolve({ Named, Other: Body }), 'Named')
    await load()
    render(
      <Suspense fallback={null}>
        <C />
      </Suspense>,
    )
    expect(screen.getByText('이름 있음')).toBeTruthy()
  })

  it('첫 렌더 뒤 모듈이 와도 다시 마운트하지 않는다', async () => {
    const mounted = vi.fn()
    function Counted() {
      useEffect(() => {
        mounted()
      }, [])
      return <p>본문</p>
    }
    // 첫 렌더 때는 아직 받지 않은 상태 — lazy 로 그린 뒤 모듈이 도착한다.
    let resolve: (m: { default: typeof Counted }) => void = () => {}
    const pending = new Promise<{ default: typeof Counted }>((r) => {
      resolve = r
    })
    const [C] = preloadableLazy(() => pending)
    // 같은 요소 객체를 다시 넘기면 React 가 다시 그리기를 건너뛰므로 매번 새 요소를 만든다.
    const ui = (n: number) => (
      <Suspense fallback={<p>로딩</p>}>
        <C key="c" data-n={n} />
      </Suspense>
    )
    const { rerender } = render(ui(0))
    expect(screen.getByText('로딩')).toBeTruthy()
    await act(async () => {
      resolve({ default: Counted })
      await pending
    })
    await screen.findByText('본문')
    // 모듈을 기억한 뒤 다시 그려도 lazy → 직접 그리기로 바뀌어 다시 마운트되면 안 된다.
    rerender(ui(1))
    rerender(ui(2))
    expect(mounted).toHaveBeenCalledTimes(1)
  })

  it('내보내기가 없으면 이름을 담은 오류로 오류 경계에 간다', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const errors: unknown[] = []
    const load = () => Promise.resolve({ Other: Body } as { Other: typeof Body; Missing: typeof Body })
    const [C] = preloadableLazy(load, 'Missing')
    render(
      <Boundary onError={(e) => errors.push(e)}>
        <Suspense fallback={<p>로딩</p>}>
          <C />
        </Suspense>
      </Boundary>,
    )
    expect(await screen.findByText('오류 경계')).toBeTruthy()
    expect(String(errors[0])).toContain("'Missing'")
    spy.mockRestore()
  })

  it('로더가 실패하면 오류 경계로 간다', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const [C] = preloadableLazy<{ default: typeof Body }>(() => Promise.reject(new Error('실패')))
    render(
      <Boundary>
        <Suspense fallback={<p>로딩</p>}>
          <C />
        </Suspense>
      </Boundary>,
    )
    expect(await screen.findByText('오류 경계')).toBeTruthy()
    spy.mockRestore()
  })
})
