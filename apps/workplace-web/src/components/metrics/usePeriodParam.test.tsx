// usePeriodParam — 모르는 값, 기본값 지우기, 다른 파라미터 보존.
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import { usePeriodParam } from './usePeriodParam'

const VALUES = ['30d', '7d'] as const

function setup(initial: string) {
  const wrapper = ({ children }: { children: ReactNode }) => <MemoryRouter initialEntries={[initial]}>{children}</MemoryRouter>
  return renderHook(
    () => {
      const [value, set] = usePeriodParam('period', VALUES, '30d')
      return { value, set, search: useLocation().search }
    },
    { wrapper },
  )
}

describe('usePeriodParam', () => {
  it('모르는 값은 기본값', () => {
    expect(setup('/?period=foo').result.current.value).toBe('30d')
  })

  it('기본값으로 바꾸면 주소에서 지운다', () => {
    const { result } = setup('/?period=7d')
    expect(result.current.value).toBe('7d')
    act(() => result.current.set('30d'))
    expect(result.current.search).toBe('')
  })

  it('다른 값이면 주소에 적는다', () => {
    const { result } = setup('/')
    act(() => result.current.set('7d'))
    expect(result.current.search).toBe('?period=7d')
    expect(result.current.value).toBe('7d')
  })

  it('다른 파라미터를 보존한다', () => {
    const { result } = setup('/?tab=x')
    act(() => result.current.set('7d'))
    expect(result.current.search).toContain('tab=x')
    expect(result.current.search).toContain('period=7d')
  })
})
