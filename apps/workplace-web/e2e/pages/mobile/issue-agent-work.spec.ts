// 모바일 이슈 상세 AI 진행(WP-377·WP-1079) — 속성 칩 줄 아래 「AI 진행」 칸(작업자마다 [이름·상태 … 시간] / 최근 보고).
// 브라우저가 있어야 판정되는 위치·줄바꿈·잘림(@layout)만 남긴다. 작업자 순서·상태 문구·「답변 필요」 → ?chat=1 드로워는
// 페이지 테스트 src/pages/mobile/mobileIssueAgentWork.test.tsx 가 지킨다(WP-981).
import { agentWorker as aki, createAgentWork, humanWorker as human, twoWorks } from '../../factories/agentWork.factory'
import { mockAgentWorkDetail } from '../../fixtures/issue-detail-mock'
import { boxOf } from '../../fixtures/layout'
import { expect, expectNoHorizontalOverflow, stubChat, test } from '../../fixtures/mobile.fixture'

test('AI 진행 칸은 속성 칩 줄 아래 서버 순서로 놓이고 가로로 넘치지 않는다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  await stubChat(page)
  await mockAgentWorkDetail(page, twoWorks('테스트 DB 를 공용으로 쓸까요, 이슈별로 따로 띄울까요?'), { assignees: [human, aki] })
  await page.goto('/projects/WP/issues/12')

  const card = page.getByTestId('agent-work-card')
  await expect(card).toBeVisible()
  const props = await boxOf(page.getByTestId('mobile-prop-chips'))
  const cardBox = await boxOf(card)
  expect(cardBox.y).toBeGreaterThanOrEqual(props.y + props.height)
  // 서버 순서 그대로(아키 먼저) — 위에서 아래로 쌓인다.
  expect((await boxOf(card.getByTestId('agent-work-9'))).y).toBeLessThan((await boxOf(card.getByTestId('agent-work-1'))).y)
  // 마지막 보고는 첫 줄 오른쪽 끝, 한 줄로 칸 안에 든다.
  const last = await boxOf(card.getByTestId('agent-work-1-last'))
  expect(last.height).toBeLessThanOrEqual(20)
  expect(last.x + last.width).toBeLessThanOrEqual(cardBox.x + cardBox.width)
  await expectNoHorizontalOverflow(page)
})

test('질문은 터치 화면에서 자르지 않고, 다른 최근 보고는 두 줄까지 보인다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  // 터치에는 마우스 올리기(title)가 없으므로 답해야 하는 질문은 전부 보여야 한다.
  const longNote = '테스트 DB 를 공용으로 쓸지 이슈별로 따로 띄울지 정해야 해요. 공용이면 마이그레이션 충돌을 조심해야 하고, 이슈별이면 기동 시간이 늘어나요. 어느 쪽으로 할까요?'
  await stubChat(page)
  await mockAgentWorkDetail(page, [
    createAgentWork({ worker: aki, state: 'INPUT_REQUIRED', note: longNote }),
    createAgentWork({ worker: human, state: 'WORKING', note: longNote }),
  ], { assignees: [human, aki] })
  await page.goto('/projects/WP/issues/12')

  const question = page.getByTestId('agent-work-9').getByText(longNote)
  await expect(question).toBeVisible()
  expect(await question.evaluate((el) => el.scrollHeight <= el.clientHeight + 1)).toBe(true)
  const note = page.getByTestId('agent-work-1').getByText(longNote)
  expect(await note.evaluate((el) => el.scrollHeight > el.clientHeight + 1)).toBe(true)
  await expectNoHorizontalOverflow(page)
})
