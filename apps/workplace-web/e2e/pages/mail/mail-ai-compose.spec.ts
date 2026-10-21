// 새 메일 AI 초안(WP-576) E2E — 지시 패널 → compose-draft 요청 → 본문·제목 반영, 중지·실패·되돌리기·다시 쓰기. 백엔드 없이 page.route 모킹.
import type { Page, Route } from '@playwright/test'

import { detail, mailAccount, summary } from '../../factories/mail.factory'
import { mockApi } from '../../fixtures/api-mock'
import { expect, test } from '../../fixtures/auth.fixture'
import { trackRequests } from '../../fixtures/requests'
import { expectStays } from '../../fixtures/wait'
import type { ComposeDraftResult } from '../../../src/types/mailMessage'

const DRAFT_PATH = '/api/v1/mail/accounts/1/compose-draft'
const INSTRUCTION = '다음 주 회의를 목요일로 옮기자고 요청'
const RESULT: ComposeDraftResult = {
  subject: '회의 일정 변경 요청',
  body: '김지훈 님, 안녕하세요.\n\n다음 주 회의를 목요일 오후 3시로 옮길 수 있을까요?\n\n감사합니다.',
}

/** 계정(AI 사용)·빈 받은편지함 + 받은편지함 1건(회신·전달 경로용) 모킹. */
async function mockMail(page: Page, { aiEnabled = true } = {}) {
  await mockApi(page, 'GET', '/api/v1/mail/accounts', [mailAccount({ aiEnabled })])
  await page.route((u) => u.pathname === '/api/v1/mail/accounts/1/messages', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([summary({ id: 7 })]) }),
  )
  await mockApi(page, 'GET', '/api/v1/mail/messages/7', detail({ id: 7, fromAddress: 'alice@example.com' }))
  await mockApi(page, 'GET', '/api/v1/mail/messages/7/summary', { summary: '• 요약' })
}

/** compose-draft 를 바로 응답한다. */
async function mockDraft(page: Page, result: ComposeDraftResult = RESULT) {
  await page.route((u) => u.pathname === DRAFT_PATH, (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(result) }),
  )
}

/**
 * compose-draft 를 붙잡아 두는 게이트 — 생성 중 상태를 결정적으로 본다.
 * 끝에 release 로 풀어 둔다(응답하지 않은 핸들러가 남으면 테스트 정리가 멈춘다). 이미 끊긴 요청의 fulfill 오류는 무시한다.
 */
async function gateDraft(page: Page) {
  let release!: () => void
  const held = new Promise<void>((res) => (release = res))
  await page.route((u) => u.pathname === DRAFT_PATH, async (route: Route) => {
    await held
    await route
      .fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(RESULT) })
      .catch(() => {})
  })
  return release
}

/** 새 메일 작성창을 열고 지시 패널에 지시를 넣는다. */
async function openPanel(page: Page, instruction = INSTRUCTION) {
  await page.goto('/mail/1')
  await page.getByTestId('mail-compose-new').click()
  await page.getByTestId('mail-ai-compose-open').click()
  const input = page.getByTestId('mail-ai-compose-instruction')
  await expect(input).toBeFocused()
  await input.fill(instruction)
  return input
}

test.describe('새 메일 AI 초안', () => {
  test('새 메일에만 칩·툴바 버튼이 보이고, 회신·전달·AI 꺼진 계정엔 없다', async ({ authenticatedPage: page }) => {
    await mockMail(page)
    await page.goto('/mail/1')
    await page.getByTestId('mail-compose-new').click()
    await expect(page.getByTestId('mail-ai-compose-chip')).toBeVisible()
    await expect(page.getByTestId('mail-ai-compose-open')).toBeVisible()
    await page.getByTestId('mail-compose-close').click()

    await page.getByTestId('mail-row-7').click()
    await page.getByTestId('mail-reply').click()
    await expect(page.getByTestId('mail-compose-dock')).toBeVisible()
    await expect(page.getByTestId('mail-ai-compose-open')).toHaveCount(0)
    await expect(page.getByTestId('mail-ai-compose-chip')).toHaveCount(0)
    await page.getByTestId('mail-compose-close').click()

    await page.getByTestId('mail-forward').click()
    await expect(page.getByTestId('mail-compose-dock')).toBeVisible()
    await expect(page.getByTestId('mail-ai-compose-open')).toHaveCount(0)
  })

  test('AI 꺼진 계정의 새 메일엔 AI 초안 진입이 없다', async ({ authenticatedPage: page }) => {
    await mockMail(page, { aiEnabled: false })
    await page.goto('/mail/1')
    await page.getByTestId('mail-compose-new').click()
    await expect(page.getByTestId('mail-compose-dock')).toBeVisible()
    await expect(page.getByTestId('mail-ai-compose-open')).toHaveCount(0)
    await expect(page.getByTestId('mail-ai-compose-chip')).toHaveCount(0)
  })

  test('칩 → 지시 → 초안 만들기: payload(지시·받는사람·참조·빈 제목) 확인 후 본문·제목이 채워지고 칩 대신 「AI 초안이에요」', { tag: '@smoke' }, async ({ authenticatedPage: page }) => {
    await mockMail(page)
    await mockDraft(page)
    const drafts = trackRequests(page, 'POST', DRAFT_PATH)
    await page.goto('/mail/1')
    await page.getByTestId('mail-compose-new').click()
    await page.getByTestId('mail-compose-to').fill('jihoon@example.com, mina@example.com')
    await page.getByRole('button', { name: '참조/숨은참조' }).click()
    await page.getByTestId('mail-compose-cc').fill('lead@example.com')
    await page.getByTestId('mail-ai-compose-chip').click()
    await page.getByTestId('mail-ai-compose-instruction').fill(INSTRUCTION)
    await page.getByTestId('mail-ai-compose-generate').click()

    await drafts.waitFor()
    expect(drafts.lastBody()).toEqual({
      instruction: INSTRUCTION,
      to: ['jihoon@example.com', 'mina@example.com'],
      cc: ['lead@example.com'],
      subject: null,
    })
    const body = page.getByTestId('mail-composer-body')
    // 한 줄 = 한 문단, 빈 줄 = 빈 문단.
    await expect(body.locator('p')).toHaveText(['김지훈 님, 안녕하세요.', '', '다음 주 회의를 목요일 오후 3시로 옮길 수 있을까요?', '', '감사합니다.'])
    await expect(page.getByTestId('mail-compose-subject')).toHaveValue('회의 일정 변경 요청')
    await expect(page.getByTestId('mail-ai-compose-bar')).toBeVisible()
    await expect(page.getByTestId('mail-ai-compose-panel')).toHaveCount(0)
    await expect(page.getByTestId('mail-ai-compose-chip')).toHaveCount(0)
  })

  test('AI 표식은 영역마다 한 번 — 패널이나 「AI 초안이에요」 줄이 있으면 툴바 「AI로 쓰기」엔 ✨ 가 없다', async ({ authenticatedPage: page }) => {
    await mockMail(page)
    await mockDraft(page)
    await page.goto('/mail/1')
    await page.getByTestId('mail-compose-new').click()
    const toolbarButton = page.getByTestId('mail-ai-compose-open')
    const sparkles = toolbarButton.locator('svg.lucide-sparkles')
    // 닫혀 있고 초안 전 — 툴바 버튼이 AI 진입점이라 표식이 있다.
    await expect(sparkles).toHaveCount(1)

    // 패널을 열면 패널 머리가 표식을 맡고, 버튼은 기능 아이콘·글자만.
    await toolbarButton.click()
    await expect(page.getByTestId('mail-ai-compose-panel')).toBeVisible()
    await expect(sparkles).toHaveCount(0)
    await expect(toolbarButton).toHaveText('AI로 쓰기')

    // 생성 뒤 「AI 초안이에요」 줄이 있는 동안도 버튼엔 표식이 없다.
    await page.getByTestId('mail-ai-compose-instruction').fill(INSTRUCTION)
    await page.getByTestId('mail-ai-compose-generate').click()
    await expect(page.getByTestId('mail-ai-compose-bar')).toBeVisible()
    await expect(sparkles).toHaveCount(0)
    // 패널 안 「초안 만들기」는 주 버튼(보내기)과 겹치지 않게 외곽선 — 다시 열어 확인한다.
    await page.getByTestId('mail-ai-compose-rewrite').click()
    const generate = page.getByTestId('mail-ai-compose-generate')
    const sendBg = await page.getByTestId('mail-compose-send').evaluate((el) => getComputedStyle(el).backgroundColor)
    expect(await generate.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe(sendBg)
  })

  test('사용자가 쓴 제목은 요청에 실어 보내고, 응답 뒤에도 그대로 둔다', async ({ authenticatedPage: page }) => {
    await mockMail(page)
    // 계약상 요청에 제목이 있으면 응답 subject 는 null.
    await mockDraft(page, { subject: null, body: '본문' })
    const drafts = trackRequests(page, 'POST', DRAFT_PATH)
    await page.goto('/mail/1')
    await page.getByTestId('mail-compose-new').click()
    await page.getByTestId('mail-compose-subject').fill('내가 쓴 제목')
    await page.getByTestId('mail-ai-compose-open').click()
    await page.getByTestId('mail-ai-compose-instruction').fill(INSTRUCTION)
    await page.getByTestId('mail-ai-compose-generate').click()
    await drafts.waitFor()
    expect(drafts.lastBody<{ subject: string | null }>()!.subject).toBe('내가 쓴 제목')
    await expect(page.getByTestId('mail-composer-body')).toContainText('본문')
    await expect(page.getByTestId('mail-compose-subject')).toHaveValue('내가 쓴 제목')
  })

  test('⌘/Ctrl+Enter 로 생성 — 한글 조합 중 ⌘Enter·Esc 는 무시, Enter 는 줄바꿈', async ({ authenticatedPage: page }) => {
    await mockMail(page)
    await mockDraft(page)
    const drafts = trackRequests(page, 'POST', DRAFT_PATH)
    const input = await openPanel(page, '첫 줄')
    // Enter 는 줄바꿈 — 생성하지 않는다.
    await input.press('Enter')
    await input.pressSequentially('둘째 줄')
    await expect(input).toHaveValue('첫 줄\n둘째 줄')
    // 조합 중 ⌘/Ctrl+Enter·Esc — 조합 확정용 키라 생성·닫기로 보지 않는다.
    await input.evaluate((el) => {
      const fire = (init: KeyboardEventInit) =>
        el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, isComposing: true, ...init }))
      fire({ key: 'Enter', metaKey: true, ctrlKey: true })
      fire({ key: 'Escape' })
    })
    await expectStays(page, () => drafts.count(), 0)
    await expect(page.getByTestId('mail-ai-compose-panel')).toBeVisible()

    await input.press('ControlOrMeta+Enter')
    await drafts.waitFor()
    expect(drafts.lastBody<{ instruction: string }>()!.instruction).toBe('첫 줄\n둘째 줄')
    await expect(page.getByTestId('mail-ai-compose-bar')).toBeVisible()
  })

  test('생성 중엔 보내기·본문이 막히고, 중지하면 요청이 끊기고 지시가 남는다(토스트 없음)', async ({ authenticatedPage: page }) => {
    await mockMail(page)
    const release = await gateDraft(page)
    await openPanel(page)
    const aborted = page.waitForEvent('requestfailed', (r) => new URL(r.url()).pathname === DRAFT_PATH)
    await page.getByTestId('mail-ai-compose-generate').click()
    await expect(page.getByTestId('mail-ai-compose-generating')).toBeVisible()
    await expect(page.getByTestId('mail-compose-send')).toBeDisabled()
    await expect(page.getByTestId('mail-composer-body').locator('xpath=ancestor::*[@inert]')).toHaveCount(1)

    await page.getByTestId('mail-ai-compose-stop').click()
    await aborted
    await expect(page.getByTestId('mail-ai-compose-instruction')).toHaveValue(INSTRUCTION)
    await expect(page.getByTestId('mail-compose-send')).toBeEnabled()
    await expect(page.locator('[data-sonner-toast]')).toHaveCount(0)
    release()
  })

  // 일시 실패 — 코드 없는 503(ai-agent 재기동 등)·502 는 다시 시도할 수 있다.
  for (const { status, message } of [
    { status: 503, message: 'AI 비서를 사용할 수 없어요. 잠시 후 다시 시도해주세요.' },
    { status: 502, message: 'AI 요청에 실패했어요. 잠시 후 다시 시도해주세요.' },
  ]) {
    test(`일시 실패(${status}, 코드 없음) — 서버 문구가 패널에 뜨고, 다시 시도하면 같은 지시로 다시 요청해 채운다`, async ({ authenticatedPage: page }) => {
      await mockMail(page)
      const drafts = trackRequests(page, 'POST', DRAFT_PATH)
      let calls = 0
      await page.route((u) => u.pathname === DRAFT_PATH, (r) =>
        ++calls === 1
          ? r.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ status, message, errors: null }) })
          : r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(RESULT) }),
      )
      await openPanel(page)
      await page.getByTestId('mail-ai-compose-generate').click()
      await expect(page.getByTestId('mail-ai-compose-error')).toContainText(message)
      await expect(page.getByTestId('mail-ai-compose-dismiss')).toHaveCount(0)
      await expect(page.locator('[data-sonner-toast]')).toHaveCount(0)

      await page.getByTestId('mail-ai-compose-retry').click()
      await drafts.waitFor(2)
      expect(drafts.bodies<{ instruction: string }>().map((b) => b.instruction)).toEqual([INSTRUCTION, INSTRUCTION])
      await expect(page.getByTestId('mail-composer-body')).toContainText('목요일 오후 3시')
    })
  }

  // 영구 실패 — 계정 AI 꺼짐·비서 미설정(errors.code)은 다시 시도해도 같아 [닫기]만, 계정 목록을 새로 받는다.
  for (const { code, message } of [
    { code: 'AI_DISABLED', message: '이 계정은 AI 비서가 꺼져 있어요. 계정 설정에서 켜주세요.' },
    { code: 'ASSISTANT_NOT_CONFIGURED', message: 'AI 비서가 아직 설정되지 않았어요. 관리자에게 문의해주세요.' },
  ]) {
    test(`영구 실패(503 ${code}) — 문구와 [닫기]만, 코드 문자열·토스트 없음, 계정 목록 재조회`, async ({ authenticatedPage: page }) => {
      // 처음엔 AI 사용 계정, 실패 뒤 재조회하면(AI_DISABLED) 꺼진 계정으로 응답한다.
      let aiEnabled = true
      const accountFetches = trackRequests(page, 'GET', '/api/v1/mail/accounts')
      await mockMail(page)
      await page.route((u) => u.pathname === '/api/v1/mail/accounts', (r) =>
        r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([mailAccount({ aiEnabled })]) }),
      )
      await page.route((u) => u.pathname === DRAFT_PATH, (r) =>
        r.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ status: 503, message, errors: { code } }) }),
      )
      await openPanel(page)
      const before = accountFetches.count()
      if (code === 'AI_DISABLED') aiEnabled = false
      await page.getByTestId('mail-ai-compose-generate').click()

      const errorBox = page.getByTestId('mail-ai-compose-error')
      await expect(errorBox).toContainText(message)
      await expect(errorBox).not.toContainText(code)
      await expect(page.getByTestId('mail-ai-compose-retry')).toHaveCount(0)
      await expect(page.locator('[data-sonner-toast]')).toHaveCount(0)
      await accountFetches.waitFor(before + 1)
      // 계정이 꺼졌다고 다시 받아도 실패 문구는 닫을 때까지 남는다.
      await expect(errorBox).toBeVisible()

      await page.getByTestId('mail-ai-compose-dismiss').click()
      await expect(errorBox).toHaveCount(0)
      if (code === 'AI_DISABLED') {
        // 꺼진 계정 — 진입점이 사라진다.
        await expect(page.getByTestId('mail-ai-compose-open')).toHaveCount(0)
        await expect(page.getByTestId('mail-ai-compose-chip')).toHaveCount(0)
      }
    })
  }

  test('생성 중 사용자가 쓴 제목은 늦게 온 AI 제목이 덮지 않고, 초점도 빼앗기지 않는다', async ({ authenticatedPage: page }) => {
    await mockMail(page)
    const release = await gateDraft(page)
    await openPanel(page)
    await page.getByTestId('mail-ai-compose-generate').click()
    await expect(page.getByTestId('mail-ai-compose-generating')).toBeVisible()
    const subject = page.getByTestId('mail-compose-subject')
    await subject.fill('생성 중 쓴 제목')
    release()
    await expect(page.getByTestId('mail-composer-body')).toContainText('목요일 오후 3시')
    await expect(subject).toHaveValue('생성 중 쓴 제목')
    await expect(subject).toBeFocused()
  })

  test('되돌리기 — 생성 직전 본문·제목으로 돌아가고 줄이 걷힌다', async ({ authenticatedPage: page }) => {
    await mockMail(page)
    await mockDraft(page)
    await page.goto('/mail/1')
    await page.getByTestId('mail-compose-new').click()
    const body = page.getByTestId('mail-composer-body')
    await body.click()
    await page.keyboard.type('내가 먼저 쓴 글')
    await page.getByTestId('mail-ai-compose-open').click()
    // 본문에 글이 있으면 바뀐다고 알린다.
    await expect(page.getByTestId('mail-ai-compose-replace-warning')).toBeVisible()
    await page.getByTestId('mail-ai-compose-instruction').fill(INSTRUCTION)
    await page.getByTestId('mail-ai-compose-generate').click()
    await expect(body).toContainText('목요일 오후 3시')
    await expect(page.getByTestId('mail-compose-subject')).toHaveValue('회의 일정 변경 요청')

    await page.getByTestId('mail-ai-compose-undo').click()
    await expect(body).toHaveText('내가 먼저 쓴 글')
    await expect(page.getByTestId('mail-compose-subject')).toHaveValue('')
    await expect(page.getByTestId('mail-ai-compose-bar')).toHaveCount(0)
  })

  test('다시 쓰기 — 지시가 채워진 패널과 교체 경고, 손대지 않은 AI 제목은 새 제목으로', async ({ authenticatedPage: page }) => {
    await mockMail(page)
    const drafts = trackRequests(page, 'POST', DRAFT_PATH)
    let n = 0
    await page.route((u) => u.pathname === DRAFT_PATH, (r) =>
      r.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ subject: `제목 ${++n}`, body: `초안 ${n}` }) }),
    )
    await openPanel(page)
    await page.getByTestId('mail-ai-compose-generate').click()
    await expect(page.getByTestId('mail-composer-body')).toHaveText('초안 1')

    await page.getByTestId('mail-ai-compose-rewrite').click()
    await expect(page.getByTestId('mail-ai-compose-instruction')).toHaveValue(INSTRUCTION)
    await expect(page.getByTestId('mail-ai-compose-instruction')).toBeFocused()
    await expect(page.getByTestId('mail-ai-compose-replace-warning')).toBeVisible()
    await page.getByTestId('mail-ai-compose-generate').click()
    await drafts.waitFor(2)
    // 손대지 않은 AI 제목은 사용자 제목이 아니라 null 로 보내 새 제목을 받는다.
    expect(drafts.lastBody<{ subject: string | null }>()!.subject).toBeNull()
    await expect(page.getByTestId('mail-composer-body')).toHaveText('초안 2')
    await expect(page.getByTestId('mail-compose-subject')).toHaveValue('제목 2')

    // 되돌리기는 맨 처음(AI 이전) 빈 상태로.
    await page.getByTestId('mail-ai-compose-undo').click()
    await expect(page.getByTestId('mail-composer-body')).toHaveText('')
    await expect(page.getByTestId('mail-compose-subject')).toHaveValue('')
    await expect(page.getByTestId('mail-ai-compose-chip')).toBeVisible()
  })

  test('본문을 고치면 「AI 초안이에요」 줄이 사라지고, ✕ 는 AI 초안과 고친 내용을 임시저장한다', async ({ authenticatedPage: page }) => {
    await mockMail(page)
    await mockDraft(page)
    const draftPosts = trackRequests(page, 'POST', '/api/v1/mail/drafts')
    await openPanel(page)
    await page.getByTestId('mail-ai-compose-generate').click()
    await expect(page.getByTestId('mail-ai-compose-bar')).toBeVisible()

    await page.getByTestId('mail-composer-body').click()
    await page.keyboard.press('ControlOrMeta+End')
    await page.keyboard.type('!')
    await expect(page.getByTestId('mail-ai-compose-bar')).toHaveCount(0)

    // AI 초안도 쓴 내용 — ✕ 는 묻지 않고 임시저장한 뒤 닫는다(WP-577).
    await page.getByTestId('mail-compose-close').click()
    await expect(page.getByTestId('mail-compose-dock')).toHaveCount(0)
    await draftPosts.waitFor()
    expect(draftPosts.lastBody()).toMatchObject({ mode: 'new', subject: '회의 일정 변경 요청' })
    expect(draftPosts.lastBody<{ bodyText: string }>()!.bodyText).toContain('!')
  })

  test('크게 보기에서 지시 칸 Esc 는 패널만 닫고 크게 보기는 그대로', async ({ authenticatedPage: page }) => {
    await mockMail(page)
    await page.goto('/mail/1')
    await page.getByTestId('mail-compose-new').click()
    await page.getByTestId('mail-compose-expand').click()
    await expect(page.getByTestId('mail-compose-backdrop')).toBeVisible()
    await page.getByTestId('mail-ai-compose-open').click()
    await page.getByTestId('mail-ai-compose-instruction').fill(INSTRUCTION)
    await page.getByTestId('mail-ai-compose-instruction').press('Escape')
    await expect(page.getByTestId('mail-ai-compose-panel')).toHaveCount(0)
    await expect(page.getByTestId('mail-compose-backdrop')).toBeVisible()
    // 한 번 더 Esc 는 기존대로 작은 창으로.
    await page.getByTestId('mail-compose-dock').press('Escape')
    await expect(page.getByTestId('mail-compose-backdrop')).toHaveCount(0)
  })

  test('생성 중 작성창을 버리면(🗑) 요청이 끊기고, 다시 연 새 메일은 빈 상태', async ({ authenticatedPage: page }) => {
    await mockMail(page)
    const release = await gateDraft(page)
    await page.goto('/mail/1')
    await page.getByTestId('mail-compose-new').click()
    await page.getByTestId('mail-compose-to').fill('a@example.com')
    await page.getByTestId('mail-ai-compose-open').click()
    await page.getByTestId('mail-ai-compose-instruction').fill(INSTRUCTION)
    const aborted = page.waitForEvent('requestfailed', (r) => new URL(r.url()).pathname === DRAFT_PATH)
    await page.getByTestId('mail-ai-compose-generate').click()
    await expect(page.getByTestId('mail-ai-compose-generating')).toBeVisible()
    await page.getByTestId('mail-compose-discard').click()
    await expect(page.getByTestId('mail-compose-dock')).toHaveCount(0)
    await aborted

    await page.getByTestId('mail-compose-new').click()
    await expect(page.getByTestId('mail-ai-compose-generating')).toHaveCount(0)
    await expect(page.getByTestId('mail-ai-compose-chip')).toBeVisible()
    release()
  })

  test('되돌리기 — AI 제목을 사용자가 고쳤으면 제목은 그대로 두고 본문만 되돌린다', async ({ authenticatedPage: page }) => {
    await mockMail(page)
    await mockDraft(page)
    await openPanel(page)
    await page.getByTestId('mail-ai-compose-generate').click()
    const subject = page.getByTestId('mail-compose-subject')
    await expect(subject).toHaveValue('회의 일정 변경 요청')
    await subject.fill('회의 일정 변경 요청 (수정)')
    await page.getByTestId('mail-ai-compose-undo').click()
    await expect(page.getByTestId('mail-composer-body')).toHaveText('')
    await expect(subject).toHaveValue('회의 일정 변경 요청 (수정)')
  })

  test('최소화했다 복원해도 쓰던 본문이 남는다(숨기기만, 에디터를 다시 만들지 않음)', async ({ authenticatedPage: page }) => {
    await mockMail(page)
    await page.goto('/mail/1')
    await page.getByTestId('mail-compose-new').click()
    const body = page.getByTestId('mail-composer-body')
    await body.click()
    await page.keyboard.type('최소화 전에 쓴 글')
    await page.getByTestId('mail-compose-minimize').click()
    await expect(body).toBeHidden()
    await page.getByTestId('mail-compose-minimize').click()
    await expect(body).toHaveText('최소화 전에 쓴 글')
    // 처음 본문과 달라 쓴 내용으로 본다 — ✕ 가 임시저장한다(WP-577).
    const draftPosts = trackRequests(page, 'POST', '/api/v1/mail/drafts')
    await page.getByTestId('mail-compose-close').click()
    await draftPosts.waitFor()
    expect(draftPosts.lastBody<{ bodyText: string }>()!.bodyText).toContain('최소화 전에 쓴 글')
  })

  test('생성 중 최소화 → 응답 도착 → 복원하면 AI 본문과 안내 줄이 정상이고, 숨은 동안 초점은 페이지에 남는다', async ({ authenticatedPage: page }) => {
    await mockMail(page)
    const release = await gateDraft(page)
    await openPanel(page)
    await page.getByTestId('mail-ai-compose-generate').click()
    await expect(page.getByTestId('mail-ai-compose-generating')).toBeVisible()
    await page.getByTestId('mail-compose-minimize').click()
    await expect(page.getByTestId('mail-ai-compose-generating')).toBeHidden()

    // 숨은 동안 페이지 검색칸에서 타이핑 — 도착한 초안이 초점을 가져가지 않고 키도 작성창으로 새지 않는다.
    const search = page.getByTestId('mail-search')
    await search.click()
    await page.keyboard.type('검색')
    release()
    await expect(page.getByTestId('mail-composer-body')).toContainText('목요일 오후 3시')
    await expect(search).toBeFocused()
    await page.keyboard.type('어')
    await expect(search).toHaveValue('검색어')
    await expect(page.getByTestId('mail-composer-body')).not.toContainText('검색')

    await page.getByTestId('mail-compose-minimize').click()
    await expect(page.getByTestId('mail-composer-body')).toBeVisible()
    await expect(page.getByTestId('mail-ai-compose-bar')).toBeVisible()
    await expect(page.getByTestId('mail-compose-subject')).toHaveValue('회의 일정 변경 요청')
    // 안내 줄이 진짜 AI 본문 기준이라, 되돌리면 빈 본문으로 돌아간다.
    await page.getByTestId('mail-ai-compose-undo').click()
    await expect(page.getByTestId('mail-composer-body')).toHaveText('')
  })

  test('보내기 잠금은 AI 생성 중과 첨부 업로드 중을 함께 본다 — 둘 다 끝나야 열린다', async ({ authenticatedPage: page }) => {
    await mockMail(page)
    const releaseDraft = await gateDraft(page)
    let releaseUpload: (() => void) | undefined
    await page.route((u) => u.pathname === '/api/v1/mail/compose-attachments', (route) => {
      releaseUpload = () =>
        void route.fulfill({
          status: 201,
          json: { id: 801, name: '안건.pdf', size: 3, mimeType: 'application/pdf', expiresAt: '2026-10-21T10:00:00Z' },
        })
    })
    await openPanel(page)
    const send = page.getByTestId('mail-compose-send')
    // 첨부를 올리는 중(응답 보류) + AI 생성 중.
    const chooser = page.waitForEvent('filechooser')
    await page.getByTestId('mail-compose-attach').click()
    await (await chooser).setFiles({ name: '안건.pdf', mimeType: 'application/pdf', buffer: Buffer.from('PDF') })
    await page.getByTestId('mail-ai-compose-instruction').fill(INSTRUCTION)
    await page.getByTestId('mail-ai-compose-generate').click()
    await expect(page.getByTestId('mail-ai-compose-generating')).toBeVisible()
    await expect(send).toBeDisabled()

    // AI 만 끝나도 업로드 중이라 잠김.
    releaseDraft()
    await expect(page.getByTestId('mail-ai-compose-bar')).toBeVisible()
    await expect(send).toBeDisabled()

    // 업로드까지 끝나면 열린다.
    await expect.poll(() => releaseUpload != null).toBe(true)
    releaseUpload!()
    await expect(send).toBeEnabled()
  })

  test('생성이 끝나면 본문 끝에 초점이 가서, 바로 친 글자가 본문에 이어진다', async ({ authenticatedPage: page }) => {
    await mockMail(page)
    const release = await gateDraft(page)
    await openPanel(page)
    await page.getByTestId('mail-ai-compose-generate').click()
    await expect(page.getByTestId('mail-ai-compose-generating')).toBeVisible()
    release()
    const body = page.getByTestId('mail-composer-body')
    await expect(body).toContainText('목요일 오후 3시')
    await expect(body).toBeFocused()
    await page.keyboard.type(' 추가')
    await expect(body.locator('p').last()).toHaveText('감사합니다. 추가')
  })

  test('최소화 중에 생성이 끝나면 초점을 옮기지 않고, 복원해도 본문으로 가져가지 않는다', async ({ authenticatedPage: page }) => {
    await mockMail(page)
    const release = await gateDraft(page)
    await openPanel(page)
    await page.getByTestId('mail-ai-compose-generate').click()
    await expect(page.getByTestId('mail-ai-compose-generating')).toBeVisible()
    await page.getByTestId('mail-compose-minimize').click()
    // 아무 칸에도 쓰고 있지 않은 상태(초점이 페이지 본문) — 그래도 숨은 작성창으로 초점을 옮기지 않는다.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    release()
    const body = page.getByTestId('mail-composer-body')
    await expect(body).toContainText('목요일 오후 3시')
    await expect.poll(() => page.evaluate(() => document.activeElement === document.body)).toBe(true)

    await page.getByTestId('mail-compose-minimize').click()
    await expect(body).toBeVisible()
    await expect(body).not.toBeFocused()
    await expect(page.getByTestId('mail-ai-compose-bar')).toBeVisible()
  })
})
