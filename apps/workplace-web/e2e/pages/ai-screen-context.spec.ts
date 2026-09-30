// WP-54 — AI 채팅 화면 컨텍스트 E2E: 페이지가 등록한 컨텍스트가 칩으로 보이고 전송 body(screenContext)에 실린다.
import { mockApi } from '../fixtures/api-mock'
import { expect, test } from '../fixtures/auth.fixture'
import { mockHomeChatGeneration } from '../fixtures/home-chat-mock'
import { createIssue, createIssueDetail, createIssueSearchResponse } from '../factories/issue.factory'
import { createChatMessagePage, createChatThread } from '../factories/chat.factory'
import { createProject } from '../factories/project.factory'
import type { AiScreenContext } from '../../src/types/aiScreenContext'

// 전송 body 를 순서대로 모은다.
async function captureChat(page: Parameters<typeof mockHomeChatGeneration>[0]) {
  const bodies: { query: string; screenContext?: AiScreenContext }[] = []
  await mockHomeChatGeneration(page, {
    onStart: (b) => bodies.push(b),
    frames: [{ event: 'done', data: { sessionId: 's-ctx' } }],
  })
  return bodies
}

// 이슈 상세 화면 목 — projects.spec.ts 의 이슈 상세 단계와 같은 목 집합.
async function mockIssueDetail(page: Parameters<typeof mockApi>[0]) {
  await mockApi(page, 'GET', '/api/v1/projects/WP', createProject())
  await mockApi(
    page, 'GET', '/api/v1/projects/WP/issues/12',
    createIssueDetail({ summary: createIssue({ number: 12, title: '로그인 버그 수정', status: 'IN_PROGRESS', priority: 'HIGH' }) }),
  )
}

test.describe('AI 채팅 화면 컨텍스트 — 공통', () => {
  test('이슈 상세에서 칩이 보이고 전송 body 에 screenContext 가 실린다', { tag: '@smoke' }, async ({ authenticatedPage: page }) => {
    const bodies = await captureChat(page)
    await mockIssueDetail(page)
    await page.goto('/projects/WP/issues/12')
    await page.getByTestId('chat-launcher').click()

    await expect(page.getByTestId('chat-context-chip')).toContainText('이슈 WP-12 로그인 버그 수정')
    await page.getByTestId('chat-input').fill('이거 요약해줘')
    await page.getByRole('button', { name: '보내기' }).click()

    await expect.poll(() => bodies.length).toBe(1)
    expect(bodies[0]).toMatchObject({
      query: '이거 요약해줘',
      screenContext: {
        view: '이슈 상세',
        focus: { type: '이슈', label: 'WP-12 로그인 버그 수정', refs: { issueKey: 'WP-12' } },
        scope: { label: '프로젝트 WP', refs: { projectKey: 'WP' } },
      },
    })
    expect(bodies[0].screenContext!.focus!.facts).toContainEqual({ label: '상태', value: '진행 중' })
  })

  test('× 는 다음 1회 전송만 컨텍스트를 빼고, 그 다음 전송에는 다시 포함한다', async ({ authenticatedPage: page }) => {
    const bodies = await captureChat(page)
    await mockIssueDetail(page)
    await page.goto('/projects/WP/issues/12')
    await page.getByTestId('chat-launcher').click()

    await page.getByTestId('chat-context-remove').click()
    await expect(page.getByTestId('chat-context-chip')).toHaveCount(0)
    await page.getByTestId('chat-input').fill('첫 질문')
    await page.getByRole('button', { name: '보내기' }).click()
    await expect.poll(() => bodies.length).toBe(1)
    expect(bodies[0].screenContext).toBeUndefined()

    // 전송 후 칩 복원 → 두 번째 전송은 컨텍스트 포함.
    await expect(page.getByTestId('chat-context-chip')).toBeVisible()
    await page.getByTestId('chat-input').fill('두 번째 질문')
    await page.getByRole('button', { name: '보내기' }).click()
    await expect.poll(() => bodies.length).toBe(2)
    expect(bodies[1].screenContext?.focus?.refs).toEqual({ issueKey: 'WP-12' })
  })

  test('× 는 키보드(포커스 + Enter)로도 동작하고 다음 전송에서 컨텍스트를 뺀다', async ({ authenticatedPage: page }) => {
    const bodies = await captureChat(page)
    await mockIssueDetail(page)
    await page.goto('/projects/WP/issues/12')
    await page.getByTestId('chat-launcher').click()

    // 접근성 이름이 있는 실제 버튼인지 + 포커스 가능한지 확인 후 Enter 로 활성화.
    const remove = page.getByRole('button', { name: '이번 질문에서 화면 정보 빼기' })
    await expect(remove).toHaveAttribute('data-testid', 'chat-context-remove')
    await remove.focus()
    await expect(remove).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('chat-context-chip')).toHaveCount(0)

    await page.getByTestId('chat-input').fill('키보드로 뺀 뒤 질문')
    await page.getByRole('button', { name: '보내기' }).click()
    await expect.poll(() => bodies.length).toBe(1)
    expect(bodies[0]).not.toHaveProperty('screenContext')
  })

  test('등록 화면이 없는 홈에서는 칩이 없고 screenContext 를 보내지 않는다', async ({ authenticatedPage: page }) => {
    const bodies = await captureChat(page)
    await page.goto('/')
    await page.getByTestId('chat-launcher').click()
    await expect(page.getByTestId('chat-context-chip')).toHaveCount(0)
    await page.getByTestId('chat-input').fill('안녕')
    await page.getByRole('button', { name: '보내기' }).click()
    await expect.poll(() => bodies.length).toBe(1)
    expect(bodies[0]).not.toHaveProperty('screenContext')
  })

  test('풀스크린에서도 뒤 화면 컨텍스트를 유지한다', async ({ authenticatedPage: page }) => {
    const bodies = await captureChat(page)
    await mockIssueDetail(page)
    await page.goto('/projects/WP/issues/12')
    await page.getByTestId('chat-launcher').click()
    // 사이드 → 풀스크린 전환 버튼(global-chat.spec 의 풀스크린 전환 셀렉터와 동일한 것을 사용).
    await page.getByTestId('chat-launcher').click()
    await expect(page.getByTestId('chat-context-chip')).toContainText('WP-12')
    await page.getByTestId('chat-input').fill('이거')
    await page.getByRole('button', { name: '보내기' }).click()
    await expect.poll(() => bodies.length).toBe(1)
    expect(bodies[0].screenContext?.focus?.refs).toEqual({ issueKey: 'WP-12' })
  })
})

test.describe('AI 채팅 화면 컨텍스트 — 이슈 목록', () => {
  test('프로젝트 이슈 목록의 필터가 이름으로 실린다', async ({ authenticatedPage: page }) => {
    const bodies = await captureChat(page)
    await mockApi(page, 'GET', '/api/v1/projects/WP', createProject({ name: 'Workplace' }))
    await mockApi(page, 'GET', '/api/v1/projects/WP/issues', { items: [createIssue()], nextCursor: null, hasMore: false })
    await page.goto('/projects/WP?status=TODO&q=%EB%A1%9C%EA%B7%B8%EC%9D%B8')
    await page.getByTestId('chat-launcher').click()
    await expect(page.getByTestId('chat-context-chip')).toContainText('이슈 목록 · 프로젝트 Workplace 이슈 목록')
    await page.getByTestId('chat-input').fill('여기서 급한 거')
    await page.getByRole('button', { name: '보내기' }).click()
    await expect.poll(() => bodies.length).toBe(1)
    expect(bodies[0].screenContext).toMatchObject({ view: '이슈 목록', scope: { refs: { projectKey: 'WP' }, count: 1, hasMore: false } })
    expect(bodies[0].screenContext!.scope!.facts).toEqual(
      expect.arrayContaining([{ label: '상태', value: '할 일' }, { label: '검색어', value: '로그인' }]),
    )
  })
})

test.describe('AI 채팅 화면 컨텍스트 — 내 작업 · AI 위임', () => {
  test('내 작업 탭과 상태 facet 이 목록 범위로 실린다', async ({ authenticatedPage: page }) => {
    const bodies = await captureChat(page)
    await mockApi(page, 'GET', '/api/v1/me/issues', createIssueSearchResponse([createIssue()]))
    await page.goto('/me/tasks/reported?status=IN_PROGRESS')
    await page.getByTestId('chat-launcher').click()
    await expect(page.getByTestId('chat-context-chip')).toContainText('내가 보고')
    await page.getByTestId('chat-input').fill('이 중 급한 거')
    await page.getByRole('button', { name: '보내기' }).click()
    await expect.poll(() => bodies.length).toBe(1)
    expect(bodies[0].screenContext).toEqual({
      view: '내 작업',
      scope: { label: '내 작업 · 내가 보고', facts: [{ label: '상태', value: '진행 중' }] },
    })
  })

  test('AI 위임 작업은 AGENT 담당만 센 건수를 싣는다', async ({ authenticatedPage: page }) => {
    const bodies = await captureChat(page)
    const agent = { id: 9, username: 'claude', name: 'Claude', kind: 'AGENT' as const }
    const human = { id: 1, username: 'kim', name: '김사람', kind: 'HUMAN' as const }
    await mockApi(
      page, 'GET', '/api/v1/me/issues',
      createIssueSearchResponse([
        createIssue({ id: 31, assignees: [agent] }),
        createIssue({ id: 32, assignees: [human] }),
        createIssue({ id: 33, assignees: [agent] }),
      ]),
    )
    await page.goto('/me/ai-tasks')
    await expect(page.getByTestId('ai-row-31')).toBeVisible()
    await page.getByTestId('chat-launcher').click()
    await page.getByTestId('chat-input').fill('진행 상황 알려줘')
    await page.getByRole('button', { name: '보내기' }).click()
    await expect.poll(() => bodies.length).toBe(1)
    expect(bodies[0].screenContext).toEqual({ view: 'AI 위임 작업', scope: { label: 'AI 에게 위임한 작업', count: 2 } })
  })
})

test.describe('AI 채팅 화면 컨텍스트 — 개인 프로젝트', () => {
  // personal-project-detail.spec.ts 의 mockPersonal/mockTaskDetail 과 같은 목 집합.
  test('열린 개인 태스크가 대상으로, 범위는 개인 프로젝트로 실린다', async ({ authenticatedPage: page }) => {
    const bodies = await captureChat(page)
    const KEY = 'PME'
    await mockApi(page, 'GET', `/api/v1/projects/${KEY}`, createProject({ id: 7, key: KEY, name: '개인 작업', type: 'PERSONAL', isDefault: true }))
    await mockApi(page, 'GET', `/api/v1/projects/${KEY}/issues`, createIssueSearchResponse([createIssue({ projectKey: KEY, number: 1, title: '블로그 초안' })]))
    await mockApi(page, 'GET', `/api/v1/projects/${KEY}/labels`, [])
    await mockApi(page, 'GET', `/api/v1/projects/${KEY}/cycles`, [])
    await mockApi(page, 'GET', `/api/v1/projects/${KEY}/types`, [])
    await mockApi(page, 'GET', `/api/v1/projects/${KEY}/issues/1`, createIssueDetail({ summary: createIssue({ projectKey: KEY, number: 1, title: '블로그 초안' }) }))
    const thread = createChatThread()
    await mockApi(page, 'GET', `/api/v1/projects/${KEY}/issues/1/chat/thread`, thread)
    await mockApi(page, 'GET', `/api/v1/chat/threads/${thread.threadId}/messages`, createChatMessagePage([]))

    await page.goto(`/projects/${KEY}?task=1`)
    await expect(page.getByTestId('personal-task-panel')).toBeVisible()
    await page.getByTestId('chat-launcher').click()
    await expect(page.getByTestId('chat-context-chip')).toContainText('이슈 PME-1 블로그 초안')
    await page.getByTestId('chat-input').fill('이거 정리해줘')
    // 패널 내 이슈 AI 대화 입력바에도 '보내기'가 있어 글로벌 채팅 패널로 범위를 좁힌다.
    await page.getByTestId('chat-panel').getByRole('button', { name: '보내기' }).click()
    await expect.poll(() => bodies.length).toBe(1)
    expect(bodies[0].screenContext).toMatchObject({
      view: '이슈 상세',
      focus: { refs: { issueKey: 'PME-1' } },
      scope: { label: '개인 프로젝트', refs: { projectKey: KEY } },
    })
  })
})
