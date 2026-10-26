// 모바일 메일 보관·옮기기·삭제(WP-962) — 길게 누르기 시트의 보관·옮기기(메일함 고르기 시트)·삭제, 상세 ⋯ 메뉴의 삭제.
// 상세 ⋯ 삭제는 닫기가 브라우저 히스토리(useHistoryParam — history.state 키)를 따라 MemoryRouter 페이지 테스트로 옮기지 못해 @platform 으로 남긴다(WP-981).
// 서버 요청은 실행 취소 토스트가 닫힐 때 나간다. 길게 누르기가 앱 타이머를 쓰므로 가상 시계 대신 실제 시간(토스트 5초)을 기다린다.
import type { Page } from '@playwright/test'

import type { MailMoveRequest, MailMoveResponse } from '../../../src/types/mailFolder'
import { detail, mailAccount, mailServerFolder, summary } from '../../factories/mail.factory'
import { mockApi } from '../../fixtures/api-mock'
import { longPress } from '../../fixtures/mobile-chat'
import { expect, stubChat, test } from '../../fixtures/mobile.fixture'
import { trackRequests } from '../../fixtures/requests'

const MOVE_PATH = '/api/v1/mail/accounts/1/messages/move'
/** 토스트(5초)가 닫혀 요청이 나갈 때까지 넉넉히. */
const COMMIT_TIMEOUT = 12_000

async function stubMail(page: Page) {
  await stubChat(page)
  const moved = new Set<number>()
  await mockApi(page, 'GET', '/api/v1/mail/accounts', [mailAccount()])
  await mockApi(page, 'GET', '/api/v1/mail/unread-summary', { workUnread: 0 })
  await mockApi(page, 'GET', '/api/v1/mail/accounts/1/unread-counts', {
    classificationActive: false, inbox: 0, byCategory: { 업무: 0, 개인: 0, 알림: 0, 프로모션: 0, 뉴스레터: 0 }, needsReply: 0,
  })
  await mockApi(page, 'GET', '/api/v1/mail/accounts/1/folders', [
    mailServerFolder({ id: 1, displayName: 'Archive', role: 'ARCHIVE', unreadCount: 0 }),
    mailServerFolder({ id: 5, displayName: '프로젝트', unreadCount: 0 }),
  ])
  await page.route(
    (u) => u.pathname === '/api/v1/mail/accounts/1/messages',
    (r) => r.fulfill({ json: [summary({ id: 10, seen: true }), summary({ id: 11, seen: true, subject: '다른 메일' })].filter((m) => !moved.has(m.id)) }),
  )
  await page.route(
    (u) => u.pathname === MOVE_PATH,
    (r) => {
      const body = r.request().postDataJSON() as MailMoveRequest
      body.messageIds.forEach((id) => moved.add(id))
      const json: MailMoveResponse = { results: body.messageIds.map((id) => ({ messageId: id, ok: true, error: null })) }
      return r.fulfill({ json })
    },
  )
  await mockApi(page, 'GET', '/api/v1/mail/messages/10', { ...detail({ id: 10 }), seen: true })
  return trackRequests(page, 'POST', MOVE_PATH)
}

test('길게 누르기 → 보관 → 바로 빠지고 토스트가 닫히면 ARCHIVE 로 보낸다', { tag: '@input' }, async ({ authenticatedPage: page }) => {
  const moves = await stubMail(page)
  await page.goto('/mail/1')
  // 터치 셸에는 hover 작업 묶음이 없다
  await expect(page.getByTestId('mail-row-10')).toBeVisible()
  await expect(page.getByTestId('mail-row-move-actions-10')).toHaveCount(0)
  await longPress(page, page.getByTestId('mail-row-10'))
  const sheet = page.getByTestId('message-action-sheet')
  await expect(sheet.getByTestId('message-action-archive')).toHaveText('보관')
  await expect(sheet.getByTestId('message-action-move')).toHaveText('옮기기')
  await expect(sheet.getByTestId('message-action-trash')).toHaveText('삭제')
  await sheet.getByTestId('message-action-archive').click()
  await expect(page.getByTestId('mail-row-10')).toHaveCount(0)
  await expect(page.getByText('보관했습니다')).toBeVisible()
  expect(moves.count()).toBe(0)
  await moves.waitFor(1, { timeout: COMMIT_TIMEOUT })
  expect(moves.lastBody()).toEqual({ messageIds: [10], target: { kind: 'ARCHIVE' } })
})

test('길게 누르기 → 옮기기 → 메일함 고르기 시트에서 프로젝트 → FOLDER 로 보낸다', { tag: '@input' }, async ({ authenticatedPage: page }) => {
  const moves = await stubMail(page)
  await page.goto('/mail/1')
  await longPress(page, page.getByTestId('mail-row-10'))
  await page.getByTestId('message-action-move').click()
  const picker = page.getByTestId('mail-move-sheet')
  await expect(picker).toBeVisible()
  // 받은편지함 보기 — 받은편지함은 없고 보관·프로젝트, 행 높이는 터치 44px 이상
  await expect(picker.getByTestId('mail-move-sheet-target-inbox')).toHaveCount(0)
  await expect(picker.getByTestId('mail-move-sheet-target-archive')).toBeVisible()
  const row = picker.getByTestId('mail-move-sheet-target-folder-5')
  expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  await row.click()
  await expect(picker).toHaveCount(0)
  await expect(page.getByTestId('mail-row-10')).toHaveCount(0)
  await moves.waitFor(1, { timeout: COMMIT_TIMEOUT })
  expect(moves.lastBody()).toEqual({ messageIds: [10], target: { kind: 'FOLDER', folderId: 5 } })
})

test('상세 ⋯ 메뉴의 삭제 → 목록으로 돌아가고 TRASH 로 보낸다', { tag: '@platform' }, async ({ authenticatedPage: page }) => {
  const moves = await stubMail(page)
  await page.goto('/mail/1')
  await page.getByTestId('mail-row-10').click()
  await expect(page.getByTestId('mail-detail')).toBeVisible()
  const bar = page.getByTestId('mail-back')
  await bar.getByRole('button', { name: '메일 메뉴' }).click()
  await bar.getByTestId('mail-trash').click()
  await expect(page.getByTestId('mail-detail')).toHaveCount(0)
  await expect(page.getByTestId('mail-list')).toBeVisible()
  await expect(page.getByTestId('mail-row-10')).toHaveCount(0)
  await moves.waitFor(1, { timeout: COMMIT_TIMEOUT })
  expect(moves.lastBody()).toEqual({ messageIds: [10], target: { kind: 'TRASH' } })
})
