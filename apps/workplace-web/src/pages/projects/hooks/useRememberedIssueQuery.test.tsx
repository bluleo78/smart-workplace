// useRememberedIssueQuery(WP-1035) — 프로젝트 이슈 화면의 필터·보기·그룹 기억과 되살리기 규칙을 지킨다.
// 무엇을: 주소에 조건이 없을 때만 되살림·주소 조건 우선과 기억 갱신·화면 안에서 조건을 모두 지우면 기억도 지움·
//        같은 프로젝트 링크로 다시 들어오면 되살림·앱의 다른 replace(AI 대화 링크·모바일 뒤로 가기)로 들어와도 되살림·
//        프로젝트·사용자별 분리·목록 열과 다른 쿼리는 기억하지 않음·알 수 없는 값을 지운 목록은 같은 화면의 이동(replace·시트 표식 PUSH·시트 닫는 POP·aiChat PUSH)에 그대로임.
// 왜: 조건은 URL 이 단일 원본이라, 되살리기가 주소의 조건을 덮으면 공유 링크·에픽 링크가 엉뚱한 조건으로 열린다.
import { act, render, renderHook, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { BrowserRouter, MemoryRouter, Route, Routes, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AiChatDeepLink } from '@/components/ai/AiChatDeepLink'
import { useMobileBack } from '@/components/mobile/useMobileBack'
import { AuthContext } from '@/hooks/auth-context-value'
import { useHistoryParam } from '@/hooks/useHistoryParam'
import { settleHistory } from '@/test/history'
import { memoryStorage } from '@/test/memoryStorage'
import { testAuthValue } from '@/test/renderWithProviders'

import { IGNORED_CLEARED_STATE, rememberedIssueQuery, useRememberedIssueQuery } from './useRememberedIssueQuery'
import { withIssueFiltersReset } from './useResetIssueFilters'

// AI 대화 링크가 기대는 패널·대화 세션 — 패널 열기는 끊고, 대화 열기(openSession)는 불렸는지만 본다(대화 링크 처리가 덮이지 않았는지).
const openSession = vi.hoisted(() => vi.fn((id: string) => Promise.resolve(id ? 'ok' : 'not-found')))
vi.mock('@/components/ai/AIAssistantContext', () => ({ useAssistant: () => ({ mode: 'side', open: vi.fn() }) }))
vi.mock('@/hooks/chat-session-context', () => ({
  useChatSessionContext: () => ({ openSession }),
}))

// 테스트 사용자(id 1)·워크스페이스(1)의 저장 키 — userScopedKey 규칙 `<base>:<userId>:<tenantId>`.
const keyOf = (project: string) => `issue-list-query:${project}:1:1`

/** @param withDeepLink 앱 셸(AppLayout)처럼 AI 대화 링크 처리기를 함께 띄운다 — 화면보다 바깥이라 effect 가 화면 뒤에 돈다. */
function renderAt(url: string | { pathname: string; search: string; state: unknown }, project = 'WP', enabled = true, withDeepLink = false) {
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
  openSession.mockClear()
  // 실제 세션 히스토리(BrowserRouter)를 쓰는 테스트가 남긴 항목·state(idx)를 걷는다 — 뒤 테스트의 모바일 뒤로 가기가 idx 를 읽는다.
  window.history.replaceState(null, '', '/')
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

  // WP-2125: 개요 링크(fromOverview)로 들어온 뒤 「필터 지우기」(리셋 신호 state)를 해도 기억을 지운다 — 표지가 남으면 옛 필터가 다음 진입에 되살아난다.
  it('개요 링크로 들어온 뒤 「필터 지우기」를 하면 기억도 지운다', () => {
    localStorage.setItem(keyOf('WP'), 'priority=HIGH')
    const { result } = renderAt({ pathname: '/projects/WP', search: '?priority=HIGH', state: { fromOverview: true } })
    expect(localStorage.getItem(keyOf('WP'))).toBe('priority=HIGH')
    act(() => result.current.setParams(new URLSearchParams(), { replace: true, state: withIssueFiltersReset() }))
    expect(localStorage.getItem(keyOf('WP'))).toBeNull()
  })

  // 이전 state(고정 보기 savedViewId·projectTab·개요·지우기 표지)는 하나도 따라오지 않는다 — 새 location.key 로 되살아나지 않게.
  it('withIssueFiltersReset — 지우기 신호 숫자 키 하나만 담고, 신호값은 호출마다 달라진다', () => {
    const a = withIssueFiltersReset() as Record<string, unknown>
    const b = withIssueFiltersReset() as Record<string, unknown>
    expect(Object.keys(a)).toEqual(['issueFiltersReset'])
    expect(typeof a.issueFiltersReset).toBe('number')
    expect(b.issueFiltersReset).not.toBe(a.issueFiltersReset)
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

  it('조건을 바꾸면 기억하고, 「필터 지우기」로 보기만 남으면 보기만 기억한다', () => {
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

  describe('알 수 없는 필터 값(WP-2083)', () => {
    it('기억이 있어도 알 수 없는 값만 든 주소는 되살리지 않고, 기억도 그대로 둔다', () => {
      localStorage.setItem(keyOf('WP'), 'status=TODO')
      const { result } = renderAt('/projects/WP?status=BOGUS')
      expect(result.current.restoring).toBe(false)
      expect(result.current.location.search).toBe('?status=BOGUS')
      expect(localStorage.getItem(keyOf('WP'))).toBe('status=TODO')
    })

    it('기억이 없으면 알 수 없는 값만 든 주소로 기억을 만들지 않는다', () => {
      renderAt('/projects/WP?status=BOGUS')
      expect(localStorage.getItem(keyOf('WP'))).toBeNull()
    })

    it('알 수 없는 값을 지워 조건 없는 주소가 돼도(표지 state) 기억을 되살리지도 지우지도 않는다', () => {
      localStorage.setItem(keyOf('WP'), 'status=TODO')
      const { result } = renderAt('/projects/WP?status=BOGUS')
      act(() => result.current.setParams(new URLSearchParams(), { replace: true, state: IGNORED_CLEARED_STATE }))
      expect(result.current.location.search).toBe('')
      expect(localStorage.getItem(keyOf('WP'))).toBe('status=TODO')
    })

    it('지우고 남은 조건이 있으면(표지 state) 그 조건을 기억한다', () => {
      const { result } = renderAt('/projects/WP?priority=HIGH,BOGUS')
      // 진입 때 쓴 기억을 되돌려 놓고, 지우기 뒤에 다시 쓰이는지 본다.
      localStorage.setItem(keyOf('WP'), 'status=TODO')
      act(() => result.current.setParams(new URLSearchParams('priority=HIGH'), { replace: true, state: IGNORED_CLEARED_STATE }))
      expect(result.current.location.search).toBe('?priority=HIGH')
      expect(localStorage.getItem(keyOf('WP'))).toBe('priority=HIGH')
    })

    it('지운 뒤 같은 화면에 상관없는 상태 없는 replace 가 와도 보이는 조건을 바꾸지 않고 기억도 지우지 않는다', () => {
      localStorage.setItem(keyOf('WP'), 'status=TODO')
      const { result } = renderAt('/projects/WP?status=BOGUS')
      act(() => result.current.setParams(new URLSearchParams(), { replace: true, state: IGNORED_CLEARED_STATE }))
      act(() => result.current.setParams((prev) => { prev.set('aiChat', '1'); return prev }, { replace: true }))
      expect(searchOf(result)).toEqual(new URLSearchParams('aiChat=1'))
      act(() => result.current.setParams((prev) => { prev.delete('aiChat'); return prev }, { replace: true }))
      expect(result.current.location.search).toBe('')
      expect(result.current.restoring).toBe(false)
      expect(localStorage.getItem(keyOf('WP'))).toBe('status=TODO')
    })

    it('지운 뒤 AI 대화 링크(aiChat 을 replace 로 지움)가 와도 보이는 조건을 바꾸지 않는다', () => {
      localStorage.setItem(keyOf('WP'), 'status=TODO')
      const { result } = renderAt('/projects/WP?status=BOGUS', 'WP', true, true)
      act(() => result.current.setParams(new URLSearchParams(), { replace: true, state: IGNORED_CLEARED_STATE }))
      // AI 답 안의 대화 링크가 같은 화면 주소에 aiChat 을 replace 로 단다 → 처리기가 다시 replace 로 지운다.
      act(() => result.current.setParams(new URLSearchParams('aiChat=bad'), { replace: true }))
      expect(result.current.location.search).toBe('')
      expect(localStorage.getItem(keyOf('WP'))).toBe('status=TODO')
    })

    it('지운 뒤 검색의 AI 대화 결과(지금 주소에 aiChat 만 더해 PUSH)로 와도 보이는 조건을 바꾸지 않고 대화 링크 처리를 덮지 않는다', () => {
      localStorage.setItem(keyOf('WP'), 'status=TODO')
      const { result } = renderAt('/projects/WP?status=BOGUS', 'WP', true, true)
      act(() => result.current.setParams(new URLSearchParams(), { replace: true, state: IGNORED_CLEARED_STATE }))
      // 검색 팔레트는 화면을 그대로 두고 지금 쿼리에 aiChat 만 더해 push 한다 → 처리기가 대화를 열고 replace 로 지운다.
      act(() => result.current.navigate('/projects/WP?aiChat=11111111-1111-1111-1111-111111111111'))
      expect(result.current.location.search).toBe('')
      expect(localStorage.getItem(keyOf('WP'))).toBe('status=TODO')
      // 처리기가 aiChat 을 지운 뒤 그 대화를 열었다 — 되살리기 replace 가 지우기를 덮었으면 열지 못한다.
      expect(openSession).toHaveBeenCalledTimes(1)
      expect(openSession).toHaveBeenCalledWith('11111111-1111-1111-1111-111111111111')
    })

    it('지운 뒤 history 표식을 PUSH 하는 시트(useHistoryParam state 모드)를 열고 닫아도 조건 없는 목록 그대로이고 표식도 지우지 않는다', async () => {
      localStorage.setItem(keyOf('WP'), 'status=TODO')
      // 시트 표식은 브라우저 history 를 읽으므로(useHistoryParam.snapshot) 실제 세션 히스토리(BrowserRouter)로 띄운다.
      window.history.replaceState(null, '', '/projects/WP?status=BOGUS')
      const wrapper = ({ children }: { children: ReactNode }) => (
        <AuthContext.Provider value={testAuthValue}>
          <BrowserRouter>{children}</BrowserRouter>
        </AuthContext.Provider>
      )
      const { result } = renderHook(() => {
        useRememberedIssueQuery('WP', true)
        // 모바일 AI 시트(AIAssistantContext)·useSheetHistory 와 같은 state 모드 표식.
        const sheet = useHistoryParam('aiOpen', { mode: 'state' })
        return { sheet, location: useLocation(), setParams: useSearchParams()[1] }
      }, { wrapper })
      act(() => result.current.setParams(new URLSearchParams(), { replace: true, state: IGNORED_CLEARED_STATE }))
      expect(result.current.location.search).toBe('')
      // 시트 열기 — 같은 주소에 표식만 단 PUSH.
      act(() => result.current.sheet.open('1'))
      expect(result.current.location.search).toBe('')
      expect(result.current.sheet.value).toBe('1')
      // 시트 닫기 — 표식 항목을 되돌리는 POP.
      act(() => result.current.sheet.close())
      await act(settleHistory)
      expect(result.current.sheet.value).toBeNull()
      expect(result.current.location.search).toBe('')
      expect(window.location.search).toBe('')
      expect(localStorage.getItem(keyOf('WP'))).toBe('status=TODO')
    })

    it('지운 뒤 쿼리 파라미터로 여는 패널(?task=, useHistoryParam query 모드)을 열고 닫아도 조건 없는 목록 그대로이고 열림 마크도 남는다', async () => {
      localStorage.setItem(keyOf('WP'), 'status=TODO')
      // 개인 프로젝트 화면의 작업 패널(PersonalTaskPanel)처럼 ?task=<번호> 를 PUSH 로 단다 — 표식은 실제 history 를 읽어 BrowserRouter 로 띄운다.
      window.history.replaceState(null, '', '/projects/WP?status=BOGUS')
      const wrapper = ({ children }: { children: ReactNode }) => (
        <AuthContext.Provider value={testAuthValue}>
          <BrowserRouter>{children}</BrowserRouter>
        </AuthContext.Provider>
      )
      const { result } = renderHook(() => {
        useRememberedIssueQuery('WP', true)
        const task = useHistoryParam('task')
        return { task, location: useLocation(), setParams: useSearchParams()[1] }
      }, { wrapper })
      act(() => result.current.setParams(new URLSearchParams(), { replace: true, state: IGNORED_CLEARED_STATE }))
      expect(result.current.location.search).toBe('')
      // 패널 열기 — 목록 조건은 그대로이고 ?task=5 와 열림 마크만 단 PUSH.
      act(() => result.current.task.open('5'))
      expect(result.current.location.search).toBe('?task=5')
      expect(result.current.task.value).toBe('5')
      // 되살리기 replace 가 열림 마크를 지우면 닫기가 뒤로 가기 대신 다른 길로 빠진다.
      expect(result.current.location.state).toMatchObject({ 'historyParam:task': expect.any(Number) })
      // 패널 닫기 — 마크 항목을 되돌리는 POP.
      act(() => result.current.task.close())
      await act(settleHistory)
      expect(result.current.task.value).toBeNull()
      expect(result.current.location.search).toBe('')
      expect(window.location.search).toBe('')
      expect(localStorage.getItem(keyOf('WP'))).toBe('status=TODO')
    })

    it('지운 뒤 같은 주소에 표식을 단 PUSH 와 그 항목을 닫는 뒤로(POP)에서도 조건 없는 목록 그대로다', () => {
      localStorage.setItem(keyOf('WP'), 'status=TODO')
      const { result } = renderAt('/projects/WP?status=BOGUS')
      act(() => result.current.setParams(new URLSearchParams(), { replace: true, state: IGNORED_CLEARED_STATE }))
      // 시트 열기와 같은 모양 — 지금 state 를 이어받고 값·열림 마크를 더한다(historyParam.planOpen).
      act(() => result.current.navigate('/projects/WP', { state: { ...IGNORED_CLEARED_STATE, sheet: '1', 'historyParam:sheet': 1 } }))
      expect(result.current.location.search).toBe('')
      expect(result.current.location.state).toMatchObject({ sheet: '1' })
      act(() => result.current.navigate(-1))
      expect(result.current.location.search).toBe('')
      expect(localStorage.getItem(keyOf('WP'))).toBe('status=TODO')
    })

    it('되살리기 replace 는 들어온 항목의 state(시트·패널 열림 마크 등)를 지우지 않는다', () => {
      localStorage.setItem(keyOf('WP'), 'status=TODO')
      // 열림 마크를 단 채 조건 없는 주소로 들어온 항목 — 되살리기가 state 를 버리면 그 시트의 닫기가 뒤로 가기로 돌아가지 못한다.
      const { result } = renderAt({ pathname: '/projects/WP', search: '', state: { sheet: '1', 'historyParam:sheet': 1 } })
      expect(result.current.location.search).toBe('?status=TODO')
      expect(result.current.location.state).toMatchObject({ sheet: '1', 'historyParam:sheet': 1 })
    })

    it('표지가 남은 항목에서 state 를 이어받는 replace(AI 대화 링크 처리기)가 와도 표지를 다시 따르지 않고 기억을 되살린다', () => {
      localStorage.setItem(keyOf('WP'), 'status=TODO')
      // 표지가 history.state 에 남은 항목을 새로고침 — 주소에 대화 링크(aiChat)가 있어 처리기가 state 를 이어받아 replace 로 지운다.
      const { result } = renderAt(
        { pathname: '/projects/WP', search: '?aiChat=11111111-1111-1111-1111-111111111111', state: IGNORED_CLEARED_STATE },
        'WP', true, true,
      )
      const s = searchOf(result)
      expect(s.get('aiChat')).toBeNull()
      expect(s.get('status')).toBe('TODO')
    })

    it('지운 뒤에도 같은 프로젝트 링크(PUSH)로 조건 없이 다시 들어오면 평소처럼 되살린다', () => {
      localStorage.setItem(keyOf('WP'), 'status=TODO')
      const { result } = renderAt('/projects/WP?status=BOGUS')
      act(() => result.current.setParams(new URLSearchParams(), { replace: true, state: IGNORED_CLEARED_STATE }))
      act(() => result.current.navigate('/projects/WP'))
      expect(result.current.location.search).toBe('?status=TODO')
    })

    it('지운 뒤 화면에서 조건을 골랐다가 모두 지우면 평소처럼 기억도 지운다', () => {
      localStorage.setItem(keyOf('WP'), 'status=TODO')
      const { result } = renderAt('/projects/WP?status=BOGUS')
      act(() => result.current.setParams(new URLSearchParams(), { replace: true, state: IGNORED_CLEARED_STATE }))
      act(() => result.current.setParams(new URLSearchParams('priority=HIGH'), { replace: true }))
      expect(localStorage.getItem(keyOf('WP'))).toBe('priority=HIGH')
      act(() => result.current.setParams(new URLSearchParams(), { replace: true }))
      expect(result.current.location.search).toBe('')
      expect(localStorage.getItem(keyOf('WP'))).toBeNull()
    })

    it('표지가 history.state 에 남은 채 새로고침(POP 진입)하면 평소처럼 기억을 되살린다', () => {
      localStorage.setItem(keyOf('WP'), 'status=TODO')
      // 새로고침 = 같은 주소·같은 state 로 POP 진입(브라우저가 history.state 를 되돌려 준다).
      const { result } = renderAt({ pathname: '/projects/WP', search: '', state: IGNORED_CLEARED_STATE })
      expect(result.current.location.search).toBe('?status=TODO')
      expect(localStorage.getItem(keyOf('WP'))).toBe('status=TODO')
    })

    it('지운 뒤 다른 화면에 갔다가 뒤로(POP) 돌아와도 평소처럼 기억을 되살리고, 앞으로 갔다 다시 뒤로 와도 같다', () => {
      localStorage.setItem(keyOf('WP'), 'status=TODO')
      const { result } = renderAt('/projects/WP?status=BOGUS')
      act(() => result.current.setParams(new URLSearchParams(), { replace: true, state: IGNORED_CLEARED_STATE }))
      expect(result.current.location.search).toBe('')
      act(() => result.current.navigate('/projects/WP/issues/5'))
      act(() => result.current.navigate(-1))
      expect(result.current.location.search).toBe('?status=TODO')
      act(() => result.current.navigate(1))
      act(() => result.current.navigate(-1))
      expect(result.current.location.search).toBe('?status=TODO')
      expect(localStorage.getItem(keyOf('WP'))).toBe('status=TODO')
    })

    it('알 수 없는 값이 섞여도 알려진 값은 기억한다', () => {
      renderAt('/projects/WP?priority=HIGH,BOGUS')
      expect(localStorage.getItem(keyOf('WP'))).toBe('priority=HIGH')
    })
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
              <Route path="/projects/:key/issues" element={<List />} />
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
