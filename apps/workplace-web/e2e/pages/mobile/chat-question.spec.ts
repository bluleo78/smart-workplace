// WP-373 — 이슈 챗 질문·작성창 안내의 모바일(375px) E2E.
// 긴 안내가 두 줄로 접혀도 잘리지 않는지, 열린 질문 강조가 모바일에서도 보이는지 검증한다. 백엔드는 page.route 로 모킹.
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

test('긴 안내는 두 줄로 접혀도 잘리지 않는다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  const editor = page.getByTestId('chat-composer').locator('.ProseMirror')
  const empty = editor.locator('p.is-editor-empty')
  await expect(empty).toHaveAttribute('data-placeholder', '답변 입력… 멘션 없이 보내도 코디가 이어받아요')
  const box = await editor.boundingBox()
  const lineHeight = await editor.evaluate((el) => parseFloat(getComputedStyle(el).lineHeight))
  expect(box!.height).toBeGreaterThanOrEqual(lineHeight * 2)
  // 단어(어절) 중간에서 줄이 바뀌지 않는다 — 안내를 그리는 ::before 에 keep-all.
  const wordBreak = await empty.evaluate((el) => getComputedStyle(el, '::before').wordBreak)
  expect(wordBreak).toBe('keep-all')
  await expectNoHorizontalOverflow(page)
  await page.screenshot({ path: 'test-results/tc/chat-question/composer-hint-375.png' })
})

test('열린 질문 강조가 모바일에서도 보인다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  await expect(page.locator('[data-message-id="105"]')).toHaveAttribute('data-question', 'open')
  await expect(page.getByTestId('chat-message-question-105')).toHaveText('질문')
  await page.screenshot({ path: 'test-results/tc/chat-question/open-question-375.png' })
})
