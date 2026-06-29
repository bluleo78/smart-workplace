import { expect, test } from '../fixtures/auth.fixture'
import { mockApi } from '../fixtures/api-mock'
import { createUser } from '../factories/auth.factory'
import type { HomeMessage, HomeSessionPage } from '../../src/types/home'

// global-chat.spec.ts — AI 어시스턴트 신규 모드(side/fullscreen/chip) E2E.
// FloatingChat 모달·홈 캔버스는 제거됨. 칩(chat-launcher) 클릭 → side → fullscreen → closed 순환.
// 챗→compose 는 제자리(in-place) 응답으로 동작(홈 이동/캔버스 구성 없음).

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

test('비-홈(이슈) 페이지에서 챗 제출 시 제자리에서 어시스턴트가 응답한다(홈 이동/캔버스 없음)', { tag: '@smoke' }, async ({
  authenticatedPage: page,
}) => {
  // 캔버스 제거 후 동작: 비-홈에서 제출해도 홈("/")으로 강제 이동하지 않고, 현재 라우트의
  // 챗 패널에 사용자 질의 + 어시스턴트 응답 턴이 제자리(in-place)로 렌더된다.
  await mockApi(page, 'GET', '/api/v1/projects', {
    content: [],
    page: 0,
    size: 20,
    totalElements: 0,
    totalPages: 0,
  })
  // compose → SSE 스트리밍 응답으로 모킹(JSON → SSE 전환 후).
  // capture 를 위해 page.route 직접 사용 후 SSE 형식으로 응답.
  let composePayload: unknown = null;
  let resolveCompose: (() => void) | null = null;
  const composeRequested = new Promise<void>((resolve) => { resolveCompose = resolve; });
  await page.route(
    (url) => url.pathname === '/api/v1/ai/chat',
    (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      try { composePayload = route.request().postDataJSON(); } catch { composePayload = null; }
      resolveCompose?.();
      const sseBody =
        'event: delta\ndata: {"text":"내 HIGH 이슈를 "}\n\n' +
        'event: delta\ndata: {"text":"정리했어요"}\n\n' +
        'event: done\ndata: {"sessionId":"s-nonhome"}\n\n';
      return route.fulfill({ status: 200, contentType: 'text/event-stream', body: sseBody });
    },
  );

  // 1) 이슈 페이지에서 시작(홈이 아님)
  await page.goto('/projects')
  await expect(page.getByTestId('issue-sidebar')).toBeVisible()

  // 2) 전역 챗 런처를 열고(side 모드) 질의 제출
  await page.getByTestId('chat-launcher').click()
  await page.getByTestId('chat-input').fill('내 HIGH 이슈')
  await page.getByRole('button', { name: '보내기' }).click()

  // 3) compose 요청 페이로드 검증(새 세션이므로 sessionId null, 입력 query 그대로)
  await composeRequested
  expect(composePayload).toMatchObject({ sessionId: null, query: '내 HIGH 이슈' })

  // 4) 어시스턴트 응답이 챗 패널에 제자리로 렌더된다(사용자 질의 + 응답 턴)
  await expect(page.getByTestId('chat-panel')).toContainText('내 HIGH 이슈')
  await expect(page.getByTestId('chat-panel')).toContainText('내 HIGH 이슈를 정리했어요')

  // 5) 홈("/")으로 라우팅되지 않고 현재 라우트(/projects)에 머문다 — 강제 이동 제거
  await expect(page).toHaveURL(/\/projects$/)
  // 6) 캔버스(home-widget)는 더 이상 존재하지 않는다
  await expect(page.getByTestId('home-widget')).toHaveCount(0)
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

// #353 회귀 가드 — AI 응답 실패 시 에러 버블 표시
test('AI 응답 실패(5xx) 시 에러 안내 버블이 렌더된다 (refs #353)', async ({
  authenticatedPage: page,
}) => {
  // compose → 500 에러로 모킹(AI 에이전트 내부 오류 시나리오).
  await page.route(
    (url) => url.pathname === '/api/v1/ai/chat',
    (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      return route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'AI agent internal error' }),
      });
    },
  );

  await page.goto('/')
  await page.getByTestId('chat-launcher').click()

  // 메시지 전송
  await page.getByTestId('chat-input').fill('현재 진행 중인 프로젝트 목록 알려줘')
  await page.getByRole('button', { name: '보내기' }).click()

  // 입력→처리→출력 파이프라인 검증:
  // 1) 사용자 메시지 버블이 남아있어야 한다.
  await expect(page.getByTestId('chat-panel')).toContainText('현재 진행 중인 프로젝트 목록 알려줘')

  // 2) 빈 어시스턴트 턴이 null로 사라지지 않고 에러 안내 텍스트로 채워져야 한다.
  await expect(page.getByTestId('chat-turn').last()).toContainText('응답 생성에 실패했습니다')

  // 3) 에러 후 입력 창이 활성화되어 재시도 가능해야 한다.
  await expect(page.getByTestId('chat-input')).toBeEnabled()
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

test('칩이 디자인 시스템 치수를 따른다 (min-w 140px, text-xs, pill)', async ({
  authenticatedPage: page,
}) => {
  // 칩 치수 — 인라인 raw px 대신 디자인 시스템 유틸(min-w-[140px]·text-xs·rounded-full pill)로 정의.
  await page.goto('/')
  const chip = page.getByTestId('chat-launcher')
  const box = await chip.evaluate((el) => {
    const cs = getComputedStyle(el)
    return {
      minWidth: cs.minWidth,
      fontSize: cs.fontSize,
      borderRadius: parseFloat(cs.borderRadius),
      height: el.getBoundingClientRect().height,
    }
  })
  expect(box.minWidth).toBe('140px')
  expect(box.fontSize).toBe('12px') // text-xs
  // rounded-full → 모서리 반경이 높이 절반 이상(완전 pill)
  expect(box.borderRadius).toBeGreaterThanOrEqual(box.height / 2 - 1)
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
    { id: 1, role: 'USER', content: '풀스크린 질문', widgets: null, toolCalls: null, createdAt: '2026-06-08T00:00:00Z' },
    {
      id: 2,
      role: 'ASSISTANT',
      content: '풀스크린 응답입니다',
      widgets: [{ type: 'issue_list', params: {}, layout: { page: 'current' } }],
      toolCalls: null,
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

test('풀스크린에서 메시지 전송 시 첫 chat-turn 이 상단 AI 칩·닫기 X 에 가려지지 않는다 (#206)', async ({
  authenticatedPage: page,
}) => {
  // 회귀(#206): 풀스크린 우측 채팅 pane 에 상단 헤더가 없어, 첫 USER turn(우상단 정렬)이
  // 상단 고정 AI 칩(chat-launcher)과 우상단 닫기 X(ai-fs-close)에 가려졌다(occlusion).
  // 수정: 우측 pane 상단에 h-12 헤더 바를 추가하고 닫기 X 를 그 안 일반 배치로 옮겨 여백 확보.
  // 검증: 첫 chat-turn 의 top 이 칩의 bottom 이상이고, 닫기 X rect 와 겹치지 않는다.
  await page.setViewportSize({ width: 1440, height: 900 })

  // 홈에서 compose → SSE 스트리밍 응답으로 모킹 — 제출 시 turn 이 렌더되도록.
  await page.route(
    (url) => url.pathname === '/api/v1/ai/chat',
    (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      const sseBody =
        'event: delta\ndata: {"text":"정리했어요"}\n\n' +
        'event: done\ndata: {"sessionId":"s-206"}\n\n';
      return route.fulfill({ status: 200, contentType: 'text/event-stream', body: sseBody });
    },
  );

  await page.goto('/')
  // side → fullscreen
  await page.getByTestId('chat-launcher').click()
  await page.getByTestId('chat-launcher').click()
  await expect(page.getByTestId('ai-fullscreen')).toBeVisible()

  // 메시지 1개 전송
  await page.getByTestId('chat-input').fill('내 이슈 정리')
  await page.getByRole('button', { name: '보내기' }).click()

  // 제출 후에도 풀스크린 pane 유지(모드 전환/라우팅으로 측정 대상이 사라지지 않음)
  await expect(page.getByTestId('ai-fullscreen')).toBeVisible()

  // 첫 chat-turn(USER, 우상단 정렬) 이 렌더될 때까지 대기
  const firstTurn = page.getByTestId('chat-panel').getByTestId('chat-turn').first()
  await expect(firstTurn).toBeVisible()

  const turnBox = (await firstTurn.boundingBox())!
  const chipBox = (await page.getByTestId('chat-launcher').boundingBox())!
  const closeBox = (await page.getByTestId('ai-fs-close').boundingBox())!

  // 1) 첫 turn 의 top 이 칩 bottom 이상 → 칩과 수직 비겹침(칩에 가려지지 않음)
  expect(turnBox.y).toBeGreaterThanOrEqual(chipBox.y + chipBox.height)

  // 2) 첫 turn 이 닫기 X rect 와 겹치지 않음(헤더 영역 아래로 내려감).
  //    사각형 비겹침: turn.top 이 close.bottom 이상이면 수직으로 분리됨.
  expect(turnBox.y).toBeGreaterThanOrEqual(closeBox.y + closeBox.height)
})

test('긴 무공백 메시지가 말풍선 안에서 줄바꿈되어 메시지 패널에 가로 오버플로가 없다 (#202)', async ({
  authenticatedPage: page,
}) => {
  // 회귀(#202): 100자+ 공백 없는 토큰(URL/aaaa…) 메시지가 말풍선의 max-w-[80%] 를 무시하고
  // 줄바꿈 없이 가로로 늘어나 메시지 스크롤러에 가로 스크롤이 생겼다.
  // 수정: 말풍선 <span> 에 [overflow-wrap:anywhere] 추가 → 무공백 긴 토큰도 강제 줄바꿈.
  // 검증: 메시지 스크롤러의 scrollWidth 가 clientWidth 를 (의미 있는 폭으로) 넘지 않아야 한다.
  await page.setViewportSize({ width: 1280, height: 800 })
  const longToken = 'a'.repeat(150) // 공백 없는 150자 토큰
  await mockChatSessions(page, {
    items: [{ id: 's-lw1', title: '긴토큰 대화', lastMessageAt: '2026-06-08T00:00:00Z', widgetCount: 0 }],
    nextCursor: null,
  })
  const messages: HomeMessage[] = [
    { id: 1, role: 'USER', content: longToken, widgets: null, toolCalls: null, createdAt: '2026-06-08T00:00:00Z' },
    { id: 2, role: 'ASSISTANT', content: longToken, widgets: null, toolCalls: null, createdAt: '2026-06-08T00:00:01Z' },
  ]
  await mockApi(page, 'GET', '/api/v1/home/sessions/s-lw1/messages', messages)

  await page.goto('/')
  // side → fullscreen
  await page.getByTestId('chat-launcher').click()
  await page.getByTestId('chat-launcher').click()
  await expect(page.getByTestId('ai-fullscreen')).toBeVisible()

  // 세션 선택 → transcript 렌더
  await page.getByTestId('ai-fs-sessions').getByTestId('chat-session-select').first().click()
  const turns = page.getByTestId('chat-panel').getByTestId('chat-turn')
  await expect(turns).toHaveCount(2)

  // 1) 말풍선 자체가 부모 폭을 넘지 않는다 (overflow-wrap:anywhere 로 무공백 토큰이 줄바꿈됨)
  const bubbleOverflow = await turns.first().locator('span').evaluate((el) => el.scrollWidth - el.clientWidth)
  expect(bubbleOverflow).toBeLessThanOrEqual(1) // 반올림 오차 1px 허용

  // 2) 메시지 스크롤러(말풍선의 overflow-auto 조상)에 가로 오버플로가 없다
  const scrollerOverflow = await turns.first().evaluate((turnEl) => {
    const scroller = (turnEl.closest('.overflow-auto') as HTMLElement | null) ?? turnEl
    return scroller.scrollWidth - scroller.clientWidth
  })
  // 수정 전엔 수백 px 의 가로 오버플로가 났다. 수정 후엔 0(또는 반올림 오차 수준)이어야 한다.
  expect(scrollerOverflow).toBeLessThanOrEqual(2)
})

test('모바일(375px) 풀스크린에서 좌측 세션목록이 숨겨지고 헤더 드롭다운이 세션 전환을 제공한다 (#203)', async ({
  authenticatedPage: page,
}) => {
  // 회귀(#203): 375px 모바일 뷰포트에서 좌측 260px 세션목록이 고정폭으로 남아
  // 채팅 영역이 115px / 입력창 26px 로 압착돼 사용 불가 상태.
  // 수정: 좌측 목록 hidden md:flex, 모바일 헤더에 드롭다운 세션 스위처 추가.
  await page.setViewportSize({ width: 375, height: 800 })

  await mockChatSessions(page, {
    items: [
      { id: 's-mob1', title: '모바일 대화 1', lastMessageAt: '2026-06-10T00:00:00Z', widgetCount: 0 },
      { id: 's-mob2', title: '모바일 대화 2', lastMessageAt: '2026-06-10T01:00:00Z', widgetCount: 0 },
    ],
    nextCursor: null,
  })
  // 세션 선택 시 메시지 fetch — 빈 transcript 로 모킹.
  await mockApi(page, 'GET', '/api/v1/home/sessions/s-mob1/messages', [])

  await page.goto('/')
  // side → fullscreen
  await page.getByTestId('chat-launcher').click()
  await page.getByTestId('chat-launcher').click()
  await expect(page.getByTestId('ai-fullscreen')).toBeVisible()

  // 1) 좌측 세션 목록이 숨겨짐 (hidden md:flex → 375px 에서 비표시)
  const fsSessionsBox = await page.getByTestId('ai-fs-sessions').boundingBox()
  expect(fsSessionsBox).toBeNull()

  // 2) 모바일 세션 스위처가 헤더에 보임
  await expect(page.getByTestId('ai-fs-mobile-session-switcher')).toBeVisible()

  // 3) 채팅 패널이 전체 폭을 차지해 입력창이 정상 너비(100px+)를 가짐
  const chatInputBox = await page.getByTestId('chat-input').boundingBox()
  expect(chatInputBox).not.toBeNull()
  expect(chatInputBox!.width).toBeGreaterThan(100)

  // 4) 드롭다운 열기 → 세션 목록이 표시됨
  await page.getByTestId('ai-fs-mobile-session-switcher').click()
  // 드롭다운 콘텐츠(DropdownMenuContent)에 두 세션이 보여야 함
  await expect(page.getByRole('menu', { name: '대화 선택' })).toBeVisible()

  // 5) 세션 선택 시 드롭다운이 닫힌다(#451) — 모바일 스위처도 controlled 닫힘 적용
  await page.getByRole('menu', { name: '대화 선택' }).getByText('모바일 대화 1').click()
  await expect(page.getByRole('menu', { name: '대화 선택' })).toHaveCount(0)
})

test('위임 진행 이벤트가 도크에 위임 버블을 렌더한다 (#333)', { tag: '@smoke' }, async ({
  authenticatedPage: page,
}) => {
  // compose SSE 에 progress 이벤트를 포함 — 도크가 "캘린더 전문가에게 위임 중" 버블을 띄워야.
  // 전략: fetch API 를 page.addInitScript 로 몽키패치해 /api/v1/ai/chat 응답을
  // ReadableStream 으로 직접 제어한다. progress 청크를 먼저 흘리고 렌더를 기다린 뒤
  // delta·done 을 flush — done 이전에 버블이 존재함을 assert.
  //
  // Playwright page.route 는 전체 body 를 한 번에 flush 해 progress→done 이 동일 task 에
  // 처리될 수 있으므로, ReadableStream 으로 청크를 타임 분리하는 방식 선택.
  await page.addInitScript(() => {
    // 원본 fetch 를 래핑해 compose 요청만 가로챈다.
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (!url.includes('/api/v1/ai/chat') || (init?.method ?? 'GET') !== 'POST') {
        return originalFetch(input, init);
      }
      // ReadableStream 으로 SSE 청크를 시간 분리해 전달한다.
      const enc = new TextEncoder();
      const stream = new ReadableStream({
        async start(controller) {
          // 1) progress 이벤트 — 위임 버블 트리거
          controller.enqueue(enc.encode('event: progress\ndata: {"label":"캘린더 전문가에게 위임 중"}\n\n'));
          // 렌더 사이클이 돌 시간을 줌 — macrotask 경계 삽입
          await new Promise((r) => setTimeout(r, 100));
          // 2) delta + done
          controller.enqueue(enc.encode('event: delta\ndata: {"text":"일정을 확인했어요"}\n\n'));
          controller.enqueue(enc.encode('event: done\ndata: {"sessionId":"s-prog-1"}\n\n'));
          controller.close();
        },
      });
      return new Response(stream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      });
    };
  });

  await page.goto('/');
  await page.getByTestId('chat-launcher').click();
  await page.getByTestId('chat-input').fill('다음주 회의 잡아줘');
  await page.getByRole('button', { name: '보내기' }).click();

  // 위임 진행 버블이 라벨과 함께 렌더된다(progress 이벤트 후 100ms 창 내에 관측 가능).
  await expect(page.getByTestId('tool-step-delegation')).toContainText('캘린더 전문가에게 위임 중');
  // 최종 응답도 정상 렌더(progress 가 스트림을 끊지 않음).
  await expect(page.getByTestId('chat-panel')).toContainText('일정을 확인했어요');
});

test('확인 카드 — pending_action 이 카드로 렌더되고 승인 시 confirm payload 를 전송한다 (#333)', { tag: '@smoke' }, async ({
  authenticatedPage: page,
}) => {
  // compose SSE 에 pending_action(done 앞) 포함.
  await page.route(
    (url) => url.pathname === '/api/v1/ai/chat',
    (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      const sseBody =
        'event: delta\ndata: {"text":"6/26 10시 팀 미팅을 제안할게요"}\n\n' +
        'event: pending_action\ndata: [{"actionType":"calendar.create_event","summary":"6/26 10시 팀 미팅(1시간)","params":{"title":"팀 미팅","startsAt":"2026-06-26T01:00:00Z","endsAt":"2026-06-26T02:00:00Z","allDay":false}}]\n\n' +
        'event: done\ndata: {"sessionId":"s-conf-1"}\n\n';
      return route.fulfill({ status: 200, contentType: 'text/event-stream', body: sseBody });
    },
  );
  // confirm 실행기 모킹 — payload 캡처.
  let confirmPayload: unknown = null;
  await page.route(
    (url) => url.pathname === '/api/v1/home/actions/confirm',
    (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      try { confirmPayload = route.request().postDataJSON(); } catch { confirmPayload = null; }
      return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ id: 99, title: '팀 미팅' }) });
    },
  );

  await page.goto('/');
  await page.getByTestId('chat-launcher').click();
  await page.getByTestId('chat-input').fill('다음주 팀미팅 잡아줘');
  await page.getByRole('button', { name: '보내기' }).click();

  // 1) 확인 카드가 요약과 함께 렌더된다.
  const card = page.getByTestId('pending-action-card');
  await expect(card).toBeVisible();
  await expect(card).toContainText('6/26 10시 팀 미팅(1시간)');

  // 2) 승인 클릭 → confirm POST payload 가 actionType+params 그대로.
  await card.getByRole('button', { name: '승인' }).click();
  await expect.poll(() => confirmPayload).not.toBeNull();
  expect(confirmPayload).toMatchObject({
    actionType: 'calendar.create_event',
    params: { title: '팀 미팅', startsAt: '2026-06-26T01:00:00Z', endsAt: '2026-06-26T02:00:00Z' },
  });
  // 3) 승인 후 카드가 사라진다.
  await expect(page.getByTestId('pending-action-card')).toHaveCount(0);
});

test('확인 카드 — 취소 시 confirm API 미호출, 카드 폐기 (#333)', async ({ authenticatedPage: page }) => {
  await page.route(
    (url) => url.pathname === '/api/v1/ai/chat',
    (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      const sseBody =
        'event: pending_action\ndata: [{"actionType":"calendar.create_event","summary":"취소 대상","params":{"title":"x"}}]\n\n' +
        'event: done\ndata: {"sessionId":"s-conf-2"}\n\n';
      return route.fulfill({ status: 200, contentType: 'text/event-stream', body: sseBody });
    },
  );
  let confirmCalled = false;
  await page.route(
    (url) => url.pathname === '/api/v1/home/actions/confirm',
    (route) => { confirmCalled = true; return route.fulfill({ status: 201, body: '{}' }); },
  );

  await page.goto('/');
  await page.getByTestId('chat-launcher').click();
  await page.getByTestId('chat-input').fill('일정 잡아줘');
  await page.getByRole('button', { name: '보내기' }).click();

  const card = page.getByTestId('pending-action-card');
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: '거부' }).click();
  // 카드 폐기 + confirm 미호출.
  await expect(page.getByTestId('pending-action-card')).toHaveCount(0);
  expect(confirmCalled).toBe(false);
});

test('챗 도크 응답이 토큰 단위로 점진 렌더된다', { tag: '@smoke' }, async ({ authenticatedPage: page }) => {
  // /api/v1/ai/chat 를 SSE event-stream 으로 모킹.
  // 단일 delta 에 전체 텍스트가 없어야 '연결이 없으면 표시 불가'를 증명할 수 있다.
  // route.fulfill 은 body 를 한 번에 전달하므로 중간 상태 캡처 대신,
  // 분할 delta 조합이 최종 텍스트를 만드는지를 검증한다.
  await page.route(
    (url) => url.pathname === '/api/v1/ai/chat',
    (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      // '안' / '녕' / '하세요' 세 토큰으로 분할 — 어떤 단일 delta 에도 전체 문자열이 없다.
      const sseBody =
        'event: delta\ndata: {"text":"안"}\n\n' +
        'event: delta\ndata: {"text":"녕"}\n\n' +
        'event: delta\ndata: {"text":"하세요"}\n\n' +
        'event: done\ndata: {"sessionId":"s-stream-1"}\n\n';
      return route.fulfill({ status: 200, contentType: 'text/event-stream', body: sseBody });
    },
  );

  await page.goto('/')
  await page.getByTestId('chat-launcher').click()

  // 질의 제출
  await page.getByTestId('chat-input').fill('인사해줘')
  await page.getByRole('button', { name: '보내기' }).click()

  // 사용자 턴이 먼저 렌더된다
  await expect(page.getByTestId('chat-panel')).toContainText('인사해줘')

  // 스트리밍 완료 후 어시스턴트 말풍선에 세 토큰이 합쳐진 '안녕하세요' 가 표시된다.
  // 세 delta 를 모두 연결해야만 이 텍스트가 나오므로 점진 누적 렌더가 동작함을 증명한다.
  await expect(page.getByTestId('chat-panel')).toContainText('안녕하세요')

  // 스트리밍 완료 후 3-dot 로딩이 사라진다.
  await expect(page.getByTestId('chat-pending')).toHaveCount(0)
})

test('사이드패널: 세션 선택 시 세션 스위처 드롭다운이 닫힌다 (#451)', async ({
  authenticatedPage: page,
}) => {
  // 회귀(#451): 세션 항목이 DropdownMenuItem 이 아닌 일반 button 이라 Radix 자동 닫힘이 안 됨.
  // 수정: DropdownMenu 를 controlled(open/onOpenChange)로 두고 선택 직후 setOpen(false).
  await mockChatSessions(page, {
    items: [
      { id: 's-a', title: '대화 A', lastMessageAt: '2026-06-08T00:00:00Z', widgetCount: 0 },
      { id: 's-b', title: '대화 B', lastMessageAt: '2026-06-08T00:00:00Z', widgetCount: 0 },
    ],
    nextCursor: null,
  })
  // 세션 선택 시 메시지 fetch — 빈 transcript 로 모킹.
  await mockApi(page, 'GET', '/api/v1/home/sessions/s-a/messages', [])

  await page.goto('/')
  await page.getByTestId('chat-launcher').click() // side 모드

  // 스위처를 열어 세션 목록(드롭다운)이 보이는지 확인
  await page.getByTestId('chat-session-switcher').click()
  await expect(page.getByTestId('chat-session-select').first()).toBeVisible()

  // 세션 선택 → 드롭다운이 닫혀 세션 항목이 DOM 에서 사라져야 함
  await page.getByTestId('chat-session-select').first().click()
  await expect(page.getByTestId('chat-session-item')).toHaveCount(0)
})

test('사이드패널: 세션 로드/전송 시 채팅이 맨 아래로 자동 스크롤된다 (#452)', async ({
  authenticatedPage: page,
}) => {
  // 회귀(#452): 메시지 컨테이너에 자동 스크롤 로직이 없어 전송/스트리밍 시 하단으로 안 내려감.
  // 수정: useStickToBottom 을 컨테이너에 연결(전송/스트리밍/단계/확인카드 변화를 depKey 로).
  await page.setViewportSize({ width: 1000, height: 500 })
  await mockChatSessions(page, {
    items: [{ id: 's-scroll', title: '스크롤 대화', lastMessageAt: '2026-06-08T00:00:00Z', widgetCount: 0 }],
    nextCursor: null,
  })
  // 컨테이너를 넘치게(스크롤 가능) 할 만큼 많은 메시지
  const messages: HomeMessage[] = Array.from({ length: 30 }, (_, i) => ({
    id: i + 1,
    role: i % 2 === 0 ? 'USER' : 'ASSISTANT',
    content: `메시지 ${i + 1}`,
    widgets: null,
    toolCalls: null,
    createdAt: '2026-06-08T00:00:00Z',
  }))
  await mockApi(page, 'GET', '/api/v1/home/sessions/s-scroll/messages', messages)
  // 전송 검증용 compose SSE
  await page.route(
    (url) => url.pathname === '/api/v1/ai/chat',
    (route) => {
      if (route.request().method() !== 'POST') return route.fallback()
      const sseBody =
        'event: delta\ndata: {"text":"새 응답입니다"}\n\n' +
        'event: done\ndata: {"sessionId":"s-scroll"}\n\n'
      return route.fulfill({ status: 200, contentType: 'text/event-stream', body: sseBody })
    },
  )

  await page.goto('/')
  await page.getByTestId('chat-launcher').click()

  // 세션 선택
  await page.getByTestId('chat-session-switcher').click()
  await expect(page.getByTestId('chat-session-select').first()).toBeVisible()
  await page.getByTestId('chat-session-select').first().click()
  await expect(page.getByTestId('chat-panel').getByTestId('chat-turn').first()).toBeVisible()

  const scroll = page.getByTestId('chat-scroll')
  // 전제: 컨테이너가 실제로 오버플로해야(스크롤 가능) 검증이 유의미
  await expect
    .poll(async () => scroll.evaluate((el) => el.scrollHeight - el.clientHeight))
    .toBeGreaterThan(40)
  // 로드 직후 하단 근처(scrollHeight - scrollTop - clientHeight <= 80)
  await expect
    .poll(async () => scroll.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight))
    .toBeLessThanOrEqual(80)

  // 전송 → 새 응답 누적 후에도 하단 유지
  await page.getByTestId('chat-input').fill('추가 질문')
  await page.getByRole('button', { name: '보내기' }).click()
  await expect(page.getByTestId('chat-panel')).toContainText('새 응답입니다')
  await expect
    .poll(async () => scroll.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight))
    .toBeLessThanOrEqual(80)
})

test('앱 레일에서 앱 전환 시 AI 풀스크린이면 side 패널로 강등된다 (#454)', async ({
  authenticatedPage: page,
}) => {
  // #454: 풀스크린 AI 가 콘텐츠를 덮어, 레일로 앱을 바꿔도 전환된 앱이 가려진다.
  // 기대: 레일 네비게이션 시 풀스크린이면 side 로 강등 → 새 앱 + AI 가 함께 보임.
  await mockApi(page, 'GET', '/api/v1/projects', {
    content: [], page: 0, size: 20, totalElements: 0, totalPages: 0,
  })

  await page.goto('/')
  // side → fullscreen (칩 2회 클릭)
  await page.getByTestId('chat-launcher').click()
  await page.getByTestId('chat-launcher').click()
  await expect(page.getByTestId('ai-fullscreen')).toBeVisible()

  // 앱 레일에서 '작업 관리'(/projects)로 전환
  await page.getByTestId('rail-link-/projects').click()

  // ① 해당 라우트로 이동 ② 풀스크린 해제 + side 패널 표시
  await expect(page).toHaveURL(/\/projects/)
  await expect(page.getByTestId('ai-fullscreen')).toHaveCount(0)
  await expect(page.getByTestId('ai-side-panel')).toBeVisible()
})

test('앱 레일에서 앱 전환 시 AI side 모드는 그대로 유지된다 (#454 회귀가드)', async ({
  authenticatedPage: page,
}) => {
  // side/closed 모드에서는 레일 네비게이션이 AI 모드를 바꾸지 않아야 한다.
  await mockApi(page, 'GET', '/api/v1/projects', {
    content: [], page: 0, size: 20, totalElements: 0, totalPages: 0,
  })

  await page.goto('/')
  // side 모드로만 연다(칩 1회).
  await page.getByTestId('chat-launcher').click()
  await expect(page.getByTestId('ai-side-panel')).toBeVisible()

  await page.getByTestId('rail-link-/projects').click()

  // side 유지 + 풀스크린으로 승격되지 않음
  await expect(page).toHaveURL(/\/projects/)
  await expect(page.getByTestId('ai-side-panel')).toBeVisible()
  await expect(page.getByTestId('ai-fullscreen')).toHaveCount(0)
})

test('이전 세션 선택 시 위로 스크롤한 상태여도 맨 아래로 내려간다 (#455)', async ({
  authenticatedPage: page,
}) => {
  // 회귀(#455): 이전 메시지를 보려 위로 올린(stuck=false) 상태에서 다른 세션을 선택하면
  // depKey 변경만으로는 하단 고정이 발동하지 않아 맨 위/중간에 머물렀다.
  // 수정: resetKey(currentSessionId) 변경 시 무조건 하단으로 리셋.
  // 데스크톱 폭(≥1024)으로 도킹 사이드 패널 상태에서 검증(모바일 오버레이 회피).
  await page.setViewportSize({ width: 1280, height: 520 })
  await mockChatSessions(page, {
    items: [
      { id: 's-a', title: '대화 A', lastMessageAt: '2026-06-08T00:00:00Z', widgetCount: 0 },
      { id: 's-b', title: '대화 B', lastMessageAt: '2026-06-08T01:00:00Z', widgetCount: 0 },
    ],
    nextCursor: null,
  })
  const many = (prefix: string): HomeMessage[] =>
    Array.from({ length: 30 }, (_, i) => ({
      id: i + 1,
      role: i % 2 === 0 ? 'USER' : 'ASSISTANT',
      content: `${prefix} 메시지 ${i + 1}`,
      widgets: null,
      toolCalls: null,
      createdAt: '2026-06-08T00:00:00Z',
    }))
  await mockApi(page, 'GET', '/api/v1/home/sessions/s-a/messages', many('A'))
  await mockApi(page, 'GET', '/api/v1/home/sessions/s-b/messages', many('B'))

  await page.goto('/')
  await page.getByTestId('chat-launcher').click()
  const scroll = page.getByTestId('chat-scroll')

  // 1) 세션 A 선택 → 로드 + 하단
  await page.getByTestId('chat-session-switcher').click()
  await page.getByTestId('chat-session-select').first().click()
  // 드롭다운이 완전히 닫힌 뒤(다음 오픈을 막는 pointer-events 락 해제) 진행.
  await expect(page.getByTestId('chat-session-item')).toHaveCount(0)
  await expect(page.getByTestId('chat-panel')).toContainText('A 메시지 30')
  await expect
    .poll(async () => scroll.evaluate((el) => el.scrollHeight - el.clientHeight))
    .toBeGreaterThan(40)

  // 2) 위로 끝까지 스크롤(stuck=false 로 만든다)
  await scroll.evaluate((el) => {
    el.scrollTop = 0
    el.dispatchEvent(new Event('scroll'))
  })
  await expect.poll(async () => scroll.evaluate((el) => el.scrollTop)).toBe(0)

  // 3) 세션 B 선택 → 위로 올라가 있었어도 맨 아래로 내려가야 함
  await page.getByTestId('chat-session-switcher').click()
  await expect(page.getByTestId('chat-session-select').nth(1)).toBeVisible()
  await page.getByTestId('chat-session-select').nth(1).click()
  await expect(page.getByTestId('chat-session-item')).toHaveCount(0)
  await expect(page.getByTestId('chat-panel')).toContainText('B 메시지 30')
  await expect
    .poll(async () => scroll.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight))
    .toBeLessThanOrEqual(80)
})

test('세션 로드 후 콘텐츠 높이가 비동기로 커져도 하단 고정이 유지된다 (#455 ResizeObserver)', async ({
  authenticatedPage: page,
}) => {
  // 회귀(#455 핵심): 마크다운/지연(Suspense) 위젯이 렌더 후 높이를 키우면, 동기적으로 한 번만
  // scrollTop=scrollHeight 한 값은 늘어난 만큼 하단에서 밀려난다. useStickToBottom 의 ResizeObserver 가
  // 하단 고정 상태에서 콘텐츠 높이 증가를 잡아 다시 하단으로 붙여야 한다.
  // (RO 효과를 제거하면 이 테스트는 실패한다 — 핵심 경로 판별 가드.)
  await page.setViewportSize({ width: 1280, height: 520 })
  await mockChatSessions(page, {
    items: [{ id: 's-grow', title: '성장 대화', lastMessageAt: '2026-06-08T00:00:00Z', widgetCount: 0 }],
    nextCursor: null,
  })
  const messages: HomeMessage[] = Array.from({ length: 30 }, (_, i) => ({
    id: i + 1,
    role: i % 2 === 0 ? 'USER' : 'ASSISTANT',
    content: `메시지 ${i + 1}`,
    widgets: null,
    toolCalls: null,
    createdAt: '2026-06-08T00:00:00Z',
  }))
  await mockApi(page, 'GET', '/api/v1/home/sessions/s-grow/messages', messages)

  await page.goto('/')
  await page.getByTestId('chat-launcher').click()
  await page.getByTestId('chat-session-switcher').click()
  await page.getByTestId('chat-session-select').first().click()
  await expect(page.getByTestId('chat-panel')).toContainText('메시지 30')

  const scroll = page.getByTestId('chat-scroll')
  // 세션 로드 직후 하단(resetKey)
  await expect
    .poll(async () => scroll.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight))
    .toBeLessThanOrEqual(80)

  // 비동기 콘텐츠 렌더로 높이가 나중에 커지는 상황을 모사 — 관찰 대상(ul)에 큰 노드 추가.
  await scroll.evaluate((el) => {
    const ul = el.querySelector('ul')
    if (!ul) throw new Error('message list(ul) not found')
    const tall = document.createElement('li')
    tall.style.height = '1200px'
    tall.textContent = '늦게 렌더된 큰 콘텐츠'
    ul.appendChild(tall)
  })

  // RO 가 높이 증가를 잡아 다시 하단으로 붙여야 함(없으면 1200px 만큼 밀려나 실패).
  await expect
    .poll(async () => scroll.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight))
    .toBeLessThanOrEqual(80)
})

// aiAvailable 게이트 — 비서 없으면 AIChip(chat-launcher) 미렌더.
test('aiAvailable=false 이면 AIChip(chat-launcher) 이 렌더되지 않는다', async ({ authenticatedPage: page }) => {
  // aiAvailable:false 로 재정의(fixture 기본값 true 위에 LIFO 우선).
  await mockApi(page, 'GET', '/api/v1/users/me', createUser({ aiAvailable: false }))
  await page.goto('/')
  // AIChip 이 DOM 에 없어야 한다 (aiAvailable 게이트).
  await expect(page.getByTestId('chat-launcher')).not.toBeVisible()
})
