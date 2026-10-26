// WP-384 대화 딥링크(데스크톱) — /?aiChat=<id> 로 사이드 패널을 열고 대화를 복원한 뒤 파라미터를 지운다(@wiring 대표 1건)와
// 말풍선 안 단계 줄 정렬(@layout)만 남긴다. 없는 대화 토스트·답 안 대화/외부 링크·첫 30개 밖 제목·다른 쿼리·히스토리 보존·
// 전체 화면에서 화면 링크 → 사이드·뒤로 가기는 페이지 테스트 src/components/ai/aiChatDeepLink.test.tsx 가 지킨다(WP-971).
// 모양이 틀린 id 를 서버에 묻지 않는 규칙은 aiChatLink.test.ts(isSessionId).
import type { Page } from '@playwright/test'

import { expect, test } from '../fixtures/auth.fixture'
import { mockApi } from '../fixtures/api-mock'
import { stableBox } from '../fixtures/wait'
import type { HomeMessage } from '../../src/types/home'

const ID = '3f1c2a4e-8b7d-4c1e-9f2a-6d5b4c3a2e1f'

/** 질문·답 한 턴 이력. */
function turn(question: string, answer: string): HomeMessage[] {
  return [
    { id: 1, role: 'USER', content: question, widgets: null, toolCalls: null, createdAt: '2026-10-10T00:00:00Z' },
    { id: 2, role: 'ASSISTANT', content: answer, widgets: null, toolCalls: null, createdAt: '2026-10-10T00:00:01Z' },
  ]
}

async function mockSession(page: Page, id: string, messages: HomeMessage[]) {
  await mockApi(page, 'GET', `/api/v1/home/sessions/${id}/messages`, messages)
  await mockApi(page, 'GET', `/api/v1/home/sessions/${id}/proposals`, [])
}

test('딥링크로 들어오면 사이드 패널에 그 대화를 복원하고 주소의 chat 파라미터를 지운다', { tag: '@wiring' }, async ({ authenticatedPage: page }) => {
  await mockSession(page, ID, turn('고양이 사진 어디 둘까', '사진/고양이 폴더에 모으세요'))
  await page.goto(`/?aiChat=${ID}`)
  await expect(page.getByTestId('ai-side-panel')).toBeVisible()
  await expect(page.getByTestId('chat-panel')).toContainText('사진/고양이 폴더에 모으세요')
  await expect(page).not.toHaveURL(/aiChat=/)
})

test('말풍선 안 단계 줄은 본문 왼쪽 선에 맞고 ✓ 는 라벨 바로 뒤에 붙는다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  // 본문이 길어 말풍선이 패널 폭까지 넓어진 경우 — 상태가 행 끝으로 밀리면 라벨과 멀어진다.
  const messages = turn('지난번 고양이 얘기 찾아 줘', '고양이 사진은 앨범에 모으기로 했어요. 폴더 이름은 사진/고양이로 정했고 매달 정리하기로 했습니다.')
  messages[1].toolCalls = [
    { kind: 'tool', seq: 1, toolName: 'search_conversations', args: { query: '고양이' }, status: 'done' },
  ]
  await mockSession(page, ID, messages)
  await page.goto(`/?aiChat=${ID}`)
  const row = page.getByTestId('tool-step-tool')
  await expect(row).toContainText('지난 대화 찾기')
  const body = await stableBox(page.getByTestId('chat-panel').getByTestId('markdown-content'))
  // 행의 첫 글자(아이콘)가 본문 왼쪽 선에 있다 — 위임 없이 부른 도구는 들여 쓰지 않는다.
  const icon = await stableBox(row.locator('span').first())
  expect(Math.abs(icon.x - body.x)).toBeLessThanOrEqual(1)
  const label = await stableBox(row.getByText('지난 대화 찾기'))
  const check = await stableBox(row.getByText('✓'))
  // 넓은 패널에서도 상태가 라벨 곁에 있다(행 끝으로 밀리지 않는다).
  expect(check.x).toBeGreaterThan(label.x + label.width)
  expect(check.x - (label.x + label.width)).toBeLessThan(120)
})
