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
