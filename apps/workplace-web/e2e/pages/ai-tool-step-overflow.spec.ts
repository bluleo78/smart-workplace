// WP-1050 AI 채팅 도구 줄 넘침 E2E(@layout) — 위임 아래 도구 줄의 설명이 길어도 대화 영역에 가로 스크롤이 생기지 않고,
// 도구 이름은 한 줄로 남은 채 설명만 … 로 잘린다. 폭·넘침·줄바꿈은 jsdom 이 잴 수 없어 브라우저로 본다.
import { ask, openChatPanel, setupLiveChat } from '../fixtures/ai-live-chat'
import { expect, test } from '../fixtures/auth.fixture'
import { stableBox } from '../fixtures/wait'

const C = { correlationId: 'corr-a', sessionId: 's-a' }
const longTitle = '작업 관리에서 저장한 뷰를 바꿀 때 이전 목록이나 필터 칩이 잠깐 보였다가 새 결과로 바뀌며 화면이 깜빡이는 결함을 고친다 '.repeat(3)

test('긴 설명이 붙은 도구 줄도 대화 영역을 넘치지 않고, 이름은 한 줄·설명은 … 로 잘린다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  const live = await setupLiveChat(page)
  live.queueStart(C)
  await openChatPanel(page)
  await ask(page, live, 'WP-1049 제목 고쳐줘')
  await live.push('progress', { ...C, label: '이슈 전문가에게 위임 중' })
  await live.push('tool', { ...C, seq: 1, phase: 'start', toolName: 'mcp__workplace__update_issue', args: { issueKey: 'WP-1049', title: longTitle } })

  const step = page.getByTestId('tool-step-tool').first()
  await expect(step).toContainText('이슈 수정')
  // 대화 영역에 가로 스크롤이 없다 — 래퍼(min-w-0)·도구 상자(max-w-full)가 패널 폭을 넘지 않는다.
  const scroll = page.getByTestId('chat-scroll')
  await expect.poll(() => scroll.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0)
  // 설명은 답변 래퍼(chat-widgets) 안에서 끝나고, 잘린다(… — 내용 폭이 보이는 폭보다 넓다).
  const detail = step.getByText(/^WP-1049 · /)
  const wrapper = await stableBox(page.getByTestId('chat-widgets').last())
  const detailBox = await stableBox(detail)
  expect(detailBox.x + detailBox.width).toBeLessThanOrEqual(wrapper.x + wrapper.width + 0.5)
  expect(await detail.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true)

  // 도구 이름은 한 줄 — 높이가 글자 크기 두 배보다 작다(「이슈 수 / 정」처럼 꺾이면 줄 수만큼 커진다).
  const label = step.getByText('이슈 수정', { exact: true })
  const ratio = await label.evaluate((el) => el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).fontSize))
  expect(ratio).toBeLessThan(2)
})
