import type { Page } from '@playwright/test'

import { parse } from 'yaml'

import type { WorkflowDetail, WorkflowSummary, WorkflowVersionDetail, WorkflowVersionSummary } from '../../../src/lib/workflows'
import { createProject } from '../../factories/project.factory'
import { expect, test } from '../../fixtures/auth.fixture'

/** 실제 라우터가 읽는 등록된 초안과 검증 응답을 스텁한다. */
async function mockWorkflow(page: Page, yaml = 'name: 작업 정리\nnodes:\n  review:\n    type: agent_task') {
  await page.route('**/api/v1/projects/WP', (route) => route.fulfill({
    json: createProject({ id: 7, key: 'WP', viewerRole: 'OWNER' }),
  }))
  await page.route('**/api/v1/projects/7/workflows', (route) => route.fulfill({
    json: [{ id: 42, name: '작업 정리', enabled: false, activeVersionNo: null, draftChanged: true }],
  }))
  await page.route('**/api/v1/workflows/42', (route) => route.fulfill({
    json: {
      id: 42, projectId: 7, name: '작업 정리', enabled: false, activeVersion: null,
      draftYaml: yaml, draftUpdatedAt: '2026-11-22T10:00:00Z', draftProblems: [],
    },
  }))
  await page.route('**/api/v1/workflows/validate', (route) => route.fulfill({
    json: {
      problems: [{ severity: 'WARNING', code: 'REVIEW', message: '검토 단계를 확인하세요.', line: 3, column: 3, nodeKey: 'review' }],
    },
  }))
}

/** 실제 라우터와 브라우저에서 편집하면 서버 검증이 행 위치를 textarea 에 연결한다. */
test('프로젝트 워크플로우 탭에서 YAML 경고 위치를 찾아간다', { tag: ['@wiring'] }, async ({ authenticatedPage: page }) => {
  await mockWorkflow(page)
  await page.goto('/projects/WP/cycles')
  await page.getByRole('navigation', { name: '프로젝트 탭' }).getByRole('link', { name: '워크플로우' }).click()
  await expect(page).toHaveURL(/\/projects\/WP\/workflow$/)

  // 기본 보기는 그래프 — YAML 보기로 바꿔 편집기를 연다
  await page.getByRole('tab', { name: 'YAML' }).click()
  const editor = page.getByRole('textbox', { name: '워크플로우 YAML' })
  await editor.fill('name: 수정\nnodes:\n  review: {}')
  await page.getByRole('button', { name: /3행 3열.*검토 단계를 확인하세요/ }).click()
  await expect(editor).toBeFocused()
  expect(await editor.evaluate((element: HTMLTextAreaElement) => element.selectionStart)).toBe('name: 수정\nnodes:\n  '.length)
  const publish = page.getByRole('button', { name: '게시', exact: true })
  await expect(publish).toBeEnabled()
  await expect(page.getByText('사용 안 함')).toBeVisible()
  await publish.click()
  const confirmation = page.getByRole('dialog', { name: '워크플로우 게시' })
  await expect(confirmation.getByText('진행 중 실행 0은 시작한 버전으로 계속')).toBeVisible()
  await expect(confirmation.getByRole('button', { name: '게시', exact: true })).toBeEnabled()
})

test('다른 프로젝트 탭을 다녀와도 저장하지 않은 워크플로 YAML을 복원한다', { tag: ['@flow'] }, async ({ authenticatedPage: page }) => {
  await mockWorkflow(page)
  await page.goto('/projects/WP/workflow?view=yaml')
  const changedYaml = 'name: 편집 중\nnodes:\n  review: {}\nnotes: 아직 저장 안 함'
  await page.getByRole('textbox', { name: '워크플로우 YAML' }).fill(changedYaml)

  const tabs = page.getByRole('navigation', { name: '프로젝트 탭' })
  await tabs.getByRole('link', { name: '개요' }).click()
  await expect(page).toHaveURL(/\/projects\/WP\/overview$/)
  await tabs.getByRole('link', { name: '워크플로우' }).click()
  await page.getByRole('tab', { name: 'YAML' }).click()

  await expect(page.getByRole('textbox', { name: '워크플로우 YAML' })).toHaveValue(changedYaml)
})

test('workflowTab_desktopShowsProblemsBesideEditor_mobileStacksProblems', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  await mockWorkflow(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/projects/WP/workflow?view=yaml')
  const editor = page.getByRole('textbox', { name: '워크플로우 YAML' })
  const gutter = page.getByTestId('workflow-yaml-gutter')
  const problems = page.getByRole('region', { name: '검증 결과' })
  await expect(gutter.getByText('3')).toBeVisible()
  const editorBox = await editor.boundingBox()
  const problemBox = await problems.boundingBox()
  expect(problemBox!.x).toBeGreaterThanOrEqual(editorBox!.x + editorBox!.width)

  await editor.fill(Array.from({ length: 30 }, (_, index) => 'step' + index + ': {}').join('\n'))
  await editor.evaluate((node: HTMLTextAreaElement) => { node.scrollTop = 96 })
  await expect.poll(() => gutter.evaluate((node) => node.scrollTop)).toBe(96)

  await page.setViewportSize({ width: 390, height: 844 })
  await expect.poll(async () => {
    const currentEditor = await editor.boundingBox()
    const currentProblems = await problems.boundingBox()
    return !!currentEditor && !!currentProblems && currentProblems.y >= currentEditor.y + currentEditor.height
  }).toBe(true)
})

test('workflowGraph_drawerBesideCanvasOnWide_belowCanvasOnNarrow', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  await mockWorkflow(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/projects/WP/workflow')
  const canvas = page.getByTestId('workflow-graph-canvas')
  const panel = page.getByRole('complementary', { name: '노드 설정' })
  // 노드 하나를 눌러 노드 서랍을 연다 — 노드 카드 제목은 YAML 의 노드 키다
  await page.locator('.react-flow__node').filter({ hasText: 'review' }).click()
  await expect(panel).toBeVisible()

  const canvasWide = (await canvas.boundingBox())!
  const panelWide = (await panel.boundingBox())!
  expect(panelWide.x).toBeGreaterThanOrEqual(canvasWide.x + canvasWide.width)
  // 넓은 폭의 서랍 폭은 380px(@3xl:w-[380px])
  expect(Math.abs(panelWide.width - 380)).toBeLessThanOrEqual(2)
  expect(canvasWide.width).toBeGreaterThanOrEqual(300)
  expect(canvasWide.height).toBeGreaterThanOrEqual(400)

  await page.setViewportSize({ width: 390, height: 844 })
  await expect.poll(async () => {
    const c = await canvas.boundingBox()
    const p = await panel.boundingBox()
    return !!c && !!p && p.y >= c.y + c.height
  }).toBe(true)
  const canvasNarrow = (await canvas.boundingBox())!
  expect(canvasNarrow.width).toBeGreaterThanOrEqual(300)
  // 좁은 폭의 캔버스는 24rem(384px) 고정 높이 — 한 단 보기로 바뀌며 400 기준을 이 값에 맞췄다(WP-2090)
  expect(canvasNarrow.height).toBeGreaterThanOrEqual(380)
  await expect(page.getByRole('button', { name: '+ 노드' })).toBeVisible()
  // 좁은 캔버스에서 떠 있는 두 도구 패널(왼쪽 위 도구·배율)이 서로 겹치지 않는다
  const toolsBox = (await page.getByTestId('workflow-graph-tools').boundingBox())!
  const zoomBox = (await page.getByTestId('workflow-graph-zoom').boundingBox())!
  const overlaps = toolsBox.x < zoomBox.x + zoomBox.width && zoomBox.x < toolsBox.x + toolsBox.width && toolsBox.y < zoomBox.y + zoomBox.height && zoomBox.y < toolsBox.y + toolsBox.height
  expect(overlaps).toBe(false)
  // 미니맵은 좁은 폭에서 숨는다
  await expect(page.locator('.react-flow__minimap')).toBeHidden()

  // 좁은 폭에서 처음부터 열어 보면(390 에서 노드를 누르면) 패널 머리 줄이 뷰포트 안에 있어야 한다 —
  // 캔버스 아래 바깥에 열리면 노드를 누른 것이 티가 나지 않아 아무 일도 안 일어난 것처럼 보이고,
  // 머리 줄이 바깥이면 이름을 고칠 수도 없다(WP-2041 리뷰 후속 지적 1·2 — 머리 줄만 뷰포트에 넣는다).
  await page.reload()
  await page.locator('.react-flow__node').filter({ hasText: 'review' }).click()
  await expect(panel).toBeVisible()
  await expect(panel).toBeInViewport()
  await expect(panel.getByRole('button', { name: '서랍 닫기' })).toBeInViewport()

  // 세로로 쌓일 때는 패널 높이가 화면의 60% 로 막히고 안쪽(overflow-y-auto)에서 스크롤한다 —
  // 막지 않으면 패널이 길어질 때마다 페이지가 아래로 늘어나 스크롤이 두 겹이 된다.
  // 단언은 계산값으로 본다 — scrollHeight > clientHeight 는 패널 내용 양에 기대 깨질 수 있다(WP-2041 리뷰 후속 지적 3·4).
  const narrowStyle = await panel.evaluate((el) => {
    const style = getComputedStyle(el)
    return { overflowY: style.overflowY, maxHeight: style.maxHeight, height: el.getBoundingClientRect().height }
  })
  expect(['auto', 'scroll']).toContain(narrowStyle.overflowY)
  const narrowMax = parseFloat(narrowStyle.maxHeight)
  expect(narrowMax).toBeGreaterThan(0)
  expect(narrowStyle.height).toBeLessThanOrEqual(narrowMax + 1)
  expect(narrowStyle.height).toBeLessThanOrEqual(Math.round(844 * 0.6) + 1)

  // 짧은 화면(주소창이 덮는 모바일)에서도 상한이 고정 px 가 아니라 그 화면 높이를 따라가는지 함께 본다
  await page.setViewportSize({ width: 390, height: 664 })
  await expect.poll(async () => {
    const box = await panel.boundingBox()
    return box !== null && box.height <= Math.round(664 * 0.6) + 1
  }).toBe(true)
})

/** 「+ 노드」로 더한 노드가 캔버스 안에 들어온다(WP-2039) — jsdom 이 못 재는 기하라 브라우저에서 본다. */
test('workflowGraph_addNode_keepsNewNodeInsideCanvas', { tag: ['@layout'] }, async ({ authenticatedPage: page }) => {
  await mockWorkflow(page)
  await page.route('**/api/v1/workflows/42/draft', (route) => route.fulfill({ json: { draftUpdatedAt: '2026-11-24T10:00:00Z', problems: [] } }))
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/projects/WP/workflow')
  await page.getByRole('button', { name: '+ 노드' }).click()
  await page.getByRole('menuitem', { name: '시작' }).click()
  await page.getByRole('button', { name: '+ 노드' }).click()
  await page.getByRole('menuitem', { name: 'AI 작업' }).click()
  const canvas = page.locator('.react-flow')
  const added = page.locator('.react-flow__node', { hasText: '새 AI 작업' })
  await added.waitFor()
  // 시야 이동은 250ms 애니메이션으로 끝나서, 노드가 나타난 직후의 한 번 읽기는 전 중간 좌표다 — 캔버스 안에 들어올 때까지 조건 대기한다(고정 대기 지양).
  // 캔버스 상자도 매번 안에서 다시 읽는다 — 레이아웃이 그 사이 바뀌어도 지난 좌표로 판정하지 않게.
  await expect.poll(async () => {
    const box = await canvas.boundingBox()
    const node = await added.boundingBox()
    if (!box || !node) return false
    return node.x >= box.x
      && node.y >= box.y
      && node.x + node.width <= box.x + box.width
      && node.y + node.height <= box.y + box.height
  }, { timeout: 5000, message: '새 노드가 캔버스 안에 들어와야 한다' }).toBe(true)
})

// WP-2052 — 노드를 마우스로 끌기만 해서는 편집 패널이 열리지 않는다(React Flow 는 드래그 시작에도 노드를 선택한다)
test('workflowGraph_dragNode_doesNotOpenPanel', { tag: '@input' }, async ({ authenticatedPage: page }) => {
  await mockWorkflow(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/projects/WP/workflow')
  const node = page.locator('.react-flow__node').filter({ hasText: 'review' })
  await expect(node).toBeVisible()
  const before = (await node.boundingBox())!
  const startX = before.x + before.width / 2
  const startY = before.y + before.height / 2
  await page.mouse.move(startX, startY)
  await page.mouse.down()
  await page.mouse.move(startX + 80, startY + 20, { steps: 8 })
  await page.mouse.up()
  const after = (await node.boundingBox())!
  expect(Math.abs(after.x - before.x)).toBeGreaterThan(20)
  await expect(page.getByRole('complementary', { name: '노드 설정' })).not.toBeVisible()
})

// WP-2052 — 노드에 포커스를 두고 Enter 를 누르면 편집 패널이 열린다
test('workflowGraph_keyboardEnter_opensPanel', { tag: '@input' }, async ({ authenticatedPage: page }) => {
  await mockWorkflow(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/projects/WP/workflow')
  const node = page.locator('.react-flow__node').filter({ hasText: 'review' })
  await expect(node).toBeVisible()
  await node.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('complementary', { name: '노드 설정' })).toBeVisible()
})

// WP-2052 — 화살표로 옮긴 노드 자리는 YAML 에 저장되어, 다른 노드를 골라 다시 그려져도 되돌아가지 않는다
test('workflowGraph_keyboardMove_persistsAfterRedraw', { tag: '@input' }, async ({ authenticatedPage: page }) => {
  await mockWorkflow(page, 'name: 작업 정리\nnodes:\n  review:\n    type: agent_task\n  other:\n    type: agent_task\nlayout:\n  review: { x: 0, y: 0 }\n  other: { x: 0, y: 200 }')
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/projects/WP/workflow')
  const review = page.locator('.react-flow__node').filter({ hasText: 'review' })
  const other = page.locator('.react-flow__node').filter({ hasText: 'other' })
  await expect(review).toBeVisible()
  await review.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('complementary', { name: '노드 설정' })).toBeVisible()
  // 서랍이 캔버스를 줄이면 고른 노드가 보이도록 시야가 옮겨진다(WP-2091) — 옮겨 끝난 자리(연속 두 표본이 같을 때)를 기준으로 삼는다.
  // 서랍 열기 전 위치(before)와 비교하면 시야 이동분이 섞여 키보드 이동량이 아니게 된다.
  let prevX = Number.NaN
  await expect.poll(async () => {
    const x = (await review.boundingBox())!.x
    const same = Math.abs(x - prevX) < 0.5
    prevX = x
    return same
  }, { intervals: [200] }).toBe(true)
  const settled = (await review.boundingBox())!
  await review.focus()
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight')
  await expect.poll(async () => (await review.boundingBox())!.x).toBeGreaterThan(settled.x + 10)
  // 다른 노드를 골라 다시 그리게 한다
  await other.focus()
  await page.keyboard.press('Enter')
  await expect(other).toHaveClass(/selected/)
  expect((await review.boundingBox())!.x).toBeGreaterThan(settled.x + 10)
  // YAML 탭에서도 새 좌표가 보인다 — review 의 x 가 0 보다 커졌음을 양성으로 단언한다(직렬화 공백이 바뀌어도 거짓 통과하지 않게)
  await page.getByRole('tab', { name: 'YAML' }).click()
  // YAML 을 파싱해 읽으므로 줄 꼴(인라인·블록)과 상관없고, 편집기 값이 늦게 채워져도 다시 읽는다
  const yamlBox = page.getByRole('textbox', { name: '워크플로우 YAML' })
  await expect.poll(async () => Number(parse(await yamlBox.inputValue())?.layout?.review?.x ?? 0)).toBeGreaterThan(0)
})

// WP-2089 — 한 노드의 아래 손잡이에서 다른 노드의 위 손잡이로 끌면 앞 노드 → 뒤 노드 선이 생긴다(겹친 손잡이 때문에 거절되거나 뒤집히지 않아야 한다).
// 오프셋 8 은 손잡이 중심에서 벗어나 connectionRadius 안에 놓는 경우다. 두 경우 모두 손잡이 id 경고가 콘솔에 없어야 한다.
for (const offset of [0, 8]) {
  test(`workflowGraph_dragBottomToTopHandle_offset${offset}_addsEdge`, { tag: '@input' }, async ({ authenticatedPage: page }) => {
    const warnings: string[] = []
    page.on('console', (m) => { if (m.text().includes("Couldn't create edge")) warnings.push(m.text()) })
    await mockWorkflow(page, 'name: 작업 정리\nroles:\n  lead: { name: 팀장 }\nnodes:\n  review:\n    type: agent_task\n    role: lead\n  other:\n    type: agent_task\n    role: lead\nlayout:\n  review: { x: 0, y: 0 }\n  other: { x: 0, y: 200 }')
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/projects/WP/workflow')
    const from = page.locator('.react-flow__node').filter({ hasText: 'review' }).locator('[data-handleid="s-bottom"]')
    const to = page.locator('.react-flow__node').filter({ hasText: 'other' }).locator('[data-handleid="s-top"]')
    await expect(from).toBeVisible()
    const a = (await from.boundingBox())!
    const b = (await to.boundingBox())!
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
    await page.mouse.down()
    await page.mouse.move(b.x + b.width / 2 + offset, b.y + b.height / 2 + offset / 2, { steps: 12 })
    await page.mouse.up()
    await page.getByRole('tab', { name: 'YAML' }).click()
    const yamlBox = page.getByRole('textbox', { name: '워크플로우 YAML' })
    await expect.poll(async () => {
      const outcomes = parse(await yamlBox.inputValue())?.nodes?.review?.outcomes ?? {}
      return Object.values(outcomes).map((o) => (o as { to: string }).to)
    }).toContain('other')
    expect(warnings).toEqual([])
  })
}

// WP-2090 — 그래프 캔버스는 머리 한 줄 아래 남는 화면 높이를 채우고, 페이지 자체는 세로로 넘치지 않는다. 좁은 폭에서는 머리가 줄바꿈돼도 보기 탭 4개가 보인다.
test('workflowGraph_canvasFillsRemainingHeight', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  await mockWorkflow(page)
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/projects/WP/workflow')
  const canvas = page.getByTestId('workflow-graph-canvas')
  await expect(canvas).toBeVisible()
  // 레이아웃이 자리 잡을 때까지 조건 대기 — 캔버스 아래 끝이 창 아래 여백(p-4 = 16px) 앞에 닿는다
  await expect.poll(async () => {
    const box = await canvas.boundingBox()
    return box ? Math.abs(box.y + box.height - (1000 - 16)) <= 6 : false
  }).toBe(true)
  const box = (await canvas.boundingBox())!
  expect(box.height).toBeGreaterThanOrEqual(600)
  const overflow = await page.evaluate(() => {
    const root = document.scrollingElement!
    const body = document.querySelector('[data-testid="workflow-page-body"]')!
    return { page: root.scrollHeight - window.innerHeight, body: body.scrollHeight - body.clientHeight }
  })
  expect(overflow.page).toBeLessThanOrEqual(0)
  expect(overflow.body).toBeLessThanOrEqual(0)

  await page.setViewportSize({ width: 390, height: 844 })
  const tabs = page.getByRole('tablist', { name: '워크플로우 보기' }).getByRole('tab')
  await expect(tabs).toHaveCount(4)
  for (const tab of await tabs.all()) await expect(tab).toBeInViewport()
})

/** 서랍은 AI 옆 패널과 겹치지 않고(열렸을 때 서랍 오른쪽 ≤ AI 패널 왼쪽), 선택한 노드는 캔버스 안에 머문다. */
test('workflowGraph_drawerDoesNotOverlapAiPanel', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  await mockWorkflow(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/projects/WP/workflow')
  const canvas = page.getByTestId('workflow-graph-canvas')
  const drawer = page.getByRole('complementary', { name: '노드 설정' })
  const node = page.locator('.react-flow__node').filter({ hasText: 'review' })

  // AI 패널을 연 채로 노드를 고른다
  await page.getByTestId('chat-launcher').click()
  const ai = page.getByTestId('ai-side-panel')
  await expect(ai).toBeVisible()
  await node.click()
  await expect(drawer).toBeVisible()
  // 두 패널의 자리는 레이아웃이 가라앉은 뒤에 재야 한다 — 한 번 재면 AI 패널이 들어오며 본문이 줄어드는 도중의 값을 볼 수 있다(드물게 14px 겹침으로 실패)
  await expect.poll(async () => {
    const aiBox = (await ai.boundingBox())!
    const drawerBox = (await drawer.boundingBox())!
    return aiBox.x + 1 - (drawerBox.x + drawerBox.width)
  }).toBeGreaterThanOrEqual(0)
  // AI 패널이 본문을 좁히면 서랍이 캔버스 옆이 아니라 아래로 쌓일 수 있고(컨테이너 폭 @3xl 미만) 그때 캔버스도 줄어든다.
  // 선택 노드는 그렇게 레이아웃이 가라앉은 뒤에도 캔버스 안에 다 보여야 한다(WP-2091 라이브 검증: 아래쪽에 반쯤 걸림).
  // 시야 이동(250ms 애니메이션)과 크기 변화가 끝나기를 poll 로 기다려 네 변 모두 잰다 — 한 번 재면 이동 도중 값을 본다.
  await expect.poll(async () => {
    const c = (await canvas.boundingBox())!
    const n = (await node.boundingBox())!
    return Math.min(n.x - c.x, c.x + c.width - (n.x + n.width), n.y - c.y, c.y + c.height - (n.y + n.height))
  }).toBeGreaterThanOrEqual(0)

  // AI 패널을 닫은 채로도 선택 노드가 캔버스 안에 있다.
  // 칩은 닫힘 → 옆 패널 → 전체 화면 → 닫힘으로 돈다 — 한 번 더 누르면 옆 패널이 사라지지만 닫힌 것이 아니라 전체 화면(캔버스를 덮는다)이다.
  // 전체 화면은 늦게 불러와 그려지므로 뜬 것을 확인한 뒤 한 번 더 눌러 닫지 않으면 노드 클릭이 덮개에 걸리는지가 타이밍에 달린다.
  await page.getByTestId('chat-launcher').click()
  const aiFullscreen = page.getByTestId('ai-fullscreen')
  await expect(aiFullscreen).toBeVisible()
  await page.getByTestId('chat-launcher').click()
  await expect(aiFullscreen).toBeHidden()
  await expect(ai).toBeHidden()
  await page.getByRole('button', { name: '서랍 닫기' }).click()
  await node.click()
  await expect(drawer).toBeVisible()
  const canvasNoAi = (await canvas.boundingBox())!
  const nodeNoAi = (await node.boundingBox())!
  expect(nodeNoAi.x).toBeGreaterThanOrEqual(canvasNoAi.x)
  expect(nodeNoAi.x + nodeNoAi.width).toBeLessThanOrEqual(canvasNoAi.x + canvasNoAi.width)
  expect(nodeNoAi.y + nodeNoAi.height).toBeLessThanOrEqual(canvasNoAi.y + canvasNoAi.height)
})

// 빈 캔버스를 끌어 화면을 옮기기만 해서는 워크플로우 개요가 열리지 않는다(드래그 끝의 click 이 빈 곳 클릭으로 오인되면 안 된다)
test('workflowGraph_panCanvas_doesNotOpenOverview', { tag: '@input' }, async ({ authenticatedPage: page }) => {
  await mockWorkflow(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/projects/WP/workflow')
  const canvas = page.getByTestId('workflow-graph-canvas')
  await expect(page.locator('.react-flow__node').filter({ hasText: 'review' })).toBeVisible()
  const box = (await canvas.boundingBox())!
  // 노드·도구와 겹치지 않는 캔버스 오른쪽 아래 근처에서 끈다
  const startX = box.x + box.width * 0.75
  const startY = box.y + box.height * 0.6
  await page.mouse.move(startX, startY)
  await page.mouse.down()
  await page.mouse.move(startX - 90, startY - 40, { steps: 8 })
  await page.mouse.up()
  const overview = page.getByRole('complementary', { name: '워크플로우 개요' })
  await expect(overview).toHaveCount(0)
  // 양성 대조 — 같은 빈 곳을 한 번 누르면 개요가 열린다. 끌기 직후 부재 확인이 렌더 전이라 거짓으로 통과한 게 아님을 보장한다
  // (빈 캔버스 클릭 → 개요 배선 자체는 vitest graphEditor_paneClick_opensOverview 가 덮는다)
  await page.mouse.click(startX - 90, startY - 40)
  await expect(overview).toBeVisible()
})

/** 1440px 에서 변경이 없을 때 머리가 한 줄에 들어가는지 — 줄바꿈으로 게시 단추가 탭 아래로 밀리면 실패한다(WP-2133). */
test('workflowTab_noChanges_headerFitsOneLineAt1440', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  const yaml = 'name: 작업 정리\nnodes:\n  review:\n    type: agent_task'
  await mockWorkflow(page, yaml)
  // 게시본이 있고 초안 원문 = 게시본 원문이라 변경 0 이 되도록 버전 응답을 덧씌운다(나중에 등록한 라우트가 우선).
  await page.route('**/api/v1/projects/7/workflows', (route) => route.fulfill({
    json: [{ id: 42, name: '작업 정리', enabled: true, activeVersionNo: 2, draftChanged: false }] satisfies WorkflowSummary[],
  }))
  await page.route('**/api/v1/workflows/42', (route) => route.fulfill({
    json: {
      id: 42, projectId: 7, name: '작업 정리', enabled: true,
      activeVersion: { no: 2, createdAt: '2026-11-22T10:00:00Z', createdBy: null },
      draftYaml: yaml, draftUpdatedAt: '2026-11-22T10:00:00Z', draftProblems: [],
    } satisfies WorkflowDetail,
  }))
  await page.route('**/api/v1/workflows/42/versions', (route) => route.fulfill({
    json: [{ versionNo: 2, createdAt: '2026-11-22T10:00:00Z', createdBy: null, activeRuns: 0 }] satisfies WorkflowVersionSummary[],
  }))
  await page.route('**/api/v1/workflows/42/versions/2', (route) => route.fulfill({
    json: {
      versionNo: 2, sourceYaml: yaml,
      model: { schema: '', roles: [], shared: [], nodes: [], start: [], layout: [] },
    } satisfies WorkflowVersionDetail,
  }))
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/projects/WP/workflow')

  // 변경이 없어 막히면 공용 DisabledReasonTooltip 감싸개가 「게시 — 사유」 이름의 막힌 단추로 노출된다
  const publish = page.getByRole('button', { name: '게시 — 바꾼 내용이 없어 게시할 것이 없습니다.', exact: true })
  // 게시본 원문을 받아 변경 0 이 확정되면 게시가 비활성으로 남는다.
  await expect(publish).toHaveAttribute('aria-disabled', 'true')
  await expect(page.getByRole('button', { name: '되돌리기' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '초안 저장' })).toHaveCount(0)

  const tabsBox = await page.getByRole('tablist', { name: '워크플로우 보기' }).boundingBox()
  const publishBox = await publish.boundingBox()
  // 게시 단추의 세로 중심이 보기 탭 높이의 절반 안이면 같은 줄이다.
  expect(Math.abs(publishBox!.y + publishBox!.height / 2 - (tabsBox!.y + tabsBox!.height / 2))).toBeLessThan(tabsBox!.height / 2)
  // 사용 스위치도 같은 줄(세로 중심이 탭 줄 안)이어야 한다.
  const switchBox = await page.getByRole('switch', { name: '워크플로우 사용' }).boundingBox()
  expect(Math.abs(switchBox!.y + switchBox!.height / 2 - (tabsBox!.y + tabsBox!.height / 2))).toBeLessThan(tabsBox!.height / 2)
})
