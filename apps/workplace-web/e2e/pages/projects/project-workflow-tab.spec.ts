import type { Page } from '@playwright/test'

import { createProject } from '../../factories/project.factory'
import { expect, test } from '../../fixtures/auth.fixture'

/** 실제 라우터가 읽는 등록된 초안과 검증 응답을 스텁한다. */
async function mockWorkflow(page: Page) {
  const yaml = 'name: 작업 정리\nnodes:\n  review: {}'
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

/** 「+ 노드」로 더한 노드가 캔버스 안에 들어온다(WP-2039) — jsdom 이 못 재는 기하라 브라우저에서 본다. */
test('workflowGraph_addNode_keepsNewNodeInsideCanvas', { tag: ['@layout'] }, async ({ authenticatedPage: page }) => {
  await mockWorkflow(page)
  await page.route('**/api/v1/workflows/42/draft', (route) => route.fulfill({ json: { draftUpdatedAt: '2026-11-24T10:00:00Z', problems: [] } }))
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/projects/WP/workflow')
  await page.getByRole('button', { name: '그래프' }).click()
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
