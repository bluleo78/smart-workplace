// Claude 앱 연결 동의 화면(/oauth/authorize, WP-1686) E2E — 실제 브라우저에서만 참인 것만 남긴다.
//  - @wiring  라우트 → validate → 카드 → 「허용」 → 브라우저가 앱 주소로 실제 이동한다(window.location.replace 는 jsdom 에서 일어나지 않는다)
//  - @layout  390px 에서 긴 이름·이메일·워크스페이스·확인되지 않은 앱도 가로로 넘치지 않는다(기하는 jsdom 이 잴 수 없다)
//  - @flow    미로그인으로 열면 로그인 뒤 같은 쿼리의 동의 화면으로 돌아온다(로그인 ↔ 동의 화면을 넘는 이동)
//  - @platform 같은 출처 iframe 안에서는 막음 문구만 보인다(실제 프레임의 window.top 판정)
// 나머지 상태·문구·본문(오류 카드·거부·일시 실패·AI 계정 등)은 src/pages/oauth/oauthConsent.test.tsx 가 지킨다.
// 앱 주소(https://claude.ai/...)는 page.route 로 받아 빈 HTML 로 답한다 — 격리된 네트워크 밖으로 나가지 않는다.
import type { Page } from '@playwright/test'

import type { AuthorizeDecisionRequest, AuthorizeRedirectResponse, AuthorizeValidateResponse } from '../../../src/types/oauth'
import { createLoginResponse, createTokenResponse, createUser } from '../../factories/auth.factory'
import { AUTH_PATH, validated } from '../../factories/oauth.factory'
import { mockApi } from '../../fixtures/api-mock'
import { expect, setupAuthMocks, test } from '../../fixtures/auth.fixture'
import { expectNoHorizontalOverflow } from '../../fixtures/mobile.fixture'
import { trackRequests } from '../../fixtures/requests'

const VALIDATE_PATH = '/api/v1/oauth/authorize/validate'
const DECIDE_PATH = '/api/v1/oauth/authorize'
const CALLBACK_URL = 'https://claude.ai/api/mcp/auth_callback?code=c1&state=st-1'

/** validate 를 모킹한다(쿼리는 무시하고 같은 응답). */
async function stubValidate(page: Page, body: AuthorizeValidateResponse) {
  await mockApi(page, 'GET', VALIDATE_PATH, body)
}

/**
 * 카드([data-slot="card"]) 안에서 `selector` 에 맞는 요소가 하나도 카드 오른쪽 끝을 넘지 않는다 — 끊을 자리 없는 긴 글자가
 * 카드를 밀거나 밖으로 삐져나오지 않았는지 잰다(0.5px 는 반올림 여유).
 */
async function expectNothingOverflowsCard(page: Page, selector: string) {
  const overflowing = await page.evaluate((sel) => {
    const cardEl = document.querySelector('[data-slot="card"]')!
    const right = cardEl.getBoundingClientRect().right
    return Array.from(cardEl.querySelectorAll(sel))
      .filter((el) => el.getBoundingClientRect().right > right + 0.5)
      .map((el) => el.tagName + ':' + (el.textContent ?? '').slice(0, 20))
  }, selector)
  expect(overflowing, '카드 밖으로 나간 요소').toEqual([])
}

/** 앱 콜백 주소(외부 출처)를 받아 빈 HTML 로 답한다 — 실제 인터넷으로 나가지 않는다. */
async function stubAppCallback(page: Page) {
  await page.route('https://claude.ai/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>claude</title>' }),
  )
}

test('라우트 → validate → 카드 → 허용 → 브라우저가 앱 주소로 실제 이동한다', { tag: ['@wiring', '@smoke'] }, async ({ authenticatedPage: page }) => {
  await stubAppCallback(page)
  await stubValidate(page, validated())
  const decides = trackRequests(page, 'POST', DECIDE_PATH)
  await page.route(
    (url) => url.pathname === DECIDE_PATH,
    (route) =>
      route.request().method() === 'POST'
        ? route.fulfill({ status: 200, json: { redirectUrl: CALLBACK_URL } satisfies AuthorizeRedirectResponse })
        : route.fallback(),
  )

  await page.goto(AUTH_PATH)
  await expect(page.getByRole('heading', { level: 1, name: 'Claude 연결' })).toBeVisible()
  await page.getByRole('button', { name: '허용' }).click()

  // 실제 브라우저 이동 — 앱의 콜백 주소로 code·state 가 그대로 간다.
  await page.waitForURL(CALLBACK_URL)
  expect(decides.count()).toBe(1)
  expect(decides.lastBody<AuthorizeDecisionRequest>()).toMatchObject({
    decision: 'ALLOW',
    clientId: 'swc_1',
    state: 'st-1',
    tenantId: 1,
  })
})

/**
 * 390px 에서 긴 값이 가득 찬 동의 화면을 열어 가로 넘침·잘림을 잰다 — 계정 이름·이메일, 앱 이름(clientName)·호스트,
 * 확인되지 않은 앱, 이름이 40자·72자인 워크스페이스 둘(가장 긴 쪽이 선택됨).
 */
async function expectLongContentFits(page: Page, clientName: string) {
  const longWorkspace = '워크스페이스이름'.repeat(9) // 72자 — 띄어쓰기 없는 가장 나쁜 경우
  await setupAuthMocks(
    page,
    createUser({
      name: '아주긴이름'.repeat(8),
      // 앞 조각은 줄바꿈 지점이 없는 라틴 글자 — 값 칸의 min-w-0·break-words 가 없으면 카드를 민다.
      email: 'averyveryveryverylonglocalpartwithoutanybreakopportunities.very.long.address.for.layout.check@an-extremely-long-subdomain.example.com',
    }),
    [],
    createTokenResponse(),
  )
  await stubValidate(
    page,
    validated({
      clientName, // 60자
      redirectHost: `${'long-redirect-host-segment.'.repeat(3)}example.com`.slice(0, 70), // 70자
      unverified: true,
      workspaces: [
        { tenantId: 1, name: '짧지않은워크'.repeat(7).slice(0, 40), slug: 'long-1' }, // 40자
        { tenantId: 2, name: longWorkspace, slug: 'long-2' },
      ],
      currentTenantId: 2, // 가장 긴 이름이 선택된 채 트리거에 그려진다
    }),
  )

  await page.goto(AUTH_PATH)
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  const card = page.locator('[data-slot="card"]')
  const trigger = page.getByRole('combobox', { name: '워크스페이스' })
  await expect(trigger).toBeVisible()
  await expect(trigger).toContainText('워크스페이스이름')
  await expect(page.getByText('확인되지 않은 앱', { exact: true })).toBeVisible()

  // 1) 문서가 가로로 넘치지 않는다.
  await expectNoHorizontalOverflow(page, 390)

  // 2) 카드·거부·허용·워크스페이스 트리거가 화면 폭 안에 있다.
  for (const [name, locator] of [
    ['카드', card],
    ['거부', page.getByRole('button', { name: '거부' })],
    ['허용', page.getByRole('button', { name: '허용' })],
    ['워크스페이스 트리거', trigger],
  ] as const) {
    const box = (await locator.boundingBox())!
    expect(box.x, `${name} x`).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width, `${name} 오른쪽 끝`).toBeLessThanOrEqual(390)
  }

  // 카드 좌우에 16px 여백(셸의 px-4)이 남는다 — 카드가 화면 끝까지 붙지 않는다.
  const gutter = (await card.boundingBox())!
  expect(gutter.x, '카드 왼쪽 여백').toBeGreaterThanOrEqual(15.5)
  expect(390 - (gutter.x + gutter.width), '카드 오른쪽 여백').toBeGreaterThanOrEqual(15.5)

  // 3) 긴 워크스페이스 이름은 카드를 밀지 않고 트리거 안에서 잘린다.
  const cardBox = (await card.boundingBox())!
  const triggerBox = (await trigger.boundingBox())!
  expect(triggerBox.x, '트리거 왼쪽 끝이 카드 안').toBeGreaterThanOrEqual(cardBox.x)
  expect(triggerBox.x + triggerBox.width, '트리거 오른쪽 끝이 카드 안').toBeLessThanOrEqual(cardBox.x + cardBox.width)
  const text = await trigger.evaluate((el) => {
    // 선택된 값을 그린 가장 안쪽 글자 칸(SelectValue 안의 span.truncate) — 잘렸다면 scrollWidth 가 clientWidth 보다 크다.
    // (바깥 select-value 칸은 line-clamp 라 overflow:clip 이고 글자 칸이 안에서 먼저 잘리므로 안쪽 칸을 잰다.)
    const holders = Array.from(el.querySelectorAll('span')).filter((s) => s.textContent?.includes('워크스페이스이름'))
    const span = holders[holders.length - 1] ?? el
    return { scrollWidth: span.scrollWidth, clientWidth: span.clientWidth, overflow: getComputedStyle(span).textOverflow }
  })
  expect(text.scrollWidth, `글자가 트리거 안에서 잘린다(${JSON.stringify(text)})`).toBeGreaterThan(text.clientWidth)
  expect(text.overflow).toBe('ellipsis')

  // 4) 긴 이름·긴 이메일·긴 앱 이름·긴 호스트의 값 칸 모두 카드 오른쪽 끝을 넘지 않는다.
  await expectNothingOverflowsCard(page, 'h1, p, dd, dd *')
}

test.describe('390px 모바일', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

  test('390px 에서 긴 이름·이메일·워크스페이스·확인되지 않은 앱도 가로로 넘치지 않는다', { tag: '@layout' }, async ({ page }) => {
    await expectLongContentFits(page, '아주긴앱이름'.repeat(10)) // 60자
  })

  // 타사 앱이 DCR 로 정한 이름은 줄바꿈 지점이 없을 수 있다 — 카드 머리 grid 열이 글자 폭까지 넓어지면 카드가 넘친다.
  test('390px 에서 줄바꿈 지점 없는 긴 앱 이름도 가로로 넘치지 않는다', { tag: '@layout' }, async ({ page }) => {
    await expectLongContentFits(page, 'ClaudeConnectorForAVeryLongNamedApplicationWithoutAnySpaces0') // 60자
  })

  // 서버가 준 오류 설명·코드도 끊을 자리 없이 길 수 있다 — 오류 카드(redirect 없는 오류)가 카드 밖으로 넘치지 않는다.
  test('390px 에서 끊을 자리 없는 긴 오류 설명·코드도 오류 카드 밖으로 넘치지 않는다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
    const longCode = `invalid_${'redirect_uri_'.repeat(8)}`
    const longDescription = `The redirect_uri https://${'unbroken-segment'.repeat(8)}.example/${'callback'.repeat(8)} is not registered`
    await mockApi(page, 'GET', VALIDATE_PATH, { error: longCode, errorDescription: longDescription }, { status: 400 })

    await page.goto(AUTH_PATH)
    await expect(page.getByRole('heading', { level: 1, name: '연결할 수 없습니다' })).toBeVisible()
    await expect(page.getByText(longCode)).toBeVisible()

    await expectNoHorizontalOverflow(page, 390)
    await expectNothingOverflowsCard(page, 'h1, p, code')
  })
})

test('미로그인으로 동의 주소를 열면 로그인 뒤 같은 쿼리의 동의 화면으로 돌아온다', { tag: '@flow' }, async ({ page }) => {
  await setupAuthMocks(page, createUser(), [], createTokenResponse())
  // 로그인 폼이 마운트 때 조회하는 부가 API — 미스텁이면 로컬 백엔드로 새어 401 → /login 으로 되돌려진다.
  await mockApi(page, 'GET', '/api/v1/auth/signup-available', { available: true })
  await mockApi(page, 'GET', '/api/v1/auth/sso/status', { m365: false })
  // 로그인 응답은 멤버십이 하나인 1단계 응답(setupAuthMocks 의 토큰 응답을 덮는다).
  await mockApi(page, 'POST', '/api/v1/auth/login', createLoginResponse())
  await stubValidate(page, validated())
  // setupAuthMocks 가 심은 세션 표식을 지운다 — 첫 적재가 미로그인이 된다(이 순서여야 한다).
  await page.addInitScript(() => localStorage.removeItem('hasSession'))

  await page.goto(AUTH_PATH)
  await expect(page).toHaveURL(/\/login$/)

  await page.getByLabel('아이디').fill('user@example.com')
  await page.locator('#password').fill('Workplace1')
  await page.getByRole('button', { name: '로그인' }).click()

  // 로그인 뒤 홈을 거쳐 같은 경로+쿼리의 동의 화면으로 돌아온다.
  await expect(page).toHaveURL(AUTH_PATH)
  await expect(page.getByRole('heading', { level: 1, name: 'Claude 연결' })).toBeVisible()
  // 로그인 화면으로의 이동은 같은 문서 안(SPA)이라, 카드를 그린 문서는 처음 받은 /oauth/authorize 문서다(nginx 프레임 금지 헤더가 붙은 문서).
  expect(await documentPath(page)).toBe('/oauth/authorize')
})

/** 지금 문서를 브라우저가 받은 경로 — navigation 항목의 이름(SPA 이동으로는 바뀌지 않는다). */
async function documentPath(page: Page) {
  return page.evaluate(() => new URL(performance.getEntriesByType('navigation')[0].name).pathname)
}

// nginx 의 프레임 금지 헤더는 정확 일치(location = /oauth/authorize)로 받은 문서에만 붙는다. 끝 슬래시·대소문자 변형도 React Router 는
// 동의 화면으로 그리므로, 화면이 그리기 전에 정확한 경로로 문서를 다시 받는다 — 실제 문서 이동과 navigation 항목은 jsdom 에 없다.
for (const variant of ['/oauth/authorize/', '/OAuth/Authorize']) {
  test(`${variant} 로 열면 정확한 /oauth/authorize 문서를 다시 받은 뒤 카드를 그린다`, { tag: '@platform' }, async ({ authenticatedPage: page }) => {
    await stubValidate(page, validated())
    const validates = trackRequests(page, 'GET', VALIDATE_PATH)
    const query = AUTH_PATH.slice(AUTH_PATH.indexOf('?'))

    await page.goto(variant + query)

    // 같은 쿼리를 그대로 들고 정확한 경로로 다시 받고, 그 문서에서는 다시 이동하지 않고 카드를 그린다.
    await expect(page).toHaveURL(AUTH_PATH)
    await expect(page.getByRole('heading', { level: 1, name: 'Claude 연결' })).toBeVisible()
    expect(await documentPath(page)).toBe('/oauth/authorize')
    // 헤더 없는 첫 문서에서는 검증을 부르지 않았다 — 다시 받은 문서에서 한 번만.
    expect(validates.count()).toBe(1)
  })
}

test('같은 출처 iframe 안에서는 막음 문구만 보이고 validate 를 부르지 않는다', { tag: '@platform' }, async ({ authenticatedPage: page }) => {
  await stubValidate(page, validated())
  const validates = trackRequests(page, 'GET', VALIDATE_PATH)

  await page.goto('/')
  await expect(page.getByTestId('app-rail')).toBeVisible()
  // 앱 안에 동의 화면을 프레임으로 넣는다 — dev 서버엔 nginx 의 frame-ancestors 헤더가 없어 JS 판정(window.top)만 본다.
  await page.evaluate((src) => {
    const frame = document.createElement('iframe')
    frame.src = src
    document.body.appendChild(frame)
  }, AUTH_PATH)

  const inner = page.frameLocator('iframe')
  await expect(inner.getByText('이 화면은 다른 화면 안에서 열 수 없습니다.')).toBeVisible()
  await expect(inner.getByRole('button', { name: '허용' })).toHaveCount(0)
  // 막음 카드는 첫 렌더에 동기로 그려지고(isFramed 를 useState 초기값으로 판정) 그때 validate 가 꺼져 있어, 문구가 보인 시점이면 validate 가 나갈 틈이 없었다.
  expect(validates.count()).toBe(0)
})
