// 메일 작성 「새 창으로 열기」(WP-1535) E2E — 실제 브라우저 팝업 창(@platform).
// 작성창 ↗ → 클릭에서 바로 연 창이 임시저장 id 로 /mail/compose?draftId=N 에 들어가 그 작성을 앱 셸 없이 그리고,
// 거기서 보내면 창이 스스로 닫히며 메인 창이 BroadcastChannel 알림으로 보낸편지함을 다시 받고 「메일을 보냈습니다」를 띄운다.
// 단추 표시·차단·저장 실패·닫기/버리기 순서·무효화 규칙은 src/pages/mail/mailComposePopout.test.tsx(화면 테스트)가 지킨다.
// 팝업은 새 page 라 메인 page 의 route 목이 닿지 않는다 — 메인 창의 첫 임시저장(POST) 응답을 잠시 붙잡아,
// 팝업이 아직 빈 창(about:blank)일 때 팝업에도 인증·메일 목을 건 뒤 놓아준다(그 응답 뒤에야 팝업 주소가 정해진다).
import type { Page } from '@playwright/test'

import { mailAccount } from '../../factories/mail.factory'
import { createTokenResponse, createUser } from '../../factories/auth.factory'
import { mockApi } from '../../fixtures/api-mock'
import { expect, setupAuthMocks, test } from '../../fixtures/auth.fixture'
import { mockDraftServer, mockSendWithDrafts } from '../../fixtures/mail-drafts-mock'

/** 보낸편지함 목록 조회 수를 센다(folder=SENT) — 새 창에서 보낸 뒤 메인 창이 다시 받는지. */
async function countSentLists(page: Page) {
  let sent = 0
  await page.route(
    (u) => u.pathname === '/api/v1/mail/accounts/1/messages',
    (route) => {
      if (new URL(route.request().url()).searchParams.get('folder') === 'SENT') sent++
      return route.fulfill({ json: [] })
    },
  )
  return () => sent
}

test.describe('메일 작성 새 창', { tag: '@platform' }, () => {
  test('↗ 로 연 새 창에서 보내면 창이 닫히고 메인 창이 보낸편지함을 다시 받는다', async ({ authenticatedPage: page }) => {
    await mockApi(page, 'GET', '/api/v1/mail/accounts', [mailAccount()])
    const sentLists = await countSentLists(page)
    const server = await mockDraftServer(page)
    // 메인 창의 첫 저장(POST) 응답을 붙잡는다 — 팝업 목을 다 건 뒤 놓아준다.
    let releasePost!: () => void
    const postGate = new Promise<void>((r) => (releasePost = r))
    await page.route(
      (u) => u.pathname === '/api/v1/mail/drafts',
      async (route) => {
        if (route.request().method() === 'POST') await postGate
        return route.fallback()
      },
    )

    await page.goto('/mail/1?folder=sent')
    await page.getByTestId('mail-compose-new').click()
    await page.getByTestId('mail-compose-to').fill('rcpt@test.local')
    await page.getByTestId('mail-compose-subject').fill('새 창에서 보낼 메일')
    await expect.poll(sentLists).toBeGreaterThan(0)

    const popupPromise = page.context().waitForEvent('page')
    await page.getByTestId('mail-compose-popout').click()
    const popup = await popupPromise
    // 팝업도 refresh 쿠키로 스스로 로그인한다 — 같은 사용자 목. 임시저장은 메인 창 목의 상태를 그대로 읽고, 보내면 지운다.
    await setupAuthMocks(popup, createUser({ aiAvailable: true }), [{ id: 2, name: 'USER', description: '일반 사용자', isSystem: true }], createTokenResponse())
    await mockApi(popup, 'GET', '/api/v1/mail/accounts', [mailAccount()])
    await popup.route(
      (u) => /^\/api\/v1\/mail\/drafts\/\d+$/.test(u.pathname),
      (route) => {
        if (route.request().method() !== 'GET') return route.fallback()
        const id = Number(new URL(route.request().url()).pathname.split('/').pop())
        const stored = server.drafts.get(id)
        return stored ? route.fulfill({ json: stored.detail }) : route.fulfill({ status: 404, json: { status: 404, message: '없음' } })
      },
    )
    const sends = await mockSendWithDrafts(popup, server)
    releasePost()

    // 클릭에서 연 창이 저장된 id 로 들어가 그 작성을 앱 셸 없이 그린다. 메인 창의 작성창은 닫힌다.
    // 연 창의 id 를 싣는다(손댄 작성이라 fresh 는 없다).
    await expect(popup).toHaveURL(/\/mail\/compose\?draftId=\d+&opener=[\w-]+$/)
    await expect(popup.getByTestId('mail-compose-subject')).toHaveValue('새 창에서 보낼 메일')
    await expect(popup.getByTestId('mail-compose-to')).toBeVisible()
    await expect(popup.locator('[data-testid^="rail-link-"]')).toHaveCount(0)
    await expect(page.getByTestId('mail-compose-dock')).toHaveCount(0)
    const id = Number(new URL(popup.url()).searchParams.get('draftId'))
    expect(server.drafts.has(id)).toBe(true)

    // 새 창에서 이어 쓰고 곧바로 보낸다 — 저장이 끝나지 않은 채라도 창이 닫힐 때 나가기 경고(beforeunload)가 걸려 있으면
    // Playwright 가 대화상자를 「머무르기」로 닫아 창이 닫히지 않는다(close 대기가 시간 초과).
    await popup.getByTestId('mail-compose-subject').fill('새 창에서 보낼 메일 (수정)')
    const sentBefore = sentLists()
    const closed = popup.waitForEvent('close')
    await popup.getByTestId('mail-compose-send').click()
    await closed
    expect(sends.lastBody()).toMatchObject({ to: ['rcpt@test.local'], subject: '새 창에서 보낼 메일 (수정)', draftId: id })

    // 메인 창 — 새 창의 알림으로 결과를 띄우고 보낸편지함을 다시 받는다.
    await expect(page.getByText('메일을 보냈습니다')).toBeVisible()
    await expect.poll(sentLists).toBeGreaterThan(sentBefore)
  })
})
