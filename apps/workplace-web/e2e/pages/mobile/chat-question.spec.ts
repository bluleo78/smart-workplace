// WP-373 — 이슈 챗 질문·작성창 안내의 모바일(375px) E2E.
// 작성창 안내(WP-1499 — 짧은 placeholder + 아래 한 줄)가 좁은 폭에서도 한 줄 높이를 지키는지, 열린 질문 강조가 모바일에서도 보이는지 검증한다. 백엔드는 page.route 로 모킹.
import { createAgentWork } from '../../factories/agentWork.factory'
import { createChatMember, createChatMessage, createChatThread } from '../../factories/chat.factory'
import { createIssue, createIssueDetail } from '../../factories/issue.factory'
import { createProject } from '../../factories/project.factory'
import { expect, expectNoHorizontalOverflow, test } from '../../fixtures/mobile.fixture'
import { json, KEY } from '../../fixtures/mobile-chat'

const THREAD_ID = 100

test.use({ viewport: { width: 375, height: 800 } })

test.beforeEach(async ({ authenticatedPage: page }) => {
  // 질문한 AI(50)가 답변 대기(INPUT_REQUIRED) — 열린 질문 판정 기준.
  const issue = createIssue({
    id: 1, number: 1, projectKey: KEY, title: '질문 표시',
    agentWork: [createAgentWork({ worker: { id: 50, username: 'codebot', name: '코드 봇', kind: 'AGENT' }, state: 'INPUT_REQUIRED' })],
  })
  const base = `/api/v1/projects/${KEY}/issues/1`
  await page.route(`**/api/v1/projects/${KEY}`, (r) => r.fulfill(json(createProject({ key: KEY }))))
  await page.route((u) => u.pathname === base, (r) => r.fulfill(json(createIssueDetail({ summary: issue }))))
  await page.route((u) => ['watchers', 'labels', 'attachments', 'drive-links'].some((s) => u.pathname === `${base}/${s}`),
    (r) => r.fulfill(json([])))
  for (const p of [`/api/v1/projects/${KEY}/members`, `/api/v1/projects/${KEY}/labels`]) {
    await page.route((u) => u.pathname === p, (r) => r.fulfill(json([])))
  }
  const messages = [
    createChatMessage({
      id: 105, threadId: THREAD_ID, authorId: 50, authorName: '코드 봇', authorKind: 'AGENT',
      body: '배포 전에 확인할 게 있어요. 계속할까요?', question: true, createdAt: '2026-10-14T01:04:00Z',
    }),
  ]
  const thread = createChatThread({
    threadId: THREAD_ID,
    members: [createChatMember({ userId: 1, lastReadMessageId: 105 })],
    recentMessages: messages,
    externalAgent: { id: 77, username: 'kodi', name: '코디', kind: 'AGENT' },
  })
  await page.route(`**${base}/chat/thread`, (r) => r.fulfill(json(thread)))
  await page.route(`**/api/v1/chat/threads/${THREAD_ID}/messages`, (r) =>
    r.request().method() === 'GET'
      ? r.fulfill(json({ items: messages, nextCursor: null, hasMore: false }))
      : r.fallback())
  await page.route(`**/api/v1/chat/threads/${THREAD_ID}/read`, (r) => r.fulfill({ status: 204, body: '' }))
  await page.goto(`/projects/${KEY}/issues/1?chat=1`)
  await expect(page.locator('[data-message-id="105"]')).toBeVisible()
})

// WP-1499: 긴 안내(두 줄 접힘)를 없앴다 — 빈 입력칸은 한 줄 높이로 남고, 담당 AI 설명은 입력칸 아래 한 줄로 보인다.
test('빈 입력칸이 한 줄 높이이고 아래 한 줄 설명이 보인다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  const editor = page.getByTestId('chat-composer').locator('.ProseMirror')
  const empty = editor.locator('p.is-editor-empty')
  // 모바일 뷰포트라도 터치 셸이 아닐 수 있어 Shift+Enter 문구 유무는 보지 않는다.
  await expect(empty).toHaveAttribute('data-placeholder', /^코디에게 메시지/)
  await expect(page.getByTestId('chat-implicit-agent-hint')).toHaveText('담당 AI 코디 · 멘션 없이도 답합니다')
  const m = await empty.evaluate((p) => ({
    h: p.getBoundingClientRect().height,
    lh: parseFloat(getComputedStyle(p).lineHeight),
    // 안내(::before)가 그려진 높이 — 좁은 폭에서 접히면 두 줄 높이가 된다.
    hint: parseFloat(getComputedStyle(p, '::before').height),
    whiteSpace: getComputedStyle(p, '::before').whiteSpace,
  }))
  expect(m.h).toBeLessThan(m.lh * 1.5)
  // 안내도 한 줄로 남는다(넘치면 말줄임 — chat-rich-input.css, WP-1499).
  expect(m.hint).toBeLessThan(m.lh * 1.5)
  expect(m.whiteSpace).toBe('nowrap')
  await expectNoHorizontalOverflow(page)
  await page.screenshot({ path: 'test-results/tc/chat-question/composer-hint-375.png' })
})

test('열린 질문 강조가 모바일에서도 보인다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  await expect(page.locator('[data-message-id="105"]')).toHaveAttribute('data-question', 'open')
  await expect(page.getByTestId('chat-message-question-105')).toHaveText('질문')
  await page.screenshot({ path: 'test-results/tc/chat-question/open-question-375.png' })
})
