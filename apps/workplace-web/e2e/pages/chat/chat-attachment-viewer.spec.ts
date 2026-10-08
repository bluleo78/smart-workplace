// 채팅 3곳 첨부 → 통합 첨부 뷰어(WP-279, 데스크톱). 모바일 배치·뒤로가기·길게 누르기는 e2e/pages/mobile/chat-attachment-viewer-mobile.spec.ts.
// 묶음 = 누른 메시지 한 건의 업로드 + 드라이브 링크(표시 순서), 받기는 뷰어 ⬇.
// ✨ 는 활성 드라이브 링크만(요약 403 이면 숨김), ☁ 는 업로드만, 메인 AI 채팅은 둘 다 없다. 링크 공유 불가라 "링크 복사"는 없다.
import type { Page } from '@playwright/test'

import { expect, test } from '../../fixtures/auth.fixture'
import {
  LINK_TEXT,
  MEMO_TEXT,
  stubHomeChatAttachments,
  stubIssueChatAttachments,
  stubTeamChatAttachments,
} from '../../fixtures/chat-viewer-mock'
import { KEY } from '../../fixtures/mobile-chat'

const viewerOf = (page: Page) => page.getByTestId('attachment-viewer')

/**
 * 묶음 4개(이미지 → PDF → 활성 링크 → 삭제된 링크)를 → 로 넘기며 항목별 버튼 규칙과 본문을 확인한다.
 * 팀 채팅·이슈 채팅이 같은 구성이라 함께 쓴다. 시작은 이미지(1 / 4)가 열린 상태.
 */
async function walkBundle(page: Page) {
  const viewer = viewerOf(page)
  await expect(viewer).toHaveAccessibleName('shot.png 미리보기')
  await expect(page.getByTestId('preview-body').locator('img')).toBeVisible()
  await expect(page.getByTestId('preview-meta')).toContainText('1 / 4')
  // 업로드: ☁ 있음(개인 공간 확인 뒤 활성)·✨ 없음. 링크 공유 불가라 ⋯ 에 "링크 복사"가 없다.
  await expect(viewer.getByRole('button', { name: '드라이브로 가져오기' })).toBeEnabled()
  await expect(viewer.getByRole('button', { name: 'AI 요약' })).toHaveCount(0)
  await viewer.getByRole('button', { name: '더 보기' }).click()
  await expect(page.getByRole('menuitem', { name: '드라이브로 가져오기' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: '링크 복사' })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menuitem', { name: '드라이브로 가져오기' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '이전 파일' })).toHaveCount(0)

  // PDF — 저장 형식이 octet-stream 이어도 파일명(.pdf)으로 PDF 렌더러가 그린다.
  await page.keyboard.press('ArrowRight')
  await expect(page.getByTestId('pdf-page-1')).toBeVisible()
  await expect(page.getByTestId('preview-meta')).toContainText('2 / 4')

  // 활성 드라이브 링크 — 링크 전용 경로로 받고 ✨ 있음·☁ 없음, ⋯ 에 드라이브에서 열기.
  await page.keyboard.press('ArrowRight')
  await expect(page.getByTestId('preview-body')).toContainText(LINK_TEXT)
  await expect(page.getByTestId('viewer-live')).toHaveText('회의록.txt, 4개 중 3번째')
  await expect(viewer.getByRole('button', { name: 'AI 요약' })).toBeVisible()
  await expect(viewer.getByRole('button', { name: '드라이브로 가져오기' })).toHaveCount(0)
  await viewer.getByRole('button', { name: '더 보기' }).click()
  await expect(page.getByRole('menuitem', { name: '드라이브에서 열기' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menuitem', { name: '드라이브에서 열기' })).toHaveCount(0)

  // 삭제된 링크 — 받지 않고 안내만, 다운로드 없음. 마지막이라 › 는 숨는다(순환 없음).
  await page.keyboard.press('ArrowRight')
  await expect(page.getByTestId('preview-unavailable')).toBeVisible()
  await expect(page.getByTestId('preview-meta')).toContainText('4 / 4')
  await expect(page.getByTestId('preview-download')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '다음 파일' })).toHaveCount(0)

  // 링크로 돌아가 ⬇ — 미리보기로 받은 blob 을 링크 이름으로 저장한다.
  await page.getByRole('button', { name: '이전 파일' }).click()
  await expect(page.getByTestId('preview-body')).toContainText(LINK_TEXT)
  const download = page.waitForEvent('download')
  await page.getByTestId('preview-download').click()
  expect((await download).suggestedFilename()).toBe('회의록.txt')
}

test.describe('팀 채팅 첨부 뷰어', () => {
  test('썸네일을 누르면 뷰어 — 메시지 묶음 안에서 넘기고 ⬇ 로 받는다, Esc 는 뷰어만 닫고 썸네일로 포커스', { tag: '@smoke' }, async ({ authenticatedPage: page }) => {
    const contents = await stubTeamChatAttachments(page)
    await page.goto('/chat/channels/1')
    await expect(page.getByTestId('attachment-image-801')).toBeVisible()
    // 파일 카드·링크는 그리기만 해서는 받지 않는다(썸네일 801·804 만 받는다).
    await expect(page.getByTestId('attachment-image-804')).toBeVisible()
    expect([...new Set(contents.urls().map((u) => u.pathname.split('/').at(-2)))].sort()).toEqual(['801', '804'])

    await page.getByTestId('attachment-image-open-801').click()
    await walkBundle(page)

    await page.keyboard.press('Escape')
    await expect(viewerOf(page)).toHaveCount(0)
    await expect(page).toHaveURL(/\/chat\/channels\/1$/)
    await expect(page.getByTestId('attachment-image-open-801')).toBeFocused()
  })

  test('묶음은 메시지 한 건 — 다른 메시지 첨부는 한 건 묶음, 뒤로가기도 뷰어만 닫고 카드로 포커스', async ({ authenticatedPage: page }) => {
    await stubTeamChatAttachments(page)
    await page.goto('/chat/channels/1')
    await page.getByTestId('attachment-card-803').click()
    await expect(page.getByTestId('preview-body')).toContainText(MEMO_TEXT)
    // 한 건 묶음 — 순번(n / m)도 넘김 화살표도 없다.
    await expect(page.getByTestId('preview-meta')).not.toContainText('/')
    await expect(page.getByRole('button', { name: '다음 파일' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '이전 파일' })).toHaveCount(0)

    await page.goBack()
    await expect(viewerOf(page)).toHaveCount(0)
    await expect(page).toHaveURL(/\/chat\/channels\/1$/)
    await expect(page.getByTestId('message-list').first()).toBeVisible()
    // 히스토리로 닫혀도(onOpenChange 없이 언마운트) 연 카드로 포커스가 돌아간다.
    await expect(page.getByTestId('attachment-card-803')).toBeFocused()
  })

  test('스레드 패널에서 열어도 뷰어는 하나 — 뒤로가기는 뷰어만 닫고 ?thread 는 남는다', async ({ authenticatedPage: page }) => {
    await stubTeamChatAttachments(page)
    await page.goto('/chat/channels/1')
    await page.getByTestId('message-thread-link-10').click()
    const panel = page.getByTestId('thread-panel')
    await expect(panel.getByTestId('attachment-card-802')).toBeVisible()
    // 같은 메시지(10)가 채널 목록과 스레드 패널에 함께 그려져 있다.
    await expect(page.getByTestId('attachment-card-802')).toHaveCount(2)

    await panel.getByTestId('attachment-card-802').click()
    await expect(page.getByTestId('pdf-page-1')).toBeVisible()
    await expect(viewerOf(page)).toHaveCount(1)
    await expect(page.getByTestId('preview-meta')).toContainText('2 / 4')

    await page.goBack()
    await expect(viewerOf(page)).toHaveCount(0)
    await expect(page).toHaveURL(/\/chat\/channels\/1\?thread=10$/)
    await expect(panel).toBeVisible()
    await expect(panel.getByTestId('attachment-card-802')).toBeFocused()
  })

  test('드라이브 링크 요약이 403 이면 ✨ 를 숨긴다', async ({ authenticatedPage: page }) => {
    await stubTeamChatAttachments(page, { summary: 'forbidden' })
    await page.goto('/chat/channels/1')
    await page.getByTestId('message-drive-link-70').click()
    await expect(page.getByTestId('preview-body')).toContainText(LINK_TEXT)
    await expect(page.getByTestId('preview-meta')).toContainText('3 / 4')
    await expect(viewerOf(page).getByRole('button', { name: 'AI 요약' })).toHaveCount(0)
  })
})

test.describe('이슈 채팅 첨부 뷰어', () => {
  test('카드를 누르면 뷰어 — 묶음 넘김·⬇, Esc·뒤로가기는 뷰어만 닫고 ?chat=1 은 남는다', async ({ authenticatedPage: page }) => {
    const contents = await stubIssueChatAttachments(page)
    await page.goto(`/projects/${KEY}/issues/1`)
    await page.getByTestId('issue-chat-open').click()
    await expect(page).toHaveURL(/[?&]chat=1$/)
    await expect(page.getByTestId('attachment-image-801')).toBeVisible()
    expect([...new Set(contents.urls().map((u) => u.pathname.split('/').at(-2)))]).toEqual(['801'])

    await page.getByTestId('attachment-image-open-801').click()
    await walkBundle(page)
    await page.keyboard.press('Escape')
    await expect(viewerOf(page)).toHaveCount(0)
    await expect(page).toHaveURL(/[?&]chat=1$/)
    await expect(page.getByTestId('attachment-image-open-801')).toBeFocused()

    // 다른 메시지(본인 memo)는 그 메시지만 묶음. 뒤로가기는 뷰어만 닫는다(채팅 드로워는 그대로).
    await page.getByTestId('attachment-card-803').click()
    await expect(page.getByTestId('preview-body')).toContainText(MEMO_TEXT)
    await expect(page.getByTestId('preview-meta')).not.toContainText('/')
    await page.goBack()
    await expect(viewerOf(page)).toHaveCount(0)
    await expect(page).toHaveURL(/[?&]chat=1$/)
    await expect(page.getByTestId('attachment-card-803')).toBeFocused()
  })

  test('드라이브 링크 요약이 403 이면 ✨ 를 숨긴다', async ({ authenticatedPage: page }) => {
    await stubIssueChatAttachments(page, { summary: 'forbidden' })
    await page.goto(`/projects/${KEY}/issues/1?chat=1`)
    await page.getByTestId('message-drive-link-70').click()
    await expect(page.getByTestId('preview-body')).toContainText(LINK_TEXT)
    await expect(viewerOf(page).getByRole('button', { name: 'AI 요약' })).toHaveCount(0)
  })
})

test.describe('메인 AI 채팅 첨부 뷰어', () => {
  test('복원한 대화의 썸네일 → 턴 묶음 넘김·⬇, ✨·☁ 없음, 뒤로가기는 뷰어만 닫고 패널은 남는다', async ({ authenticatedPage: page }) => {
    const contents = await stubHomeChatAttachments(page)
    await page.goto('/')
    await page.getByTestId('chat-launcher').click()
    await page.getByTestId('chat-session-switcher').click()
    await page.getByTestId('chat-session-select').first().click()
    const turn = page.getByTestId('chat-turn').first()
    await expect(turn.getByTestId('attachment-image-77')).toHaveAttribute('src', /^blob:/)

    await turn.getByTestId('attachment-image-open-77').click()
    const viewer = viewerOf(page)
    await expect(viewer).toHaveAccessibleName('board.png 미리보기')
    await expect(page.getByTestId('preview-meta')).toContainText('1 / 2')
    await expect(viewer.getByRole('button', { name: 'AI 요약' })).toHaveCount(0)
    await expect(viewer.getByRole('button', { name: '드라이브로 가져오기' })).toHaveCount(0)
    // ⋯ 에 넣을 항목(원본 이동·링크 복사·가져오기·드라이브에서 열기)이 하나도 없어 ⋯ 자체가 없다.
    await expect(viewer.getByRole('button', { name: '더 보기' })).toHaveCount(0)

    await page.keyboard.press('ArrowRight')
    await expect(page.getByTestId('pdf-page-1')).toBeVisible()
    await expect(page.getByTestId('preview-meta')).toContainText('2 / 2')
    // 다음 사용자 턴(memo 79)으로는 넘어가지 않는다.
    await expect(page.getByRole('button', { name: '다음 파일' })).toHaveCount(0)

    // ⬇ — 미리보기로 이미 받은 PDF 를 다시 받지 않고 저장한다.
    const before = contents.count()
    const download = page.waitForEvent('download')
    await page.getByTestId('preview-download').click()
    expect((await download).suggestedFilename()).toBe('spec.pdf')
    expect(contents.count()).toBe(before)

    await page.goBack()
    await expect(viewer).toHaveCount(0)
    await expect(page.getByTestId('chat-panel')).toBeVisible()
    await expect(turn.getByTestId('attachment-image-open-77')).toBeFocused()

    // 문서 카드도 뷰어로 열고 Esc 로 닫으면 카드로 포커스.
    await turn.getByTestId('attachment-card-78').click()
    await expect(page.getByTestId('pdf-page-1')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(viewer).toHaveCount(0)
    await expect(page.getByTestId('chat-panel')).toBeVisible()
    await expect(turn.getByTestId('attachment-card-78')).toBeFocused()
  })
})

// ── 수정 라운드(WP-279 리뷰): 열림 항목 자립·호스트 단일화·겹침 방지·형식 추론 ─────────────────────────

/** 지금 히스토리 항목의 router state 에 남은 채팅 열림 키(없으면 null) — 보이지 않는 열림 항목(헛도는 뒤로가기) 검사용. */
const liveChatKey = (page: Page, key: string) =>
  page.evaluate((k) => (window.history.state?.usr?.[k] as string | undefined) ?? null, key)

test.describe('채팅 뷰어 히스토리', () => {
  test('닫은 뒤 앞으로가기·새로고침이면 열림 항목이 그 메시지 묶음으로 다시 열린다', async ({ authenticatedPage: page }) => {
    await stubTeamChatAttachments(page)
    await page.goto('/chat/channels/1')
    await page.getByTestId('message-drive-link-70').click()
    await expect(page.getByTestId('preview-body')).toContainText(LINK_TEXT)

    await page.goBack()
    await expect(viewerOf(page)).toHaveCount(0)
    await page.goForward()
    await expect(page.getByTestId('preview-body')).toContainText(LINK_TEXT)
    await expect(page.getByTestId('preview-meta')).toContainText('3 / 4')
    await expect(viewerOf(page)).toHaveCount(1)

    // 새로고침해도 같은 항목(history.state)이 남아 목록이 그려지면 다시 연다.
    await page.reload()
    await expect(page.getByTestId('preview-body')).toContainText(LINK_TEXT)
    await expect(viewerOf(page)).toHaveCount(1)
    // 그 뒤 뒤로가기는 뷰어만 닫는다(헛돌지 않음).
    await page.goBack()
    await expect(viewerOf(page)).toHaveCount(0)
    await expect(page).toHaveURL(/\/chat\/channels\/1$/)
    expect(await liveChatKey(page, 'teamChatPreview')).toBeNull()
  })

  test('그릴 메시지가 없는 낡은 열림 표식은 지운다 — 뷰어 없이 뒤로가기가 헛돌지 않게', async ({ authenticatedPage: page }) => {
    await stubTeamChatAttachments(page)
    await page.goto('/chat/channels/1')
    await expect(page.getByTestId('attachment-image-801')).toBeVisible()
    // 목록에 없는 메시지(999) 키가 남은 항목을 재현 — 같은 화면 인스턴스가 popstate 로 받는다.
    await page.evaluate(() => {
      const st = window.history.state
      window.history.pushState({ ...st, usr: { ...(st?.usr ?? {}), teamChatPreview: 'msg:999:file:1' } }, '')
      window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state }))
    })
    await expect.poll(() => liveChatKey(page, 'teamChatPreview')).toBeNull()
    await expect(viewerOf(page)).toHaveCount(0)
  })

  test('형식이 octet-stream 으로 저장된 PNG 도 썸네일로 보이고 뷰어에서 이미지로 열린다', async ({ authenticatedPage: page }) => {
    await stubTeamChatAttachments(page)
    await page.goto('/chat/channels/1')
    await expect(page.getByTestId('attachment-image-804')).toBeVisible()
    await expect(page.getByTestId('attachment-card-804')).toHaveCount(0)
    await page.getByTestId('attachment-image-open-804').click()
    await expect(page.getByTestId('preview-body').locator('img')).toBeVisible()
  })
})

test.describe('메인 AI 사이드 패널과 뷰어', () => {
  /** 홈에서 AI 사이드 패널을 열고 첨부 대화(s-v)를 복원한다. */
  async function openRestoredPanel(page: Page, path = '/') {
    await page.goto(path)
    await page.getByTestId('chat-launcher').click()
    await page.getByTestId('chat-session-switcher').click()
    await page.getByTestId('chat-session-select').first().click()
    await expect(page.getByTestId('chat-turn').first().getByTestId('attachment-image-77')).toHaveAttribute('src', /^blob:/)
  }

  test('새 대화를 누르면 열린 뷰어를 정상 닫기로 되돌린다(보이지 않는 열림 항목 없음)', async ({ authenticatedPage: page }) => {
    await stubHomeChatAttachments(page)
    await openRestoredPanel(page)
    await page.getByTestId('chat-turn').first().getByTestId('attachment-card-78').click()
    await expect(page.getByTestId('pdf-page-1')).toBeVisible()
    expect(await liveChatKey(page, 'homeChatPreview')).toBe('home:78')

    // side 모드라 뷰어 옆 AI 패널을 그대로 조작할 수 있다.
    await page.getByTestId('chat-new-session').click()
    await expect(viewerOf(page)).toHaveCount(0)
    await expect.poll(() => liveChatKey(page, 'homeChatPreview')).toBeNull()
  })

  test('다른 대화로 바꾸면 열린 뷰어를 닫는다', async ({ authenticatedPage: page }) => {
    await stubHomeChatAttachments(page)
    await openRestoredPanel(page)
    await page.getByTestId('chat-turn').first().getByTestId('attachment-image-open-77').click()
    await expect(viewerOf(page)).toBeVisible()

    await page.getByTestId('chat-session-switcher').click()
    await page.getByTestId('chat-session-select').nth(1).click()
    await expect(page.getByTestId('chat-turn').first()).toContainText('다른 질문')
    await expect(viewerOf(page)).toHaveCount(0)
    await expect.poll(() => liveChatKey(page, 'homeChatPreview')).toBeNull()
  })

  test('팀 채팅 뷰어가 열린 채 AI 패널 첨부를 눌러도 뷰어를 겹쳐 열지 않는다', async ({ authenticatedPage: page }) => {
    await stubTeamChatAttachments(page)
    await stubHomeChatAttachments(page)
    await openRestoredPanel(page, '/chat/channels/1')
    await page.getByTestId('attachment-image-open-801').click()
    await expect(viewerOf(page)).toHaveAccessibleName('shot.png 미리보기')

    await page.getByTestId('chat-panel').getByTestId('attachment-card-78').click()
    await expect(viewerOf(page)).toHaveCount(1)
    await expect(viewerOf(page)).toHaveAccessibleName('shot.png 미리보기')
    expect(await liveChatKey(page, 'homeChatPreview')).toBeNull()
  })
})
