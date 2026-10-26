// 모바일 셸 최종 리뷰 보정(WP-121) — 페이지 테스트(WP-981).
// 탭바가 숨은 상세(메일·연락처)의 ✦ AI 진입점, 설정 딥링크의 ‹ 대상(앱 밖으로 나가지 않는 모듈 루트), 모바일 AI 열기가
// ai-mode 를 영속하지 않음, 알림 화면 제목 중복 없음은 브라우저 없이 판정되므로 e2e/pages/mobile/final-review.spec.ts 에서 옮겼다.
// 앱 → 설정 → ‹ (실제 브라우저 기록 -1, @platform), 캘린더 헤더 폭·탭 재탭 스크롤·리사이즈 셸 교체(@layout)는 E2E 에 남는다.
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { expect, test } from 'vitest'

import { PAGE_LOAD_TIMEOUT, renderPage } from '@/test/renderPage'
import { mockViewport } from '@/test/viewport'

import { member, memberDetail, page as makeContactPage } from '../../../e2e/factories/contacts.factory'
import { detail, mailAccount, summary } from '../../../e2e/factories/mail.factory'

mockViewport()

/** 상세 화면의 뒤로가기 바(탭바 숨김)에 있는 ✦ 로 AI 시트를 연다. */
async function expectAiFromDetailBar(user: ReturnType<typeof renderPage>['user']) {
  await waitFor(() => expect(screen.queryByTestId('mobile-tabbar')).not.toBeInTheDocument())
  await user.click(screen.getByTestId('mobile-back-ai'))
  expect(await screen.findByTestId('ai-sheet')).toBeInTheDocument()
}

// 탭 루트 상세는 탭바를 숨기므로 탭바 ✦ 대신 상세 바의 ✦ 가 AI 진입점이다.
test('메일 본문(탭바 숨김)에서도 ✦ 로 AI 시트를 연다', async () => {
  const { user } = renderPage('/mail/1', {
    handlers: [
      http.get('/api/v1/mail/accounts', () => HttpResponse.json([mailAccount()])),
      http.get('/api/v1/mail/accounts/1/messages', () => HttpResponse.json([summary()])),
      http.get('/api/v1/mail/messages/10', () => HttpResponse.json(detail())),
      // 목록 머리 안 읽음 수·본문 AI 요약 — 화면 관심사가 아니라 빈 값으로 둔다.
      http.get('/api/v1/mail/accounts/1/unread-counts', () =>
        HttpResponse.json({ classificationActive: false, inbox: 0, byCategory: {}, needsReply: 0 }),
      ),
      http.get('/api/v1/mail/messages/10/summary', () => HttpResponse.json({ summary: null, status: 'SKIPPED' })),
    ],
  })
  await user.click(await screen.findByTestId('mail-row-10', {}, { timeout: PAGE_LOAD_TIMEOUT }))
  expect(await screen.findByTestId('mail-back')).toBeInTheDocument()
  await expectAiFromDetailBar(user)
})

test('연락처 상세(탭바 숨김)에서도 ✦ 로 AI 시트를 연다', async () => {
  const { user } = renderPage('/contacts', {
    handlers: [
      http.get('/api/v1/contacts', () => HttpResponse.json(makeContactPage([member()]))),
      http.get('/api/v1/contacts/members/1', () => HttpResponse.json(memberDetail())),
    ],
  })
  // 행은 div — 선택은 안쪽 첫 버튼(별 버튼과 형제)이 받는다.
  const row = await screen.findByTestId('contact-row-MEMBER-1', {}, { timeout: PAGE_LOAD_TIMEOUT })
  await user.click(within(row).getAllByRole('button')[0])
  expect(await screen.findByTestId('contact-back')).toBeInTheDocument()
  await expectAiFromDetailBar(user)
})

// 딥링크로 들어오면 앱 안 기록이 없어 ‹ 는 -1 대신 모듈 루트로 간다 — 설정 하위 → 설정 목록 → 앱 목록(막다른 길 없음).
test('설정 딥링크: /settings/notifications → ‹ → /settings → ‹ → /apps', async () => {
  const { user, location } = renderPage('/settings/notifications', {
    handlers: [http.get('/api/v1/push/config', () => HttpResponse.json({ enabled: false, vapidPublicKey: null }))],
  })
  await user.click(await screen.findByTestId('mobile-back', {}, { timeout: PAGE_LOAD_TIMEOUT }))
  await waitFor(() => expect(location()).toBe('/settings'))
  expect(await screen.findByTestId('settings-sidebar')).toBeInTheDocument()
  // 탭 루트가 아니므로 큰 제목 대신 뒤로가기 바가 뜬다.
  expect(screen.queryByTestId('mobile-list-header')).not.toBeInTheDocument()
  await user.click(screen.getByTestId('mobile-back'))
  await waitFor(() => expect(location()).toBe('/apps'))
})

// 모바일 AI 시트는 데스크톱 ⌘K 의 기본 모드(ai-mode)를 덮어쓰지 않는다.
test('모바일에서 AI 를 열어도 ai-mode 를 영속하지 않는다', async () => {
  const { user } = renderPage('/apps')
  await user.click(await screen.findByTestId('mobile-tab-ai', {}, { timeout: PAGE_LOAD_TIMEOUT }))
  expect(await screen.findByTestId('ai-sheet')).toBeInTheDocument()
  expect(window.localStorage.getItem('ai-mode')).toBeNull()
})

// 알림 화면 머리에 「알림」 제목이 한 번만 — 헤더와 본문이 겹쳐 두 번 보이던 문제. 모두 읽음은 남는다.
test('알림 화면: 제목 "알림" 은 한 번만 보이고 모두 읽음은 남는다', async () => {
  renderPage('/notifications', {
    handlers: [http.get('/api/v1/push/config', () => HttpResponse.json({ enabled: false, vapidPublicKey: null }))],
  })
  expect(await screen.findByTestId('inbox-mark-all', {}, { timeout: PAGE_LOAD_TIMEOUT })).toBeInTheDocument()
  expect(screen.getAllByText('알림', { exact: true })).toHaveLength(1)
})
