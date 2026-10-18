// 이슈 상세 AI 진행(WP-377) — 레일 「AI 진행」 섹션 · 답변 필요 질문 카드 · 「채팅에서 답하기」로 채팅 드로워 열기.
// 전 구간 page.route 모킹(백엔드 무관). agentWork 는 서버가 급한 순(상태 순위 → 마지막 보고 최근순)으로 내려주고, 화면은 그 순서를 그대로 지킨다.
import { agentWorker as aki, createAgentWork, humanWorker as human, KST_1430, minutesAgo, twoWorks } from '../../factories/agentWork.factory'
import { mockAgentWorkDetail } from '../../fixtures/issue-detail-mock'
import { expect, test } from '../../fixtures/auth.fixture'
import { boxOf } from '../../fixtures/layout'

const URL = '/projects/WP/issues/12'


test('레일 AI 진행은 담당자 아래에 작업자별 상태·최근 보고·에이전트 유형·진행률·마지막 보고를 서버 순서대로 보여 준다', { tag: '@smoke' }, async ({ authenticatedPage: page }) => {
  // 1440 — 레일이 본문 옆(280px)으로 서는 폭. 좁은 레일에서도 마지막 보고가 줄바꿈되지 않아야 한다.
  await page.setViewportSize({ width: 1440, height: 900 })
  await mockAgentWorkDetail(page, twoWorks('A안/B안 중 어느 쪽으로 진행할까요?'), { assignees: [human, aki] })
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

  // 서버 순서 그대로 — 답변 필요(아키) 다음 작업 중(양동희).
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
  await mockAgentWorkDetail(page, twoWorks('A안/B안 중 어느 쪽으로 진행할까요?'), { assignees: [human, aki] })
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

test('인증 필요는 레일에 인증 필요 배지로 보이고 질문 카드는 없다', async ({ authenticatedPage: page }) => {
  await mockAgentWorkDetail(page, [createAgentWork({ worker: aki, state: 'AUTH_REQUIRED', note: 'GitHub 권한이 필요해요' })], { assignees: [aki] })
  await page.goto(URL)

  const badge = page.getByTestId('agent-work-rail-9-state')
  await expect(badge).toContainText('인증 필요')
  // 답변이 아니라 사용자가 권한을 줘야 하는 상태 — 툴팁 없이 배지만, 질문 카드도 없다.
  await expect(badge).not.toHaveAttribute('title', /.+/)
  await expect(page.getByTestId('agent-work-rail-9')).toContainText('GitHub 권한이 필요해요')
  await expect(page.getByTestId('agent-question-card')).toHaveCount(0)
})

test('시작 전(도구 없음) 작업은 레일에 시작 전 배지만 보이고 에이전트 유형·null 은 없다', async ({ authenticatedPage: page }) => {
  await mockAgentWorkDetail(page, [createAgentWork({ worker: aki, state: 'SUBMITTED', tool: null })], { assignees: [aki] })
  await page.goto(URL)

  const row = page.getByTestId('agent-work-rail-9')
  await expect(page.getByTestId('agent-work-rail-9-state')).toHaveText('시작 전')
  await expect(row.getByTitle('Claude Code')).toHaveCount(0)
  await expect(row).not.toContainText('null')
  await expect(row).not.toContainText('—')
  // 아직 아무 보고도 없으니 마지막 보고 시각을 보이지 않는다.
  await expect(page.getByTestId('agent-work-rail-9-last')).toHaveCount(0)
  // 보일 게 없는 메타 줄은 빈 줄로도 남지 않는다 — 한 덩어리의 직계 자식은 아바타·이름·배지 줄 하나뿐.
  await expect(row.locator(':scope > div')).toHaveCount(1)
  await expect(page.getByTestId('agent-question-card')).toHaveCount(0)
})

// WP-450: 다음 회차 대기 — 레일에 언제 이어지는지 한 줄. 기준 시각 고정(2026-10-18 14:30 KST).
test('다음 회차 대기 작업은 레일에 예정 시각 한 줄, 예정이 없으면 다른 작업 뒤 이어서', async ({ authenticatedPage: page }) => {
  await page.clock.setFixedTime(new Date(KST_1430))
  await mockAgentWorkDetail(
    page,
    [
      createAgentWork({ worker: aki, state: 'SCHEDULED', note: '다른 작업에 양보했어요', nextRunAt: '2026-10-19T00:00:00Z' }),
      createAgentWork({ worker: human, state: 'SCHEDULED', nextRunAt: null }),
    ],
    { assignees: [human, aki] },
  )
  await page.goto(URL)

  await expect(page.getByTestId('agent-work-rail-9-state')).toHaveText('다음 회차 대기')
  const next = page.getByTestId('agent-work-rail-9-next-run')
  await expect(next).toHaveText('내일 09:00 이후 시작')
  await expect(next).toHaveAttribute('title', '예정 2026-10-19 09:00')
  await expect(page.getByTestId(`agent-work-rail-${human.id}-next-run`)).toHaveText('다른 작업 뒤 이어서')
  await expect(page.getByTestId(`agent-work-rail-${human.id}-next-run`)).not.toHaveAttribute('title', /.+/)
})

// WP-450: 예정 시각이 2시간 넘게 지났는데 시작하지 않으면(서버 overdue) 경고 툴팁 + 「곧 시작」.
test('예정 시각이 한참 지난 다음 회차 대기는 경고 툴팁을 보인다', async ({ authenticatedPage: page }) => {
  await page.clock.setFixedTime(new Date(KST_1430))
  await mockAgentWorkDetail(
    page,
    [createAgentWork({ worker: aki, state: 'SCHEDULED', nextRunAt: '2026-10-18T01:00:00Z', overdue: true })],
    { assignees: [human, aki] },
  )
  await page.goto(URL)

  const next = page.getByTestId('agent-work-rail-9-next-run')
  await expect(next).toHaveText('곧 시작')
  await expect(next).toHaveAttribute('title', '예정 시각이 2시간 넘게 지났어요')
})
