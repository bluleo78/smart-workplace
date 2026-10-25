// 메일 보관·옮기기·삭제 E2E(WP-962, 데스크톱) — 행 hover·상세 툴바에서 누르면 바로 목록에서 빠지고 「… · 실행 취소」 토스트가 뜬다.
// 서버 요청은 토스트가 닫힐 때(5초) 나간다 — 실행 취소면 요청이 없다. 실패하면 행이 돌아오고 오류 토스트.
import type { Page } from '@playwright/test'

import { UNDO_DELETE_DELAY_MS } from '../../../src/lib/deleteWithUndo'
import type { MailMoveRequest, MailMoveResponse, MailServerFolder } from '../../../src/types/mailFolder'
import type { EmailMessageSummary } from '../../../src/types/mailMessage'
import { detail, mailAccount, mailServerFolder, summary } from '../../factories/mail.factory'
import { mockApi } from '../../fixtures/api-mock'
import { expect, test } from '../../fixtures/auth.fixture'
import { trackRequests } from '../../fixtures/requests'
import { expectStays } from '../../fixtures/wait'

const MOVE_PATH = '/api/v1/mail/accounts/1/messages/move'

/** 보관(1) · 프로젝트(5) ⊃ 견적(6). */
const FOLDERS: MailServerFolder[] = [
  mailServerFolder({ id: 1, displayName: 'Archive', role: 'ARCHIVE', unreadCount: 0 }),
  mailServerFolder({ id: 5, displayName: '프로젝트', unreadCount: 0 }),
  mailServerFolder({ id: 6, displayName: '견적', parentId: 5, unreadCount: 0 }),
]

/**
 * 계정·안 읽은 수·메일함·목록을 모킹한다. 목록은 서버처럼 옮겨진 메일을 빼고 돌려준다(옮기기 응답이 ok 인 메일).
 * moveReply 로 옮기기 응답을 바꾼다(기본: 모두 성공).
 */
async function stub(
  page: Page,
  opts: { rows?: EmailMessageSummary[]; moveReply?: (body: MailMoveRequest) => { status: number; json: unknown } } = {},
) {
  const rows = opts.rows ?? [summary({ id: 10, subject: '보관할 메일' }), summary({ id: 11, subject: '다른 메일' })]
  const moved = new Set<number>()
  await mockApi(page, 'GET', '/api/v1/mail/accounts', [mailAccount()])
  await mockApi(page, 'GET', '/api/v1/mail/accounts/1/unread-counts', {
    classificationActive: false, inbox: 0, byCategory: { 업무: 0, 개인: 0, 알림: 0, 프로모션: 0, 뉴스레터: 0 }, needsReply: 0,
  })
  await mockApi(page, 'GET', '/api/v1/mail/accounts/1/folders', FOLDERS)
  await page.route(
    (u) => u.pathname === '/api/v1/mail/accounts/1/messages',
    (r) => r.fulfill({ json: rows.filter((m) => !moved.has(m.id)) }),
  )
  await page.route(
    (u) => u.pathname === MOVE_PATH,
    (r) => {
      const body = r.request().postDataJSON() as MailMoveRequest
      const reply = opts.moveReply?.(body) ?? {
        status: 200,
        json: { results: body.messageIds.map((id) => ({ messageId: id, ok: true, error: null })) } satisfies MailMoveResponse,
      }
      if (reply.status === 200) {
        for (const res of (reply.json as MailMoveResponse).results) if (res.ok) moved.add(res.messageId)
      }
      return r.fulfill({ status: reply.status, json: reply.json })
    },
  )
  return trackRequests(page, 'POST', MOVE_PATH)
}

test.describe('메일 보관·옮기기·삭제 — 데스크톱(WP-962)', () => {
  test('행 hover 보관 → 바로 빠지고 토스트, 5초 뒤 ARCHIVE 로 보낸다', async ({ authenticatedPage: page }) => {
    await page.clock.install()
    const moves = await stub(page)
    await page.goto('/mail/1')
    await page.getByTestId('mail-row-10').hover()
    await page.getByTestId('mail-row-archive-10').click()

    await expect(page.getByTestId('mail-row-10')).toHaveCount(0)
    await expect(page.getByTestId('mail-row-11')).toBeVisible()
    await expect(page.getByText('보관했습니다')).toBeVisible()
    expect(moves.count()).toBe(0) // 토스트가 떠 있는 동안은 보내지 않는다

    await page.clock.runFor(UNDO_DELETE_DELAY_MS)
    await moves.waitFor()
    expect(moves.lastBody()).toEqual({ messageIds: [10], target: { kind: 'ARCHIVE' } })
    // 옮긴 뒤 다시 받은 목록에도 없다
    await expect(page.getByTestId('mail-row-10')).toHaveCount(0)
  })

  test('실행 취소 → 행이 돌아오고 요청은 나가지 않는다', async ({ authenticatedPage: page }) => {
    await page.clock.install()
    const moves = await stub(page)
    await page.goto('/mail/1')
    await page.getByTestId('mail-row-10').hover()
    await page.getByTestId('mail-row-trash-10').click()
    await expect(page.getByText('삭제했습니다')).toBeVisible()
    await page.getByRole('button', { name: '실행 취소' }).click()
    await expect(page.getByTestId('mail-row-10')).toBeVisible()
    await page.clock.runFor(UNDO_DELETE_DELAY_MS * 2)
    await expectStays(page, moves.count, 0)
  })

  test('화면이 숨으면(visibilitychange hidden) 토스트를 기다리지 않고 보내고, 다시 보이면 목록을 받아 행이 그대로 빠져 있다', async ({ authenticatedPage: page }) => {
    await page.clock.install()
    const moves = await stub(page)
    const lists = trackRequests(page, 'GET', '/api/v1/mail/accounts/1/messages')
    await page.goto('/mail/1')
    await page.getByTestId('mail-row-10').hover()
    await page.getByTestId('mail-row-archive-10').click()
    await expect(page.getByTestId('mail-row-10')).toHaveCount(0)
    expect(moves.count()).toBe(0)
    const setVisibility = (v: 'hidden' | 'visible') =>
      page.evaluate((state) => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
        document.dispatchEvent(new Event('visibilitychange'))
      }, v)
    await setVisibility('hidden')
    await moves.waitFor()
    expect(moves.lastBody()).toEqual({ messageIds: [10], target: { kind: 'ARCHIVE' } })
    const listsBefore = lists.count()
    await setVisibility('visible')
    await expect.poll(() => lists.count()).toBeGreaterThan(listsBefore)
    await expect(page.getByTestId('mail-row-10')).toHaveCount(0)
    await expect(page.getByTestId('mail-row-11')).toBeVisible()
    // 토스트가 나중에 닫혀도 다시 보내지 않는다
    await page.clock.runFor(UNDO_DELETE_DELAY_MS * 2)
    await expectStays(page, moves.count, 1)
  })

  test('옮기기 메뉴 — 받은편지함 보기엔 받은편지함이 없고 보관·내 메일함 트리, 고르면 FOLDER 로 보낸다', async ({ authenticatedPage: page }) => {
    await page.clock.install()
    const moves = await stub(page)
    await page.goto('/mail/1')
    await page.getByTestId('mail-row-10').hover()
    await page.getByTestId('mail-row-move-10').click()
    const menu = page.getByTestId('mail-move-menu')
    await expect(menu).toBeVisible()
    await expect(menu.getByTestId('mail-move-target-inbox')).toHaveCount(0)
    await expect(menu.getByTestId('mail-move-target-archive')).toHaveText('보관')
    await expect(menu.getByTestId('mail-move-target-folder-5')).toHaveText('프로젝트')
    await expect(menu.getByTestId('mail-move-target-folder-6')).toHaveText('견적')
    // 하위 메일함은 더 들여 쓴다
    const x = async (id: number) => (await menu.getByTestId(`mail-move-target-folder-${id}`).locator('svg').boundingBox())!.x
    expect(await x(6)).toBeGreaterThan(await x(5))
    await menu.getByTestId('mail-move-target-folder-6').click()
    // 메뉴를 고르는 클릭이 행 열기로 번지지 않는다
    await expect(page).not.toHaveURL(/messageId=/)
    await expect(page.getByText("'견적' 메일함으로 옮겼습니다")).toBeVisible()
    await page.clock.runFor(UNDO_DELETE_DELAY_MS)
    await moves.waitFor()
    expect(moves.lastBody()).toEqual({ messageIds: [10], target: { kind: 'FOLDER', folderId: 6 } })
  })

  test('열린 메일을 상세 툴바에서 삭제 → 상세가 닫히고 TRASH 로 보낸다', async ({ authenticatedPage: page }) => {
    await page.clock.install()
    const moves = await stub(page)
    await mockApi(page, 'GET', '/api/v1/mail/messages/10', { ...detail({ id: 10 }), seen: true })
    await page.goto('/mail/1')
    await page.getByTestId('mail-row-10').click()
    await expect(page.getByTestId('mail-detail')).toBeVisible()
    await page.getByTestId('mail-trash').click()
    await expect(page.getByTestId('mail-detail')).toHaveCount(0)
    await expect(page.getByTestId('mail-detail-empty')).toBeVisible()
    await expect(page.getByTestId('mail-row-10')).toHaveCount(0)
    await page.clock.runFor(UNDO_DELETE_DELAY_MS)
    await moves.waitFor()
    expect(moves.lastBody()).toEqual({ messageIds: [10], target: { kind: 'TRASH' } })
  })

  test('서버 오류 → 행이 돌아오고 오류 토스트', async ({ authenticatedPage: page }) => {
    await page.clock.install()
    const moves = await stub(page, {
      moveReply: () => ({ status: 400, json: { status: 400, message: '보관 메일함이 없습니다' } }),
    })
    await page.goto('/mail/1')
    await page.getByTestId('mail-row-10').hover()
    await page.getByTestId('mail-row-archive-10').click()
    await expect(page.getByTestId('mail-row-10')).toHaveCount(0)
    await page.clock.runFor(UNDO_DELETE_DELAY_MS)
    await moves.waitFor()
    await expect(page.getByText('보관 메일함이 없습니다')).toBeVisible()
    await expect(page.getByTestId('mail-row-10')).toBeVisible()
  })

  test('일부 실패 → 실패한 메일만 돌아오고 사유를 알린다', async ({ authenticatedPage: page }) => {
    await page.clock.install()
    const moves = await stub(page, {
      moveReply: (b) => ({
        status: 200,
        json: { results: b.messageIds.map((id) => ({ messageId: id, ok: false, error: '메일 서버에서 메일을 찾을 수 없습니다' })) },
      }),
    })
    await page.goto('/mail/1')
    await page.getByTestId('mail-row-10').hover()
    await page.getByTestId('mail-row-archive-10').click()
    await page.clock.runFor(UNDO_DELETE_DELAY_MS)
    await moves.waitFor()
    await expect(page.getByText('메일을 옮기지 못했어요 — 메일 서버에서 메일을 찾을 수 없습니다')).toBeVisible()
    await expect(page.getByTestId('mail-row-10')).toBeVisible()
  })

  test('보관 보기 — 보관 버튼이 없고, 옮기기 메뉴 맨 앞의 받은편지함으로 INBOX', async ({ authenticatedPage: page }) => {
    await page.clock.install()
    const moves = await stub(page)
    await page.route(
      (u) => u.pathname === '/api/v1/mail/accounts/1/folders/1/sync',
      (r) => r.fulfill({ json: { running: false, fetched: 0, saved: 0, seenChanged: 0, removed: 0, syncedSince: null, folderSyncedAt: null } }),
    )
    await page.goto('/mail/1?box=1')
    await page.getByTestId('mail-row-10').hover()
    await expect(page.getByTestId('mail-row-trash-10')).toBeVisible()
    await expect(page.getByTestId('mail-row-archive-10')).toHaveCount(0)
    await page.getByTestId('mail-row-move-10').click()
    const menu = page.getByTestId('mail-move-menu')
    await expect(menu.getByTestId('mail-move-target-archive')).toHaveCount(0)
    await menu.getByTestId('mail-move-target-inbox').click()
    await expect(page.getByText('받은편지함으로 옮겼습니다')).toBeVisible()
    await page.clock.runFor(UNDO_DELETE_DELAY_MS)
    await moves.waitFor()
    expect(moves.lastBody()).toEqual({ messageIds: [10], target: { kind: 'INBOX' } })
  })

  test('보낸편지함엔 보관·옮기기·삭제가 없다', async ({ authenticatedPage: page }) => {
    await stub(page)
    await mockApi(page, 'GET', '/api/v1/mail/messages/10', { ...detail({ id: 10 }), seen: true })
    await page.goto('/mail/1?folder=sent')
    await page.getByTestId('mail-row-10').hover()
    await expect(page.getByTestId('mail-row-move-actions-10')).toHaveCount(0)
    await page.getByTestId('mail-row-10').click()
    await expect(page.getByTestId('mail-detail')).toBeVisible()
    await expect(page.getByTestId('mail-archive')).toHaveCount(0)
    await expect(page.getByTestId('mail-move')).toHaveCount(0)
    await expect(page.getByTestId('mail-trash')).toHaveCount(0)
  })
})
