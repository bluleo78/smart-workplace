// useIssueListColumns(WP-270) — 열 구성의 출처 우선순위(URL `cols` → 개인 저장값 → 기본)와 저장 위치 분기를 지킨다.
// 무엇을: 저장값 반영·URL 우선·setChosen 이 URL 유무에 따라 URL/저장값 중 하나만 바꾸는지·깨진 저장값 무시·
//        삭제된 커스텀 필드 키 제거·reset·완료일 필터 자동 열이 저장값을 오염시키지 않는지.
// 왜: 화면(목록·열 메뉴·저장된 뷰 페이로드)이 이 훅 하나의 결과를 함께 쓰므로, 분기 하나가 틀리면 세 곳이 함께 어긋난다.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { BrowserRouter, MemoryRouter, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AuthContext } from '@/hooks/auth-context-value'
import { memoryStorage } from '@/test/memoryStorage'
import { testAuthValue } from '@/test/renderWithProviders'

import { DEFAULT_COLUMNS } from '../../../lib/issueListColumns'
import type { IssueFieldDef } from '../../../types/customField'
import { useIssueListColumns } from './useIssueListColumns'

// 커스텀 필드 정의 — 테스트마다 바꿔 끼운다(삭제된 필드 키 제거 검증용).
let fieldDefs: IssueFieldDef[] | undefined
vi.mock('../../../hooks/queries/useCustomFields', () => ({
  useCustomFields: () => ({ data: fieldDefs }),
}))

const KEY = 'WP'
// 테스트 사용자(id 1)·워크스페이스(1)의 저장 키 — userScopedKey 규칙 `<base>:<userId>:<tenantId>`.
const STORAGE_KEY = 'issue-list-columns:WP:1:1'

function def(id: number, position: number): IssueFieldDef {
  return { id, projectId: 1, name: `필드${id}`, type: 'TEXT', options: null, position, createdAt: '', updatedAt: '' }
}

/**
 * 주어진 URL 로 훅을 렌더한다 — 현재 location 도 함께 돌려 URL 갱신을 확인한다.
 * 앱과 같은 BrowserRouter 로 렌더한다 — 훅이 쓰기 기준을 지금 브라우저 주소(liveSearchParams)로 잡기 때문이다(WP-955).
 */
function renderColumns(url = `/projects/${KEY}`, closedFilterActive = false) {
  window.history.replaceState(null, '', url)
  const queryClient = new QueryClient()
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <AuthContext.Provider value={testAuthValue}>
        <BrowserRouter>{children}</BrowserRouter>
      </AuthContext.Provider>
    </QueryClientProvider>
  )
  return renderHook(
    ({ closed }: { closed: boolean }) => ({ cols: useIssueListColumns(KEY, closed), location: useLocation() }),
    { wrapper, initialProps: { closed: closedFilterActive } },
  )
}

const urlCols = (search: string) => new URLSearchParams(search).get('cols')
const stored = () => localStorage.getItem(STORAGE_KEY)

beforeEach(() => {
  // jsdom 의 localStorage 대신 테스트마다 새 메모리 저장소 — 앞 테스트의 저장값이 새지 않게.
  vi.stubGlobal('localStorage', memoryStorage())
  // 앞 테스트가 남긴 브라우저 주소(cols 등)가 새지 않게 비운다.
  window.history.replaceState(null, '', '/')
  fieldDefs = undefined
})

describe('useIssueListColumns', () => {
  it('URL 도 저장값도 없으면 기본 열', () => {
    const { result } = renderColumns()
    expect(result.current.cols.columns).toEqual(DEFAULT_COLUMNS)
    expect(result.current.cols.chosen).toEqual(DEFAULT_COLUMNS)
    expect(result.current.cols.autoClosed).toBe(false)
  })

  it('개인 저장값을 표시 순서로 반영한다', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(['reporter', 'priority']))
    const { result } = renderColumns()
    expect(result.current.cols.columns).toEqual(['priority', 'reporter'])
  })

  it('저장된 빈 배열은 「선택 열 모두 끔」으로 존중한다', () => {
    localStorage.setItem(STORAGE_KEY, '[]')
    const { result } = renderColumns()
    expect(result.current.cols.columns).toEqual([])
  })

  it('URL cols 가 저장값보다 우선한다', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(['reporter']))
    const { result } = renderColumns(`/projects/${KEY}?cols=milestone`)
    expect(result.current.cols.columns).toEqual(['milestone'])
    expect(result.current.cols.chosen).toEqual(['milestone'])
  })

  it('깨진 저장값(JSON 아님·배열 아님)은 무시하고 기본 열', () => {
    localStorage.setItem(STORAGE_KEY, '{')
    expect(renderColumns().result.current.cols.columns).toEqual(DEFAULT_COLUMNS)
    localStorage.setItem(STORAGE_KEY, '{"a":1}')
    expect(renderColumns().result.current.cols.columns).toEqual(DEFAULT_COLUMNS)
    localStorage.setItem(STORAGE_KEY, '[1,2]')
    expect(renderColumns().result.current.cols.columns).toEqual(DEFAULT_COLUMNS)
  })

  it('저장값의 모르는 키·삭제된 커스텀 필드 키는 버린다(필드 정의 로딩 후)', () => {
    fieldDefs = [def(7, 0)]
    localStorage.setItem(STORAGE_KEY, JSON.stringify(['due', 'bogus', 'cf7', 'cf99']))
    const { result } = renderColumns()
    expect(result.current.cols.columns).toEqual(['due', 'cf7'])
    expect(result.current.cols.chosen).toEqual(['due', 'cf7'])
  })

  it('저장값의 키가 모두 사라지면(삭제된 필드·모르는 키만) 「모두 끔」이 아니라 기본 열로 돌아간다', () => {
    fieldDefs = [def(7, 0)]
    localStorage.setItem(STORAGE_KEY, JSON.stringify(['cf12']))
    const { result } = renderColumns()
    expect(result.current.cols.columns).toEqual(DEFAULT_COLUMNS)
    expect(result.current.cols.chosen).toEqual(DEFAULT_COLUMNS)
    // 모르는 내장 키만 있어도 마찬가지.
    localStorage.setItem(STORAGE_KEY, JSON.stringify(['bogus']))
    expect(renderColumns().result.current.cols.columns).toEqual(DEFAULT_COLUMNS)
  })

  it('URL 의 cols=(빈 값)과 cols=cf12(전부 삭제된 필드)는 저장값 보정 없이 「모두 끔」', () => {
    fieldDefs = [def(7, 0)]
    localStorage.setItem(STORAGE_KEY, JSON.stringify(['due']))
    expect(renderColumns(`/projects/${KEY}?cols=`).result.current.cols.columns).toEqual([])
    expect(renderColumns(`/projects/${KEY}?cols=cf12`).result.current.cols.columns).toEqual([])
  })

  it('URL 에 cols 가 없으면 setChosen 은 저장값만 바꾸고 URL 은 그대로', () => {
    const { result } = renderColumns(`/projects/${KEY}?priority=HIGH`)
    act(() => result.current.cols.setChosen(['priority', 'reporter']))
    expect(JSON.parse(stored()!)).toEqual(['priority', 'reporter'])
    expect(urlCols(result.current.location.search)).toBeNull()
    expect(result.current.cols.columns).toEqual(['priority', 'reporter'])
  })

  it('URL 에 cols 가 있으면 setChosen 은 URL 만 바꾸고(다른 파라미터 유지) 저장값은 그대로', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(['due']))
    const { result } = renderColumns(`/projects/${KEY}?priority=HIGH&cols=due`)
    act(() => result.current.cols.setChosen(['due', 'reporter']))
    expect(urlCols(result.current.location.search)).toBe('due,reporter')
    expect(new URLSearchParams(result.current.location.search).get('priority')).toBe('HIGH')
    expect(JSON.parse(stored()!)).toEqual(['due'])
    expect(result.current.cols.columns).toEqual(['due', 'reporter'])
  })

  it('URL cols 에서 모두 끄면 빈 값(cols=)으로 남는다 — 부재(개인값)와 구분', () => {
    const { result } = renderColumns(`/projects/${KEY}?cols=due`)
    act(() => result.current.cols.setChosen([]))
    expect(urlCols(result.current.location.search)).toBe('')
    expect(result.current.cols.columns).toEqual([])
  })

  it('URL 에 cols 가 없으면 reset 은 개인 저장값을 지워 기본 열로 돌아간다', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(['reporter']))
    const { result } = renderColumns(`/projects/${KEY}?priority=HIGH`)
    act(() => result.current.cols.reset())
    expect(urlCols(result.current.location.search)).toBeNull()
    expect(stored()).toBeNull()
    expect(result.current.cols.columns).toEqual(DEFAULT_COLUMNS)
  })

  it('URL 에 cols 가 있으면(열을 담은 뷰 안) reset 은 URL cols 를 기본 열로 바꾸고 개인 저장값은 그대로 둔다', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(['reporter']))
    const { result } = renderColumns(`/projects/${KEY}?priority=HIGH&cols=milestone`)
    act(() => result.current.cols.reset())
    expect(urlCols(result.current.location.search)).toBe(DEFAULT_COLUMNS.join(','))
    expect(new URLSearchParams(result.current.location.search).get('priority')).toBe('HIGH')
    expect(JSON.parse(stored()!)).toEqual(['reporter'])
    expect(result.current.cols.columns).toEqual(DEFAULT_COLUMNS)
  })

  it('완료일 필터가 켜지면 완료일 열을 자동으로 더하되 chosen(저장 대상)에는 넣지 않는다', () => {
    const { result, rerender } = renderColumns(`/projects/${KEY}`, true)
    expect(result.current.cols.columns).toEqual(['priority', 'assignee', 'due', 'closed'])
    expect(result.current.cols.autoClosed).toBe(true)
    expect(result.current.cols.chosen).toEqual(DEFAULT_COLUMNS)
    // 필터를 풀면 원래 선택으로.
    rerender({ closed: false })
    expect(result.current.cols.columns).toEqual(DEFAULT_COLUMNS)
    expect(result.current.cols.autoClosed).toBe(false)
  })

  it('같은 화면의 두 훅 인스턴스(목록·열 메뉴)는 저장값 변경을 함께 본다', () => {
    const queryClient = new QueryClient()
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>
        <AuthContext.Provider value={testAuthValue}>
          <MemoryRouter initialEntries={[`/projects/${KEY}`]}>{children}</MemoryRouter>
        </AuthContext.Provider>
      </QueryClientProvider>
    )
    const { result } = renderHook(
      () => ({ a: useIssueListColumns(KEY, false), b: useIssueListColumns(KEY, false) }),
      { wrapper },
    )
    act(() => result.current.a.setChosen(['milestone']))
    expect(result.current.b.columns).toEqual(['milestone'])
  })
})
