// WP-384 대화 딥링크(모바일) — /?chat=<id> 로 AI 시트를 열고 대화를 복원한 뒤 파라미터를 지운다.
import { mockApi } from '../../fixtures/api-mock'
import { expect, test } from '../../fixtures/mobile.fixture'
import type { HomeMessage } from '../../../src/types/home'

const ID = '3f1c2a4e-8b7d-4c1e-9f2a-6d5b4c3a2e1f'

test('딥링크로 들어오면 AI 시트에 그 대화를 복원하고 파라미터를 지운다', async ({ authenticatedPage: page }) => {
  const messages: HomeMessage[] = [
    { id: 1, role: 'USER', content: '고양이 사진 어디 둘까', widgets: null, toolCalls: null, createdAt: '2026-10-10T00:00:00Z' },
    { id: 2, role: 'ASSISTANT', content: '사진/고양이 폴더에 모으세요', widgets: null, toolCalls: null, createdAt: '2026-10-10T00:00:01Z' },
  ]
  await mockApi(page, 'GET', `/api/v1/home/sessions/${ID}/messages`, messages)
  await mockApi(page, 'GET', `/api/v1/home/sessions/${ID}/proposals`, [])
  await page.goto(`/?chat=${ID}`)
  await expect(page.getByTestId('ai-sheet')).toBeVisible()
  await expect(page.getByTestId('chat-panel')).toContainText('사진/고양이 폴더에 모으세요')
  await expect(page).not.toHaveURL(/chat=/)
})

test('바깥에서 딥링크로 연 시트는 뒤로 가기로 닫히고 화면은 그대로다', async ({ authenticatedPage: page }) => {
  const messages: HomeMessage[] = [
    { id: 1, role: 'USER', content: '고양이 사진 어디 둘까', widgets: null, toolCalls: null, createdAt: '2026-10-10T00:00:00Z' },
    { id: 2, role: 'ASSISTANT', content: '사진/고양이 폴더에 모으세요', widgets: null, toolCalls: null, createdAt: '2026-10-10T00:00:01Z' },
  ]
  await mockApi(page, 'GET', `/api/v1/home/sessions/${ID}/messages`, messages)
  await mockApi(page, 'GET', `/api/v1/home/sessions/${ID}/proposals`, [])
  await page.goto('/settings/profile')
  await page.goto(`/?chat=${ID}`)
  await expect(page.getByTestId('chat-panel')).toContainText('사진/고양이 폴더에 모으세요')
  await page.goBack()
  await expect(page.getByTestId('ai-sheet')).toHaveCount(0)
  await expect(page).toHaveURL(/\/$/)
})

test('시트에서 답 안 화면 링크를 누르면 시트를 닫고 그 화면이 보인다', async ({ authenticatedPage: page }) => {
  const messages: HomeMessage[] = [
    { id: 1, role: 'USER', content: '프로필 어디서 바꿔', widgets: null, toolCalls: null, createdAt: '2026-10-10T00:00:00Z' },
    { id: 2, role: 'ASSISTANT', content: '[프로필 설정](/settings/profile) 에서 바꿀 수 있어요.', widgets: null, toolCalls: null, createdAt: '2026-10-10T00:00:01Z' },
  ]
  await mockApi(page, 'GET', `/api/v1/home/sessions/${ID}/messages`, messages)
  await mockApi(page, 'GET', `/api/v1/home/sessions/${ID}/proposals`, [])
  await page.goto(`/?chat=${ID}`)
  await page.getByTestId('ai-sheet').getByTestId('markdown-internal-link').click()
  await expect(page).toHaveURL(/\/settings\/profile$/)
  await expect(page.getByTestId('ai-sheet')).toHaveCount(0)
  // 앱 레일과 같은 push 이동 — 뒤로 가면 시트를 연 항목으로 돌아와 답을 다시 본다.
  await page.goBack()
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByTestId('ai-sheet')).toBeVisible()
})
