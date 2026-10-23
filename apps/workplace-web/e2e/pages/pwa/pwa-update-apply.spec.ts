// e2e/pages/pwa/pwa-update-apply.spec.ts
// 새 버전 적용(WP-664) — 다른 창에서 새 SW 가 활성화돼 이 창의 관리 SW 가 바뀌면(controllerchange),
// 토스트를 본 적 없는 창도 새로고침해 옛 번들에 남지 않는지, 저장 안 한 입력이 있으면 새로고침 대신 안내하는지.
// 실제 새 배포는 E2E 에서 만들 수 없으므로 controllerchange 를 직접 보내 앱의 반응만 검증한다
// (대기 SW 활성화 뒤 새로고침하는 순서는 applyUpdate.test.ts, 두 창 실브라우저 확인은 라이브 검증).
import type { Page } from '@playwright/test'

import { expect, test } from '../../fixtures/auth.fixture'
import { mockAgentWorkDetail } from '../../fixtures/issue-detail-mock'
import { openSwControlled } from '../../fixtures/push-mock'

test.use({ serviceWorkers: 'allow' })

type Marked = { __beforeReload?: boolean }

/** SW 의 관리를 받는 상태로 열고, 새로고침 여부를 가릴 표식을 남긴다. */
async function openControlled(page: Page, path: string) {
  await openSwControlled(page, path)
  // 새로고침되면 사라지는 표식 — 남아 있으면 아직 같은 문서다.
  await page.evaluate(() => {
    ;(window as Marked).__beforeReload = true
  })
}

/**
 * 관리 SW 교체를 흉내 낸다. 등록 콜백(onRegisteredSW)이 감시를 거는 시점이 SW ready 보다 늦을 수 있어,
 * 감시가 걸린 뒤의 반응을 볼 때까지 호출부가 다시 보낸다. 반환: 새로고침됐으면 'reloaded', 아니면 'same-document'.
 */
async function sendControllerChange(page: Page) {
  try {
    return await page.evaluate(() => {
      if (!(window as Marked).__beforeReload) return 'reloaded'
      navigator.serviceWorker.dispatchEvent(new Event('controllerchange'))
      return 'same-document'
    })
  } catch (e) {
    // 새로고침 중이라 실행 문맥이 사라진 경우만 — 다음 확인에서 새 문서를 본다.
    if (String(e).includes('Execution context was destroyed')) return 'navigating'
    throw e
  }
}

test.describe('PWA 새 버전 적용', () => {
  test('관리 서비스워커가 바뀌면 창을 새로고침한다', async ({ authenticatedPage: page }) => {
    await openControlled(page, '/')
    await expect.poll(() => sendControllerChange(page)).toBe('reloaded')
  })

  test('저장 안 한 입력이 있으면 새로고침 대신 새 버전 적용 안내를 띄운다', async ({ authenticatedPage: page }) => {
    await mockAgentWorkDetail(page, undefined)
    await openControlled(page, '/projects/WP/issues/12')
    const input = page.getByTestId('issue-comment-input')
    await input.click()
    await page.keyboard.type('작성 중인 코멘트')

    const notice = page.getByText('새 버전이 적용됐습니다')
    await expect
      .poll(async () => {
        await sendControllerChange(page)
        return notice.isVisible()
      })
      .toBe(true)
    // 입력은 그대로 — 새로고침되지 않았다.
    expect(await sendControllerChange(page)).toBe('same-document')
    await expect(input).toContainText('작성 중인 코멘트')
    await expect(page.getByRole('button', { name: '새로고침' })).toBeVisible()
  })
})
