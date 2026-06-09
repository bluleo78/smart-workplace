import { expect, test } from '../fixtures/auth.fixture'
import { mockApi } from '../fixtures/api-mock'
import type { HomeMessage, HomeSessionPage } from '../../src/types/home'

// global-chat.spec.ts — AI 어시스턴트 신규 모드(side/fullscreen/chip) E2E.
// FloatingChat 모달은 제거됨. 칩(chat-launcher) 클릭 → side → fullscreen → closed 순환.
// 기존 chat→compose→캔버스 payload 검증 케이스는 side 오픈 후 동일하게 유지.

const mockChatSessions = async (page: Parameters<typeof mockApi>[0], sessions: HomeSessionPage) => {
  await mockApi(page, 'GET', '/api/v1/home/sessions', sessions)
}

// ── 기존 케이스 (모달→side 오픈 방식으로 유지) ──────────────────────────────

test('입력이 비어 있으면 보내기 버튼이 비활성(disabled)이어야 한다', async ({ authenticatedPage: page }) => {
  // 보내기 버튼의 disabled 속성이 입력 상태와 동기화되는지 검증 (이슈 #144 회귀 방지)
  await page.goto('/')
  await page.getByTestId('chat-launcher').click() // → side 모드
  const sendBtn = page.getByRole('button', { name: '보내기' })

  // 1) 입력 비어 있음 → 버튼 비활성
  await expect(sendBtn).toBeDisabled()

  // 2) 텍스트 입력 후 → 버튼 활성
  await page.getByTestId('chat-input').fill('안녕')
  await expect(sendBtn).toBeEnabled()

  // 3) 입력 지우면 → 다시 비활성
  await page.getByTestId('chat-input').fill('')
  await expect(sendBtn).toBeDisabled()
})

test('이슈 페이지에서도 챗 런처가 상주한다', { tag: '@smoke' }, async ({ authenticatedPage: page }) => {
  // 챗 런처는 AppLayout(전역 셸)에 있다. 이슈 페이지가 정상 렌더돼야(에러 바운더리 미발동)
  // 런처도 함께 상주함을 확인할 수 있으므로 프로젝트 목록을 빈 페이지로 모킹한다.
  await mockApi(page, 'GET', '/api/v1/projects', {
    content: [],
    page: 0,
    size: 20,
    totalElements: 0,
    totalPages: 0,
  })
  await page.goto('/projects')
  // 평소엔 칩(런처)만 보이고, 클릭하면 사이드 패널이 펼쳐진다.
  await expect(page.getByTestId('chat-launcher')).toBeVisible()
  await page.getByTestId('chat-launcher').click()
  await expect(page.getByTestId('chat-input')).toBeVisible()
})

test('비-홈(이슈) 페이지에서 챗 제출 시 홈으로 이동해 캔버스를 구성한다', { tag: '@smoke' }, async ({
  authenticatedPage: page,
}) => {
  // 이슈 페이지 렌더용 프로젝트 목록 + compose 응답 모킹.
  // 세션/me/* 는 auth fixture 의 빈 스텁을 사용(홈 기본 구성은 빈 위젯이라도 home-widget 으로 렌더됨).
  await mockApi(page, 'GET', '/api/v1/projects', {
    content: [],
    page: 0,
    size: 20,
    totalElements: 0,
    totalPages: 0,
  })
  const composeCapture = await mockApi(
    page,
    'POST',
    '/api/v1/home/compose',
    {
      sessionId: 's-nonhome',
      message: '내 HIGH 이슈를 정리했어요',
      widgets: [{ type: 'issue_list', params: { assignee: 'me', priority: ['HIGH'] }, layout: { page: 'current' } }],
    },
    { capture: true },
  )

  // 1) 이슈 페이지에서 시작(홈이 아님)
  await page.goto('/projects')
  await expect(page.getByTestId('issue-sidebar')).toBeVisible()

  // 2) 전역 챗 런처를 열고(side 모드) 질의 제출
  await page.getByTestId('chat-launcher').click()
  await page.getByTestId('chat-input').fill('내 HIGH 이슈')
  await page.getByRole('button', { name: '보내기' }).click()

  // 3) 홈("/")으로 라우팅된다 — "챗 → compose → 캔버스" 주 경로 보존
  await expect(page).toHaveURL(/\/$/)

  // 4) compose 요청 페이로드 검증(새 세션이므로 sessionId null, 입력 query 그대로)
  const req = await composeCapture.waitForRequest()
  expect(req.payload).toMatchObject({ sessionId: null, query: '내 HIGH 이슈' })

  // 5) 캔버스가 compose 결과로 구성된다(현재 페이지 위젯 1개로 replace-all)
  await expect(page.getByTestId('home-widget')).toHaveCount(1)
  // 6) 전역 챗 패널은 라우팅 후에도 유지되며 사용자 질의 + 어시스턴트 응답을 보여준다
  await expect(page.getByTestId('chat-panel')).toContainText('내 HIGH 이슈')
  await expect(page.getByTestId('chat-panel')).toContainText('내 HIGH 이슈를 정리했어요')
})

// 세션 삭제 확인 다이얼로그 (#193)
// 휴지통 클릭 시 AlertDialog 로 확인 후 삭제 — 즉시 삭제 금지.

test('사이드 패널 — 휴지통 클릭 시 AlertDialog 확인 다이얼로그가 표시되고, 취소 시 삭제 API 미호출', async ({
  authenticatedPage: page,
}) => {
  // 세션 1개로 모킹
  await mockChatSessions(page, {
    items: [{ id: 'sc1', title: '테스트 대화', lastMessageAt: '2026-06-08T00:00:00Z', widgetCount: 0 }],
    nextCursor: null,
  })
  // 삭제 API — 호출 여부 캡처(호출되면 안 됨)
  const del = await mockApi(page, 'DELETE', '/api/v1/home/sessions/sc1', null, { status: 204, capture: true })

  await page.goto('/')
  // 전역 챗 패널 열기 (side 모드)
  await page.getByTestId('chat-launcher').click()
  await expect(page.getByTestId('chat-panel')).toBeVisible()

  // 세션 드롭다운 열기
  await page.getByTestId('chat-session-switcher').click()
  await expect(page.getByTestId('chat-session-item')).toHaveCount(1)

  // 휴지통 클릭 → 즉시 삭제 아닌 AlertDialog 표시
  await page.getByTestId('chat-session-delete').click()
  await expect(page.getByRole('alertdialog')).toBeVisible()
  await expect(page.getByRole('alertdialog')).toContainText('대화 삭제')
  await expect(page.getByRole('alertdialog')).toContainText('삭제된 대화는 복구할 수 없습니다')

  // 취소 → AlertDialog 닫힘, 삭제 API 미호출
  await page.getByRole('button', { name: '취소' }).click()
  await expect(page.getByRole('alertdialog')).toHaveCount(0)
  // 삭제 요청이 없었는지 확인 (capture 된 요청 없음)
  expect(del.requests.length).toBe(0)
})

test('사이드 패널 — AlertDialog 삭제 확인 클릭 시 DELETE API 호출됨 (#193)', async ({
  authenticatedPage: page,
}) => {
  await mockChatSessions(page, {
    items: [{ id: 'sc2', title: '삭제할 대화', lastMessageAt: '2026-06-08T00:00:00Z', widgetCount: 0 }],
    nextCursor: null,
  })
  const del = await mockApi(page, 'DELETE', '/api/v1/home/sessions/sc2', null, { status: 204, capture: true })

  await page.goto('/')
  await page.getByTestId('chat-launcher').click()
  await expect(page.getByTestId('chat-panel')).toBeVisible()

  await page.getByTestId('chat-session-switcher').click()
  await expect(page.getByTestId('chat-session-item')).toHaveCount(1)

  // 휴지통 클릭 → AlertDialog가 뜨고 즉시 삭제되지 않음
  await page.getByTestId('chat-session-delete').click()
  await expect(page.getByRole('alertdialog')).toBeVisible()
  // AlertDialog 확인("삭제") 클릭 → DELETE API 호출
  await page.getByRole('button', { name: '삭제' }).last().click()
  await del.waitForRequest()

  // AlertDialog가 닫혀야 함
  await expect(page.getByRole('alertdialog')).toHaveCount(0)
})

// ── 신규 모드 동작 케이스 ────────────────────────────────────────────────────

test('칩 클릭이 closed→side→fullscreen→closed 로 순환한다', async ({ authenticatedPage: page }) => {
  await page.goto('/')
  const chip = page.getByTestId('chat-launcher')
  // 초기: side/fullscreen 없음
  await expect(page.getByTestId('ai-side-panel')).toHaveCount(0)
  await expect(chip).toHaveAttribute('data-mode', 'closed')

  // 1클릭 → side
  await chip.click()
  await expect(page.getByTestId('ai-side-panel')).toBeVisible()
  await expect(chip).toHaveAttribute('data-mode', 'side')

  // 2클릭 → fullscreen
  await chip.click()
  await expect(page.getByTestId('ai-fullscreen')).toBeVisible()
  await expect(page.getByTestId('ai-side-panel')).toHaveCount(0)
  await expect(chip).toHaveAttribute('data-mode', 'fullscreen')

  // 3클릭 → closed
  await chip.click()
  await expect(page.getByTestId('ai-fullscreen')).toHaveCount(0)
  await expect(page.getByTestId('ai-side-panel')).toHaveCount(0)
  await expect(chip).toHaveAttribute('data-mode', 'closed')
})

test('칩 치수가 fire-hub 정합값이다 (minWidth 140px, fontSize 12px, borderRadius 20px)', async ({
  authenticatedPage: page,
}) => {
  // 칩 fixed 오버레이 치수 — fire-hub 정합(인라인 style 고정값).
  await page.goto('/')
  const chip = page.getByTestId('chat-launcher')
  const box = await chip.evaluate((el) => {
    const cs = getComputedStyle(el)
    return { minWidth: cs.minWidth, fontSize: cs.fontSize, borderRadius: cs.borderRadius }
  })
  expect(box.minWidth).toBe('140px')
  expect(box.fontSize).toBe('12px')
  expect(box.borderRadius).toBe('20px')
})

test('⌘K 로 side 패널이 열리고 Esc 로 닫힌다', async ({ authenticatedPage: page }) => {
  // ⌘K 토글: 닫혀 있으면 side 모드로 열림(lastOpen 기본값), 열려 있으면 닫힘.
  await page.goto('/')
  // 칩이 렌더되어 이벤트 리스너가 등록될 때까지 대기
  await expect(page.getByTestId('chat-launcher')).toBeVisible()
  // 초기 닫힘 상태
  await expect(page.getByTestId('ai-side-panel')).toHaveCount(0)

  // ⌘K → side 열림 (window keydown 이벤트 리스너가 칩 마운트 시 등록됨)
  await page.keyboard.press('Meta+k')
  await expect(page.getByTestId('ai-side-panel')).toBeVisible()

  // Esc → 닫힘
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('ai-side-panel')).toHaveCount(0)
})

test('사이드 패널이 본문을 밀어낸다(reflow) + 핸들 드래그 후 리사이즈 영속', async ({
  authenticatedPage: page,
}) => {
  // 데스크톱 뷰포트에서 side 패널이 flex 형제로 본문을 실제로 밀어내는지 검증.
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/')
  const main = page.locator('main')
  const before = (await main.boundingBox())!.width

  // side 모드 열기
  await page.getByTestId('chat-launcher').click()
  await expect(page.getByTestId('ai-side-panel')).toBeVisible()
  const after = (await main.boundingBox())!.width
  // 본문이 줄어들어야 함(reflow)
  expect(after).toBeLessThan(before)

  // 핸들 드래그로 폭 확대 (기본 380 → +120 = ~500)
  // 핸들은 absolute left-0, w-1(4px) — 패널의 좌측 경계.
  const panel = page.getByTestId('ai-side-panel')
  const pb = (await panel.boundingBox())!
  // 핸들 위치: 패널 좌측 경계 + 2px (핸들 폭 4px 의 중심)
  const hx = pb.x + 2
  const hy = pb.y + pb.height / 2
  await page.mouse.move(hx, hy)
  await page.mouse.down()
  // pointermove 리스너가 window 에 등록될 시간을 줌
  await page.waitForTimeout(50)
  // 10 스텝으로 천천히 왼쪽으로 드래그 (패널 폭 증가 방향)
  await page.mouse.move(hx - 120, hy, { steps: 10 })
  await page.mouse.up()
  // width transition 이 완료될 시간을 줌 (200ms transition-[width])
  await page.waitForTimeout(300)
  const widened = (await page.getByTestId('ai-side-panel').boundingBox())!.width
  expect(widened).toBeGreaterThan(380)

  // 페이지 재로드 후 폭이 localStorage 에서 복원되어야 함
  await page.reload()
  // 재로드 후 초기 모드는 closed — 다시 open
  await page.getByTestId('chat-launcher').click()
  await expect(page.getByTestId('ai-side-panel')).toBeVisible()
  const restored = (await page.getByTestId('ai-side-panel').boundingBox())!.width
  expect(Math.abs(restored - widened)).toBeLessThan(8)
})

test('모바일 뷰포트(<1024px)에서 side 가 풀스크린 오버레이로 렌더된다', async ({
  authenticatedPage: page,
}) => {
  // 모바일 뷰포트: max-lg CSS → 고정 인라인 width 무력화 + !fixed !inset-0 !w-full.
  await page.setViewportSize({ width: 480, height: 800 })
  await page.goto('/')
  await page.getByTestId('chat-launcher').click() // side
  const panel = page.getByTestId('ai-side-panel')
  await expect(panel).toBeVisible()
  const box = (await panel.boundingBox())!
  // 화면 폭 가득(오버레이) — 440px 이상
  expect(box.width).toBeGreaterThan(440)
})

test('사이드 패널을 최대 폭으로 넓혀도 AI 칩이 대화 선택 스위처를 가리거나 클릭을 가로채지 않는다 (#195)', async ({
  authenticatedPage: page,
}) => {
  // 회귀(#195): 칩이 뷰포트 중앙 고정이라, 패널을 ~502px 이상으로 넓히면 칩 우측이
  // 헤더의 대화 선택 스위처(chat-session-switcher) 좌측을 덮어 클릭을 가로챘다.
  // 수정: side 모드에서 칩을 콘텐츠 영역(뷰포트−패널폭) 중앙으로 정렬 → 패널과 항상 비겹침.
  await page.setViewportSize({ width: 1200, height: 800 })
  await page.goto('/')

  // side 모드 열기
  await page.getByTestId('chat-launcher').click()
  const panel = page.getByTestId('ai-side-panel')
  await expect(panel).toBeVisible()

  // 핸들을 왼쪽 끝까지 드래그하여 패널을 상한 폭(600)까지 확대 → 칩과 충돌 영역에 진입.
  const pb = (await panel.boundingBox())!
  const hx = pb.x + 2
  const hy = pb.y + pb.height / 2
  await page.mouse.move(hx, hy)
  await page.mouse.down()
  await page.waitForTimeout(50)
  // 충분히 큰 거리(중심을 향해)로 끌어 상한(600)까지 클램프되게 한다.
  await page.mouse.move(hx - 400, hy, { steps: 12 })
  await page.mouse.up()
  // width transition(200ms) + 칩 left transition 완료 대기
  await page.waitForTimeout(300)

  const widened = (await panel.boundingBox())!.width
  expect(widened).toBeGreaterThanOrEqual(560) // 거의 상한까지 넓어졌는지

  // 대화 선택 스위처가 헤더에 존재해야(빈 상태에서도 "대화 선택" 버튼 렌더)
  const switcher = page.getByTestId('chat-session-switcher')
  await expect(switcher).toBeVisible()

  // 핵심 검증 1(기하): 칩 우측 끝이 스위처 좌측 끝보다 왼쪽(또는 같음) → 시각적 겹침 없음.
  const chipBox = (await page.getByTestId('chat-launcher').boundingBox())!
  const swBox = (await switcher.boundingBox())!
  expect(chipBox.x + chipBox.width).toBeLessThanOrEqual(swBox.x)

  // 핵심 검증 2(히트테스트): 스위처 좌측 지점의 최상단 요소가 칩이 아니어야 클릭이 안 가로채진다.
  const hitTestid = await page.evaluate(
    ({ x, y }) => {
      const el = document.elementFromPoint(x, y) as HTMLElement | null
      return el?.getAttribute('data-testid') ?? el?.closest('[data-testid]')?.getAttribute('data-testid') ?? null
    },
    { x: swBox.x + 4, y: swBox.y + swBox.height / 2 },
  )
  expect(hitTestid).not.toBe('chat-launcher')

  // 핵심 검증 3(동작): 스위처 좌측을 클릭해도 칩의 모드 순환(side→fullscreen)이 트리거되지 않는다.
  await page.mouse.click(swBox.x + 4, swBox.y + swBox.height / 2)
  await expect(page.getByTestId('chat-launcher')).toHaveAttribute('data-mode', 'side')
})

test('풀스크린 2단: 세션 선택 시 우측 채팅 패널에 transcript 가 렌더된다', async ({
  authenticatedPage: page,
}) => {
  // /home/sessions 에 1개 세션, /home/sessions/s-fs1/messages 로 메시지 2건 모킹.
  await mockChatSessions(page, {
    items: [{ id: 's-fs1', title: '풀스크린 테스트 대화', lastMessageAt: '2026-06-08T00:00:00Z', widgetCount: 1 }],
    nextCursor: null,
  })
  const messages: HomeMessage[] = [
    { id: 1, role: 'USER', content: '풀스크린 질문', widgets: null, createdAt: '2026-06-08T00:00:00Z' },
    {
      id: 2,
      role: 'ASSISTANT',
      content: '풀스크린 응답입니다',
      widgets: [{ type: 'issue_list', params: {}, layout: { page: 'current' } }],
      createdAt: '2026-06-08T00:00:01Z',
    },
  ]
  await mockApi(page, 'GET', '/api/v1/home/sessions/s-fs1/messages', messages)

  await page.goto('/')
  // side → fullscreen 으로 두 번 클릭
  await page.getByTestId('chat-launcher').click()
  await page.getByTestId('chat-launcher').click()
  await expect(page.getByTestId('ai-fullscreen')).toBeVisible()

  // 좌측 세션 목록에 1건이 보여야 함
  const fsSessions = page.getByTestId('ai-fs-sessions')
  await expect(fsSessions).toBeVisible()
  await expect(fsSessions.getByTestId('chat-session-item')).toHaveCount(1)

  // 세션 클릭 → 우측 채팅 패널에 transcript 반영
  await fsSessions.getByTestId('chat-session-select').first().click()

  // 메시지 fetch 후 chat-turn 이 2개 렌더되어야 함
  await expect(page.getByTestId('chat-panel').getByTestId('chat-turn')).toHaveCount(2)
  await expect(page.getByTestId('chat-panel')).toContainText('풀스크린 질문')
  await expect(page.getByTestId('chat-panel')).toContainText('풀스크린 응답입니다')
})
