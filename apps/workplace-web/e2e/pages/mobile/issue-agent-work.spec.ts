// 모바일 이슈 상세 AI 진행(WP-377) — 속성 칩 아래 작업자별 칩 → 「AI 진행」 바텀시트, 질문 카드(좁은 폭에서 버튼 줄바꿈).
import { agentWorker as aki, createAgentWork, humanWorker as human, minutesAgo, twoWorks } from '../../factories/agentWork.factory'
import { createIssue, createIssueDetail } from '../../factories/issue.factory'
import { pushHeldEvents, resourceChangedFrame } from '../../fixtures/gatedEvents'
import { mockAgentWorkDetail } from '../../fixtures/issue-detail-mock'
import { boxOf } from '../../fixtures/layout'
import { expect, expectNoHorizontalOverflow, stubChat, test } from '../../fixtures/mobile.fixture'
import { expectStays } from '../../fixtures/wait'
import type { AgentWorkView } from '../../../src/types/issue'



test('속성 칩 아래 작업자별 칩을 탭하면 AI 진행 시트가 레일과 같은 내용을 보여 준다', async ({ authenticatedPage: page }) => {
  await stubChat(page)
  await mockAgentWorkDetail(page, twoWorks('테스트 DB 를 공용으로 쓸까요, 이슈별로 따로 띄울까요?'), { assignees: [human, aki] })
  await page.goto('/projects/WP/issues/12')

  const akiChip = page.getByTestId('agent-work-chip-9')
  const meChip = page.getByTestId('agent-work-chip-1')
  await expect(akiChip).toContainText('답변 필요')
  await expect(meChip).toContainText('작업 중')
  // 서버 순서 그대로(아키 먼저) + 속성 칩 줄 아래.
  const props = await boxOf(page.getByTestId('mobile-prop-chips'))
  const akiBox = await boxOf(akiChip)
  expect(akiBox.y).toBeGreaterThanOrEqual(props.y + props.height)
  expect(akiBox.x).toBeLessThan((await boxOf(meChip)).x)
  // 데스크톱 레일은 모바일에 없다.
  await expect(page.getByTestId('property-rail')).toHaveCount(0)
  await expectNoHorizontalOverflow(page)

  await meChip.click()
  const sheet = page.getByTestId('agent-work-sheet')
  await expect(sheet).toBeVisible()
  await expect(sheet.getByRole('heading', { name: 'AI 진행' })).toBeVisible()
  await expect(sheet.getByTestId('agent-work-rail-9-state')).toContainText('답변 필요')
  await expect(sheet.getByTestId('agent-work-rail-9')).toContainText('테스트 DB 를 공용으로 쓸까요, 이슈별로 따로 띄울까요?')
  await expect(sheet.getByTestId('agent-work-rail-1-progress')).toHaveText('3/5')
  await expect(sheet.getByTestId('agent-work-rail-1-last')).toHaveText('5분 전')
  await expect(sheet.getByTestId('agent-work-rail-1')).toContainText('Claude Code')
  await expectNoHorizontalOverflow(page)
})

test('질문 카드는 좁은 폭에서 버튼을 줄바꿈해 보이고 탭하면 채팅을 연다', async ({ authenticatedPage: page }) => {
  await stubChat(page)
  await mockAgentWorkDetail(page, twoWorks('테스트 DB 를 공용으로 쓸까요, 이슈별로 따로 띄울까요?'), { assignees: [human, aki] })
  await page.goto('/projects/WP/issues/12')

  const card = page.getByTestId('agent-question-card')
  await expect(card).toContainText('아키의 질문 · 답변 필요')
  const reply = card.getByTestId('agent-question-reply')
  await expect(reply).toBeVisible()
  // 버튼이 카드 안에 다 들어온다(잘리지 않음) + 본문 아래 줄로 내려간다.
  const cardBox = await boxOf(card)
  const replyBox = await boxOf(reply)
  expect(replyBox.x + replyBox.width).toBeLessThanOrEqual(cardBox.x + cardBox.width)
  const note = await boxOf(card.getByText('테스트 DB 를 공용으로 쓸까요, 이슈별로 따로 띄울까요?'))
  expect(replyBox.y).toBeGreaterThanOrEqual(note.y + note.height)
  // 위치 — 작업자 칩 아래.
  const chip = await boxOf(page.getByTestId('agent-work-chip-9'))
  expect(cardBox.y).toBeGreaterThan(chip.y + chip.height)
  await expectNoHorizontalOverflow(page)

  await reply.click()
  await expect(page).toHaveURL(/[?&]chat=1/)
  await expect(page.getByTestId('issue-chat-drawer')).toBeVisible()
})

test('시트는 최근 보고를 자르지 않고, 진행 중 작업이 모두 끝나면 닫히며 다음 보고 때 저절로 다시 열리지 않는다', async ({ authenticatedPage: page }) => {
  // 터치에는 마우스 올리기(title)가 없으므로 시트는 긴 최근 보고도 전부 보여야 한다(레일은 두 줄 말줄임).
  const longNote = '테스트 DB 를 공용으로 쓸지 이슈별로 따로 띄울지 정해야 해요. 공용이면 마이그레이션 충돌을 조심해야 하고, 이슈별이면 기동 시간이 늘어나요. 어느 쪽으로 할까요?'
  const state: { works: AgentWorkView[] } = { works: [createAgentWork({ worker: aki, state: 'INPUT_REQUIRED', note: longNote })] }
  await stubChat(page)
  await mockAgentWorkDetail(page, state.works, { assignees: [aki] })
  // 상세 GET 을 바꿀 수 있는 상태로 덮어쓴다(나중 등록 route 우선) — resource.changed 로 재조회될 때 state.works 를 내려준다.
  await page.route((u) => u.pathname === '/api/v1/projects/WP/issues/12', (r) =>
    r.request().method() === 'GET'
      ? r.fulfill({ json: createIssueDetail({ summary: createIssue({ number: 12, title: '로그인 버그 수정', status: 'IN_PROGRESS', assignees: [aki], agentWork: state.works }) }) })
      : r.fallback())
  const changed = resourceChangedFrame({ resource: 'issue', op: 'updated', scopeType: 'PROJECT', scopeId: 1, ids: [1], actorId: 99, projectKey: 'WP', issueNumber: 12 })
  await page.goto('/projects/WP/issues/12')

  await page.getByTestId('agent-work-chip-9').click()
  const sheet = page.getByTestId('agent-work-sheet')
  await expect(sheet).toBeVisible()
  const note = sheet.getByText(longNote)
  await expect(note).toBeVisible()
  // 잘림 없음 — 내용 높이가 보이는 높이를 넘지 않는다(line-clamp 면 넘친다).
  expect(await note.evaluate((el) => el.scrollHeight <= el.clientHeight + 1)).toBe(true)

  // AI 가 작업을 끝냄 → 실시간 갱신으로 진행 중 작업이 비면 시트가 닫히고 칩도 사라진다.
  state.works = []
  await pushHeldEvents(page, changed)
  await expect(page.getByTestId('agent-work-chip-9')).toHaveCount(0)
  await expect(sheet).toBeHidden()

  // 다시 보고가 들어와 칩이 돌아와도 탭 전에는 시트가 열리지 않는다.
  state.works = [createAgentWork({ worker: aki, state: 'WORKING', note: '다시 시작' })]
  await pushHeldEvents(page, changed)
  await expect(page.getByTestId('agent-work-chip-9')).toBeVisible()
  await expectStays(page, () => sheet.isVisible(), false)
})

test('시작 전(도구 없음)·인증 필요 칩과 시트 — 에이전트 유형·null 을 그리지 않는다', async ({ authenticatedPage: page }) => {
  await stubChat(page)
  await mockAgentWorkDetail(
    page,
    [createAgentWork({ worker: aki, state: 'AUTH_REQUIRED', note: 'GitHub 권한이 필요해요' }), createAgentWork({ worker: human, state: 'SUBMITTED', tool: null })],
    { assignees: [human, aki] },
  )
  await page.goto('/projects/WP/issues/12')

  await expect(page.getByTestId('agent-work-chip-9')).toContainText('인증 필요')
  await expect(page.getByTestId('agent-work-chip-1')).toContainText('시작 전')
  await expect(page.getByTestId('agent-question-card')).toHaveCount(0)

  await page.getByTestId('agent-work-chip-1').click()
  const sheet = page.getByTestId('agent-work-sheet')
  await expect(sheet.getByTestId('agent-work-rail-1-state')).toHaveText('시작 전')
  await expect(sheet.getByTestId('agent-work-rail-9-state')).toContainText('인증 필요')
  await expect(sheet.getByTestId('agent-work-rail-1')).not.toContainText('null')
  await expect(sheet.getByTestId('agent-work-rail-1').getByTitle('Claude Code')).toHaveCount(0)
  await expect(sheet.getByTestId('agent-work-rail-9')).toContainText('Claude Code')
  await expectNoHorizontalOverflow(page)
})
