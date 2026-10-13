// 이슈 상세 AI 진행(WP-377) — 레일 「AI 진행」 섹션 · 답변 필요 질문 카드 · 「채팅에서 답하기」로 채팅 드로워 열기.
// 전 구간 page.route 모킹(백엔드 무관). agentWork 는 서버 순서(작업 생성순)로 내려오고, 화면은 급한 순으로 보인다.
import { createAgentWork, minutesAgo } from '../../factories/agentWork.factory'
import { mockAgentWorkDetail } from '../../fixtures/issue-detail-mock'
import { expect, test } from '../../fixtures/auth.fixture'
import { boxOf } from '../../fixtures/layout'
import type { UserSummary } from '../../../src/types/user'

const URL = '/projects/WP/issues/12'
const human: UserSummary = { id: 1, username: 'dh.yang@iacloud.kr', name: '양동희', kind: 'HUMAN' }
const aki: UserSummary = { id: 9, username: 'aki', name: '아키', kind: 'AGENT' }

// 사람이 Claude Code 로 작업 중(3/5) + AI 구성원이 질문을 남기고 답변 대기 — 서버 순서는 사람 먼저.
// 상대 시각이 테스트 시작 시점 기준이 되도록 테스트 안에서 만든다(모듈 로드 시각이면 늦게 도는 테스트에서 분이 밀린다).
const twoWorks = () => [
  createAgentWork({ worker: human, state: 'WORKING', note: 'MCP 헤더 처리 중', stepsDone: 3, stepsTotal: 5, updatedAt: minutesAgo(5) }),
  createAgentWork({ worker: aki, state: 'WAITING', note: 'A안/B안 중 어느 쪽으로 진행할까요?', updatedAt: minutesAgo(62) }),
]

test('레일 AI 진행은 담당자 아래에 작업자별 상태·최근 보고·에이전트 유형·진행률·마지막 보고를 급한 순으로 보여 준다', { tag: '@smoke' }, async ({ authenticatedPage: page }) => {
  // 1440 — 레일이 본문 옆(280px)으로 서는 폭. 좁은 레일에서도 마지막 보고가 줄바꿈되지 않아야 한다.
  await page.setViewportSize({ width: 1440, height: 900 })
  await mockAgentWorkDetail(page, twoWorks(), { assignees: [human, aki] })
  await page.goto(URL)

  const rail = page.getByTestId('agent-work-rail')
  await expect(rail).toBeVisible()
  await expect(rail).toContainText('AI 진행')
  // 상태·담당 그룹 안, 담당자 아래 · 보고자 위.
  const group = page.getByTestId('property-group-status-people')
  await expect(group.getByTestId('agent-work-rail')).toBeVisible()
  const assigneeLabel = await boxOf(group.getByText('담당자', { exact: true }))
  const railBox = await boxOf(rail)
  const reporterBox = await boxOf(group.getByTestId('issue-reporter'))
  expect(railBox.y).toBeGreaterThan(assigneeLabel.y)
  expect(railBox.y + railBox.height).toBeLessThanOrEqual(reporterBox.y)

  // 급한 순 — 답변 필요(아키)가 작업 중(양동희)보다 먼저.
  const rows = rail.locator('li[data-testid^="agent-work-rail-"]')
  await expect(rows).toHaveCount(2)
  await expect(rows.nth(0)).toHaveAttribute('data-testid', 'agent-work-rail-9')
  await expect(rows.nth(1)).toHaveAttribute('data-testid', 'agent-work-rail-1')

  const akiRow = page.getByTestId('agent-work-rail-9')
  await expect(akiRow).toContainText('아키')
  await expect(akiRow.getByTestId('agent-work-rail-9-state')).toContainText('답변 필요')
  await expect(akiRow).toContainText('A안/B안 중 어느 쪽으로 진행할까요?')
  await expect(akiRow).toContainText('Claude Code')
  await expect(akiRow.getByTestId('agent-work-rail-9-last')).toHaveText('1시간 전')
  // 진행 정보가 없으면 진행률은 숨긴다(— 표시 없음).
  await expect(akiRow.getByTestId('agent-work-rail-9-progress')).toHaveCount(0)
  await expect(akiRow).not.toContainText('—')

  const meRow = page.getByTestId('agent-work-rail-1')
  await expect(meRow).toContainText('양동희')
  await expect(meRow.getByTestId('agent-work-rail-1-state')).toContainText('작업 중')
  await expect(meRow).toContainText('MCP 헤더 처리 중')
  await expect(meRow.getByTestId('agent-work-rail-1-progress')).toHaveText('3/5')
  await expect(meRow.getByTestId('agent-work-rail-1-last')).toHaveText('5분 전')

  // 마지막 보고는 한 줄 — 시안 시제품에서 "5분 전"이 세로로 쪼개지던 문제 회귀 방지. 메타 줄도 행 밖으로 넘치지 않는다.
  const last = await boxOf(meRow.getByTestId('agent-work-rail-1-last'))
  expect(last.height).toBeLessThanOrEqual(20)
  const rowBox = await boxOf(meRow)
  expect(last.x + last.width).toBeLessThanOrEqual(rowBox.x + rowBox.width + 0.5)
  // 진행률이 있는 줄에서도 에이전트 유형 「Claude Code」가 말줄임 없이 다 보인다.
  const chipText = meRow.getByTitle('Claude Code').locator('span')
  expect(await chipText.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
})

test('AI 구성원이 답변 필요면 제목 아래·AI 현황 요약 위에 질문 카드가 보이고, 채팅에서 답하기는 채팅 드로워를 연다', { tag: '@smoke' }, async ({ authenticatedPage: page }) => {
  await mockAgentWorkDetail(page, twoWorks(), { assignees: [human, aki] })
  await page.goto(URL)

  const card = page.getByTestId('agent-question-card')
  await expect(card).toBeVisible()
  await expect(card).toContainText('아키의 질문 · 답변 필요')
  await expect(card).toContainText('A안/B안 중 어느 쪽으로 진행할까요?')
  // 위치 — 제목 블록 아래, AI 현황 요약 카드 위.
  const title = await boxOf(page.getByTestId('issue-title-heading'))
  const cardBox = await boxOf(card)
  const summary = await boxOf(page.getByTestId('issue-instant-context'))
  expect(cardBox.y).toBeGreaterThanOrEqual(title.y + title.height)
  expect(cardBox.y + cardBox.height).toBeLessThanOrEqual(summary.y)

  // 채팅에서 답하기 → URL ?chat=1 + 채팅 드로워 열림.
  await expect(page.getByTestId('issue-chat-drawer')).toHaveCount(0)
  const reply = card.getByTestId('agent-question-reply')
  await expect(reply).toHaveText('채팅에서 답하기')
  await reply.click()
  await expect(page).toHaveURL(/[?&]chat=1/)
  await expect(page.getByTestId('issue-chat-drawer')).toBeVisible()
})

test('진행 중 AI 작업이 없으면 레일 AI 진행과 질문 카드를 그리지 않는다', async ({ authenticatedPage: page }) => {
  await mockAgentWorkDetail(page, undefined, { assignees: [aki] })
  await page.goto(URL)

  await expect(page.getByTestId('property-group-status-people')).toBeVisible()
  await expect(page.getByTestId('issue-reporter')).toBeVisible()
  await expect(page.getByTestId('agent-work-rail')).toHaveCount(0)
  await expect(page.getByTestId('agent-question-card')).toHaveCount(0)
})

test('사람의 답변 필요는 질문 카드 없이 레일 배지만 보여 준다', async ({ authenticatedPage: page }) => {
  await mockAgentWorkDetail(page, [createAgentWork({ worker: human, state: 'WAITING', note: '터미널에서 확인 필요' })], { assignees: [human] })
  await page.goto(URL)

  await expect(page.getByTestId('agent-work-rail-1-state')).toContainText('답변 필요')
  await expect(page.getByTestId('agent-work-rail-1')).toContainText('터미널에서 확인 필요')
  await expect(page.getByTestId('agent-question-card')).toHaveCount(0)
})
