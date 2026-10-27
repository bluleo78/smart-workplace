// useRememberedIssueQuery(WP-1035) — 프로젝트 이슈 화면의 필터·보기·그룹 기억과 되살리기 규칙을 지킨다.
// 무엇을: 주소에 조건이 없을 때만 되살림·주소 조건 우선과 기억 갱신·화면 안에서 조건을 모두 지우면 기억도 지움·
//        같은 프로젝트 링크로 다시 들어오면 되살림·프로젝트·사용자별 분리·목록 열과 다른 쿼리는 기억하지 않음.
// 왜: 조건은 URL 이 단일 원본이라, 되살리기가 주소의 조건을 덮으면 공유 링크·에픽 링크가 엉뚱한 조건으로 열린다.
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AuthContext } from '@/hooks/auth-context-value'
import { memoryStorage } from '@/test/memoryStorage'
import { testAuthValue } from '@/test/renderWithProviders'

import { rememberedIssueQuery, useRememberedIssueQuery } from './useRememberedIssueQuery'

// 테스트 사용자(id 1)·워크스페이스(1)의 저장 키 — userScopedKey 규칙 `<base>:<userId>:<tenantId>`.
const keyOf = (project: string) => `issue-list-query:${project}:1:1`

function renderAt(url: string, project = 'WP', enabled = true) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <AuthContext.Provider value={testAuthValue}>
      <MemoryRouter initialEntries={[url]}>{children}</MemoryRouter>
    </AuthContext.Provider>
  )
  return renderHook(
    ({ p }: { p: string }) => {
      const restoring = useRememberedIssueQuery(p, enabled)
      return { restoring, location: useLocation(), setParams: useSearchParams()[1], navigate: useNavigate() }
    },
    { wrapper, initialProps: { p: project } },
  )
}

const searchOf = (r: { current: { location: { search: string } } }) => new URLSearchParams(r.current.location.search)

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage())
})

describe('rememberedIssueQuery', () => {
  it('필터·보기·그룹만 남기고 모르는 값·목록 열·다른 쿼리는 버린다', () => {
    const q = rememberedIssueQuery(new URLSearchParams('view=board&group=assignee&priority=HIGH,BOGUS&label=x,3&cols=key&aiChat=1'))
    expect(q.toString()).toBe('view=board&group=assignee&priority=HIGH&label=3')
  })
})

describe('useRememberedIssueQuery', () => {
  it('주소에 조건이 없으면 기억한 조건으로 되살리고, 다른 쿼리는 그대로 둔다', () => {
    localStorage.setItem(keyOf('WP'), 'view=board&priority=HIGH')
    const { result } = renderAt('/projects/WP?aiChat=1')
    const s = searchOf(result)
    expect(s.get('view')).toBe('board')
    expect(s.get('priority')).toBe('HIGH')
    expect(s.get('aiChat')).toBe('1')
    // 되살린 뒤엔 목록을 그린다.
    expect(result.current.restoring).toBe(false)
  })

  it('화면 안에서 필터를 모두 지우면 기억도 지우고, 같은 프로젝트 링크로 다시 들어오면 그때 조건으로 연다', () => {
    const { result } = renderAt('/projects/WP')
    act(() => result.current.setParams(new URLSearchParams('priority=HIGH'), { replace: true }))
    // 사이드바 등의 같은 프로젝트 링크(PUSH) — 화면이 그대로 붙어 있어도 다시 들어온 것으로 본다.
    act(() => result.current.navigate('/projects/WP'))
    expect(result.current.location.search).toBe('?priority=HIGH')
    act(() => result.current.setParams(new URLSearchParams(), { replace: true }))
    expect(localStorage.getItem(keyOf('WP'))).toBeNull()
    expect(result.current.location.search).toBe('')
  })

  it('프로젝트를 불러오기 전(또는 볼 수 없는 프로젝트)에는 되살리지도 기억하지도 않는다', () => {
    localStorage.setItem(keyOf('WP'), 'priority=HIGH')
    const { result } = renderAt('/projects/WP?status=TODO', 'WP', false)
    expect(result.current.location.search).toBe('?status=TODO')
    expect(localStorage.getItem(keyOf('WP'))).toBe('priority=HIGH')
  })

  it('주소에 조건이 있으면 되살리지 않고 주소 조건을 기억한다', () => {
    localStorage.setItem(keyOf('WP'), 'view=board&priority=HIGH')
    const { result } = renderAt('/projects/WP?parent=12')
    expect(result.current.location.search).toBe('?parent=12')
    expect(localStorage.getItem(keyOf('WP'))).toBe('parent=12')
  })

  it('조건을 바꾸면 기억하고, 「필터 초기화」로 보기만 남으면 보기만 기억한다', () => {
    const { result } = renderAt('/projects/WP')
    act(() => result.current.setParams(new URLSearchParams('view=board&status=TODO&group=none'), { replace: true }))
    expect(localStorage.getItem(keyOf('WP'))).toBe('view=board&group=none&status=TODO')
    act(() => result.current.setParams(new URLSearchParams('view=board'), { replace: true }))
    expect(localStorage.getItem(keyOf('WP'))).toBe('view=board')
  })

  it('주소에 기본 보기(view=list)만 있어도 목록을 고른 것이라 되살리지 않는다', () => {
    localStorage.setItem(keyOf('WP'), 'view=board')
    const { result } = renderAt('/projects/WP?view=list')
    expect(result.current.location.search).toBe('?view=list')
    expect(localStorage.getItem(keyOf('WP'))).toBeNull()
  })

  it('프로젝트별로 따로 기억한다', () => {
    localStorage.setItem(keyOf('WP'), 'priority=HIGH')
    localStorage.setItem(keyOf('OPS'), 'view=board')
    const { result } = renderAt('/projects/OPS', 'OPS')
    expect(result.current.location.search).toBe('?view=board')
  })

  it('다른 사용자의 기억은 되살리지 않는다', () => {
    localStorage.setItem('issue-list-query:WP:2:1', 'priority=HIGH')
    const { result } = renderAt('/projects/WP')
    expect(result.current.location.search).toBe('')
  })

  it('깨진 기억은 버리고 기본 조건으로 연다', () => {
    localStorage.setItem(keyOf('WP'), 'priority=NOPE&label=abc')
    const { result } = renderAt('/projects/WP')
    expect(result.current.location.search).toBe('')
  })
})
