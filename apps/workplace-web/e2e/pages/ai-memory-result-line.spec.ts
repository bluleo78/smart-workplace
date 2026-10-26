// WP-55 채팅 메모리 결과 줄(데스크톱) E2E — 브라우저가 있어야 판정되는 것만 남긴다(@layout): 되돌리기 밑줄·nowrap 덩어리,
// 답 아래·후속 질문 위의 실제 위치, 긴 문구 줄바꿈(넘침 없음), WP-581 끊긴 단계 묶음 들여쓰기, WP-380 기한 nowrap·취소선.
// 결과 줄 생성·문구(범위·기한·공용)·done 전 비활성·되돌리기 payload·줄별 잠금·오류 토스트·설정 이동·이력 복원(at 자리·깨진 공용 줄)은
// 페이지 테스트 src/components/ai/aiChatMemoryLine.test.tsx 가 지킨다(WP-966). 오류·■ 정지 턴의 messageId(chatStreams.test.ts)·이력 복원(chatTurns.test.ts)은 단위 테스트.
import type { Page } from '@playwright/test'

import { ask, openChatPanel, setupLiveChat } from '../fixtures/ai-live-chat'
import { memoryTool, mockMemoryUndo } from '../fixtures/ai-memory-mock'
import { expect, test } from '../fixtures/auth.fixture'
import { stableBox } from '../fixtures/wait'

const C = { correlationId: 'corr-a', sessionId: 's-a' }
const lines = (page: Page) => page.getByTestId('chat-memory-result')
const undoLinks = (page: Page) => page.getByTestId('chat-memory-undo')

const saved = { action: 'saved', memoryId: 12, kind: 'PREFERENCE', content: '이슈 목록은 짧은 목록으로 보여 준다', source: 'AI' }
const updated = { action: 'updated', memoryId: 9, kind: 'CONTEXT', content: '백엔드 팀이다', previousContent: '프론트 팀이다', source: 'AI' }

/** 노트 도구 start·result 한 쌍(표시되는 단계). */
async function wikiTool(live: Awaited<ReturnType<typeof setupLiveChat>>, seq: number, toolName: string) {
  await live.push('tool', { ...C, seq, phase: 'start', toolName, args: {} })
  await live.push('tool', { ...C, seq, phase: 'result', toolName, isError: false })
}

/** 위에서 아래로 놓인 순서대로인가 — 앞 요소의 아래 끝이 뒤 요소의 위 끝보다 위다. */
async function expectStacked(...locators: ReturnType<Page['getByTestId']>[]) {
  const boxes = []
  for (const l of locators) boxes.push(await stableBox(l))
  for (let k = 1; k < boxes.length; k++) expect(boxes[k].y).toBeGreaterThan(boxes[k - 1].y + boxes[k - 1].height - 1)
}

// 되돌리기는 평소에도 링크로 보인다(밑줄, hover 아님 — 터치엔 hover 가 없다). " · 되돌리기" 는 한 덩어리(nowrap)라 "·" 가 줄 끝에 남지 않는다.
// 결과 줄은 마지막 답 풍선 아래·후속 질문 위에 실제로 놓인다(기하).
test('결과 줄 되돌리기는 밑줄 링크·nowrap 덩어리이고, 답 아래·후속 질문 위에 놓인다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  await mockMemoryUndo(page)
  const live = await setupLiveChat(page)
  live.queueStart({ correlationId: 'corr-a', sessionId: 's-a' })
  await openChatPanel(page)
  await ask(page, live, '앞으로는 이슈 목록을 짧은 목록으로 보여줘')
  await live.push('delta', { ...C, text: '알겠어요. 앞으로 짧은 목록으로 보여 드릴게요.' })
  await memoryTool(live, 1, 'mcp__workplace__remember_memory', saved)
  await live.push('done', { ...C, widgets: null, messageId: 2 })
  await live.push('followups', { ...C, messageId: 2, items: ['내 이슈 보여줘'] })
  await expect(undoLinks(page)).toBeEnabled()
  await expect(undoLinks(page)).toHaveCSS('text-decoration-line', 'underline')
  await expect(undoLinks(page).locator('..')).toHaveCSS('white-space', 'nowrap')
  await expectStacked(page.getByTestId('chat-block').last(), lines(page).first(), page.getByTestId('chat-followups'))
})

test('긴 메모리 문구는 줄바꿈되어 패널 밖으로 넘치지 않는다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  const live = await setupLiveChat(page)
  live.queueStart({ correlationId: 'corr-a', sessionId: 's-a' })
  await openChatPanel(page)
  await ask(page, live, '기억해줘')
  await memoryTool(live, 1, 'remember_memory', { ...saved, content: 'https://example.com/' + 'a'.repeat(280) })
  await live.push('delta', { ...C, text: '기억할게요.' })
  await live.push('done', { ...C, widgets: null, messageId: 2 })
  const line = lines(page).first()
  await expect(line).toBeVisible()
  const overflow = await line.evaluate((el) => el.scrollWidth - el.clientWidth)
  expect(overflow).toBeLessThanOrEqual(0)
  const panel = await stableBox(page.getByTestId('chat-panel'))
  const box = await stableBox(line)
  expect(box.x + box.width).toBeLessThanOrEqual(panel.x + panel.width)
})

// WP-581: 결과 줄 뒤에 끊겨 이어지는 도구 묶음도 위임 아래로 들여 쓴다 — 앞 묶음의 도구와 같은 들여쓰기, 결과 줄을 사이에 두고 위아래로 놓인다.
// 묶음 나뉨·문구·순서(문서 순서)는 src/components/ai/aiChatMemoryLine.test.tsx 가 본다.
test('메모리 결과 줄 뒤 새 단계 묶음은 결과 줄 아래에 앞 묶음과 같은 들여쓰기로 놓인다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  const live = await setupLiveChat(page)
  live.queueStart({ correlationId: 'corr-a', sessionId: 's-a' })
  await openChatPanel(page)
  await ask(page, live, '오늘 업무 노트 정리해줘')
  await live.push('progress', { ...C, label: '노트 전문가에게 위임 중' })
  await wikiTool(live, 1, 'get_wiki_page')
  await wikiTool(live, 2, 'update_wiki_page')
  await memoryTool(live, 3, 'update_memory', updated)
  await wikiTool(live, 4, 'move_wiki_page')
  await wikiTool(live, 5, 'list_wiki_pages')

  const groups = page.getByTestId('chat-block-tools')
  await expect(groups).toHaveCount(2)
  await expectStacked(groups.nth(0), lines(page), groups.nth(1))
  const indent = (l: ReturnType<Page['getByTestId']>) => l.getByTestId('tool-step-tool').first().evaluate((e) => getComputedStyle(e).paddingLeft)
  expect(await indent(groups.nth(1))).toBe(await indent(groups.nth(0)))
  expect(await indent(groups.nth(1))).not.toBe('0px')

  await live.push('delta', { ...C, text: '노트를 정리했어요.' })
  await live.push('done', { ...C, widgets: null, messageId: 5 })
  await expectStacked(groups.nth(1), page.getByTestId('chat-block').last())
})

test.describe('기한 (WP-380)', () => {
  test.use({ timezoneId: 'Asia/Seoul' })

  // 기한 덩어리는 nowrap, 되돌리면 기한도 취소선을 받는다(스타일). 문구·지움 줄 제외는 aiChatMemoryLine.test.tsx 가 본다.
  test('기한 덩어리는 nowrap 이고 되돌리면 기한도 취소선이다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
    await page.clock.setFixedTime(new Date('2026-10-14T03:00:00Z'))
    await mockMemoryUndo(page)
    const live = await setupLiveChat(page)
    live.queueStart({ correlationId: 'corr-a', sessionId: 's-a' })
    await openChatPanel(page)
    await ask(page, live, '이번 주는 결제 모듈만 볼 거야')
    await memoryTool(live, 1, 'remember_memory', { ...saved, content: '이번 주는 결제 모듈 집중', scope: 'ISSUE', expiresOn: '2026-10-24' })
    await live.push('delta', { ...C, text: '기억할게요.' })
    await live.push('done', { ...C, widgets: null, messageId: 5 })

    await expect(lines(page).nth(0).getByTestId('chat-memory-expiry')).toHaveCSS('white-space', 'nowrap')
    await lines(page).nth(0).getByTestId('chat-memory-undo').click()
    await expect(lines(page).nth(0)).toHaveAttribute('data-undone', 'true')
    await expect(lines(page).nth(0).getByTestId('chat-memory-expiry').locator('..')).toHaveCSS('text-decoration-line', 'line-through')
  })
})
