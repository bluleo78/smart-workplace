// 모바일 UI/UX 마감 U3(WP-121) — 페이지 테스트(WP-981).
// ⋯ 를 그대로 남기는 화면(이슈 상세·메일 검색), 탭 편집 [저장] 활성 조건, 메일 계정 없음의 ☰ 없음은 조건부 렌더라
// e2e/pages/mobile/uiux-u3.spec.ts 에서 옮겼다. 시각 규격·키보드 초점 이동, 그리고 노트 AI 작성 메뉴(편집 가능 여부가
// 동기화 서버 연결에 달려 있다)는 그 E2E 가 지킨다.
// 앱 셸(탭바·AI 시트)을 보지 않으므로 앱 대신 각 화면(이슈 상세·메일 모듈·탭 편집)만 renderScreen 으로 띄운다(WP-1002).
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { expect, test } from 'vitest'

import { MailModuleLayout } from '@/components/mail/MailModuleLayout'
import { hasUnsavedInput } from '@/lib/unsavedInput'
import { renderMobileModule, renderMobileRoute } from '@/test/kits/mobile/mobileScreen'
import { mockViewport } from '@/test/viewport'

import { createIssue, createIssueDetail } from '../../../e2e/factories/issue.factory'
import { mailAccount, summary } from '../../../e2e/factories/mail.factory'
import { createProject } from '../../../e2e/factories/project.factory'
import TabEditPage from '../apps/TabEditPage'
import { MailInboxPage } from '../mail/MailInboxPage'
import IssueDetailPage from '../projects/IssueDetailPage'

mockViewport()

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
  const view = renderMobileRoute('/apps/tabs', <TabEditPage />, { path: '/apps/tabs' })
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
