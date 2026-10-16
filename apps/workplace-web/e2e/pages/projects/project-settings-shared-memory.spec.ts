// WP-386 프로젝트 설정의 한 줄 링크 「공용 AI 메모리 n개 · 관리」 — 팀·공개 프로젝트만, 누르면 그 공간이 고른 설정 화면.
import { createMember, createProject } from '../../factories/project.factory'
import { mockApi } from '../../fixtures/api-mock'
import { expect, test } from '../../fixtures/auth.fixture'
import { mockMyAssistantStatus } from '../../fixtures/my-assistant-mock'
import { mockSharedMemory, sharedItem, sharedSpace } from '../../fixtures/shared-memory-mock'
import { gate } from '../../fixtures/wait'

test('팀 프로젝트 설정에 공용 메모리 개수 링크가 있고 누르면 그 공간이 고른 공용 탭으로 간다', async ({ authenticatedPage: page }) => {
  await mockApi(page, 'GET', '/api/v1/projects/WP', createProject({ id: 12, key: 'WP', type: 'TEAM' }))
  await mockApi(page, 'GET', '/api/v1/projects/WP/members', [createMember({ userId: 1 })])
  await mockSharedMemory(page, { spaces: [sharedSpace({})], items: { 'PROJECT:12': [sharedItem(1), sharedItem(2), sharedItem(3)] } })
  await page.goto('/projects/WP/settings')
  const link = page.getByTestId('shared-memory-link')
  await expect(link).toHaveText(/공용 AI 메모리 3개\s*·\s*관리/)
  // 설정 › AI 비서는 개인 비서 상태를 부른다 — 미스텁이면 dev 프록시로 샌다(openSharedMemory 와 같은 스텁).
  await mockMyAssistantStatus(page, () => ({ configured: false, provider: null, model: null, suggestionModelAuto: null }))
  await link.click()
  await expect(page).toHaveURL(/\/settings\/assistant\?memoryTab=shared&space=PROJECT%3A12/)
  await expect(page.getByTestId('shared-space-title')).toHaveText('Smart Workplace(WP)')
})

test('개인 프로젝트에는 링크가 없다', async ({ authenticatedPage: page }) => {
  await mockApi(page, 'GET', '/api/v1/projects/PABC', createProject({ id: 30, key: 'PABC', type: 'PERSONAL' }))
  await mockApi(page, 'GET', '/api/v1/projects/PABC/members', [createMember({ userId: 1 })])
  await mockSharedMemory(page, { spaces: [sharedSpace({})] })
  await page.goto('/projects/PABC/settings')
  await expect(page.getByRole('heading', { name: '프로젝트 설정' })).toBeVisible()
  await expect(page.getByTestId('shared-memory-link')).toHaveCount(0)
})

test('공간 목록을 받는 동안 AI 메모리 섹션 자리를 미리 잡아 아래 섹션이 밀리지 않는다', async ({ authenticatedPage: page }) => {
  await mockApi(page, 'GET', '/api/v1/projects/WP', createProject({ id: 12, key: 'WP', type: 'TEAM' }))
  await mockApi(page, 'GET', '/api/v1/projects/WP/members', [createMember({ userId: 1 })])
  await mockSharedMemory(page, { spaces: [sharedSpace({})], items: { 'PROJECT:12': [sharedItem(1)] } })
  // 공간 목록 응답을 붙잡아 둔다 — 나중에 등록한 route 가 먼저 받는다.
  const held = gate()
  await page.route('**/api/v1/shared-ai-memories/spaces', async (route) => {
    await held.p
    await route.fallback()
  })
  await page.goto('/projects/WP/settings')
  await expect(page.getByTestId('shared-memory-link-pending')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'AI 메모리' })).toBeVisible()
  const members = page.getByRole('heading', { name: '멤버' })
  const before = (await members.boundingBox())!.y
  held.release()
  await expect(page.getByTestId('shared-memory-link')).toHaveText(/공용 AI 메모리 1개/)
  await expect(page.getByTestId('shared-memory-link-pending')).toHaveCount(0)
  // 링크(한 줄)가 자리 잡은 높이를 그대로 쓴다 — 아래 섹션이 거의 움직이지 않는다.
  expect(Math.abs((await members.boundingBox())!.y - before)).toBeLessThanOrEqual(4)
})
