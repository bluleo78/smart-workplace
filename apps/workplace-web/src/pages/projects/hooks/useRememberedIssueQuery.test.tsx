// useRememberedIssueQuery(WP-1035) — 프로젝트 이슈 화면의 필터·보기·그룹 기억과 되살리기 규칙을 지킨다.
// 무엇을: 주소에 조건이 없을 때만 되살림·주소 조건 우선과 기억 갱신·화면 안에서 조건을 모두 지우면 기억도 지움·
//        같은 프로젝트 링크로 다시 들어오면 되살림·앱의 다른 replace(AI 대화 링크·모바일 뒤로 가기)로 들어와도 되살림·
//        프로젝트·사용자별 분리·목록 열과 다른 쿼리는 기억하지 않음.
// 왜: 조건은 URL 이 단일 원본이라, 되살리기가 주소의 조건을 덮으면 공유 링크·에픽 링크가 엉뚱한 조건으로 열린다.
import { act, render, renderHook, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter, Route, Routes, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AiChatDeepLink } from '@/components/ai/AiChatDeepLink'
import { useMobileBack } from '@/components/mobile/useMobileBack'
import { AuthContext } from '@/hooks/auth-context-value'
import { memoryStorage } from '@/test/memoryStorage'
import { testAuthValue } from '@/test/renderWithProviders'

import { rememberedIssueQuery, useRememberedIssueQuery } from './useRememberedIssueQuery'

// AI 대화 링크가 기대는 패널·대화 세션 — 열기 동작은 이 테스트의 관심 밖이라 끊는다.
vi.mock('@/components/ai/AIAssistantContext', () => ({ useAssistant: () => ({ mode: 'side', open: vi.fn() }) }))
vi.mock('@/hooks/chat-session-context', () => ({
  useChatSessionContext: () => ({ openSession: vi.fn(() => Promise.resolve('ok')) }),
}))

// 테스트 사용자(id 1)·워크스페이스(1)의 저장 키 — userScopedKey 규칙 `<base>:<userId>:<tenantId>`.
const keyOf = (project: string) => `issue-list-query:${project}:1:1`

/** @param withDeepLink 앱 셸(AppLayout)처럼 AI 대화 링크 처리기를 함께 띄운다 — 화면보다 바깥이라 effect 가 화면 뒤에 돈다. */
function renderAt(url: string, project = 'WP', enabled = true, withDeepLink = false) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <AuthContext.Provider value={testAuthValue}>
      <MemoryRouter initialEntries={[url]}>
        {children}
        {withDeepLink && <AiChatDeepLink />}
      </MemoryRouter>
    </AuthContext.Provider>
  )
  return renderHook(
    ({ p, on }: { p: string; on: boolean }) => {
      const restoring = useRememberedIssueQuery(p, on)
      return { restoring, location: useLocation(), setParams: useSearchParams()[1], navigate: useNavigate() }
    },
    { wrapper, initialProps: { p: project, on: enabled } },
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

describe('rememberedIssueQuery — 정렬(WP-1238)', () => {
  it('정렬(sort·direction)도 기억하고, 모르는 기준은 버린다', () => {
    expect(rememberedIssueQuery(new URLSearchParams('view=board&sort=dueDate&direction=asc')).toString())
      .toBe('view=board&sort=dueDate&direction=asc')
    expect(rememberedIssueQuery(new URLSearchParams('sort=title&direction=asc')).toString()).toBe('')
  })
})

describe('useRememberedIssueQuery', () => {
  it('정렬만 고른 화면도 기억했다가, 조건 없이 다시 들어오면 그 정렬로 되살린다(WP-1238)', () => {
    const { result } = renderAt('/projects/WP')
    act(() => result.current.setParams(new URLSearchParams('sort=priority&direction=desc'), { replace: true }))
    expect(localStorage.getItem(keyOf('WP'))).toBe('sort=priority&direction=desc')
    act(() => result.current.navigate('/projects/WP'))
    const s = searchOf(result)
    expect(s.get('sort')).toBe('priority')
    expect(s.get('direction')).toBe('desc')
  })

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

  describe('앱의 다른 replace 로 조건 없이 들어와도 지우지 않고 되살린다', () => {
    const AI_CHAT = '/projects/WP?aiChat=11111111-1111-1111-1111-111111111111'

    it('AI 대화 링크 — 프로젝트를 불러오는 동안 aiChat 이 replace 로 지워진 뒤', () => {
      localStorage.setItem(keyOf('WP'), 'view=board&priority=HIGH')
      const { result, rerender } = renderAt(AI_CHAT, 'WP', false, true)
      expect(result.current.location.search).toBe('')
      rerender({ p: 'WP', on: true })
      expect(result.current.location.search).toBe('?view=board&priority=HIGH')
      expect(localStorage.getItem(keyOf('WP'))).toBe('view=board&priority=HIGH')
    })

    it('AI 대화 링크 — 프로젝트가 캐시에 있어 되살리기와 aiChat 지우기가 같은 커밋에 돌 때', () => {
      localStorage.setItem(keyOf('WP'), 'view=board&priority=HIGH')
      const { result } = renderAt(AI_CHAT, 'WP', true, true)
      const s = searchOf(result)
      expect(s.get('aiChat')).toBeNull()
      expect(s.get('view')).toBe('board')
      expect(s.get('priority')).toBe('HIGH')
      expect(localStorage.getItem(keyOf('WP'))).toBe('view=board&priority=HIGH')
    })

    it('모바일 뒤로 가기 — 딥링크로 연 이슈 상세에서 ‹ 로 프로젝트에 replace 이동', () => {
      localStorage.setItem(keyOf('WP'), 'view=board&priority=HIGH')
      // 실제 라우트처럼 목록과 상세가 다른 화면이라, 뒤로 가면 목록 화면이 새로 붙는다.
      function List() {
        useRememberedIssueQuery('WP', true)
        return <p data-testid="search">{useLocation().search}</p>
      }
      function Detail() {
        const back = useMobileBack()
        return <button onClick={back}>뒤로</button>
      }
      render(
        <AuthContext.Provider value={testAuthValue}>
          <MemoryRouter initialEntries={['/projects/WP/issues/5']}>
            <Routes>
              <Route path="/projects/:key" element={<List />} />
              <Route path="/projects/:key/issues/:number" element={<Detail />} />
            </Routes>
          </MemoryRouter>
        </AuthContext.Provider>,
      )
      act(() => screen.getByRole('button', { name: '뒤로' }).click())
      expect(screen.getByTestId('search').textContent).toBe('?view=board&priority=HIGH')
      expect(localStorage.getItem(keyOf('WP'))).toBe('view=board&priority=HIGH')
    })

    it('조건이 있던 화면이라도 다른 쿼리만 replace 로 바뀌면 기억은 그대로다', () => {
      const { result } = renderAt('/projects/WP?priority=HIGH')
      act(() => result.current.setParams((prev) => { prev.set('aiChat', 'x'); return prev }, { replace: true }))
      expect(localStorage.getItem(keyOf('WP'))).toBe('priority=HIGH')
    })
  })
})
