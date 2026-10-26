// 이슈 상세 AI 진행(WP-377) E2E — 레일 「AI 진행」 섹션과 답변 필요 질문 카드의 자리·한 줄 표시.
// 브라우저가 있어야 판정되는 기하만 남긴다(@layout) — 레일이 담당자 아래·보고자 위에 서고, 마지막 보고가 한 줄이며 에이전트 유형이
// 말줄임 없이 보이는지, 질문 카드가 제목 아래·AI 현황 요약 위에 서는지.
// 행의 서버 순서·상태 배지·진행률·마지막 보고 문구, 작업 없음·인증 필요·시작 전·다음 회차 대기, 「채팅에서 답하기」(?chat=1 + 드로워)는
// 페이지 테스트 src/pages/projects/issueAgentWork.test.tsx 가 지킨다(WP-980).
import { agentWorker as aki, humanWorker as human, twoWorks } from '../../factories/agentWork.factory'
import { mockAgentWorkDetail } from '../../fixtures/issue-detail-mock'
import { expect, test } from '../../fixtures/auth.fixture'
import { boxOf } from '../../fixtures/layout'

const URL = '/projects/WP/issues/12'

test('레일 AI 진행은 담당자 아래·보고자 위에 서고, 마지막 보고는 한 줄·에이전트 유형은 말줄임 없이 보인다', { tag: ['@layout', '@smoke'] }, async ({ authenticatedPage: page }) => {
  // 1440 — 레일이 본문 옆(280px)으로 서는 폭. 좁은 레일에서도 마지막 보고가 줄바꿈되지 않아야 한다.
  await page.setViewportSize({ width: 1440, height: 900 })
  await mockAgentWorkDetail(page, twoWorks('A안/B안 중 어느 쪽으로 진행할까요?'), { assignees: [human, aki] })
  await page.goto(URL)

  const rail = page.getByTestId('agent-work-rail')
  await expect(rail).toBeVisible()
  // 상태·담당 그룹 안, 담당자 아래 · 보고자 위.
  const group = page.getByTestId('property-group-status-people')
  await expect(group.getByTestId('agent-work-rail')).toBeVisible()
  const assigneeLabel = await boxOf(group.getByText('담당자', { exact: true }))
  const railBox = await boxOf(rail)
  const reporterBox = await boxOf(group.getByTestId('issue-reporter'))
  expect(railBox.y).toBeGreaterThan(assigneeLabel.y)
  expect(railBox.y + railBox.height).toBeLessThanOrEqual(reporterBox.y)

  // 마지막 보고는 한 줄 — 시안 시제품에서 "5분 전"이 세로로 쪼개지던 문제 회귀 방지. 메타 줄도 행 밖으로 넘치지 않는다.
  const meRow = page.getByTestId('agent-work-rail-1')
  await expect(meRow.getByTestId('agent-work-rail-1-last')).toHaveText('5분 전')
  const last = await boxOf(meRow.getByTestId('agent-work-rail-1-last'))
  expect(last.height).toBeLessThanOrEqual(20)
  const rowBox = await boxOf(meRow)
  expect(last.x + last.width).toBeLessThanOrEqual(rowBox.x + rowBox.width + 0.5)
  // 진행률이 있는 줄에서도 에이전트 유형 「Claude Code」가 말줄임 없이 다 보인다.
  const chipText = meRow.getByTitle('Claude Code').locator('span')
  expect(await chipText.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
})

test('질문 카드는 제목 아래·AI 현황 요약 위에 선다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  await mockAgentWorkDetail(page, twoWorks('A안/B안 중 어느 쪽으로 진행할까요?'), { assignees: [human, aki] })
  await page.goto(URL)

  const card = page.getByTestId('agent-question-card')
  await expect(card).toBeVisible()
  const title = await boxOf(page.getByTestId('issue-title-heading'))
  const cardBox = await boxOf(card)
  const summary = await boxOf(page.getByTestId('issue-instant-context'))
  expect(cardBox.y).toBeGreaterThanOrEqual(title.y + title.height)
  expect(cardBox.y + cardBox.height).toBeLessThanOrEqual(summary.y)
})
