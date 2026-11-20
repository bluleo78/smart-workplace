// 모바일 UI/UX 마감 U3(WP-121) — 페이지 테스트(WP-981).
// ⋯ 를 그대로 남기는 화면(이슈 상세·메일 검색), 탭 편집 [저장] 활성 조건, 메일 계정 없음의 ☰ 없음은 조건부 렌더라
// e2e/pages/mobile/uiux-u3.spec.ts 에서 옮겼다. 시각 규격·키보드 초점 이동, 그리고 노트 AI 작성 메뉴(편집 가능 여부가
// 동기화 서버 연결에 달려 있다)는 그 E2E 가 지킨다.
// 앱 셸(탭바·AI 시트)을 보지 않으므로 앱 대신 각 화면(이슈 상세·메일 모듈·탭 편집)만 renderScreen 으로 띄운다(WP-1002).
import { act, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { Outlet, useNavigate } from 'react-router-dom'
import { afterEach, expect, test } from 'vitest'

import { MailModuleLayout } from '@/components/mail/MailModuleLayout'
import { hasLiveStateMark } from '@/lib/historyParam'
import { hasUnsavedInput } from '@/lib/unsavedInput'
import { settleHistory } from '@/test/history'
import { renderMobileModule, renderMobileRoute } from '@/test/kits/mobile/mobileScreen'
import { MOBILE_VIEWPORT, mockResizableViewport } from '@/test/viewport'

import { createIssue, createIssueDetail } from '../../../e2e/factories/issue.factory'
import { mailAccount, summary } from '../../../e2e/factories/mail.factory'
import { createProject } from '../../../e2e/factories/project.factory'
import TabEditPage from '../apps/TabEditPage'
import { MailInboxPage } from '../mail/MailInboxPage'
import IssueDetailPage from '../projects/IssueDetailPage'

// 회전으로 탭바 칸 수가 바뀌는 판정(WP-1849)이 있어 폭을 바꿀 수 있는 뷰포트를 쓴다 — 기본은 iPhone 13 폭(390, 5칸).
const viewport = mockResizableViewport(MOBILE_VIEWPORT)
// 회전 판정이 폭을 바꾼다 — 실패해도 뒤 테스트가 좁은 폭을 물려받지 않게 테스트마다 기본 폭으로 되돌린다.
afterEach(() => act(() => viewport.setWidth(MOBILE_VIEWPORT.width)))

/** 앱 목록 흉내 — 단추로 라우터를 통해 /apps/tabs 로 들어간다(실제 앱 목록 → 탭 편집 이동과 같은 push). */
function AppsStub() {
  const navigate = useNavigate()
  return (
    <>
      <button type="button" data-testid="go-tabs" onClick={() => navigate('/apps/tabs')}>탭 편집</button>
      {/* 앞 기록을 한 칸 더 쌓는다 — 두 칸 뒤로 가면(이중 back) idx 로 드러나게(WP-1849). */}
      <button type="button" data-testid="go-apps-again" onClick={() => navigate('/apps')}>앱 다시</button>
    </>
  )
}

/**
 * /apps 에서 띄워 라우터로 /apps/tabs 로 이동한다 — 앞 기록이 실제로 생긴다(history.state.idx 0 → 1).
 * renderScreen 이 replaceState(null) 로 idx 를 지워 BrowserRouter 가 idx 0 으로 다시 심으므로,
 * replaceState·pushState 로 앞 기록을 미리 만들면 안 되고(‹ 가 navigate(-1) 이 아닌 replace('/apps') 갈래를 탄다) 렌더 뒤 라우터 이동으로 만든다.
 */
async function renderTabEditFromApps({ extraApps = 0 } = {}) {
  const view = renderMobileModule(<Outlet />, [['/apps', <AppsStub />], ['/apps/tabs', <TabEditPage />]], { path: '/apps' })
  expect(window.history.state.idx).toBe(0)
  // extraApps 만큼 /apps 를 더 쌓는다 — 두 칸 뒤로 가는 잘못이 idx 로 드러나게.
  for (let i = 1; i <= extraApps; i++) {
    await view.user.click(await screen.findByTestId('go-apps-again'))
    await waitFor(() => expect(window.history.state.idx).toBe(i))
  }
  await view.user.click(await screen.findByTestId('go-tabs'))
  await screen.findByTestId('tab-edit-header')
  expect(window.history.state.idx).toBe(extraApps + 1)
  return view
}

/** 메일 모듈(레이아웃 + 받은편지함)을 path 로 띄운다. */
const renderMail = (path: string, options: Parameters<typeof renderMobileModule>[2] = {}) =>
  renderMobileModule(<MailModuleLayout />, [['/mail', <MailInboxPage />], ['/mail/:accountId', <MailInboxPage />]], { ...options, path })

test('여러 항목 메뉴(이슈 상세)는 ⋯ 트리거로 남고, 메일 검색은 헤더 메뉴가 아닌 목록 위 필터다', async () => {
  const issueView = renderMobileRoute('/projects/:key/issues/:number', <IssueDetailPage />, {
    path: '/projects/WP/issues/2',
    handlers: [
      http.get('/api/v1/projects/WP', () => HttpResponse.json(createProject())),
      http.get('/api/v1/projects/WP/issues/2', () =>
        HttpResponse.json(createIssueDetail({ summary: createIssue({ id: 2, number: 2, title: '하단 탭바 도입 검토' }), body: '본문', comments: [], history: [] })),
      ),
      http.get('/api/v1/projects/WP/issues/2/*', () => HttpResponse.json([])),
      http.get('/api/v1/projects/WP/issues', () => HttpResponse.json({ items: [], nextCursor: null, hasMore: false })),
    ],
  })
  expect(await screen.findByTestId('mobile-header-more')).toBeInTheDocument()
  issueView.unmount()

  // 메일: 검색 입력을 헤더가 더 갖지 않는다.
  renderMail('/mail', {
    handlers: [
      http.get('/api/v1/mail/accounts', () => HttpResponse.json([mailAccount()])),
      http.get('/api/v1/mail/accounts/1/messages', () => HttpResponse.json([summary()])),
      http.get('/api/v1/mail/accounts/1/unread-counts', () =>
        HttpResponse.json({ classificationActive: false, inbox: 0, byCategory: {}, needsReply: 0 }),
      ),
    ],
  })
  // WP-1355: 메일 검색은 헤더 메뉴가 아니라 목록 위 키워드 필터로 옮겨, 헤더엔 ⋯/🔍 메뉴도 검색 입력도 없다.
  expect(await screen.findByTestId('mail-search')).toBeInTheDocument()
  expect(screen.queryByTestId('mobile-header-more')).not.toBeInTheDocument()
  expect(screen.queryByLabelText('메일 검색')).not.toBeInTheDocument()
})

test('탭 편집 — ✦ 없음, [저장]은 바뀐 것이 있을 때만 활성(되돌리면 다시 비활성)', async () => {
  const { user } = renderMobileRoute('/apps/tabs', <TabEditPage />, { path: '/apps/tabs' })
  const header = await screen.findByTestId('tab-edit-header')
  expect(screen.queryByTestId('mobile-back-ai')).not.toBeInTheDocument()
  const save = within(header).getByTestId('tab-edit-save')
  expect(save).toBeDisabled()
  await user.click(screen.getByTestId('tab-edit-down-0'))
  await waitFor(() => expect(save).toBeEnabled())
  await user.click(screen.getByTestId('tab-edit-up-1'))
  await waitFor(() => expect(save).toBeDisabled())
})

// WP-1833: 저장하지 않은 초안으로 ‹ 를 누르면 버릴지 묻는다(칸이 덜 찬 초안 포함 — 저장은 막혀도 changed).
/** 탭 편집을 띄워 첫 칸을 빼고 ‹ 를 눌러 버림 확인을 연다 — 뺀 앞의 칸 수(slots)도 돌려준다. */
async function removeFirstAndBack() {
  const view = await renderTabEditFromApps()
  await screen.findByTestId('tab-edit-remove-0')
  const slots = screen.getAllByTestId(/^tab-edit-slot-/).length
  await view.user.click(screen.getByTestId('tab-edit-remove-0'))
  await view.user.click(screen.getByTestId('mobile-back'))
  const dialog = await screen.findByTestId('tab-edit-discard-dialog')
  return { ...view, slots, dialog }
}

test('탭 편집 — 칸을 빼고 ‹ 를 누르면 버릴지 묻고 주소는 그대로다', async () => {
  const { location, dialog } = await removeFirstAndBack()
  expect(within(dialog).getByText('저장하지 않은 변경을 버릴까요?')).toBeInTheDocument()
  expect(location()).toBe('/apps/tabs')
  // 바뀐 초안은 「저장 안 한 입력」으로 등록돼 새로고침·새 버전 자동 새로고침에서도 지켜진다.
  expect(hasUnsavedInput()).toBe(true)
})

test('계속 편집 — 대화상자만 닫히고 초안이 남는다', async () => {
  const { user, location, slots } = await removeFirstAndBack()
  await user.click(screen.getByTestId('tab-edit-discard-keep'))
  await waitFor(() => expect(screen.queryByTestId('tab-edit-discard-dialog')).not.toBeInTheDocument())
  // 대화상자를 닫으면 초점이 연 ‹ 단추로 돌아온다(Radix 기본).
  await waitFor(() => expect(screen.getByTestId('mobile-back')).toHaveFocus())
  expect(screen.getAllByTestId(/^tab-edit-slot-/)).toHaveLength(slots - 1)
  expect(location()).toBe('/apps/tabs')
})

test('버리고 나가기 — 저장하지 않고 앱 목록으로', async () => {
  // 저장 구성을 미리 심어 둔다 — 비어 있으면(null) 버리기가 저장해도 단언이 헛통과한다.
  const stored = JSON.stringify(['chat', 'home', 'mail', 'calendar', 'drive'])
  localStorage.setItem('mobile-tabs', stored)
  const { user, location } = await removeFirstAndBack()
  await user.click(screen.getByTestId('tab-edit-discard-confirm'))
  await waitFor(() => expect(location()).toBe('/apps'))
  expect(localStorage.getItem('mobile-tabs')).toBe(stored)
})

test('바뀐 것이 없으면(바꿨다 되돌림 포함) ‹ 는 묻지 않고 나간다', async () => {
  const { user, location } = renderMobileRoute('/apps/tabs', <TabEditPage />, { path: '/apps/tabs' })
  await user.click(await screen.findByTestId('tab-edit-down-0'))
  await user.click(screen.getByTestId('tab-edit-up-1'))
  await user.click(screen.getByTestId('mobile-back'))
  await waitFor(() => expect(location()).toBe('/apps'))
  expect(screen.queryByTestId('tab-edit-discard-dialog')).not.toBeInTheDocument()
})

// WP-1849: 시스템 뒤로가기(popstate)도 ‹ 와 같은 버림 확인을 띄운다 — 바뀐 초안 동안 히스토리 표식 항목이 있다.
test('탭 편집 — 칸을 빼고 시스템 뒤로가기면 버릴지 묻고 화면·초안이 남는다', async () => {
  const { user, location } = renderMobileRoute('/apps/tabs', <TabEditPage />, { path: '/apps/tabs' })
  await screen.findByTestId('tab-edit-remove-0')
  const slots = screen.getAllByTestId(/^tab-edit-slot-/).length
  await user.click(screen.getByTestId('tab-edit-remove-0'))
  await waitFor(() => expect(hasLiveStateMark('tabEdit')).toBe(true))
  act(() => window.history.back())
  expect(await screen.findByTestId('tab-edit-discard-dialog')).toBeInTheDocument()
  expect(location()).toBe('/apps/tabs')
  expect(screen.getAllByTestId(/^tab-edit-slot-/)).toHaveLength(slots - 1)
  await waitFor(() => expect(hasLiveStateMark('tabEdit')).toBe(true))
})

test('탭 편집 — 계속 편집 뒤 다시 시스템 뒤로가기면 또 묻는다', async () => {
  const { user, location } = renderMobileRoute('/apps/tabs', <TabEditPage />, { path: '/apps/tabs' })
  await user.click(await screen.findByTestId('tab-edit-remove-0'))
  await waitFor(() => expect(hasLiveStateMark('tabEdit')).toBe(true))
  act(() => window.history.back())
  await screen.findByTestId('tab-edit-discard-dialog')
  await waitFor(() => expect(hasLiveStateMark('tabEdit')).toBe(true))
  await user.click(screen.getByTestId('tab-edit-discard-keep'))
  await waitFor(() => expect(screen.queryByTestId('tab-edit-discard-dialog')).not.toBeInTheDocument())
  act(() => window.history.back())
  expect(await screen.findByTestId('tab-edit-discard-dialog')).toBeInTheDocument()
  expect(location()).toBe('/apps/tabs')
})

test('탭 편집 — 바꿨다 되돌리면 시스템 뒤로가기는 묻지 않고 앞 화면으로', async () => {
  // /apps 에서 라우터로 들어와 앞 기록(idx 1)이 실제로 있다 — 표식 → go(-1) → navigate(-1) 경로.
  const { user, location } = await renderTabEditFromApps()
  await user.click(await screen.findByTestId('tab-edit-down-0'))
  await waitFor(() => expect(hasLiveStateMark('tabEdit')).toBe(true))
  await user.click(screen.getByTestId('tab-edit-up-1'))
  await waitFor(() => expect(hasLiveStateMark('tabEdit')).toBe(false))
  // 훅이 걷는 표식 항목이 다 빠진 뒤에 시스템 back 을 누른다.
  await settleHistory()
  act(() => window.history.back())
  await waitFor(() => expect(location()).toBe('/apps'))
  expect(screen.queryByTestId('tab-edit-discard-dialog')).not.toBeInTheDocument()
})

// WP-1849: 회전으로 칸 수가 바뀌면 초안·표식을 제자리에서 다시 잡는다 — 표식이 걷혀 첫 시스템 뒤로가기가 화면을 떠난다.
test('탭 편집 — 초안을 바꾼 채 회전해 칸 수가 바뀌어도 표식이 걷혀 시스템 뒤로가기가 화면을 떠난다', async () => {
  const { user, location } = await renderTabEditFromApps()
  const wide = screen.getAllByTestId(/^tab-edit-slot-/).length
  await user.click(await screen.findByTestId('tab-edit-down-0'))
  await waitFor(() => expect(hasLiveStateMark('tabEdit')).toBe(true))
  act(() => viewport.setWidth(360))
  await waitFor(() => expect(screen.getAllByTestId(/^tab-edit-slot-/).length).toBeLessThan(wide))
  // 초안이 새 저장 구성으로 다시 잡혀 표식이 걷힌다.
  await waitFor(() => expect(hasLiveStateMark('tabEdit')).toBe(false))
  await settleHistory()
  act(() => window.history.back())
  await waitFor(() => expect(location()).toBe('/apps'))
  expect(screen.queryByTestId('tab-edit-discard-dialog')).not.toBeInTheDocument()
})

test('탭 편집 — 버리고 나가기는 표식 항목을 걷고 화면을 떠난다', async () => {
  const { user, location } = await removeFirstAndBack()
  await user.click(screen.getByTestId('tab-edit-discard-confirm'))
  await waitFor(() => expect(location()).toBe('/apps'))
  expect(hasLiveStateMark('tabEdit')).toBe(false)
  // 앞 기록으로 돌아갔다(idx 1 → 0) — replace 갈래였다면 idx 가 그대로 1 이다.
  expect(window.history.state.idx).toBe(0)
})

// WP-1849: 막힌 시스템 back 직후(표식 재심기 전) 바로 버리고 나가도 앞 화면에서 끝나고 낡은 표식이 남지 않는다.
test('탭 편집 — 막힌 시스템 뒤로가기 직후 바로 버리고 나가도 앞 화면에서 끝나고 표식이 남지 않는다', async () => {
  // /apps(0) → /apps(1) → /apps/tabs(2) — 나가기가 back 을 두 번 부르면 idx 0 까지 내려가 드러난다.
  const { user, location } = await renderTabEditFromApps({ extraApps: 1 })
  await user.click(await screen.findByTestId('tab-edit-remove-0'))
  await waitFor(() => expect(hasLiveStateMark('tabEdit')).toBe(true))
  act(() => window.history.back())
  await screen.findByTestId('tab-edit-discard-dialog')
  // 재심기를 기다리지 않고 바로 확인한다.
  await user.click(screen.getByTestId('tab-edit-discard-confirm'))
  await waitFor(() => expect(location()).toBe('/apps'))
  await settleHistory()
  expect(location()).toBe('/apps')
  expect(hasLiveStateMark('tabEdit')).toBe(false)
  expect(JSON.stringify(window.history.state)).not.toContain('historyParam:tabEdit')
  expect(window.history.state.idx).toBe(1)
})

// WP-1849: 저장은 '/apps' 를 새로 쌓지 않고 표식을 걷은 뒤 앞 화면으로 돌아간다 — 뒤로가기가 편집 화면을 다시 열면 안 된다.
test('저장 — 탭바에 반영하고 나간 뒤 뒤로가기가 편집 화면을 다시 열지 않는다', async () => {
  const { user, location } = await renderTabEditFromApps()
  await user.click(await screen.findByTestId('tab-edit-down-0'))
  await waitFor(() => expect(hasLiveStateMark('tabEdit')).toBe(true))
  await user.click(screen.getByTestId('tab-edit-save'))
  await waitFor(() => expect(location()).toBe('/apps'))
  expect(localStorage.getItem('mobile-tabs')).not.toBeNull()
  expect(hasLiveStateMark('tabEdit')).toBe(false)
  expect(JSON.stringify(window.history.state)).not.toContain('historyParam:tabEdit')
  // 저장은 앞 기록으로 돌아간 것(idx 1 → 0) — '/apps' 를 새로 쌓았다면 idx 가 2 이거나 그대로다.
  expect(window.history.state.idx).toBe(0)
  await settleHistory()
  // 앞 기록이 더 없으니 뒤로가기가 있어도 편집 화면을 다시 열지 않는다.
  act(() => window.history.back())
  await settleHistory()
  expect(location()).not.toBe('/apps/tabs')
  expect(screen.queryByTestId('tab-edit-header')).not.toBeInTheDocument()
})

test('저장 — 딥링크(앞 기록 없음)여도 앱 목록으로 나간다', async () => {
  const { user, location } = renderMobileRoute('/apps/tabs', <TabEditPage />, { path: '/apps/tabs' })
  // 딥링크 — 앞 기록이 없다(첫 항목).
  expect(window.history.state.idx).toBe(0)
  await user.click(await screen.findByTestId('tab-edit-down-0'))
  await waitFor(() => expect(hasLiveStateMark('tabEdit')).toBe(true))
  await user.click(screen.getByTestId('tab-edit-save'))
  await waitFor(() => expect(location()).toBe('/apps'))
  expect(hasLiveStateMark('tabEdit')).toBe(false)
})

test('메일 계정 없음 — ☰(폴더 시트) 트리거를 두지 않고 헤더 🔔 은 남는다', async () => {
  renderMail('/mail', {})
  expect(await screen.findByTestId('mail-empty-accounts')).toBeInTheDocument()
  expect(screen.queryByTestId('mobile-sidebar-trigger')).not.toBeInTheDocument()
  expect(within(screen.getByTestId('page-header')).getByTestId('mobile-bell')).toBeInTheDocument()
})

test('대조 — 메일 계정이 있으면 같은 헤더에 ☰(폴더 시트) 트리거가 있다', async () => {
  renderMail('/mail/1', {
    handlers: [
      http.get('/api/v1/mail/accounts', () => HttpResponse.json([mailAccount()])),
      http.get('/api/v1/mail/accounts/1/messages', () => HttpResponse.json([summary()])),
      http.get('/api/v1/mail/accounts/1/unread-counts', () =>
        HttpResponse.json({ classificationActive: false, inbox: 0, byCategory: {}, needsReply: 0 }),
      ),
    ],
  })
  expect(await screen.findByTestId('mobile-sidebar-trigger')).toBeInTheDocument()
})
