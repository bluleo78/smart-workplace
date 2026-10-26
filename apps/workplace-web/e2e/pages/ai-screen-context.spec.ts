// WP-54 — AI 채팅 화면 컨텍스트 E2E: 페이지가 등록한 컨텍스트가 칩으로 보이고 전송 body(screenContext)에 실린다.
// 브라우저가 있어야 판정되는 것만 남긴다 — 이슈 상세 대표 흐름·위키(협업 서버를 쓰는 화면) 배선(@wiring), 칩 높이·다이얼로그와 패널의
// 겹침·폭·셸 전환·스크린샷(@layout), 키보드·툴팁·포커스·실제 클릭으로 본 다이얼로그와 패널의 상호작용(@input).
// × 1회 제외·되돌리기·화면 이동 뒤 복원·풀스크린·홈(칩 없음)과 이슈 목록·내 작업·AI 위임·개인 프로젝트·메일·캘린더 딥링크·채팅·드라이브·연락처
// 화면별 screenContext payload 는 페이지 테스트 src/components/ai/screen-context/aiScreenContext.test.tsx 가 지킨다(WP-966).
import { mockApi } from '../fixtures/api-mock'
import { dismissByOutsideClick } from '../fixtures/wait'
import { expect, test } from '../fixtures/auth.fixture'
import { type HomeChatStartBody, mockHomeChatGeneration } from '../fixtures/home-chat-mock'
import { mockIssueDetail } from '../fixtures/issue-detail-mock'
import { calendar, calendarEvent } from '../factories/calendar.factory'
import { wikiPageDetail, wikiPageSummary, wikiSpace } from '../factories/wiki.factory'

// 목 헬퍼들이 받는 Playwright Page 타입.
type Page = Parameters<typeof mockApi>[0]

// 채팅 응답을 목하고, 전송 요청을 기록하는 tracker 를 돌려준다.
async function captureChat(page: Page) {
  return mockHomeChatGeneration(page, {
    frames: [{ event: 'done', data: { sessionId: 's-ctx' } }],
  })
}

test.describe('AI 채팅 화면 컨텍스트 — 공통', () => {
  test('이슈 상세에서 칩이 보이고 전송 body 에 screenContext 가 실린다', { tag: ['@wiring', '@smoke'] }, async ({ authenticatedPage: page }) => {
    const chat = await captureChat(page)
    await mockIssueDetail(page)
    await page.goto('/projects/WP/issues/12')
    await page.getByTestId('chat-launcher').click()

    await expect(page.getByTestId('chat-context-chip')).toContainText('이슈 WP-12 로그인 버그 수정')
    await page.getByTestId('chat-input').fill('이거 요약해줘')
    await page.getByRole('button', { name: '보내기' }).click()

    await expect.poll(chat.count).toBe(1)
    expect(chat.bodies<HomeChatStartBody>()[0]).toMatchObject({
      query: '이거 요약해줘',
      screenContext: {
        view: '이슈 상세',
        focus: { type: '이슈', label: 'WP-12 로그인 버그 수정', refs: { issueKey: 'WP-12' } },
        scope: { label: '프로젝트 WP', refs: { projectKey: 'WP' } },
      },
    })
    expect(chat.bodies<HomeChatStartBody>()[0].screenContext!.focus!.facts).toContainEqual({ label: '상태', value: '진행 중' })
  })

  // 1회 제외·복원·전송 payload 는 src/components/ai/screen-context/aiScreenContext.test.tsx 가 지킨다 — 여기선 jsdom 이 못 재는 높이만.
  test('× 로 바뀐 제외 칩은 포함 칩과 높이가 같아 입력 영역이 흔들리지 않는다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
    await captureChat(page)
    await mockIssueDetail(page)
    await page.goto('/projects/WP/issues/12')
    await page.getByTestId('chat-launcher').click()

    const chipHeight = (await page.getByTestId('chat-context-chip').boundingBox())!.height
    await page.getByTestId('chat-context-remove').click()
    await expect(page.getByTestId('chat-context-chip-excluded')).toBeVisible()
    // 두 상태 높이가 같아 입력 영역이 흔들리지 않는다(레이아웃 이동 없음).
    expect((await page.getByTestId('chat-context-chip-excluded').boundingBox())!.height).toBe(chipHeight)
  })

  test('× 는 키보드(Tab 이동 + Enter)로도 동작하고 입력창으로 포커스가 돌아온다', { tag: '@input' }, async ({ authenticatedPage: page }) => {
    const chat = await captureChat(page)
    await mockIssueDetail(page)
    await page.goto('/projects/WP/issues/12')
    await page.getByTestId('chat-launcher').click()

    // 입력창에서 Shift+Tab 두 번 → 입력 행의 ＋ 첨부(WP-234)를 지나 바로 앞(칩의 ×)으로 이동. 접근성 이름으로 찾아 실제 버튼인지 확인.
    await page.getByTestId('chat-input').click()
    await page.keyboard.press('Shift+Tab')
    await expect(page.getByTestId('ai-composer-attach-button')).toBeFocused()
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
    await expect.poll(chat.count).toBe(1)
    expect(chat.bodies<HomeChatStartBody>()[0]).not.toHaveProperty('screenContext')
  })

  test('칩은 목적 문구를 보이고, × 와 라벨에 툴팁(Hover·Focus)을 띄운다', { tag: '@input' }, async ({ authenticatedPage: page }) => {
    await captureChat(page)
    await mockIssueDetail(page)
    await page.goto('/projects/WP/issues/12')
    await page.getByTestId('chat-launcher').click()

    const chip = page.getByTestId('chat-context-chip')
    await expect(chip).toContainText('화면 참고')
    // × Hover → "이번 1회" 의미 툴팁.
    await page.getByTestId('chat-context-remove').hover()
    await expect(page.getByRole('tooltip', { name: '이번 질문에만 빼기 · 보낸 뒤 다시 포함돼요' })).toBeVisible()
    // 라벨 Focus(키보드) → 전체 라벨 툴팁.
    // 포인터가 × 위에 남아 있어 × 툴팁(Hover)과 라벨 툴팁(Focus)이 동시에 떠 있을 수 있다 — 이름으로 특정한다.
    await page.getByTestId('chat-context-label').focus()
    await expect(page.getByRole('tooltip', { name: '이슈 WP-12 로그인 버그 수정' })).toBeVisible()
    // 스크린리더 알림 영역에 현재 화면 정보가 실려 있다.
    await expect(page.getByTestId('chat-context-live')).toHaveText('화면 정보: 이슈 WP-12 로그인 버그 수정')
    await page.getByTestId('chat-context-remove').click()
    await expect(page.getByTestId('chat-context-live')).toHaveText('화면 정보 빼고 보내요')
  })

})

test.describe('AI 채팅 화면 컨텍스트 — 캘린더', () => {
  // 오늘 정오(UTC) 일정 — 기본 월 보기에 항상 보이도록 팩토리 기본 날짜(2026-06)를 덮어쓴다.
  const startsAt = new Date(new Date().toISOString().slice(0, 10) + 'T03:00:00Z')
  const ev = calendarEvent({
    id: 42, title: '주간회의', location: '3층',
    startsAt: startsAt.toISOString(), endsAt: new Date(startsAt.getTime() + 3600_000).toISOString(),
  })
  async function mockCalendar(page: Page) {
    await mockApi(page, 'GET', '/api/v1/calendars', [calendar()])
    await mockApi(page, 'GET', '/api/v1/calendar/events', [ev])
    await mockApi(page, 'GET', '/api/v1/calendar/events/42', ev)
  }

  test('사이드 패널을 연 채 일정을 열고, 다이얼로그 위에서 패널에 입력·전송하면 eventId 가 실린다', { tag: '@input' }, async ({ authenticatedPage: page }) => {
    const chat = await captureChat(page)
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

    await expect.poll(chat.count).toBe(1)
    expect(chat.bodies<HomeChatStartBody>()[0].screenContext).toMatchObject({
      view: '캘린더',
      focus: { type: '일정', label: '주간회의', refs: { eventId: '42' } },
      scope: { label: '월 보기', count: 1 },
    })
    expect(chat.bodies<HomeChatStartBody>()[0].screenContext!.scope!.refs).toHaveProperty('from')
    expect(chat.bodies<HomeChatStartBody>()[0].screenContext!.focus!.facts).toContainEqual({ label: '장소', value: '3층' })
    // 패널 조작 후에도 다이얼로그는 열려 있다.
    await expect(dialog).toBeVisible()
  })

  test('패널 클릭은 다이얼로그를 유지하고, 페이지 영역 클릭은 다이얼로그를 닫는다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
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
    // 열린 직후 바깥 클릭은 Radix 가 무시할 수 있어 닫힐 때까지 재시도한다 (WP-225).
    await dismissByOutsideClick(page, dialog, { x: dlg!.x - 40, y: dlg!.y + 40 })
    await expect(page.getByTestId('ai-aware-dialog-overlay')).toHaveCount(0)
    await expect(page.getByTestId('ai-side-panel')).toBeVisible()
  })

  // WP-801 사이드 패널 배치가 폼을 기본 폭(32rem)으로 줄여 시작·종료가 두 줄로 꺾이고 줄표가 앞 줄 끝에 남았다 — 폼은 넓은 폭(36rem)을 지킨다.
  test('패널을 연 채 연 일정 편집 폼은 넓은 폭을 지켜 시작·종료가 한 줄에 놓이고 패널을 가리지 않는다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
    await captureChat(page)
    await mockCalendar(page)
    await page.goto('/calendar')
    await page.getByTestId('chat-launcher').click()
    await page.getByTestId('calendar-event-42').click()
    const dialog = page.getByTestId('calendar-event-dialog')
    await expect(page.getByTestId('calendar-form-start')).toBeVisible()

    const dlg = (await dialog.boundingBox())!
    const panel = (await page.getByTestId('ai-side-panel').boundingBox())!
    const start = (await page.getByTestId('calendar-form-start').boundingBox())!
    const end = (await page.getByTestId('calendar-form-end').boundingBox())!
    expect(dlg.width).toBeGreaterThan(32 * 16)
    expect(dlg.x + dlg.width).toBeLessThanOrEqual(panel.x + 1)
    expect(Math.abs(start.y - end.y)).toBeLessThan(1)
  })

  test('패널 입력창의 Esc 는 패널만 닫고 다이얼로그는 유지된다(이후 모달 복귀)', { tag: '@input' }, async ({ authenticatedPage: page }) => {
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

  test('다이얼로그를 연 채 ⌘K 로 패널을 열면 곧바로 입력되고, 편집 중인 값은 유지된다', { tag: '@input' }, async ({ authenticatedPage: page }) => {
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

  test('패널의 대화 선택 드롭다운·삭제 확인을 써도 다이얼로그는 유지된다', { tag: '@input' }, async ({ authenticatedPage: page }) => {
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

  test('side 모드 다이얼로그가 열린 동안 페이지 영역은 inert — Tab 이 흐린 페이지로 새지 않고, 닫으면 해제된다', { tag: '@input' }, async ({ authenticatedPage: page }) => {
    await captureChat(page)
    await mockCalendar(page)
    await page.goto('/calendar')
    await page.getByTestId('chat-launcher').click()
    await page.getByTestId('calendar-event-42').click()
    const dialog = page.getByTestId('calendar-event-dialog')
    await expect(dialog).toBeVisible()

    // 페이지 영역(AppRail·main)은 inert, AI 패널은 아님.
    await expect(page.getByTestId('app-rail')).toHaveAttribute('inert', '')
    await expect(page.locator('main')).toHaveAttribute('inert', '')
    await expect(page.getByTestId('ai-side-panel')).not.toHaveAttribute('inert')

    // 다이얼로그 마지막 컨트롤에서 Tab 을 여러 번 눌러도 포커스는 다이얼로그·AI 표면 안에만 머문다.
    const lastControl = dialog.locator('button, input, [tabindex]:not([tabindex="-1"])').last()
    await lastControl.focus()
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Tab')
      const where = await page.evaluate(() => {
        const a = document.activeElement
        if (!a || a === document.body) return 'body'
        if (a.closest('[data-testid=calendar-event-dialog]')) return 'dialog'
        if (a.closest('[data-ai-panel]')) return 'panel'
        return 'page'
      })
      expect(where).not.toBe('page')
    }

    // 닫으면 inert 가 남지 않는다.
    await dialog.getByRole('button', { name: '닫기' }).click()
    await expect(dialog).toBeHidden()
    await expect(page.getByTestId('app-rail')).not.toHaveAttribute('inert')
    await expect(page.locator('main')).not.toHaveAttribute('inert')
  })

  test('side 모드 다이얼로그가 열린 채 셸이 모바일↔데스크톱으로 바뀌어도 새로 그린 페이지 영역이 inert 다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
    await captureChat(page)
    await mockCalendar(page)
    await page.goto('/calendar')
    await page.getByTestId('chat-launcher').click()
    await page.getByTestId('calendar-event-42').click()
    const dialog = page.getByTestId('calendar-event-dialog')
    await expect(dialog).toBeVisible()
    // 셸이 바뀌면 페이지 영역 DOM 이 새로 그려진다 — 새 main 도 inert 조상 아래 있어야 한다.
    const mainInert = () =>
      page.evaluate(() => Array.from(document.querySelectorAll('[data-ai-page-root] main')).every((el) => el.closest('[inert]') != null))
    await page.setViewportSize({ width: 800, height: 900 }) // lg(1024px) 미만 → 모바일 셸
    await expect(dialog).toBeVisible()
    await expect.poll(mainInert).toBe(true)
    await page.setViewportSize({ width: 1440, height: 900 }) // 다시 데스크톱 셸
    await expect(dialog).toBeVisible()
    await expect.poll(mainInert).toBe(true)
  })

  test('패널 칩 툴팁(body 포털)을 클릭해도 다이얼로그는 닫히지 않는다', { tag: '@input' }, async ({ authenticatedPage: page }) => {
    await captureChat(page)
    await mockCalendar(page)
    await page.goto('/calendar')
    await page.getByTestId('chat-launcher').click()
    await page.getByTestId('calendar-event-42').click()
    const dialog = page.getByTestId('calendar-event-dialog')
    await expect(dialog).toBeVisible()

    await page.getByTestId('chat-context-label').hover()
    const tip = page.locator('[data-slot=tooltip-content]')
    await expect(tip).toBeVisible()
    await tip.click()
    await expect(dialog).toBeVisible()
  })

  test('패널을 닫아 modal 로 돌아가면 inert 는 해제되고 페이지 영역은 모달 aria-hidden 으로 가려진다', { tag: '@input' }, async ({ authenticatedPage: page }) => {
    await captureChat(page)
    await mockCalendar(page)
    await page.goto('/calendar')
    await page.getByTestId('chat-launcher').click()
    await page.getByTestId('calendar-event-42').click()
    const dialog = page.getByTestId('calendar-event-dialog')
    await expect(dialog).toBeVisible()
    await expect(page.getByTestId('app-rail')).toHaveAttribute('inert', '')

    // 툴팁이 떠 있으면(퇴장 애니메이션 중 포함) 최상위 DismissableLayer 가 Escape 를 가로채므로,
    // 입력창 클릭 후 툴팁이 DOM 에서 완전히 사라진 것을 확인한 뒤 Escape 로 패널을 닫는다.
    await page.getByTestId('chat-input').click()
    await expect(page.locator('[data-slot=tooltip-content]')).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('ai-side-panel')).toBeHidden()
    await expect(dialog).toBeVisible()
    await expect(page.getByTestId('app-rail')).not.toHaveAttribute('inert')
    // modal 복귀 — Radix hideOthers 가 AppRail(또는 그 조상)에 aria-hidden="true" 를 건다.
    await expect
      .poll(() => page.getByTestId('app-rail').evaluate((el) => el.closest('[aria-hidden="true"]') !== null))
      .toBe(true)
  })

  test('스크린샷 — 일정 다이얼로그와 사이드 패널 동시 표시(라이트/다크)', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
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
  async function mockDrive(page: Page) {
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

  test('미리보기 모달을 연 채 사이드 패널에 입력·전송할 수 있고 모달은 유지된다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
    const chat = await captureChat(page)
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
    await expect.poll(chat.count).toBe(1)
    expect(chat.bodies<HomeChatStartBody>()[0].query).toBe('이 파일 요약해줘')
    await expect(preview).toBeVisible()
    // 넓은 미리보기(w-[64rem])도 패널을 가리지 않도록 페이지 영역 안으로 클램프된다.
    const dlg = await page.getByRole('dialog').boundingBox()
    const panel = await page.getByTestId('ai-side-panel').boundingBox()
    expect(dlg!.x + dlg!.width).toBeLessThanOrEqual(panel!.x + 1)
  })
})

// 위키 화면 목 — 스페이스 목록·트리·페이지 상세·백링크·멘션 (e2e/pages/wiki/wiki-header.spec.ts 와 같은 집합).
async function mockWiki(page: Page) {
  await mockApi(page, 'GET', '/api/v1/wiki/spaces', [wikiSpace({ id: 2, name: '개발' })])
  await mockApi(page, 'GET', '/api/v1/wiki/spaces/2/pages', [wikiPageSummary({ id: 10, title: '배포 가이드' })])
  await mockApi(page, 'GET', '/api/v1/wiki/pages/10/backlinks', [])
  await mockApi(page, 'GET', '/api/v1/wiki/pages/10/mentions', [])
  await mockApi(
    page, 'GET', '/api/v1/wiki/pages/10',
    wikiPageDetail({ id: 10, spaceId: 2, title: '배포 가이드', updatedAt: '2026-09-29T05:00:00Z' }),
  )
}

test.describe('AI 채팅 화면 컨텍스트 — 위키', () => {
  test('페이지 pageId·스페이스가 실린다', { tag: '@wiring' }, async ({ authenticatedPage: page }) => {
    const chat = await captureChat(page)
    await mockWiki(page)
    // 스페이스 목록(useWikiSpaces) 로드가 뒤늦게 될 수 있어 병렬 로드에서 플레이키 (가능성 낮음)
    // → goto 전에 대기 시작, send 전에 완료 확인하여 scope.label 이 항상 '위키 스페이스 개발' 으로 결정론적 도착
    const spacesLoaded = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/v1/wiki/spaces' && r.request().method() === 'GET')
    await page.goto('/wiki/spaces/2/pages/10')
    await page.getByTestId('chat-launcher').click()
    await expect(page.getByTestId('chat-context-chip')).toContainText('위키 페이지 배포 가이드')
    await spacesLoaded
    await page.getByTestId('chat-input').fill('이 문서 요약')
    await page.getByRole('button', { name: '보내기' }).click()
    await expect.poll(chat.count).toBe(1)
    expect(chat.bodies<HomeChatStartBody>()[0].screenContext).toMatchObject({
      focus: { refs: { pageId: '10' } },
      scope: { label: '위키 스페이스 개발', refs: { spaceId: '2' } },
    })
  })
})
