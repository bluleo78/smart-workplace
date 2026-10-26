// 새 메일 AI 초안(WP-576) E2E — 초점·IME 단축키(@input)와 버튼 배경색(@layout)만 남긴다. 백엔드 없이 page.route 모킹.
// 진입점 조건·payload·본문/제목 반영·생성 중 잠금·중지/버리기(요청 끊김)·일시/영구 실패·되돌리기·다시 쓰기·✕ 저장·
// 크게 보기 Esc·최소화 뒤 유지·보내기 잠금은 src/pages/mail/mailAiCompose.test.tsx(vitest, WP-984)가 지킨다.
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

  test('AI 표식은 영역마다 한 번 — 패널이나 「AI 초안이에요」 줄이 있으면 툴바 「AI로 쓰기」엔 ✨ 가 없다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
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

  test('⌘/Ctrl+Enter 로 생성 — 한글 조합 중 ⌘Enter·Esc 는 무시, Enter 는 줄바꿈', { tag: '@input' }, async ({ authenticatedPage: page }) => {
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

  test('생성 중 사용자가 쓴 제목은 늦게 온 AI 제목이 덮지 않고, 초점도 빼앗기지 않는다', { tag: '@input' }, async ({ authenticatedPage: page }) => {
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

  test('생성 중 최소화 → 응답 도착 → 복원하면 AI 본문과 안내 줄이 정상이고, 숨은 동안 초점은 페이지에 남는다', { tag: '@input' }, async ({ authenticatedPage: page }) => {
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

  test('생성이 끝나면 본문 끝에 초점이 가서, 바로 친 글자가 본문에 이어진다', { tag: '@input' }, async ({ authenticatedPage: page }) => {
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

  test('최소화 중에 생성이 끝나면 초점을 옮기지 않고, 복원해도 본문으로 가져가지 않는다', { tag: '@input' }, async ({ authenticatedPage: page }) => {
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
