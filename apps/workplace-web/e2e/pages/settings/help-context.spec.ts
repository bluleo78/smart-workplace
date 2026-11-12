// 도움말 문맥 따라가기(WP-1506) — API 토큰 화면(/settings/tokens)에서 도움말 패널이 화면 문맥을 따라 절을 고르는지 실제 브라우저로 본다.
// 신호 우선순위·층 올라가기·스크롤 칸 고르기·기록 규칙은 순수 함수(helpContext·helpNav)와 HelpPanel/훅 vitest 가 지킨다.
// 여기엔 jsdom 이 거짓으로 통과하거나 잴 수 없는 것만 둔다:
// - @input: 실제 포커스 이동(focusin)·포인터 호버(pointerenter/leave)로 패널이 얼고 풀리는지, 대화상자를 열고 Esc 로 닫으면
//   포커스가 돌아온 단추의 절로 되돌아오는지
// - @layout: 실제 스크롤 위치에서 기준선(보이는 높이 30%)에 걸친 칸을 고르고, 스크롤이 멈춘 뒤 200ms 에야 바뀌는지,
//   지연 로딩 화면으로 옮겨 첫 측정 때 화면이 아직 없었어도 그려진 뒤 칸을 재는지
//   도움말을 연 뒤 목록 데이터가 늦게 와 칸 위치가 밀려도 스크롤 전이면 다시 재는지
// 도움말 묶음은 작은 목(help-bundle-mock 의 「내 설정」 장), 토큰 API 는 목록만 주는 목이다.
import type { Page } from '@playwright/test'

import { expect, test } from '../../fixtures/auth.fixture'
import { mockHelpBundle } from '../../fixtures/help-bundle-mock'
import { expectStays, gate, nextFrame } from '../../fixtures/wait'

/** 토큰 목록 행 — UserApiToken 응답 꼴(api-tokens.spec 의 목과 같은 필드). */
function token(id: number) {
  return {
    id,
    name: `토큰 ${id}`,
    tokenPrefix: `swp_test${id}`,
    tenantId: 1,
    expiresAt: null,
    createdAt: '2026-11-01T00:00:00Z',
    lastUsedAt: null,
    revokedAt: null,
  }
}

/** 토큰 목록 GET 을 count 개로 답한다 — 스크롤 테스트는 목록을 길게 해 본문이 스크롤되게 한다. */
async function mockTokens(page: Page, count: number) {
  await page.route(/\/api\/v1\/users\/me\/api-tokens$/, (route) =>
    route.request().method() === 'GET'
      ? route.fulfill({ json: Array.from({ length: count }, (_, i) => token(i + 1)) })
      : route.fallback(),
  )
}

/** API 토큰 화면을 열고 도움말 패널을 연다 — 목록 행이 그려진 뒤 연다(첫 측정이 다 그려진 화면을 재게). */
async function openTokensWithHelp(page: Page, count = 1) {
  await mockHelpBundle(page)
  await mockTokens(page, count)
  await page.goto('/settings/tokens')
  await expect(page.getByTestId(/^token-row-\d+$/)).toHaveCount(count)
  await page.getByTestId('help-toggle').click()
  await expect(page.getByTestId('help-panel')).toBeVisible()
}

/** 패널 루트 — data-help-source 가 지금 보이는 절의 출처(selected|dialog|focus|scroll|address). */
function panelBody(page: Page) {
  return page.getByTestId('help-panel-body')
}

/**
 * 브레드크럼의 마지막 항목 — 지금 보이는 절의 화면 칸 이름(label).
 * 역할(listitem)이 아니라 li 로 찾는다 — 모달이 열리면 Radix 가 바깥(패널 포함)을 aria-hidden 으로 가려 역할 조회에서 빠진다.
 */
function currentCrumb(page: Page) {
  return page.getByTestId('help-breadcrumb').locator('li').last()
}

/** 보이는 절이 label 이고 출처가 source 인지 함께 본다. */
async function expectShown(page: Page, label: string, source: string) {
  await expect(currentCrumb(page)).toContainText(label)
  await expect(panelBody(page)).toHaveAttribute('data-help-source', source)
}

/** 「도구에 연결하기」 칸의 설치 명령 복사 단추 — 그 칸의 대표 조작 요소. */
function connectCopy(page: Page) {
  return page.getByTestId('connect-guide-plugin-install-command-copy')
}

test.describe('도움말 문맥 따라가기 — API 토큰 화면', () => {
  test('화면에서 포커스를 옮기면 도움말이 그 칸의 절로 바뀌고 누른 단추 이름을 본문에서 강조한다', { tag: '@input' }, async ({ authenticatedPage: page }) => {
    await openTokensWithHelp(page)

    await connectCopy(page).focus()
    await expectShown(page, '도구에 연결하기', 'focus')
    await expect(panelBody(page)).toContainText('연결 절 본문')

    // 헤더 「토큰 발급」 단추로 포커스를 옮기면 발급 절 — 본문의 **토큰 발급** 이 단추 이름과 같아 강조된다.
    await page.getByTestId('token-issue-open').focus()
    await expectShown(page, 'API 토큰 발급', 'focus')
    await expect(panelBody(page).locator('strong[data-help-active]')).toHaveText('토큰 발급')

    // 실제 키보드 이동(Tab)도 같은 신호 — 발급 단추 다음 탭 정지점은 목록 행의 「폐기」 단추라 목록 절, 강조도 **폐기** 로 옮긴다.
    await page.keyboard.press('Tab')
    await expect(page.getByTestId('token-revoke-1')).toBeFocused()
    await expectShown(page, 'API 토큰 목록', 'focus')
    await expect(panelBody(page).locator('strong[data-help-active]')).toHaveText('폐기')
  })

  test('포인터가 도움말 패널 위에 있는 동안은 포커스를 옮겨도 바뀌지 않고, 벗어나면 최신 칸으로 맞춘다', { tag: '@input' }, async ({ authenticatedPage: page }) => {
    await openTokensWithHelp(page)
    await connectCopy(page).focus()
    await expectShown(page, '도구에 연결하기', 'focus')

    // 패널 위로 포인터를 올린 채 키보드로 다른 칸(헤더 「토큰 발급」)에 포커스 — 읽는 중이라 그대로여야 한다.
    await panelBody(page).hover()
    await page.getByTestId('token-issue-open').focus()
    await expect(page.getByTestId('token-issue-open')).toBeFocused()
    await expectStays(page, () => currentCrumb(page).textContent(), await currentCrumb(page).textContent(), {
      message: '포인터가 패널 위인 동안 보이는 절',
    })
    await expect(currentCrumb(page)).toContainText('도구에 연결하기')

    // 포인터를 본문(화면 쪽)으로 옮기면 얼림이 풀려 그 사이 바뀐 포커스 칸의 절로 맞춘다.
    const main = (await page.locator('main#main-content').boundingBox())!
    await page.mouse.move(main.x + 20, main.y + main.height - 20)
    await expectShown(page, 'API 토큰 발급', 'focus')
  })

  test('대화상자를 열면 그 대화상자의 절, 닫으면 포커스가 돌아온 단추의 절로 돌아온다', { tag: '@input' }, async ({ authenticatedPage: page }) => {
    await openTokensWithHelp(page)
    await connectCopy(page).focus()
    await expectShown(page, '도구에 연결하기', 'focus')

    // 발급 대화상자를 열면 출처가 대화상자 — 단추 포커스(같은 절)보다 대화상자 신호가 이긴다.
    // 모달의 흐린 막이 패널도 덮으므로(설계 결정 12) 패널은 만지지 않고 내용만 본다.
    await page.getByTestId('token-issue-open').click()
    await expect(page.getByTestId('token-issue-form-dialog')).toBeVisible()
    await expectShown(page, 'API 토큰 발급', 'dialog')

    // Esc 로 닫으면 포커스가 「토큰 발급」 단추로 돌아온다 — 닫힌 뒤 보이는 절은 대화상자 전 신호가 아니라 돌아온 포커스의 칸.
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('token-issue-form-dialog')).toBeHidden()
    await expect(page.getByTestId('token-issue-open')).toBeFocused()
    await expectShown(page, 'API 토큰 발급', 'focus')

    await connectCopy(page).focus()
    await expectShown(page, '도구에 연결하기', 'focus')
  })

  test('스크롤이 멈추고 200ms 뒤에 기준선 아래 칸의 절을 따라간다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
    // 낮은 창 + 토큰 10개 — 본문(page-body)이 스크롤되고, 처음엔 기준선(보이는 높이 30%)이 목록 칸에 걸린다.
    await page.setViewportSize({ width: 1280, height: 500 })
    await page.clock.install()
    await openTokensWithHelp(page, 10)
    await expectShown(page, 'API 토큰 목록', 'scroll')

    // 앱 타이머(스크롤 멈춤 200ms)를 테스트가 흘리도록 시계를 세운다.
    await page.clock.pauseAt(new Date(Date.now() + 60_000))

    // 「도구에 연결하기」 칸 위끝이 기준선보다 조금 위에 오게 본문을 스크롤한다 — 스크롤 이벤트가 실제로 난 뒤에 돌아온다.
    await page.evaluate(async () => {
      const scroller = document.querySelector<HTMLElement>('[data-ai-page-root] main [data-testid="page-body"]')!
      const section = document.querySelector<HTMLElement>('[data-testid="token-connect-guide"]')!
      const offset = section.getBoundingClientRect().top - scroller.getBoundingClientRect().top
      const scrolled = new Promise<void>((resolve) => scroller.addEventListener('scroll', () => resolve(), { once: true }))
      scroller.scrollTo({ top: scroller.scrollTop + offset - scroller.clientHeight * 0.2, behavior: 'instant' })
      await scrolled
    })
    // 스크롤이 실제로 됐고 맨 아래가 아닌지(맨 아래면 기준선이 60% 로 바뀐다) — 낮은 창·긴 목록이 의도대로인지 확인.
    const geometry = await page.evaluate(() => {
      const scroller = document.querySelector<HTMLElement>('[data-ai-page-root] main [data-testid="page-body"]')!
      return { top: scroller.scrollTop, room: scroller.scrollHeight - scroller.clientHeight }
    })
    expect(geometry.top, '본문이 스크롤됨').toBeGreaterThan(0)
    expect(geometry.top, '맨 아래가 아님').toBeLessThan(geometry.room - 1)

    // 멈춘 지 150ms — 아직 재지 않아 목록 절 그대로.
    await page.clock.runFor(150)
    await expectShown(page, 'API 토큰 목록', 'scroll')
    // 200ms 를 넘기면 기준선 아래 칸(도구에 연결하기)으로 바뀐다.
    await page.clock.runFor(100)
    await expectShown(page, '도구에 연결하기', 'scroll')
  })

  test('다른 화면에서 지연 로딩되는 API 토큰 화면으로 옮겨도 그려진 뒤 칸을 재 장 첫머리에 머물지 않는다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
    // 이어 쓰는 문서는 앞 테스트가 화면 조각을 이미 받아 두었을 수 있다 — 시작 스크립트를 달아 문서를 새로 열어 조각을 아직 받지 않은 상태로 시작한다.
    await page.addInitScript(() => {})
    await page.setViewportSize({ width: 1280, height: 500 })
    await mockHelpBundle(page)
    await mockTokens(page, 10)
    // API 토큰 화면 조각(React.lazy) 받기를 붙잡아 둔다 — 주소가 바뀐 다음 프레임의 첫 측정 때 화면이 아직 없게.
    const chunk = gate()
    let chunkRequested = false
    await page.route(/TokenSettingsPage[^/]*\.(tsx|js)(\?.*)?$/, async (route) => {
      chunkRequested = true
      await chunk.p
      await route.fallback()
    })
    await page.goto('/')
    await page.getByTestId('help-toggle').click()
    await expect(page.getByTestId('help-panel')).toBeVisible()

    // 앱 안 이동(새로고침 없이) — 라우터는 popstate 로 주소 변화를 받는다.
    await page.evaluate(() => {
      window.history.pushState({}, '', '/settings/tokens')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    await expect.poll(() => chunkRequested, { message: '화면 조각 요청' }).toBe(true)
    // 주소가 바뀐 다음 프레임(첫 측정)이 조각이 붙잡힌 동안 지나가게 한 프레임을 넘긴 뒤 푼다.
    await nextFrame(page)
    chunk.release()
    await expect(page.getByTestId(/^token-row-\d+$/)).toHaveCount(10)
    await expectShown(page, 'API 토큰 목록', 'scroll')
  })

  test('도움말을 연 뒤 토큰 목록이 늦게 와 칸이 아래로 밀려도 스크롤 전이면 다시 재 목록 절을 보인다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
    // 라이브 검증에서 찾은 결함 — 목록이 비어 있을 때 잰 「도구에 연결하기」가 행이 그려진 뒤에도 남았다.
    await page.setViewportSize({ width: 1440, height: 900 })
    await mockHelpBundle(page)
    // 토큰 목록 응답을 붙잡아 둔다 — 도움말이 먼저 열려 빈 화면을 재게.
    const rows = gate()
    await page.route(/\/api\/v1\/users\/me\/api-tokens$/, async (route) => {
      if (route.request().method() !== 'GET') return route.fallback()
      await rows.p
      await route.fulfill({ json: Array.from({ length: 8 }, (_, i) => token(i + 1)) })
    })
    await page.goto('/settings/tokens')
    await expect(connectCopy(page)).toBeVisible()
    await page.getByTestId('help-toggle').click()
    await expect(page.getByTestId('help-panel')).toBeVisible()
    // 행이 없을 때는 「도구에 연결하기」 칸이 기준선에 걸린다 — 이 테스트가 결함 상황을 재현하는지 확인.
    await expectShown(page, '도구에 연결하기', 'scroll')

    rows.release()
    await expect(page.getByTestId(/^token-row-\d+$/)).toHaveCount(8)
    await expectShown(page, 'API 토큰 목록', 'scroll')
  })
})
