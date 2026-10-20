// 모바일 메일 상세 공간 개선(WP-400) — 첫 화면에 본문이 보이도록 메타를 접고 액션을 하단 고정 바·⋯ 메뉴로 옮긴 배치.
// 요약 접힘·「AI 요약 보기」, 수신자 한 줄 요약, 스크롤 제목 페이드, ⋯ 메뉴(안 읽음·AI 이슈·원본 배경), 하단 바 4버튼·기하를 본다.
import type { Page } from '@playwright/test'

import { detail, mailAccount, summary } from '../../factories/mail.factory'
import { mockApi } from '../../fixtures/api-mock'
import { expectTheme, withTheme } from '../../fixtures/contrast'
import { expect, stubChat, test } from '../../fixtures/mobile.fixture'

const SUBJECT = '[공유] 4분기 통합 플랫폼 고도화 프로젝트 주간 진행 현황 및 다음 주 릴리스 일정 조율 요청'
const TO = '양동희 <me@example.com>, 이서연 <seoyeon.lee@example.com>, 박준호 <junho.park@example.com>'
const CC = [
  '최지우 <jiwoo.choi@example.com>',
  '정해인 <haein.jung@example.com>',
  '한소희 <sohee.han@example.com>',
  'devops-team@example.com',
  '오세훈 <sehoon.oh@example.com>',
  '윤아름 <areum.yoon@example.com>',
  'qa-lead@example.com',
].join(', ')
const SUMMARY = [
  '• 나에게: 김민수 팀장이 금요일까지 릴리스 체크리스트 검토를 요청했어요.',
  '• 핵심: 결제·알림 모듈 지연으로 1차 릴리스를 한 주 미루는 안을 논의해요.',
  '• 참고: 지난주 회의록과 첨부한 일정표를 함께 보면 좋아요.',
].join('\n')
// 다크 변환 대상이 되도록 흰 배경을 명시한 HTML 본문(여러 문단).
const BODY_HTML = `<div id="mail-root" style="font-size:15px;line-height:1.6;color:#222;background:#ffffff">${Array.from(
  { length: 8 },
  (_, i) => `<p>${i + 1}번째 문단입니다. 4분기 통합 플랫폼 고도화 프로젝트의 진행 현황과 일정 조율에 관한 내용이 이어집니다.</p>`,
).join('')}</div>`
// 텍스트 본문 — 마지막 줄이 하단 바에 가리지 않는지 볼 때 쓴다(iframe 안은 화면 기하를 재기 어렵다).
const BODY_TEXT = Array.from({ length: 40 }, (_, i) => `본문 ${i + 1}번째 줄입니다.`).join('\n') + '\n마지막 줄'

/** 메일 화면 API 를 모킹한다. 10 = HTML 본문·요약 있음, 11 = 텍스트 본문·요약 생략(SKIPPED). */
async function stubMail(page: Page, opts: { aiEnabled?: boolean } = {}) {
  await stubChat(page)
  await mockApi(page, 'GET', '/api/v1/mail/accounts', [mailAccount({ aiEnabled: opts.aiEnabled ?? true })])
  await mockApi(page, 'GET', '/api/v1/mail/unread-summary', { workUnread: 1 })
  await mockApi(page, 'GET', '/api/v1/mail/accounts/1/unread-counts', {
    classificationActive: true, inbox: 2, byCategory: { 업무: 2, 개인: 0, 알림: 0, 프로모션: 0, 뉴스레터: 0 }, needsReply: 0,
  })
  await mockApi(page, 'GET', '/api/v1/mail/accounts/1/messages', [
    summary({ id: 10, seen: true, subject: SUBJECT, fromName: '김민수', fromAddress: 'minsu.kim@example.com' }),
    summary({ id: 11, seen: true, subject: '자동 발송 알림', fromName: '알림봇', fromAddress: 'noreply@example.com' }),
  ])
  await mockApi(page, 'GET', '/api/v1/mail/messages/10', detail({
    id: 10, seen: true, subject: SUBJECT, fromName: '김민수', fromAddress: 'minsu.kim@example.com',
    toAddresses: TO, ccAddresses: CC, bodyText: null, bodyHtml: BODY_HTML, attachments: [],
  }))
  await mockApi(page, 'GET', '/api/v1/mail/messages/11', detail({
    id: 11, seen: true, subject: '자동 발송 알림', fromName: '알림봇', fromAddress: 'noreply@example.com',
    toAddresses: 'me@example.com', ccAddresses: null, bodyText: BODY_TEXT, bodyHtml: null, attachments: [],
  }))
  await mockApi(page, 'GET', '/api/v1/mail/messages/10/summary', { summary: SUMMARY, status: 'DONE' })
  await mockApi(page, 'GET', '/api/v1/mail/messages/10/linked-issue', { issueKey: null })
  await mockApi(page, 'GET', '/api/v1/mail/messages/11/linked-issue', { issueKey: null })
}

/** 목록에서 메일을 연다. */
async function openMail(page: Page, id: number) {
  await page.getByTestId(`mail-row-${id}`).click()
  await expect(page.getByTestId('mail-detail')).toBeVisible()
}

const titleOpacity = (page: Page) => page.getByTestId('mobile-back-title').evaluate((el) => getComputedStyle(el).opacity)

test('AI 요약은 첫 줄 미리보기로 접혀 있고, 탭하면 펼치고 다시 탭하면 접는다', async ({ authenticatedPage: page }) => {
  await stubMail(page)
  await page.goto('/mail/1')
  await openMail(page, 10)
  const card = page.getByTestId('mail-ai-summary')
  await expect(card).toHaveJSProperty('open', false)
  // 접힌 동안엔 첫 불릿(기호 뗌)만 한 줄로 — 나머지 불릿은 보이지 않는다.
  await expect(card.locator('summary')).toContainText('나에게: 김민수 팀장이')
  await expect(card.getByText(/핵심: 결제/)).toBeHidden()
  await card.locator('summary').click()
  await expect(card).toHaveJSProperty('open', true)
  await expect(card.getByText(/핵심: 결제/)).toBeVisible()
  await card.locator('summary').click()
  await expect(card).toHaveJSProperty('open', false)
})

test('「AI 요약 보기」로 만든 요약은 펼친 채 보이고, 다른 메일을 갔다 오면 접혀 있다', async ({ authenticatedPage: page }) => {
  await stubMail(page)
  // 생성 전엔 SKIPPED, 생성 뒤 조회는 만든 요약을 돌려준다(서버 저장 흉내).
  let generated = false
  await page.route((u) => u.pathname === '/api/v1/mail/messages/11/summary', (route) => {
    const method = route.request().method()
    if (method === 'POST') generated = true
    return route.fulfill({
      json: generated ? { summary: '• 핵심: 서버 점검 안내 자동 메일이에요.\n• 참고: 조치할 일은 없어요.', status: 'DONE' } : { summary: null, status: 'SKIPPED' },
    })
  })
  await page.goto('/mail/1')
  await openMail(page, 11)
  const button = page.getByTestId('mail-ai-summary-generate')
  await expect(button).toHaveText('AI 요약 보기')
  const post = page.waitForRequest((r) => r.method() === 'POST' && new URL(r.url()).pathname === '/api/v1/mail/messages/11/summary')
  await button.click()
  await post
  const card = page.getByTestId('mail-ai-summary')
  await expect(card).toHaveJSProperty('open', true)
  await expect(card.getByText(/조치할 일은 없어요/)).toBeVisible()

  // 다른 메일을 열었다가 돌아오면 다른 요약과 같이 접힌 채.
  await page.getByTestId('mobile-back').click()
  await openMail(page, 10)
  await page.getByTestId('mobile-back').click()
  await openMail(page, 11)
  await expect(page.getByTestId('mail-ai-summary')).toHaveJSProperty('open', false)
  await expect(page.getByTestId('mail-ai-summary').locator('summary')).toContainText('핵심: 서버 점검 안내')
})

test('수신자는 「받는사람 첫 사람 외 N명 · 참조 N명」 한 줄이고, 탭하면 전체 목록을 펼치고 다시 탭하면 접는다', async ({ authenticatedPage: page }) => {
  await stubMail(page)
  await page.goto('/mail/1')
  await openMail(page, 10)
  const toggle = page.getByTestId('mail-recipients-toggle')
  await expect(toggle).toHaveText('받는사람 양동희 외 2명 · 참조 7명')
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await expect(page.getByTestId('mail-recipients-full')).toHaveCount(0)
  // 한 줄 요약이라도 손가락으로 누를 만한 높이.
  expect((await toggle.boundingBox())!.height).toBeGreaterThanOrEqual(44)

  await toggle.click()
  const full = page.getByTestId('mail-recipients-full')
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  await expect(full.getByText('이서연 <seoyeon.lee@example.com>')).toBeVisible()
  await expect(full.getByText('최지우 <jiwoo.choi@example.com>')).toBeVisible()
  // 이름 없는 주소는 주소 그대로.
  await expect(full.getByText('qa-lead@example.com', { exact: true })).toBeVisible()
  await expect(full.locator('li')).toHaveCount(10)

  await toggle.click()
  await expect(full).toHaveCount(0)
})

test('상단바 제목은 처음엔 숨어 있다가, 본문 위 큰 제목이 스크롤로 사라지면 나타난다', async ({ authenticatedPage: page }) => {
  await stubMail(page)
  await page.goto('/mail/1')
  await openMail(page, 10)
  // 같은 제목을 두 번 보이지 않는다 — 큰 제목만 보이고 상단바 제목은 투명(접근 이름은 유지).
  await expect(page.getByRole('heading', { level: 2, name: SUBJECT })).toBeInViewport()
  await expect(page.getByTestId('mobile-back-title')).toHaveText(SUBJECT)
  await expect.poll(() => titleOpacity(page)).toBe('0')
  // 숨은 동안엔 보조기술에서도 숨긴다 — 큰 제목이 대신 읽힌다.
  await expect(page.getByTestId('mobile-back-title')).toHaveAttribute('aria-hidden', 'true')

  const scroller = page.getByTestId('mail-detail-scroll')
  await scroller.evaluate((el) => el.scrollTo({ top: el.scrollHeight }))
  await expect(page.getByRole('heading', { level: 2, name: SUBJECT })).not.toBeInViewport()
  await expect.poll(() => titleOpacity(page)).toBe('1')
  await expect(page.getByTestId('mobile-back-title')).not.toHaveAttribute('aria-hidden', /.*/)

  await scroller.evaluate((el) => el.scrollTo({ top: 0 }))
  await expect.poll(() => titleOpacity(page)).toBe('0')
})

test('다른 메일을 열면 수신자 펼침·상단바 제목·스크롤 위치가 앞 메일에서 이어지지 않는다', async ({ authenticatedPage: page }) => {
  await stubMail(page)
  await page.goto('/mail/1')
  await openMail(page, 10)
  // 앞 메일: 수신자 펼침 + 끝까지 스크롤해 상단바 제목이 나타난 상태를 만든다.
  await page.getByTestId('mail-recipients-toggle').click()
  await expect(page.getByTestId('mail-recipients-toggle')).toHaveAttribute('aria-expanded', 'true')
  const scroller = page.getByTestId('mail-detail-scroll')
  await scroller.evaluate((el) => el.scrollTo({ top: el.scrollHeight }))
  await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(0)
  await expect.poll(() => titleOpacity(page)).toBe('1')

  await page.getByTestId('mobile-back').click()
  await openMail(page, 11)
  await expect(page.getByTestId('mobile-back-title')).toHaveText('자동 발송 알림')
  await expect(page.getByTestId('mail-recipients-toggle')).toHaveAttribute('aria-expanded', 'false')
  await expect(page.getByTestId('mail-recipients-full')).toHaveCount(0)
  await expect.poll(() => titleOpacity(page)).toBe('0')
  await expect(page.getByTestId('mobile-back-title')).toHaveAttribute('aria-hidden', 'true')
  expect(await page.getByTestId('mail-detail-scroll').evaluate((el) => el.scrollTop)).toBe(0)
})

test.describe('조회 중·실패 화면', () => {
  test('응답을 기다리는 동안에도 상단바(‹)가 있고, 응답이 오면 상세가 그려진다', async ({ authenticatedPage: page }) => {
    await stubMail(page)
    // 상세 응답을 붙잡아 두었다가 단언 뒤에 풀어 준다.
    let release!: () => void
    const held = new Promise<void>((r) => (release = r))
    await page.route((u) => u.pathname === '/api/v1/mail/messages/10', async (route) => {
      await held
      await route.fallback()
    })
    await page.goto('/mail/1')
    await page.getByTestId('mail-row-10').click()
    await expect(page.getByText('불러오는 중…')).toBeVisible()
    await expect(page.getByTestId('mail-back').getByTestId('mobile-back')).toBeVisible()
    release()
    await expect(page.getByTestId('mail-detail')).toBeVisible()
    await expect(page.getByRole('heading', { level: 2, name: SUBJECT })).toBeVisible()
  })

  test('조회 실패(500) 화면에도 ‹ 가 있어 목록으로 돌아가고, 「다시 시도」가 성공하면 상세로 바뀐다', async ({ authenticatedPage: page }) => {
    await stubMail(page)
    // 실패를 켜 둔 동안만 500 — 「다시 시도」 직전에 끈다(자동 재시도 횟수에 기대지 않게).
    let failing = true
    await page.route((u) => u.pathname === '/api/v1/mail/messages/10', (route) =>
      failing && route.request().method() === 'GET'
        ? route.fulfill({ status: 500, json: { message: 'boom' } })
        : route.fallback())
    await page.goto('/mail/1')
    await page.getByTestId('mail-row-10').click()
    await expect(page.getByText('메일을 불러오지 못했습니다')).toBeVisible()
    const back = page.getByTestId('mail-back').getByTestId('mobile-back')
    await expect(back).toBeVisible()
    await back.click()
    await expect(page.getByTestId('mail-list')).toBeVisible()
    await expect(page.getByText('메일을 불러오지 못했습니다')).toHaveCount(0)

    await page.getByTestId('mail-row-10').click()
    await expect(page.getByText('메일을 불러오지 못했습니다')).toBeVisible()
    failing = false
    await page.getByRole('button', { name: '다시 시도' }).click()
    await expect(page.getByTestId('mail-detail')).toBeVisible()
    await expect(page.getByRole('heading', { level: 2, name: SUBJECT })).toBeVisible()
    await expect(page.getByTestId('mail-mobile-action-bar')).toBeVisible()
  })
})

test('AI 사용 계정: 「안 읽음」은 ⋯ 메뉴 안에 있고, 누르면 안 읽음 API 후 목록으로 돌아가 안 읽음 표시가 붙는다', async ({ authenticatedPage: page }) => {
  await stubMail(page)
  const unread = await mockApi(page, 'POST', '/api/v1/mail/messages/10/unread', null, { capture: true })
  // 목록은 안 읽음 요청 뒤에만 10 을 안 읽음으로 돌려준다(서버 반영 흉내) — 처음부터 안 읽음 표시가 있어 단언이 헛돌지 않게.
  await page.route((u) => u.pathname === '/api/v1/mail/accounts/1/messages', (route) =>
    route.fulfill({
      json: [summary({ id: 10, seen: unread.requests.length === 0, subject: SUBJECT, fromName: '김민수', fromAddress: 'minsu.kim@example.com' })],
    }))
  await page.goto('/mail/1')
  await expect(page.getByTestId('mail-unread-bar-10')).toHaveCount(0)
  await openMail(page, 10)
  const bar = page.getByTestId('mail-back')
  // 헤더에 글자 버튼으로 나와 있지 않다 — 메뉴를 열어야 보인다.
  await expect(bar.getByTestId('mobile-header-inline-action')).toHaveCount(0)
  await expect(bar.getByTestId('mobile-mark-unread')).toBeHidden()
  await bar.getByTestId('mobile-header-more').click()
  const menu = bar.getByTestId('mobile-header-more-menu')
  await expect(menu).toBeVisible()
  // 라이트 테마라 원본 배경 토글은 없다 — 안 읽음, AI로 이슈 만들기 두 항목.
  await expect(menu.getByRole('menuitem')).toHaveText(['안 읽음', 'AI로 이슈 만들기'])
  await menu.getByTestId('mobile-mark-unread').click()
  await unread.waitForRequest()
  await expect(page.getByTestId('mail-detail')).toHaveCount(0)
  await expect(page.getByTestId('mail-list')).toBeVisible()
  await expect(page.getByTestId('mail-unread-bar-10')).toBeVisible()
})

test('다크: ⋯ 메뉴의 「원본 배경으로 보기」는 체크 항목 — 켜면 본문이 원본 흰 배경으로, 메뉴에 체크가 남는다', async ({ authenticatedPage: page }) => {
  await withTheme(page, 'dark')
  await stubMail(page)
  await page.goto('/mail/1')
  await expectTheme(page, 'dark')
  await openMail(page, 10)
  // 본문 위 토글 줄은 없다(메뉴로 옮김).
  await expect(page.getByTestId('mail-detail-scroll').getByTestId('mail-body-theme-toggle')).toHaveCount(0)
  const root = page.frameLocator('[data-testid="mail-body-html"]').locator('#mail-root')
  const bg = () => root.evaluate((el) => getComputedStyle(el).backgroundColor)
  await expect.poll(bg).not.toBe('rgb(255, 255, 255)')

  const bar = page.getByTestId('mail-back')
  await bar.getByTestId('mobile-header-more').click()
  const toggle = bar.getByTestId('mail-body-theme-toggle')
  await expect(toggle).toHaveAttribute('role', 'menuitemcheckbox')
  await expect(toggle).toHaveAttribute('aria-checked', 'false')
  await toggle.click()
  // 항목을 누르면 메뉴는 닫히고 본문은 원본 배경.
  await expect(bar.getByTestId('mobile-header-more-menu')).toBeHidden()
  await expect.poll(bg).toBe('rgb(255, 255, 255)')

  await bar.getByTestId('mobile-header-more').click()
  await expect(toggle).toHaveAttribute('aria-checked', 'true')
  await toggle.click()
  await expect.poll(bg).not.toBe('rgb(255, 255, 255)')
})

test('⋯ 메뉴의 「AI로 이슈 만들기」 → 이슈 초안 API 후 사전채움된 이슈 만들기 창', async ({ authenticatedPage: page }) => {
  await stubMail(page)
  const draft = await mockApi(page, 'POST', '/api/v1/mail/messages/10/issue-draft', {
    title: '릴리스 체크리스트 검토',
    body: '- 금요일까지 회신',
    priority: 'HIGH',
    suggestedProjectKey: 'FIN',
    candidateProjects: [{ key: 'FIN', name: '재무' }],
  }, { capture: true })
  await mockApi(page, 'GET', '/api/v1/projects/FIN/members', [
    { userId: 1, username: 'me', name: '나', kind: 'HUMAN', role: 'OWNER', createdAt: null },
  ])
  await page.goto('/mail/1')
  await openMail(page, 10)
  const bar = page.getByTestId('mail-back')
  await bar.getByTestId('mobile-header-more').click()
  await bar.getByTestId('mail-ai-issue').click()
  await draft.waitForRequest()
  await expect(page.getByTestId('mail-to-issue-dialog')).toBeVisible()
  await expect(page.getByTestId('issue-draft-title')).toHaveValue('릴리스 체크리스트 검토')
})

test.describe('하단 고정 바', () => {
  test('답장·전체답장·전달·AI 답장이 각각 알맞게 채운 작성 화면을 연다', async ({ authenticatedPage: page }) => {
    await stubMail(page)
    const replyDraft = await mockApi(page, 'POST', '/api/v1/mail/messages/10/reply-draft', { draftBody: 'AI가 쓴 회신 초안' }, { capture: true })
    await page.goto('/mail/1')
    await openMail(page, 10)
    const actions = page.getByTestId('mail-mobile-action-bar')
    const dock = page.getByTestId('mail-compose-dock')
    const close = async () => {
      await page.getByTestId('mail-compose-close').click()
      await expect(dock).toHaveCount(0)
    }

    // 답장 — 보낸 사람에게, Re: 제목, 인용문.
    await actions.getByTestId('mail-reply').click()
    await expect(dock.getByRole('heading', { name: '회신' })).toBeVisible()
    await expect(page.getByTestId('mail-compose-to')).toHaveValue('minsu.kim@example.com')
    await expect(page.getByTestId('mail-compose-subject')).toHaveValue(`Re: ${SUBJECT}`)
    await expect(dock.getByTestId('mail-compose-quote')).toBeVisible()
    await close()

    // 전체답장 — 받는사람·참조 중 나를 뺀 나머지가 참조로.
    await actions.getByTestId('mail-reply-all').click()
    await expect(page.getByTestId('mail-compose-to')).toHaveValue('minsu.kim@example.com')
    const cc = page.getByTestId('mail-compose-cc')
    await expect(cc).toHaveValue(/seoyeon\.lee@example\.com/)
    await expect(cc).toHaveValue(/qa-lead@example\.com/)
    await expect(cc).not.toHaveValue(/me@example\.com/)
    await close()

    // 전달 — 받는사람 빈 칸, Fwd: 제목.
    await actions.getByTestId('mail-forward').click()
    await expect(dock.getByRole('heading', { name: '전달' })).toBeVisible()
    await expect(page.getByTestId('mail-compose-to')).toHaveValue('')
    await expect(page.getByTestId('mail-compose-subject')).toHaveValue(`Fwd: ${SUBJECT}`)
    await close()

    // AI 답장 — 초안 API 결과가 본문에 채워진 회신.
    await expect(actions.getByTestId('mail-ai-reply-draft')).toHaveText('AI 답장')
    await actions.getByTestId('mail-ai-reply-draft').click()
    await replyDraft.waitForRequest()
    await expect(page.getByTestId('mail-composer-body')).toContainText('AI가 쓴 회신 초안')
    await expect(page.getByTestId('mail-compose-to')).toHaveValue('minsu.kim@example.com')
  })

  test('한 줄 4버튼·44px 이상이고, 끝까지 스크롤해도 본문 마지막 줄이 바에 가리지 않는다', async ({ authenticatedPage: page }) => {
    await stubMail(page)
    await page.goto('/mail/1')
    await openMail(page, 11)
    const vp = page.viewportSize()!
    const bar = (await page.getByTestId('mail-mobile-action-bar').boundingBox())!
    // 화면 맨 아래에 붙는다(상세에서는 탭바가 숨는다).
    expect(Math.round(bar.y + bar.height)).toBe(vp.height)
    await expect(page.getByTestId('mobile-tabbar')).toHaveCount(0)

    // AI 사용 계정 → 4버튼이 같은 줄, 모두 44px 이상.
    const buttons = page.getByTestId('mail-mobile-action-bar').getByRole('button')
    await expect(buttons).toHaveText(['답장', '전체답장', '전달', 'AI 답장'])
    const boxes = await Promise.all((await buttons.all()).map((b) => b.boundingBox()))
    for (const b of boxes) {
      expect(b!.height).toBeGreaterThanOrEqual(44)
      expect(b!.width).toBeGreaterThanOrEqual(44)
      expect(b!.y).toBe(boxes[0]!.y)
    }

    // 스크롤 영역은 바 위에서 끝나고, 끝까지 내리면 본문 마지막 줄이 바 위에 보인다.
    const scroller = page.getByTestId('mail-detail-scroll')
    const sBox = (await scroller.boundingBox())!
    expect(sBox.y + sBox.height).toBeLessThanOrEqual(bar.y + 0.5)
    await scroller.evaluate((el) => el.scrollTo({ top: el.scrollHeight }))
    const last = page.getByText('마지막 줄')
    await expect(last).toBeInViewport()
    const lastBottom = await last.evaluate((el) => {
      const range = document.createRange()
      range.selectNodeContents(el)
      const rects = Array.from(range.getClientRects())
      return rects[rects.length - 1].bottom
    })
    expect(lastBottom).toBeLessThanOrEqual(bar.y)
  })

  test('AI 미사용 계정: 하단 바는 3버튼, 「안 읽음」은 메뉴 없이 헤더에 바로 둔다', async ({ authenticatedPage: page }) => {
    await stubMail(page, { aiEnabled: false })
    await page.goto('/mail/1')
    await openMail(page, 11)
    await expect(page.getByTestId('mail-mobile-action-bar').getByRole('button')).toHaveText(['답장', '전체답장', '전달'])
    const bar = page.getByTestId('mail-back')
    await expect(bar.getByTestId('mobile-header-more')).toHaveCount(0)
    await expect(bar.getByTestId('mobile-header-inline-action').getByTestId('mobile-mark-unread')).toHaveText('안 읽음')
  })
})

// UI 리뷰 — 첨부가 첫 화면을 차지하지 않게 모바일 상세에선 가로로 스크롤되는 한 줄 작은 칩(데스크톱은 그대로 줄바꿈).
test('첨부는 가로로 스크롤되는 한 줄 작은 칩이고, 칩은 44px 터치 영역을 갖는다', async ({ authenticatedPage: page }) => {
  await stubMail(page)
  await mockApi(page, 'GET', '/api/v1/mail/messages/11', detail({
    id: 11, seen: true, subject: '자동 발송 알림', fromName: '알림봇', fromAddress: 'noreply@example.com',
    toAddresses: 'me@example.com', ccAddresses: null, bodyText: BODY_TEXT, bodyHtml: null,
    attachments: [
      { id: 61, filename: '릴리스_체크리스트_v3.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', sizeBytes: 820 * 1024, contentId: null },
      { id: 62, filename: '일정표.pdf', contentType: 'application/pdf', sizeBytes: 2 * 1024 * 1024, contentId: null },
      { id: 63, filename: '회의록_1017_최종본.docx', contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', sizeBytes: 96 * 1024, contentId: null },
    ],
  }))
  await page.goto('/mail/1')
  await openMail(page, 11)

  const list = page.getByTestId('mail-attachments')
  const chips = list.locator('button')
  await expect(chips).toHaveCount(3)
  // 한 줄 — 모든 칩의 위끝이 같고, 칩은 작다(32px).
  const boxes = await chips.evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).map((r) => ({ top: Math.round(r.top), h: r.height })))
  expect(new Set(boxes.map((b) => b.top)).size).toBe(1)
  for (const b of boxes) expect(b.h).toBeLessThanOrEqual(34)
  // 넘치면 가로로 스크롤된다(세로로 쌓이지 않는다).
  expect(await list.evaluate((ul) => getComputedStyle(ul).overflowX)).toBe('auto')
  expect(await list.evaluate((ul) => ul.scrollWidth > ul.clientWidth)).toBe(true)
  // 터치 영역은 투명 확장으로 44px — 칩 위아래 가장자리 밖을 눌러도 그 칩이 받는다.
  const first = (await chips.first().boundingBox())!
  const hit = await page.evaluate(
    ([x, y]) => document.elementFromPoint(x, y)?.closest('[data-testid^="mail-attachment-open-"]')?.getAttribute('data-testid') ?? null,
    [first.x + first.width / 2, first.y - 5] as const,
  )
  expect(hit).toBe('mail-attachment-open-61')
  // 첨부 줄이 본문을 밀어내지 않는다 — 본문 첫 줄이 첫 화면 위쪽 절반 안에 보인다.
  const firstLine = (await page.getByText('본문 1번째 줄입니다.').boundingBox())!
  expect(firstLine.y).toBeLessThan(page.viewportSize()!.height / 2)
})
