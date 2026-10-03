// 모바일 AI 시트(WP-191) — 보던 화면 위 바텀 시트, 진입 버튼 생성 중·완료 표시, 대화 전환 보호, 목록 화면 컨텍스트.
import { mockHomeChatGeneration } from '../../fixtures/home-chat-mock'
import { expect, stubChat, test } from '../../fixtures/mobile.fixture'

/** 생성 지연 게이트 — release() 전까지 SSE 프레임을 보류한다. */
function gate() {
  let release!: () => void
  const p = new Promise<void>((r) => (release = r))
  return { p, release }
}

test('닫힌 탭바 ✦: 생성 중이면 pending, 닫힌 사이 끝나면 완료 점, 열면 해제', async ({ authenticatedPage: page }) => {
  await stubChat(page)
  const g = gate()
  await mockHomeChatGeneration(page, {
    gate: g.p,
    frames: [{ event: 'delta', data: { text: '요약했어요' } }, { event: 'done', data: { sessionId: 's-1' } }],
  })
  await page.goto('/chat')
  const tab = page.getByTestId('mobile-tab-ai')
  await expect(tab).toHaveAttribute('data-ai-activity', 'idle')
  await tab.click()
  await page.getByTestId('chat-input').fill('요약해줘')
  await page.getByRole('button', { name: '보내기' }).click()
  // 열려 있는 동안엔 표시하지 않는다.
  await expect(tab).toHaveAttribute('data-ai-activity', 'idle')
  await tab.click() // 탭 루트의 풀스크린엔 × 가 없어 AI 칸 토글로 닫는다
  await expect(tab).toHaveAttribute('data-ai-activity', 'pending')
  await expect(tab).toHaveAttribute('aria-label', 'AI 비서, 답변 생성 중')
  g.release()
  await expect(tab).toHaveAttribute('data-ai-activity', 'done')
  await expect(tab.getByTestId('ai-trigger-dot')).toBeVisible()
  await tab.click()
  await expect(page.getByTestId('chat-panel')).toContainText('요약했어요')
  await tab.click()
  await expect(tab).toHaveAttribute('data-ai-activity', 'idle')
})

test('헤더 ✦(채팅방)도 같은 표시를 쓴다', async ({ authenticatedPage: page }) => {
  await stubChat(page)
  const g = gate()
  await mockHomeChatGeneration(page, { gate: g.p, frames: [{ event: 'done', data: { sessionId: 's-2' } }] })
  await page.goto('/chat/channels/1')
  const btn = page.getByTestId('mobile-back-ai')
  await btn.click()
  await page.getByTestId('chat-input').fill('질문')
  // 채널 화면 뒤에도 메시지 작성기의 보내기가 있어 AI 패널 안으로 범위를 좁힌다.
  await page.getByTestId('chat-panel').getByRole('button', { name: '보내기' }).click()
  await page.getByTestId('ai-panel-close').click()
  await expect(btn).toHaveAttribute('data-ai-activity', 'pending')
  g.release()
  await expect(btn).toHaveAttribute('data-ai-activity', 'done')
})

test('동작 줄이기: 생성 중에도 회전·반짝임 없이 고정 점', async ({ authenticatedPage: page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await stubChat(page)
  const g = gate()
  await mockHomeChatGeneration(page, { gate: g.p, frames: [{ event: 'done', data: { sessionId: 's-3' } }] })
  await page.goto('/chat')
  const tab = page.getByTestId('mobile-tab-ai')
  await tab.click()
  await page.getByTestId('chat-input').fill('질문')
  await page.getByRole('button', { name: '보내기' }).click()
  await tab.click()
  await expect(tab).toHaveAttribute('data-ai-activity', 'pending')
  await expect(tab.getByTestId('ai-trigger-dot')).toBeVisible()
  const capsule = page.getByTestId('mobile-tab-ai-capsule')
  expect(await capsule.evaluate((el) => getComputedStyle(el, '::before').animationName)).toBe('none')
  expect(await capsule.locator('svg').evaluate((el) => getComputedStyle(el).animationName)).toBe('none')
  g.release()
})

test('AI 를 열어도 보던 탭 강조가 유지되고 AI 칸은 열림 상태만 갖는다', async ({ authenticatedPage: page }) => {
  await stubChat(page)
  await page.goto('/chat')
  await page.getByTestId('mobile-tab-ai').click()
  await expect(page.getByTestId('mobile-tab-chat')).toHaveAttribute('aria-current', 'page')
  await expect(page.getByTestId('mobile-tab-ai')).toHaveAttribute('aria-expanded', 'true')
  await expect(page.getByTestId('mobile-tab-ai')).not.toHaveAttribute('aria-current', /.*/)
  // 다시 누르면 닫힌다(토글).
  await page.getByTestId('mobile-tab-ai').click()
  await expect(page.getByTestId('mobile-tab-ai')).toHaveAttribute('aria-expanded', 'false')
})
