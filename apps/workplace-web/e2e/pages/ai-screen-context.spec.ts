// WP-54 — AI 채팅 화면 컨텍스트 E2E: 페이지가 등록한 컨텍스트가 칩으로 보이고 전송 body(screenContext)에 실린다.
import { mockApi } from '../fixtures/api-mock'
import { expect, test } from '../fixtures/auth.fixture'
import { mockHomeChatGeneration } from '../fixtures/home-chat-mock'
import { createIssue, createIssueDetail, createIssueSearchResponse } from '../factories/issue.factory'
import { createChatMessagePage, createChatThread } from '../factories/chat.factory'
import { createProject } from '../factories/project.factory'
import { detail, mailAccount, summary } from '../factories/mail.factory'
import { calendar, calendarEvent } from '../factories/calendar.factory'
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

    const chipHeight = (await page.getByTestId('chat-context-chip').boundingBox())!.height
    await page.getByTestId('chat-context-remove').click()
    // 칩은 사라지지 않고 흐린 "제외" 칩으로 바뀐다 — 뺀 상태가 보이고 되돌릴 수 있어야 한다.
    await expect(page.getByTestId('chat-context-chip')).toHaveCount(0)
    await expect(page.getByTestId('chat-context-chip-excluded')).toContainText('화면 정보 빼고 보내요')
    // 두 상태 높이가 같아 입력 영역이 흔들리지 않는다(레이아웃 이동 없음).
    expect((await page.getByTestId('chat-context-chip-excluded').boundingBox())!.height).toBe(chipHeight)
    await page.getByTestId('chat-input').fill('첫 질문')
    await page.getByRole('button', { name: '보내기' }).click()
    await expect.poll(() => bodies.length).toBe(1)
    expect(bodies[0]).not.toHaveProperty('screenContext')

    // 전송 후 칩 복원 → 두 번째 전송은 컨텍스트 포함.
    await expect(page.getByTestId('chat-context-chip')).toBeVisible()
    await expect(page.getByTestId('chat-context-chip-excluded')).toHaveCount(0)
    await page.getByTestId('chat-input').fill('두 번째 질문')
    await page.getByRole('button', { name: '보내기' }).click()
    await expect.poll(() => bodies.length).toBe(2)
    expect(bodies[1].screenContext?.focus?.refs).toEqual({ issueKey: 'WP-12' })
  })

  test('× 는 키보드(Tab 이동 + Enter)로도 동작하고 입력창으로 포커스가 돌아온다', async ({ authenticatedPage: page }) => {
    const bodies = await captureChat(page)
    await mockIssueDetail(page)
    await page.goto('/projects/WP/issues/12')
    await page.getByTestId('chat-launcher').click()

    // 입력창에서 Shift+Tab 한 번 → 바로 앞(칩의 ×)으로 이동. 접근성 이름으로 찾아 실제 버튼인지 확인.
    await page.getByTestId('chat-input').click()
    await page.keyboard.press('Shift+Tab')
    const remove = page.getByRole('button', { name: '이번 질문에만 화면 정보 빼기(보낸 뒤 다시 포함)' })
    await expect(remove).toBeFocused()
    await expect(remove).toHaveAttribute('data-testid', 'chat-context-remove')
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('chat-context-chip-excluded')).toBeVisible()
    // × 가 사라져도 키보드 포커스를 잃지 않게 입력창으로 이동한다.
    await expect(page.getByTestId('chat-input')).toBeFocused()

    await page.getByTestId('chat-input').fill('키보드로 뺀 뒤 질문')
    await page.getByRole('button', { name: '보내기' }).click()
    await expect.poll(() => bodies.length).toBe(1)
    expect(bodies[0]).not.toHaveProperty('screenContext')
  })

  test('되돌리기는 제외를 취소해 칩을 복원하고 다음 전송에 컨텍스트를 싣는다', async ({ authenticatedPage: page }) => {
    const bodies = await captureChat(page)
    await mockIssueDetail(page)
    await page.goto('/projects/WP/issues/12')
    await page.getByTestId('chat-launcher').click()

    await page.getByTestId('chat-context-remove').click()
    await expect(page.getByTestId('chat-context-chip-excluded')).toBeVisible()
    await page.getByTestId('chat-context-restore').click()
    await expect(page.getByTestId('chat-context-chip')).toContainText('이슈 WP-12 로그인 버그 수정')
    await expect(page.getByTestId('chat-context-chip-excluded')).toHaveCount(0)
    await expect(page.getByTestId('chat-input')).toBeFocused()

    await page.getByTestId('chat-input').fill('되돌린 뒤 질문')
    await page.getByRole('button', { name: '보내기' }).click()
    await expect.poll(() => bodies.length).toBe(1)
    expect(bodies[0].screenContext?.focus?.refs).toEqual({ issueKey: 'WP-12' })
  })

  test('칩은 목적 문구를 보이고, × 와 라벨에 툴팁(Hover·Focus)을 띄운다', async ({ authenticatedPage: page }) => {
    await captureChat(page)
    await mockIssueDetail(page)
    await page.goto('/projects/WP/issues/12')
    await page.getByTestId('chat-launcher').click()

    const chip = page.getByTestId('chat-context-chip')
    await expect(chip).toContainText('화면 참고')
    // × Hover → "이번 1회" 의미 툴팁.
    await page.getByTestId('chat-context-remove').hover()
    await expect(page.getByRole('tooltip')).toContainText('이번 질문에만 빼기 · 보낸 뒤 다시 포함돼요')
    // 라벨 Focus(키보드) → 전체 라벨 툴팁.
    await page.getByTestId('chat-context-label').focus()
    await expect(page.getByRole('tooltip')).toContainText('이슈 WP-12 로그인 버그 수정')
    // 스크린리더 알림 영역에 현재 화면 정보가 실려 있다.
    await expect(page.getByTestId('chat-context-live')).toHaveText('화면 정보: 이슈 WP-12 로그인 버그 수정')
    await page.getByTestId('chat-context-remove').click()
    await expect(page.getByTestId('chat-context-live')).toHaveText('화면 정보 빼고 보내요')
  })

  test('× 후 다른 화면에 갔다 돌아오면 칩이 복원되고 전송에 다시 포함된다', async ({ authenticatedPage: page }) => {
    const bodies = await captureChat(page)
    await mockIssueDetail(page)
    await mockApi(page, 'GET', '/api/v1/projects/WP/issues', { items: [createIssue({ number: 12 })], nextCursor: null, hasMore: false })
    await page.goto('/projects/WP/issues/12')
    await page.getByTestId('chat-launcher').click()
    await page.getByTestId('chat-context-remove').click()
    await expect(page.getByTestId('chat-context-chip-excluded')).toBeVisible()

    // 앱 내부 이동(브레드크럼 → 프로젝트 목록) 후 뒤로가기 — 새로고침 없이 패널 상태가 유지되는 경로.
    await page.getByRole('navigation', { name: '이슈 경로' }).getByRole('link', { name: 'Workplace' }).click()
    await expect(page.getByTestId('chat-context-chip')).toContainText('프로젝트 Workplace 이슈 목록')
    await page.goBack()
    await expect(page.getByTestId('chat-context-chip')).toContainText('이슈 WP-12 로그인 버그 수정')

    await page.getByTestId('chat-input').fill('돌아와서 질문')
    await page.getByRole('button', { name: '보내기' }).click()
    await expect.poll(() => bodies.length).toBe(1)
    expect(bodies[0].screenContext?.focus?.refs).toEqual({ issueKey: 'WP-12' })
  })

  test('등록 화면이 없는 홈에서는 칩이 없고 screenContext 를 보내지 않는다', async ({ authenticatedPage: page }) => {
    const bodies = await captureChat(page)
    await page.goto('/')
    await page.getByTestId('chat-launcher').click()
    await expect(page.getByTestId('chat-context-chip')).toHaveCount(0)
    await expect(page.getByTestId('chat-context-chip-excluded')).toHaveCount(0)
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
    // 실제로 풀스크린에 도달했는지 확인(global-chat.spec 의 모드 순환 검증과 동일 신호).
    await expect(page.getByTestId('chat-launcher')).toHaveAttribute('data-mode', 'fullscreen')
    await expect(page.getByTestId('ai-fullscreen')).toBeVisible()
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
    // 범위 라벨이 화면 이름을 포함하므로 중복 없이 범위 라벨만 표시한다.
    await expect(page.getByTestId('chat-context-chip')).toContainText('프로젝트 Workplace 이슈 목록')
    await expect(page.getByTestId('chat-context-chip')).not.toContainText('이슈 목록 · ')
    await page.getByTestId('chat-input').fill('여기서 급한 거')
    await page.getByRole('button', { name: '보내기' }).click()
    await expect.poll(() => bodies.length).toBe(1)
    expect(bodies[0].screenContext).toMatchObject({ view: '이슈 목록', scope: { refs: { projectKey: 'WP' }, count: 1, hasMore: false } })
    expect(bodies[0].screenContext!.scope!.facts).toEqual(
      expect.arrayContaining([{ label: '상태', value: '할 일' }, { label: '검색어', value: '로그인' }]),
    )
  })
})

test.describe('AI 채팅 화면 컨텍스트 — × 유지', () => {
  test('같은 화면에서 목록 건수가 뒤늦게 도착해도 × 상태가 유지된다', async ({ authenticatedPage: page }) => {
    const bodies = await captureChat(page)
    await mockApi(page, 'GET', '/api/v1/projects/WP', createProject({ name: 'Workplace' }))
    // 이슈 목록 응답을 × 클릭 뒤까지 붙잡아 둔다 — 건수(count·hasMore)가 × 이후에 결정론적으로 도착하도록.
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    await page.route(
      (url) => url.pathname === '/api/v1/projects/WP/issues',
      async (route) => {
        await gate
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ items: [createIssue({ number: 7 })], nextCursor: null, hasMore: false }),
        })
      },
    )
    await page.goto('/projects/WP')
    await page.getByTestId('chat-launcher').click()
    await expect(page.getByTestId('chat-context-chip')).toContainText('프로젝트 Workplace 이슈 목록')
    await page.getByTestId('chat-context-remove').click()
    await expect(page.getByTestId('chat-context-chip-excluded')).toBeVisible()

    release()
    await expect(page.getByTestId('issue-row-7')).toBeVisible()
    // 건수는 휘발 값이라 화면 정체성이 같다 → 제외 상태 유지, 이번 전송엔 컨텍스트 없음.
    await expect(page.getByTestId('chat-context-chip-excluded')).toBeVisible()
    await expect(page.getByTestId('chat-context-chip')).toHaveCount(0)
    await page.getByTestId('chat-input').fill('건수 도착 후 질문')
    await page.getByRole('button', { name: '보내기' }).click()
    await expect.poll(() => bodies.length).toBe(1)
    expect(bodies[0]).not.toHaveProperty('screenContext')

    // 전송 후에는 복원되고, 도착한 건수가 실린다.
    await expect(page.getByTestId('chat-context-chip')).toBeVisible()
    await page.getByTestId('chat-input').fill('다음 질문')
    await page.getByRole('button', { name: '보내기' }).click()
    await expect.poll(() => bodies.length).toBe(2)
    expect(bodies[1].screenContext?.scope).toMatchObject({ count: 1, hasMore: false })
  })
})

test.describe('AI 채팅 화면 컨텍스트 — 내 작업 · AI 위임', () => {
  test('내 작업 탭과 상태 facet 이 목록 범위로 실린다', async ({ authenticatedPage: page }) => {
    const bodies = await captureChat(page)
    await mockApi(page, 'GET', '/api/v1/me/issues', createIssueSearchResponse([createIssue()]))
    await page.goto('/me/tasks/reported?status=IN_PROGRESS')
    await page.getByTestId('chat-launcher').click()
    await expect(page.getByTestId('chat-context-chip')).toContainText('내 작업 · 내가 보고')
    await expect(page.getByTestId('chat-context-chip')).not.toContainText('내 작업 · 내 작업')
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
    await expect(page.getByTestId('chat-context-chip')).toContainText('AI 위임 작업')
    await page.getByTestId('chat-input').fill('진행 상황 알려줘')
    await page.getByRole('button', { name: '보내기' }).click()
    await expect.poll(() => bodies.length).toBe(1)
    expect(bodies[0].screenContext).toEqual({ view: 'AI 위임 작업', scope: { label: 'AI 위임 작업', count: 2 } })
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

test.describe('AI 채팅 화면 컨텍스트 — 메일', () => {
  test('열린 메일의 messageId·제목과 폴더가 실린다', async ({ authenticatedPage: page }) => {
    const bodies = await captureChat(page)
    // 메일 계정/목록/상세 목 — mail-inbox.spec.ts 와 같은 팩토리. 계정 id=3, 목록에 id=91 '견적 요청' 1건.
    await mockApi(page, 'GET', '/api/v1/mail/accounts', [mailAccount({ id: 3 })])
    await mockApi(page, 'GET', '/api/v1/mail/accounts/3/messages', [
      summary({ id: 91, accountId: 3, subject: '견적 요청', fromName: '김철수', fromAddress: 'kim@a.com' }),
    ])
    await mockApi(page, 'GET', '/api/v1/mail/messages/91', detail({ id: 91, subject: '견적 요청' }))
    await page.goto('/mail/3?messageId=91')
    await page.getByTestId('chat-launcher').click()

    await expect(page.getByTestId('chat-context-chip')).toContainText('메일 견적 요청')
    await page.getByTestId('chat-input').fill('이 메일 요약해줘')
    await page.getByRole('button', { name: '보내기' }).click()

    await expect.poll(() => bodies.length).toBe(1)
    expect(bodies[0].screenContext).toMatchObject({
      view: '메일함',
      focus: { type: '메일', label: '견적 요청', refs: { messageId: '91' } },
      scope: { refs: { accountId: '3', folder: 'INBOX' }, count: 1 },
    })
  })
})

test.describe('AI 채팅 화면 컨텍스트 — 캘린더', () => {
  // 오늘 정오(UTC) 일정 — 기본 월 보기에 항상 보이도록 팩토리 기본 날짜(2026-06)를 덮어쓴다.
  const startsAt = new Date(new Date().toISOString().slice(0, 10) + 'T03:00:00Z')
  const ev = calendarEvent({
    id: 42, title: '주간회의', location: '3층',
    startsAt: startsAt.toISOString(), endsAt: new Date(startsAt.getTime() + 3600_000).toISOString(),
  })
  async function mockCalendar(page: Parameters<typeof mockApi>[0]) {
    await mockApi(page, 'GET', '/api/v1/calendars', [calendar()])
    await mockApi(page, 'GET', '/api/v1/calendar/events', [ev])
    await mockApi(page, 'GET', '/api/v1/calendar/events/42', ev)
  }

  test('?eventId 딥링크로 열린 일정이 칩에 반영된다', async ({ authenticatedPage: page }) => {
    await captureChat(page)
    await mockCalendar(page)
    await page.goto('/calendar?eventId=42')
    await expect(page.getByTestId('calendar-event-dialog')).toBeVisible()
    // 모달 다이얼로그가 런처 클릭을 가로막을 수 있어 ⌘K 로 AI 패널을 연다.
    await page.keyboard.press('ControlOrMeta+k')
    await expect(page.getByTestId('chat-context-chip')).toContainText('일정 주간회의')
  })

  test('사이드 패널을 연 채 일정을 열고, 다이얼로그 위에서 패널에 입력·전송하면 eventId 가 실린다', async ({ authenticatedPage: page }) => {
    const bodies = await captureChat(page)
    await mockCalendar(page)
    await page.goto('/calendar')
    await expect(page.getByTestId('calendar-event-42')).toBeVisible()
    await page.getByTestId('chat-launcher').click()
    await expect(page.getByTestId('chat-context-chip')).toContainText('월 보기')
    // 실사용 흐름 — 일정 클릭으로 다이얼로그를 연 뒤 패널 입력창을 실제로 클릭·타이핑·전송한다(force/dispatch 없음).
    await page.getByTestId('calendar-event-42').click()
    const dialog = page.getByTestId('calendar-event-dialog')
    await expect(dialog).toBeVisible()
    await expect(page.getByTestId('chat-context-chip')).toContainText('일정 주간회의')
    await page.getByTestId('chat-input').click()
    await page.getByTestId('chat-input').fill('이 회의 참석자 알려줘')
    await page.getByRole('button', { name: '보내기' }).click()

    await expect.poll(() => bodies.length).toBe(1)
    expect(bodies[0].screenContext).toMatchObject({
      view: '캘린더',
      focus: { type: '일정', label: '주간회의', refs: { eventId: '42' } },
      scope: { label: '월 보기', count: 1 },
    })
    expect(bodies[0].screenContext!.scope!.refs).toHaveProperty('from')
    expect(bodies[0].screenContext!.focus!.facts).toContainEqual({ label: '장소', value: '3층' })
    // 패널 조작 후에도 다이얼로그는 열려 있다.
    await expect(dialog).toBeVisible()
  })

  test('패널 클릭은 다이얼로그를 유지하고, 페이지 영역 클릭은 다이얼로그를 닫는다', async ({ authenticatedPage: page }) => {
    await captureChat(page)
    await mockCalendar(page)
    await page.goto('/calendar')
    await page.getByTestId('chat-launcher').click()
    await page.getByTestId('calendar-event-42').click()
    const dialog = page.getByTestId('calendar-event-dialog')
    await expect(dialog).toBeVisible()

    // 패널 내부(입력창·패널 본문) 클릭 → 다이얼로그 유지.
    await page.getByTestId('chat-input').click()
    await page.getByTestId('ai-side-panel').click({ position: { x: 40, y: 200 } })
    await expect(dialog).toBeVisible()
    // 패널 dim 없음 — 오버레이는 페이지 영역만 덮는다(패널 좌단에서 끝남).
    const overlay = await page.getByTestId('ai-aware-dialog-overlay').boundingBox()
    const panel = await page.getByTestId('ai-side-panel').boundingBox()
    expect(overlay!.x + overlay!.width).toBeLessThanOrEqual(panel!.x + 1)
    // 다이얼로그도 패널을 가리지 않는다.
    const dlg = await dialog.boundingBox()
    expect(dlg!.x + dlg!.width).toBeLessThanOrEqual(panel!.x + 1)

    // 페이지 영역(다이얼로그 바깥, 패널 아님) 클릭 → 닫힘.
    await page.mouse.click(dlg!.x - 40, dlg!.y + 40)
    await expect(dialog).toBeHidden()
    await expect(page.getByTestId('ai-aware-dialog-overlay')).toHaveCount(0)
    await expect(page.getByTestId('ai-side-panel')).toBeVisible()
  })

  test('패널 입력창의 Esc 는 패널만 닫고 다이얼로그는 유지된다(이후 모달 복귀)', async ({ authenticatedPage: page }) => {
    await captureChat(page)
    await mockCalendar(page)
    await page.goto('/calendar')
    await page.getByTestId('chat-launcher').click()
    await page.getByTestId('calendar-event-42').click()
    const dialog = page.getByTestId('calendar-event-dialog')
    await expect(dialog).toBeVisible()
    await page.getByTestId('chat-input').click()
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('ai-side-panel')).toBeHidden()
    await expect(dialog).toBeVisible()
    // 패널이 닫히면 다시 modal — Radix 오버레이가 돌아오고 포커스가 다이얼로그 안에 있다.
    await expect(page.locator('[data-slot=dialog-overlay]')).toBeVisible()
    await expect.poll(() => dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true)
    // 다이얼로그 안의 Esc 는 기존처럼 다이얼로그를 닫는다.
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
  })

  test('다이얼로그를 연 채 ⌘K 로 패널을 열면 곧바로 입력되고, 편집 중인 값은 유지된다', async ({ authenticatedPage: page }) => {
    await captureChat(page)
    await mockCalendar(page)
    await page.goto('/calendar')
    await page.getByTestId('calendar-event-42').click()
    const dialog = page.getByTestId('calendar-event-dialog')
    await expect(dialog).toBeVisible()
    const title = dialog.getByLabel('제목')
    await title.fill('주간회의 (수정)')
    await page.keyboard.press('ControlOrMeta+k')
    await expect(page.getByTestId('ai-side-panel')).toBeVisible()
    // 클릭 없이 바로 타이핑 — 포커스가 패널 입력창으로 가야 한다.
    await expect(page.getByTestId('chat-input')).toBeFocused()
    await page.keyboard.type('참석자?')
    await expect(page.getByTestId('chat-input')).toHaveValue('참석자?')
    await expect(dialog).toBeVisible()
    await expect(title).toHaveValue('주간회의 (수정)')
  })

  test('패널의 대화 선택 드롭다운·삭제 확인을 써도 다이얼로그는 유지된다', async ({ authenticatedPage: page }) => {
    await captureChat(page)
    await mockCalendar(page)
    await mockApi(page, 'GET', '/api/v1/home/sessions', {
      items: [{ id: 'sc1', title: '테스트 대화', lastMessageAt: '2026-06-08T00:00:00Z', widgetCount: 0 }],
      nextCursor: null,
    })
    await page.goto('/calendar')
    await page.getByTestId('chat-launcher').click()
    await page.getByTestId('calendar-event-42').click()
    const dialog = page.getByTestId('calendar-event-dialog')
    await expect(dialog).toBeVisible()

    // 드롭다운(body 포털, 포커스 이동) — 열고 Esc 로 닫아도 다이얼로그 유지.
    await page.getByTestId('chat-session-switcher').click()
    await expect(page.getByTestId('chat-session-item')).toHaveCount(1)
    await expect(dialog).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('chat-session-item')).toHaveCount(0)
    await expect(dialog).toBeVisible()

    // 삭제 확인 AlertDialog(패널에서 연 modal 레이어) — 열고 취소해도 다이얼로그 유지.
    await page.getByTestId('chat-session-switcher').click()
    await page.getByTestId('chat-session-delete').click()
    await expect(page.getByRole('alertdialog')).toBeVisible()
    await expect(dialog).toBeVisible()
    await page.getByRole('button', { name: '취소' }).click()
    await expect(page.getByRole('alertdialog')).toBeHidden()
    await expect(dialog).toBeVisible()
  })

  test('모바일(<lg): 패널은 다이얼로그 위 풀스크린으로 입력 가능하고, 닫으면 다이얼로그로 돌아온다', async ({ authenticatedPage: page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await captureChat(page)
    await mockCalendar(page)
    await page.goto('/calendar?eventId=42')
    const dialog = page.getByTestId('calendar-event-dialog')
    await expect(dialog).toBeVisible()
    await page.keyboard.press('ControlOrMeta+k')
    // 풀스크린 패널(z-[60])이 다이얼로그(z-50)를 덮고, 입력창은 실제 클릭·타이핑된다.
    await page.getByTestId('chat-input').click()
    await page.getByTestId('chat-input').fill('참석자?')
    await expect(page.getByTestId('chat-input')).toHaveValue('참석자?')
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('ai-side-panel')).toBeHidden()
    await expect(dialog).toBeVisible()
    await expect(page.locator('[data-slot=dialog-overlay]')).toBeVisible()
  })

  test('스크린샷 — 일정 다이얼로그와 사이드 패널 동시 표시(라이트/다크)', async ({ authenticatedPage: page }) => {
    for (const theme of ['light', 'dark'] as const) {
      await page.addInitScript((t) => window.localStorage.setItem('theme', t), theme)
      await captureChat(page)
      await mockCalendar(page)
      await page.goto('/calendar')
      await page.getByTestId('chat-launcher').click()
      await page.getByTestId('calendar-event-42').click()
      await expect(page.getByTestId('calendar-event-dialog')).toBeVisible()
      await page.getByTestId('chat-input').fill('이 회의 참석자 알려줘')
      await page.screenshot({ path: `test-results/tc/ai-screen-context/modal-with-panel-${theme}.png` })
    }
  })
})

test.describe('AI 채팅 — 드라이브 미리보기 모달 위 입력', () => {
  // drive-preview-formats.spec.ts 의 파일목록 + 미리보기 목 집합을 최소로 재사용한다.
  const FILE = {
    id: 80, folderId: null, fileId: 300, name: 'notes.txt', mimeType: 'text/plain',
    sizeBytes: 12, category: 'TEXT', createdAt: '2026-01-01T00:00:00Z',
  }
  async function mockDrive(page: Parameters<typeof mockApi>[0]) {
    await mockApi(page, 'GET', '/api/v1/drive/spaces', [
      { id: 1, type: 'PERSONAL', name: '내 드라이브', ownerId: 1, role: 'OWNER', archived: false, createdAt: '2026-06-01T00:00:00Z' },
    ])
    await mockApi(page, 'GET', '/api/v1/drive/quota', { usedBytes: 0, quotaBytes: 10737418240 })
    await mockApi(page, 'GET', '/api/v1/drive/spaces/1/items', { folders: [], files: [FILE] })
    await page.route((u) => u.pathname === `/api/v1/drive/files/${FILE.id}/thumbnail`, (r) => r.fulfill({ status: 404, body: '' }))
    await page.route((u) => u.pathname === `/api/v1/drive/files/${FILE.id}/content`, (r) =>
      r.fulfill({ status: 200, contentType: 'text/plain', body: 'hello notes' }))
    await mockApi(page, 'GET', `/api/v1/drive/files/${FILE.id}/summary`, { summary: null, status: 'PENDING' })
    await mockApi(page, 'GET', `/api/v1/drive/files/${FILE.id}/backlinks`, [])
  }

  test('미리보기 모달을 연 채 사이드 패널에 입력·전송할 수 있고 모달은 유지된다', async ({ authenticatedPage: page }) => {
    const bodies = await captureChat(page)
    await mockDrive(page)
    await page.goto('/drive/spaces/1')
    await page.getByTestId('chat-launcher').click()
    await expect(page.getByTestId('ai-side-panel')).toBeVisible()
    await page.getByRole('button', { name: 'notes.txt' }).click()
    const preview = page.getByTestId('preview-body')
    await expect(preview).toBeVisible()

    await page.getByTestId('chat-input').click()
    await page.getByTestId('chat-input').fill('이 파일 요약해줘')
    await page.getByRole('button', { name: '보내기' }).click()
    await expect.poll(() => bodies.length).toBe(1)
    expect(bodies[0].query).toBe('이 파일 요약해줘')
    await expect(preview).toBeVisible()
    // 넓은 미리보기(w-[64rem])도 패널을 가리지 않도록 페이지 영역 안으로 클램프된다.
    const dlg = await page.getByRole('dialog').boundingBox()
    const panel = await page.getByTestId('ai-side-panel').boundingBox()
    expect(dlg!.x + dlg!.width).toBeLessThanOrEqual(panel!.x + 1)
  })
})
