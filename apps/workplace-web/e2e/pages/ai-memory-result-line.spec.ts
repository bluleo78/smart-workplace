// WP-55 채팅 메모리 결과 줄(데스크톱) — 답 아래·후속 질문 위, done 전 되돌리기 비활성, 줄마다 되돌리기, 실패 토스트 3종, 위임 답 순번,
// 긴 문구 줄바꿈. WP-380: 기한 덩어리. 오류·■ 정지 턴의 messageId(chatStreams.test.ts)·이력 복원(chatTurns.test.ts)은 단위 테스트가 담당.
import type { Page } from '@playwright/test'

import { ask, msg, openChatPanel, sessionItem, setupLiveChat, summary, TITLE_A, TITLE_B } from '../fixtures/ai-live-chat'
import { memoryError, memoryTool, mockMemoryUndo } from '../fixtures/ai-memory-mock'
import { mockAiPreferences } from '../fixtures/ai-suggestions-mock'
import { expect, test } from '../fixtures/auth.fixture'
import { gate, stableBox } from '../fixtures/wait'
import type { MemoryBlock } from '../../src/types/home'

const C = { correlationId: 'corr-a', sessionId: 's-a' }
const lines = (page: Page) => page.getByTestId('chat-memory-result')
const undoLinks = (page: Page) => page.getByTestId('chat-memory-undo')

const saved = { action: 'saved', memoryId: 12, kind: 'PREFERENCE', content: '이슈 목록은 짧은 목록으로 보여 준다', source: 'AI' }
const updated = { action: 'updated', memoryId: 9, kind: 'CONTEXT', content: '백엔드 팀이다', previousContent: '프론트 팀이다', source: 'AI' }
const forgotten = { action: 'forgotten', memoryId: 7, kind: 'PREFERENCE', content: '표로 보여 준다', source: 'USER' }

test('저장 결과 줄이 답 아래·후속 질문 위에 보이고, done 전엔 되돌리기가 꺼져 있다가 누르면 되돌림으로 바뀐다', { tag: '@smoke' }, async ({ authenticatedPage: page }) => {
  const undo = await mockMemoryUndo(page)
  const live = await setupLiveChat(page)
  live.queueStart({ correlationId: 'corr-a', sessionId: 's-a' })
  await openChatPanel(page)
  await ask(page, live, '앞으로는 이슈 목록을 짧은 목록으로 보여줘')
  await live.push('delta', { ...C, text: '알겠어요. 앞으로 짧은 목록으로 보여 드릴게요.' })
  await memoryTool(live, 1, 'mcp__workplace__remember_memory', saved)

  await expect(lines(page)).toHaveCount(1)
  await expect(lines(page)).toContainText('메모리에 저장함: "이슈 목록은 짧은 목록으로 보여 준다" · 되돌리기')
  await expect(undoLinks(page)).toBeDisabled() // done 전 — 메시지 id 없음
  await expect(page.getByTestId('chat-block-tools')).toHaveCount(0) // 도구 단계 목록에는 없다

  await live.push('done', { ...C, widgets: null, messageId: 2 })
  await live.push('followups', { ...C, messageId: 2, items: ['내 이슈 보여줘'] })
  await expect(undoLinks(page)).toBeEnabled()
  // 되돌리기는 평소에도 링크로 보인다(밑줄 + primary 색, hover 아님) — 터치엔 hover 가 없다. " · 되돌리기" 는 한 덩어리(nowrap)라 "·" 가 줄 끝에 남지 않는다.
  await expect(undoLinks(page)).toHaveCSS('text-decoration-line', 'underline')
  await expect(undoLinks(page).locator('..')).toHaveCSS('white-space', 'nowrap')
  const bubble = await stableBox(page.getByTestId('chat-block').last())
  const line = await stableBox(lines(page).first())
  const followups = await stableBox(page.getByTestId('chat-followups'))
  expect(line.y).toBeGreaterThan(bubble.y + bubble.height - 1)
  expect(followups.y).toBeGreaterThan(line.y + line.height - 1)

  await undoLinks(page).click()
  await undo.waitFor()
  expect(undo.lastBody()).toEqual({ messageId: 2, blockIndex: 0 })
  await expect(lines(page).first()).toHaveAttribute('data-undone', 'true')
  await expect(lines(page).first()).toContainText('· 되돌림')
  await expect(undoLinks(page)).toHaveCount(0)
})

test('여러 줄은 동작별로 생기고 줄마다 따로 되돌린다', async ({ authenticatedPage: page }) => {
  const undo = await mockMemoryUndo(page)
  const live = await setupLiveChat(page)
  live.queueStart({ correlationId: 'corr-a', sessionId: 's-a' })
  await openChatPanel(page)
  await ask(page, live, '정리해줘')
  await memoryTool(live, 1, 'remember_memory', saved)
  await memoryTool(live, 2, 'update_memory', updated)
  await memoryTool(live, 3, 'workplace_forget_memory', forgotten)
  await live.push('delta', { ...C, text: '세 가지를 정리했어요.' })
  await live.push('done', { ...C, widgets: null, messageId: 5 })

  // 동작별 문구 규칙(저장함·고침·지움·범위 이름)은 aiMemory 단위 테스트(memoryActionText)가 맡는다(WP-412) — 여기선 줄이 동작대로 생기는지만 본다.
  await expect(lines(page)).toHaveCount(3)
  // WP-581: 답보다 먼저 기억한 줄은 흐름에 끼지 않고 답 아래에 둔다.
  await expectStacked(page.getByTestId('chat-block').last(), lines(page).first())
  await expect(lines(page).nth(0)).toHaveAttribute('data-action', 'saved')
  await expect(lines(page).nth(1)).toHaveAttribute('data-action', 'updated')
  await expect(lines(page).nth(2)).toHaveAttribute('data-action', 'forgotten')

  await lines(page).nth(1).getByTestId('chat-memory-undo').click()
  await undo.waitFor()
  expect(undo.lastBody()).toEqual({ messageId: 5, blockIndex: 1 })
  await expect(lines(page).nth(1)).toHaveAttribute('data-undone', 'true')
  await expect(lines(page).nth(0)).toHaveAttribute('data-undone', 'false')
  await expect(lines(page).nth(2)).toHaveAttribute('data-undone', 'false')
})

// 패널이 되돌리기 뮤테이션 하나를 공유해도 진행 중 표시는 줄마다 따로다 — 둘째 줄을 빨리 눌러도 첫 줄의 요청 중 잠금이 풀리지 않는다.
test('응답 전에 다른 줄을 눌러도 앞 줄은 요청이 끝날 때까지 잠겨 있다', async ({ authenticatedPage: page }) => {
  const held = gate()
  const undo = await mockMemoryUndo(page, [], held.p)
  const live = await setupLiveChat(page)
  live.queueStart({ correlationId: 'corr-a', sessionId: 's-a' })
  await openChatPanel(page)
  await ask(page, live, '정리해줘')
  await memoryTool(live, 1, 'remember_memory', saved)
  await memoryTool(live, 2, 'update_memory', updated)
  await live.push('delta', { ...C, text: '정리했어요.' })
  await live.push('done', { ...C, widgets: null, messageId: 5 })

  const first = lines(page).nth(0).getByTestId('chat-memory-undo')
  const second = lines(page).nth(1).getByTestId('chat-memory-undo')
  await first.click()
  await expect(first).toBeDisabled()
  await expect(second).toBeEnabled() // 다른 줄은 따로 누를 수 있다
  await second.click()
  await expect(second).toBeDisabled()
  await expect(first).toBeDisabled() // 둘째 요청이 첫 줄의 진행 중 표시를 지우지 않는다
  await expect.poll(() => undo.count()).toBe(2)

  held.release()
  await expect(lines(page).nth(0)).toHaveAttribute('data-undone', 'true')
  await expect(lines(page).nth(1)).toHaveAttribute('data-undone', 'true')
})

test('이미 지워진 메모리·가득 참이면 안내 토스트를 띄우고 줄은 그대로 둔다 — 가득 참은 설정으로 이동할 수 있다', async ({ authenticatedPage: page }) => {
  await mockMemoryUndo(page, [memoryError(404, 'AI_MEMORY_GONE'), memoryError(409, 'AI_MEMORY_FULL')])
  const live = await setupLiveChat(page)
  live.queueStart({ correlationId: 'corr-a', sessionId: 's-a' })
  await openChatPanel(page)
  await ask(page, live, '정리해줘')
  await memoryTool(live, 1, 'update_memory', updated)
  await memoryTool(live, 2, 'forget_memory', forgotten)
  await live.push('delta', { ...C, text: '정리했어요.' })
  await live.push('done', { ...C, widgets: null, messageId: 5 })

  await lines(page).nth(0).getByTestId('chat-memory-undo').click()
  await expect(page.getByText('이미 지워진 메모리예요')).toBeVisible()
  await expect(lines(page).nth(0)).toHaveAttribute('data-undone', 'false')

  await lines(page).nth(1).getByTestId('chat-memory-undo').click()
  await expect(page.getByText('메모리가 가득 찼어요. 설정에서 정리해 주세요')).toBeVisible()
  await expect(lines(page).nth(1)).toHaveAttribute('data-undone', 'false')
  // 에러 토스트는 fixture 가 포인터를 통과시킨다 — 토스트 안의 action 버튼을 누르려면 그 규칙을 먼저 걷어낸다.
  await page.evaluate(() => document.querySelector('style[data-test-toast-passthrough]')?.remove())
  await page.getByRole('button', { name: '설정 열기' }).click()
  await expect(page).toHaveURL(/\/settings\/assistant$/)
})

// CR4: 고친 뒤 또 바뀐 메모리는 서버가 덮지 않고 409 CHANGED 로 거절한다 — 안내 토스트를 띄우고 줄은 되돌리지 않은 채(다시 누를 수 있게) 둔다.
test('고친 뒤 또 바뀐 메모리면 안내 토스트를 띄우고 줄은 그대로 둔다', async ({ authenticatedPage: page }) => {
  const undo = await mockMemoryUndo(page, [memoryError(409, 'AI_MEMORY_CHANGED')])
  const live = await setupLiveChat(page)
  live.queueStart({ correlationId: 'corr-a', sessionId: 's-a' })
  await openChatPanel(page)
  await ask(page, live, '팀 바꿔줘')
  await memoryTool(live, 1, 'update_memory', { ...updated, previousKind: 'PREFERENCE' })
  await live.push('delta', { ...C, text: '고쳤어요.' })
  await live.push('done', { ...C, widgets: null, messageId: 5 })

  await undoLinks(page).click()
  await undo.waitFor()
  await expect(page.getByText('그 뒤에 바뀐 메모리라 되돌리지 않았어요')).toBeVisible()
  await expect(lines(page).first()).toHaveAttribute('data-undone', 'false')
  await expect(undoLinks(page)).toBeEnabled()
})

// Review Focus 5: 추천을 끈 사용자(followups 없음)도 done 의 messageId 로 되돌리기가 켜지고, 위임 답(안내 문장이 버려지는 턴)에서도 순번 0 이다.
test('추천을 꺼도 done 뒤 되돌리기가 켜지고 위임 답에서도 순번이 맞다', async ({ authenticatedPage: page }) => {
  await mockAiPreferences(page, false)
  const undo = await mockMemoryUndo(page)
  const live = await setupLiveChat(page)
  live.queueStart({ correlationId: 'corr-a', sessionId: 's-a' })
  await openChatPanel(page)
  await ask(page, live, '앞으로 이슈는 짧게, 그리고 WP-1 닫아줘')
  await live.push('progress', { ...C, label: '이슈 전문가에게 위임 중' })
  await live.push('delta', { ...C, text: '확인해 볼게요. ' })
  await memoryTool(live, 1, 'remember_memory', saved)
  await live.push('delta', { ...C, text: 'WP-1 을 닫았어요.' })
  await live.push('done', { ...C, widgets: null, messageId: 8 })

  await expect(undoLinks(page)).toBeEnabled()
  await undoLinks(page).click()
  await undo.waitFor()
  expect(undo.lastBody()).toEqual({ messageId: 8, blockIndex: 0 })
})

test('긴 메모리 문구는 줄바꿈되어 패널 밖으로 넘치지 않는다', async ({ authenticatedPage: page }) => {
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

// WP-379: 앱 범위 결과는 범위 이름을 붙인 문구로, 공통은 WP-55 문구 그대로. 되돌리기 가득 참은 서버가 알려 준 범위로 안내한다.
test('앱 범위 결과 줄은 "이슈 메모리에 저장함" 이고, 되돌리기 가득 참은 그 범위 이름으로 안내한다', async ({ authenticatedPage: page }) => {
  await mockMemoryUndo(page, [memoryError(409, 'AI_MEMORY_FULL', '오류', { scope: 'MAIL' })])
  const live = await setupLiveChat(page)
  live.queueStart({ correlationId: 'corr-a', sessionId: 's-a' })
  await openChatPanel(page)
  await ask(page, live, '정리해줘')
  await memoryTool(live, 1, 'remember_memory', { ...saved, scope: 'ISSUE' })
  await memoryTool(live, 2, 'update_memory', { ...updated, scope: null, previousScope: 'ISSUE' })
  await memoryTool(live, 3, 'forget_memory', { ...forgotten, scope: 'MAIL' })
  await live.push('delta', { ...C, text: '정리했어요.' })
  await live.push('done', { ...C, widgets: null, messageId: 5 })

  await expect(lines(page).nth(0)).toContainText('이슈 메모리에 저장함: "이슈 목록은 짧은 목록으로 보여 준다"')
  await expect(lines(page).nth(1)).toContainText('메모리를 고침: "백엔드 팀이다"')
  await expect(lines(page).nth(2)).toContainText('메일 메모리에서 지움: "표로 보여 준다"')

  await lines(page).nth(2).getByTestId('chat-memory-undo').click()
  await expect(page.getByText('메일 메모리가 가득 찼어요. 설정에서 정리해 주세요')).toBeVisible()
  await expect(lines(page).nth(2)).toHaveAttribute('data-undone', 'false')
})

/** 이벤트의 memory → 이력 블록(서버 ChatBlockRecorder.Memory 모양 — 메모리 종류는 memoryKind). at 은 앞에 오는 표시 블록 수. */
const historyBlock = (m: Record<string, unknown>, at?: number) =>
  ({ ...m, kind: 'memory', memoryKind: m.kind, undone: false, ...(at === undefined ? {} : { at }) }) as unknown as MemoryBlock

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

// WP-581: 결과 줄은 도착한 자리에 들어간다 — 뒤이은 도구 호출은 결과 줄 앞 도구 그룹에 이어 붙지 않고 결과 줄 아래 새 그룹으로 시작한다.
test('메모리 결과 줄 뒤의 도구 호출은 결과 줄 아래 새 단계 묶음으로 보인다', async ({ authenticatedPage: page }) => {
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

  // 답변 전(본문 없음)에도 결과 줄이 제자리에 보인다.
  const groups = page.getByTestId('chat-block-tools')
  await expect(groups).toHaveCount(2)
  await expect(groups.nth(0)).toContainText('노트 수정')
  await expect(groups.nth(0)).not.toContainText('노트 이동')
  await expect(groups.nth(1)).toContainText('노트 이동')
  await expect(groups.nth(1)).toContainText('노트 목록')
  await expect(lines(page)).toHaveCount(1)
  await expectStacked(groups.nth(0), lines(page), groups.nth(1))
  // 끊겨 이어지는 그룹도 위임 아래로 들여 쓴다 — 앞 그룹의 도구와 같은 들여쓰기.
  const indent = (l: ReturnType<Page['getByTestId']>) => l.getByTestId('tool-step-tool').first().evaluate((e) => getComputedStyle(e).paddingLeft)
  expect(await indent(groups.nth(1))).toBe(await indent(groups.nth(0)))
  expect(await indent(groups.nth(1))).not.toBe('0px')

  await live.push('delta', { ...C, text: '노트를 정리했어요.' })
  await live.push('done', { ...C, widgets: null, messageId: 5 })
  await expectStacked(groups.nth(1), page.getByTestId('chat-block').last())
  // 흐름 안에 그렸으니 답 아래에 한 번 더 그리지 않는다.
  await expect(page.getByTestId('chat-memory-results')).toHaveCount(1)
  await expect(undoLinks(page)).toBeEnabled()
})

test('이력의 결과 줄은 저장된 자리(at)에 복원되고, 자리가 없는 구 이력은 답 아래에 모인다', async ({ authenticatedPage: page }) => {
  const undo = await mockMemoryUndo(page)
  const live = await setupLiveChat(page)
  live.setSessions([summary('s-a', TITLE_A, 1), summary('s-b', TITLE_B, 1)])
  const steps = ['get_wiki_page', 'move_wiki_page'].map((toolName, k) => ({ kind: 'tool' as const, seq: k + 1, toolName, status: 'done' as const }))
  live.setMessages('s-a', [
    msg(1, 'USER', TITLE_A),
    {
      ...msg(2, 'ASSISTANT', '노트를 정리했어요.'),
      toolCalls: steps,
      contentBlocks: [{ kind: 'tools', stepStart: 0 }, { kind: 'tools', stepStart: 1 }, { kind: 'text', textStart: 0 }],
      memoryBlocks: [historyBlock(saved, 1), historyBlock(updated, 1)],
    },
  ])
  live.setMessages('s-b', [
    msg(1, 'USER', TITLE_B),
    {
      ...msg(2, 'ASSISTANT', '기억했어요.'),
      toolCalls: steps.slice(0, 1),
      contentBlocks: [{ kind: 'tools', stepStart: 0 }, { kind: 'text', textStart: 0 }],
      memoryBlocks: [historyBlock(saved)],
    },
  ])
  await openChatPanel(page)
  await page.getByTestId('chat-session-switcher').click()
  await sessionItem(page, TITLE_A).getByTestId('chat-session-select').click()

  const groups = page.getByTestId('chat-block-tools')
  await expect(lines(page)).toHaveCount(2)
  await expect(page.getByTestId('chat-memory-results')).toHaveCount(1) // 같은 자리의 연속 줄은 한 묶음
  await expectStacked(groups.nth(0), page.getByTestId('chat-memory-results'), groups.nth(1), page.getByTestId('chat-block').last())
  // 되돌리기 순번은 끼운 자리와 상관없이 memoryBlocks 원본 순번이다.
  await lines(page).nth(1).getByTestId('chat-memory-undo').click()
  await undo.waitFor()
  expect(undo.lastBody()).toEqual({ messageId: 2, blockIndex: 1 })

  await page.getByTestId('chat-session-switcher').click()
  await sessionItem(page, TITLE_B).getByTestId('chat-session-select').click()
  await expect(page.getByText('기억했어요.')).toBeVisible()
  await expect(lines(page)).toHaveCount(1)
  await expectStacked(page.getByTestId('chat-block').last(), lines(page))
})

test.describe('기한 (WP-380)', () => {
  test.use({ timezoneId: 'Asia/Seoul' })

  test('기한 있는 결과 줄은 " · 10월 24일까지", 지움 줄엔 없고, 되돌리면 기한도 취소선이다', async ({ authenticatedPage: page }) => {
    await page.clock.setFixedTime(new Date('2026-10-14T03:00:00Z'))
    await mockMemoryUndo(page)
    const live = await setupLiveChat(page)
    live.queueStart({ correlationId: 'corr-a', sessionId: 's-a' })
    await openChatPanel(page)
    await ask(page, live, '이번 주는 결제 모듈만 볼 거야')
    await memoryTool(live, 1, 'remember_memory', { ...saved, content: '이번 주는 결제 모듈 집중', scope: 'ISSUE', expiresOn: '2026-10-24' })
    await memoryTool(live, 2, 'forget_memory', { ...forgotten, expiresOn: '2026-10-20' })
    await live.push('delta', { ...C, text: '기억할게요.' })
    await live.push('done', { ...C, widgets: null, messageId: 5 })

    await expect(lines(page).nth(0)).toContainText('이슈 메모리에 저장함: "이번 주는 결제 모듈 집중" · 10월 24일까지 · 되돌리기')
    await expect(lines(page).nth(0).getByTestId('chat-memory-expiry')).toHaveCSS('white-space', 'nowrap')
    await expect(lines(page).nth(1).getByTestId('chat-memory-expiry')).toHaveCount(0)

    await lines(page).nth(0).getByTestId('chat-memory-undo').click()
    await expect(lines(page).nth(0)).toHaveAttribute('data-undone', 'true')
    await expect(lines(page).nth(0).getByTestId('chat-memory-expiry').locator('..')).toHaveCSS('text-decoration-line', 'line-through')
  })
})

// WP-386 공용 메모리 결과 줄 — 「{공간} 공용 메모리에 기억했어요: "…" · 되돌리기」, 같은 되돌리기 경로(blockIndex), 409 두 종 안내.
const shared = { action: 'shared' as const, changeId: 41, memoryId: 9, spaceName: 'Smart Workplace(WP)', content: '배포는 API 먼저 한다' }

test('공용 저장 결과 줄이 공간 이름과 함께 보이고 같은 경로로 되돌린다', async ({ authenticatedPage: page }) => {
  const undo = await mockMemoryUndo(page)
  const live = await setupLiveChat(page)
  live.queueStart({ correlationId: 'corr-a', sessionId: 's-a' })
  await openChatPanel(page)
  await ask(page, live, '이건 팀 규칙으로 기억해')
  await memoryTool(live, 1, 'mcp__workplace__remember_memory', saved)
  await memoryTool(live, 2, 'mcp__workplace__remember_shared_memory', shared)
  await live.push('done', { ...C, widgets: null, messageId: 8 })
  await expect(lines(page)).toHaveCount(2)
  await expect(lines(page).nth(1)).toHaveAttribute('data-action', 'shared')
  await expect(lines(page).nth(1)).toContainText('Smart Workplace(WP) 공용 메모리에 기억했어요: "배포는 API 먼저 한다" · 되돌리기')
  await lines(page).nth(1).getByTestId('chat-memory-undo').click()
  await undo.waitFor()
  expect(undo.lastBody()).toEqual({ messageId: 8, blockIndex: 1 })
  await expect(lines(page).nth(1)).toHaveAttribute('data-undone', 'true')
})

test('공용 결과 줄 되돌리기가 그 뒤 바뀜·이미 되돌림이면 안내한다', async ({ authenticatedPage: page }) => {
  await mockMemoryUndo(page, [memoryError(409, 'SHARED_MEMORY_CHANGED'), memoryError(409, 'SHARED_MEMORY_CHANGE_UNDONE')])
  const live = await setupLiveChat(page)
  live.queueStart({ correlationId: 'corr-a', sessionId: 's-a' })
  await openChatPanel(page)
  await ask(page, live, '기억해')
  await memoryTool(live, 1, 'remember_shared_memory', shared)
  await live.push('done', { ...C, widgets: null, messageId: 8 })
  await undoLinks(page).click()
  await expect(page.getByText('그 뒤에 메모리가 바뀌어 되돌릴 수 없어요')).toBeVisible()
  await expect(lines(page)).toHaveAttribute('data-undone', 'false')
  await undoLinks(page).click()
  await expect(page.getByText('이미 되돌린 기록이에요')).toBeVisible()
})

// 최종 리뷰 T17·M5: 권한이 없으면(403) 안내하고, 기록이 사라진 뒤(보관 기간·프로젝트 삭제 → 404)에도 안내하며, 어느 쪽이든 줄은 되돌리지 않은 채 둔다.
test('공용 결과 줄 되돌리기가 권한 없음(403)·기록 사라짐(404)이면 안내하고 줄은 그대로 둔다', async ({ authenticatedPage: page }) => {
  const undo = await mockMemoryUndo(page, [memoryError(403, 'SHARED_MEMORY_FORBIDDEN'), memoryError(404, 'SHARED_MEMORY_NOT_FOUND')])
  const live = await setupLiveChat(page)
  live.queueStart({ correlationId: 'corr-a', sessionId: 's-a' })
  await openChatPanel(page)
  await ask(page, live, '기억해')
  await memoryTool(live, 1, 'remember_shared_memory', shared)
  await live.push('done', { ...C, widgets: null, messageId: 8 })
  await undoLinks(page).click()
  await undo.waitFor()
  await expect(page.getByText('되돌릴 권한이 없어요')).toBeVisible()
  await expect(lines(page)).toHaveAttribute('data-undone', 'false')
  await expect(undoLinks(page)).toBeEnabled()
  await undoLinks(page).click()
  await expect(page.getByText('이 기록은 더 이상 되돌릴 수 없어요')).toBeVisible()
  await expect(lines(page)).toHaveAttribute('data-undone', 'false')
})

test('이력의 공용 결과 줄도 복원된다', async ({ authenticatedPage: page }) => {
  const live = await setupLiveChat(page)
  live.setSessions([summary('s-a', TITLE_A, 1)])
  live.setMessages('s-a', [
    msg(1, 'USER', TITLE_A),
    {
      ...msg(2, 'ASSISTANT', '기억했어요.'),
      contentBlocks: [{ kind: 'text', textStart: 0 }],
      memoryBlocks: [{ kind: 'memory', ...shared, undone: true }],
    },
  ])
  await openChatPanel(page)
  await page.getByTestId('chat-session-switcher').click()
  await sessionItem(page, TITLE_A).getByTestId('chat-session-select').click()
  await expect(lines(page)).toContainText('Smart Workplace(WP) 공용 메모리에 기억했어요')
  await expect(lines(page)).toHaveAttribute('data-undone', 'true')
})

// 그릴 수 있는 줄이 하나도 없으면(깨진 공용 줄뿐) 빈 래퍼(여백)도 내지 않고, 하나라도 있으면 래퍼를 낸다.
test('깨진 공용 줄뿐이면 결과 줄 래퍼를 그리지 않고, 정상 줄이 섞이면 그 줄만 그린다', async ({ authenticatedPage: page }) => {
  const live = await setupLiveChat(page)
  live.setSessions([summary('s-a', TITLE_A, 1), summary('s-b', TITLE_B, 2)])
  const broken = { kind: 'memory' as const, action: 'shared' as const, changeId: 0, memoryId: 9, spaceName: '', content: '', undone: false }
  live.setMessages('s-a', [msg(1, 'USER', TITLE_A), { ...msg(2, 'ASSISTANT', '기억했어요.'), contentBlocks: [{ kind: 'text', textStart: 0 }], memoryBlocks: [broken, broken] }])
  live.setMessages('s-b', [msg(1, 'USER', TITLE_B), { ...msg(2, 'ASSISTANT', '기억했어요.'), contentBlocks: [{ kind: 'text', textStart: 0 }], memoryBlocks: [broken, { kind: 'memory' as const, ...shared, undone: false }] }])
  await openChatPanel(page)
  await page.getByTestId('chat-session-switcher').click()
  await sessionItem(page, TITLE_A).getByTestId('chat-session-select').click()
  await expect(page.getByText('기억했어요.')).toBeVisible()
  await expect(page.getByTestId('chat-memory-results')).toHaveCount(0)

  await page.getByTestId('chat-session-switcher').click()
  await sessionItem(page, TITLE_B).getByTestId('chat-session-select').click()
  await expect(page.getByTestId('chat-memory-results')).toHaveCount(1)
  await expect(lines(page)).toHaveCount(1) // 깨진 줄(순번 0)은 빠지고 정상 줄(순번 1)만
})
