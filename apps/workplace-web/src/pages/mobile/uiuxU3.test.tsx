// 모바일 UI/UX 마감 U3(WP-121) — 페이지 테스트(WP-981).
// ⋯ 를 그대로 남기는 화면(이슈 상세·메일 검색), 탭 편집 [저장] 활성 조건, 메일 계정 없음의 ☰ 없음은 조건부 렌더라
// e2e/pages/mobile/uiux-u3.spec.ts 에서 옮겼다. 시각 규격·키보드 초점 이동, 그리고 노트 AI 작성 메뉴(편집 가능 여부가
// 동기화 서버 연결에 달려 있다)는 그 E2E 가 지킨다.
// 앱 셸(탭바·AI 시트)을 보지 않으므로 앱 대신 각 화면(이슈 상세·메일 모듈·탭 편집)만 renderScreen 으로 띄운다(WP-1002).
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { expect, test } from 'vitest'

import { MailModuleLayout } from '@/components/mail/MailModuleLayout'
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

test('여러 항목 메뉴(이슈 상세)와 검색 입력 메뉴(메일)는 ⋯/🔍 트리거로 남는다', async () => {
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

  // 메일: 메뉴 내용이 검색 입력 하나 — 입력은 인라인 대상이 아니므로 🔍 트리거가 남는다.
  const { user } = renderMail('/mail', {
    handlers: [
      http.get('/api/v1/mail/accounts', () => HttpResponse.json([mailAccount()])),
      http.get('/api/v1/mail/accounts/1/messages', () => HttpResponse.json([summary()])),
      http.get('/api/v1/mail/accounts/1/unread-counts', () =>
        HttpResponse.json({ classificationActive: false, inbox: 0, byCategory: {}, needsReply: 0 }),
      ),
    ],
  })
  const search = await screen.findByTestId('mobile-header-more')
  expect(search).toHaveAccessibleName('메일 검색')
  await user.click(search)
  const menu = await screen.findByTestId('mobile-header-more-menu')
  expect(menu.querySelector('input')).not.toBeNull()
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
