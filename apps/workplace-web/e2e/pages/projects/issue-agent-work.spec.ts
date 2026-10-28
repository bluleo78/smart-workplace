// 이슈 상세 AI 진행(WP-377·WP-1079) E2E — 제목 아래 「AI 진행」 칸의 자리·한 줄 표시.
// 브라우저가 있어야 판정되는 기하만 남긴다(@layout) — 칸이 제목 아래·AI 현황 요약 위에 서고, 작업자 행이 한 줄이며
// 긴 최근 보고는 말줄임, 답해야 하는 질문은 자르지 않는지.
// 행의 서버 순서·상태 배지·진행률·마지막 보고 문구, 작업 없음·인증 필요·시작 전·다음 회차 대기, 「답변 필요」 → ?chat=1 + 드로워는
// 페이지 테스트 src/pages/projects/issueAgentWork.test.tsx 가 지킨다(WP-980).
import { agentWorker as aki, createAgentWork, humanWorker as human, twoWorks } from '../../factories/agentWork.factory'
import { mockAgentWorkDetail } from '../../fixtures/issue-detail-mock'
import { expect, test } from '../../fixtures/auth.fixture'
import { boxOf } from '../../fixtures/layout'

const URL = '/projects/WP/issues/12'

test('AI 진행 칸은 제목 아래·AI 현황 요약 위에 서고, 작업자 행은 한 줄이다', { tag: ['@layout', '@smoke'] }, async ({ authenticatedPage: page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await mockAgentWorkDetail(page, twoWorks('A안/B안 중 어느 쪽으로 진행할까요?'), { assignees: [human, aki] })
  await page.goto(URL)

  const card = page.getByTestId('agent-work-card')
  await expect(card).toBeVisible()
  const title = await boxOf(page.getByTestId('issue-title-heading'))
  const cardBox = await boxOf(card)
  const summary = await boxOf(page.getByTestId('issue-instant-context'))
  expect(cardBox.y).toBeGreaterThanOrEqual(title.y + title.height)
  expect(cardBox.y + cardBox.height).toBeLessThanOrEqual(summary.y)
  // 속성 레일에는 더 이상 AI 진행이 없다.
  await expect(page.getByTestId('property-rail').getByText('AI 진행')).toHaveCount(0)

  // 작업자 행은 한 줄(아바타 높이 근처) — 마지막 보고도 행 안 오른쪽 끝에 한 줄로.
  const row = card.getByTestId('agent-work-1')
  const rowBox = await boxOf(row)
  expect(rowBox.height).toBeLessThanOrEqual(32)
  const last = await boxOf(row.getByTestId('agent-work-1-last'))
  expect(last.height).toBeLessThanOrEqual(20)
  expect(last.x + last.width).toBeLessThanOrEqual(rowBox.x + rowBox.width + 0.5)
})

test('긴 최근 보고는 한 줄 말줄임(마우스 올리면 전체), 답해야 하는 질문은 자르지 않는다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  const longNote = '테스트 DB 를 공용으로 쓸지 이슈별로 따로 띄울지 정해야 해요. 공용이면 마이그레이션 충돌을 조심해야 하고, 이슈별이면 기동 시간이 늘어나요. 어느 쪽으로 할까요? 결정해 주시면 바로 이어서 진행할게요.'
  await mockAgentWorkDetail(page, [
    createAgentWork({ worker: aki, state: 'INPUT_REQUIRED', note: longNote }),
    createAgentWork({ worker: human, state: 'WORKING', note: longNote }),
  ], { assignees: [human, aki] })
  await page.goto(URL)

  const question = page.getByTestId('agent-work-9').getByText(longNote)
  await expect(question).toBeVisible()
  expect(await question.evaluate((el) => el.scrollWidth <= el.clientWidth && el.scrollHeight <= el.clientHeight + 1)).toBe(true)
  const note = page.getByTestId('agent-work-1').getByText(longNote)
  expect(await note.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true)
  await expect(note).toHaveAttribute('title', longNote)
})
