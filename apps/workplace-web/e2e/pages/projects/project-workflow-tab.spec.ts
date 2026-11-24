import type { Page } from '@playwright/test'

import { createProject } from '../../factories/project.factory'
import { expect, test } from '../../fixtures/auth.fixture'

/** 실제 라우터가 읽는 등록된 초안과 검증 응답을 스텁한다. */
async function mockWorkflow(page: Page) {
  const yaml = 'name: 작업 정리\nnodes:\n  review:\n    type: agent_task'
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
  await page.goto('/projects/WP/workflow')
  const changedYaml = 'name: 편집 중\nnodes:\n  review: {}\nnotes: 아직 저장 안 함'
  await page.getByRole('textbox', { name: '워크플로우 YAML' }).fill(changedYaml)

  const tabs = page.getByRole('navigation', { name: '프로젝트 탭' })
  await tabs.getByRole('link', { name: '개요' }).click()
  await expect(page).toHaveURL(/\/projects\/WP\/overview$/)
  await tabs.getByRole('link', { name: '워크플로우' }).click()

  await expect(page.getByRole('textbox', { name: '워크플로우 YAML' })).toHaveValue(changedYaml)
})

test('workflowTab_desktopShowsProblemsBesideEditor_mobileStacksProblems', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  await mockWorkflow(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/projects/WP/workflow')
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

test('workflowGraph_editorPanelBesideCanvasOnWide_belowCanvasOnNarrow', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  await mockWorkflow(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/projects/WP/workflow')
  await page.getByRole('button', { name: '그래프' }).click()
  const canvas = page.getByTestId('workflow-graph-canvas')
  const panel = page.getByRole('complementary', { name: '노드 편집' })
  // 노드 하나를 눌러 편집 패널을 연다 — 노드 카드 제목은 YAML 의 노드 키다
  await page.locator('.react-flow__node').filter({ hasText: 'review' }).click()
  await expect(panel).toBeVisible()

  const canvasWide = (await canvas.boundingBox())!
  const panelWide = (await panel.boundingBox())!
  expect(panelWide.x).toBeGreaterThanOrEqual(canvasWide.x + canvasWide.width)
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
  expect(canvasNarrow.height).toBeGreaterThanOrEqual(400)
  await expect(page.getByRole('button', { name: '+ 노드' })).toBeVisible()

  // 좁은 폭에서 처음부터 열어 보면(390 에서 노드를 누르면) 패널이 뷰포트 안으로 들어와야 한다 —
  // 캔버스 아래 바깥에 열리면 노드를 누른 것이 티가 나지 않아 아무 일도 안 일어난 것처럼 보인다(WP-2041 리뷰 지적 1)
  await page.reload()
  await page.getByRole('button', { name: '그래프' }).click()
  await page.locator('.react-flow__node').filter({ hasText: 'review' }).click()
  await expect(panel).toBeVisible()
  await expect(panel).toBeInViewport()

  // 세로로 쌓일 때는 패널 높이가 60vh 로 막혀 안쪽(overflow-y-auto)에서 스크롤된다 —
  // 막지 않으면 패널이 길어질 때마다 페이지가 아래로 늘어나 스크롤이 두 겹이 된다(WP-2041 리뷰 지적 2)
  const panelNarrow = (await panel.boundingBox())!
  expect(panelNarrow.height).toBeLessThanOrEqual(844 * 0.6 + 1)
  expect(await panel.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true)
})
