// 비동기 E2E 공용 대기 헬퍼 (WP-225).
// 간헐 실패의 공통 원인은 "보인다"를 확인하자마자 앱이 아직 준비되지 않은 순간에 행동·측정하는 것이다.
// Playwright 의 boundingBox()·evaluate()·좌표 클릭은 자동 대기·재시도가 없어, 레이아웃이 다시 그려지거나
// 문서가 교체되는 찰나에 걸리면 null·예외·무시된 입력이 된다. 아래 헬퍼는 그 찰나를 넘길 때까지 다시 시도한다.
import { expect, type FrameLocator, type Locator, type Page } from '@playwright/test';

type Box = NonNullable<Awaited<ReturnType<Locator['boundingBox']>>>;

/**
 * 요소의 boundingBox 를 null 이 아닐 때까지 다시 잰다(끝내 없으면 실패).
 * 뷰포트가 1024 경계를 넘으면 목록이 모바일/데스크톱 레이아웃으로 다시 마운트되는 등, 보인다고 확인한
 * 직후에도 요소가 바뀌어 null 이 될 수 있다. 측정값으로 단언까지 하려면 expect(...).toPass() 안에서
 * measureBox 를 쓴다(재시도는 toPass 가 맡으므로 안에서 또 기다리지 않는다).
 */
export async function stableBox(locator: Locator, message = 'boundingBox'): Promise<Box> {
  let box: Box | null = null;
  await expect.poll(async () => (box = await locator.boundingBox()), { message }).not.toBeNull();
  return box!;
}

/** toPass 안에서 쓰는 즉시 측정 — null 이면 바로 던져 바깥 toPass 가 다시 시도하게 한다. */
export async function measureBox(locator: Locator, message = 'boundingBox'): Promise<Box> {
  const box = await locator.boundingBox();
  expect(box, message).not.toBeNull();
  return box!;
}

/** 문서·프레임이 교체되는 순간의 오류 — 새 문서에서 다시 재면 된다. */
const NAVIGATION_ERRORS = ['Execution context was destroyed', 'Frame was detached'];

/**
 * 문서가 교체되는 순간을 넘겨 측정·조작을 다시 실행한다 — 주로 `locator.evaluate` 를 감싼다.
 * iframe srcdoc 재작성·리마운트 중에 걸리면 "Execution context was destroyed" 로, iframe 요소가 바뀌어 잡아 둔
 * 프레임이 떨어지면 "Frame was detached" 로 던지는데(WP-1221 — 부하 중 push 게이트에서만 드러났다), expect.poll 은
 * 콜백 예외를 재시도하지 않고 바로 실패한다. 이 두 오류만 골라 새 문서가 뜰 때까지 다시 시도한다.
 *
 *   await expect.poll(() => retryOnNavigation(() => frame.locator('#a').evaluate((el) => getComputedStyle(el).color)))
 */
export async function retryOnNavigation<R>(run: () => Promise<R>): Promise<R> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await run();
    } catch (e) {
      if (attempt >= 4 || !NAVIGATION_ERRORS.some((m) => String(e).includes(m))) throw e;
    }
  }
}

/**
 * 격리 iframe(SandboxedHtmlFrame) 문서 안 요소의 스크롤바가 슬림(thin)인지 조건 대기로 확인한다(WP-275).
 * srcdoc 문서가 뜨기 전(about:blank)이나 교체 순간에 재면 틀린 값·예외가 나므로 poll + retryOnNavigation 으로 감싼다.
 */
export async function expectThinScrollbar(frame: FrameLocator, selector = 'body') {
  await expect
    .poll(() => retryOnNavigation(() => frame.locator(selector).evaluate((el) => getComputedStyle(el).scrollbarWidth)))
    .toBe('thin');
}

/**
 * 바깥(기본 좌상단 2,2) 클릭으로 레이어(다이얼로그·팝오버)를 닫는다 — 닫힐 때까지 클릭을 재시도한다.
 * Radix DismissableLayer 는 바깥 클릭 감지를 열린 다음 틱에 등록해, 열리자마자 누른 클릭은 무시될 수 있다.
 * 닫히면 곧바로 통과하므로 닫힌 뒤의 페이지를 다시 누르지 않는다.
 */
export async function dismissByOutsideClick(page: Page, layer: Locator, point = { x: 2, y: 2 }) {
  await expect(async () => {
    await page.mouse.click(point.x, point.y);
    // 닫힘 = DOM 에서 빠지거나(Radix Dialog) 숨겨진 채 남음(일부 메뉴) — toBeHidden 은 둘 다 통과한다.
    await expect(layer).toBeHidden({ timeout: 1000 });
  }).toPass();
}

/**
 * 뷰포트를 바꾸고 앱 셸 전환(1024 경계: 데스크톱 AppLayout ↔ MobileShell)이 끝날 때까지 기다린다.
 * 경계를 넘으면 화면이 통째로 다시 마운트되므로, 바로 재면 옛 배치나 사라지는 요소를 잡는다.
 * 셸 전환 뒤에도 내부가 늦게 자리 잡을 수 있으니 측정 단언은 stableBox·expect(...).toPass() 와 함께 쓴다.
 * AppLayout 안(로그인 뒤) 화면에서 goto 이후에만 쓴다 — 셸이 없는 화면은 setViewportSize 를 그대로 쓴다.
 */
export async function resizeAndSettle(page: Page, size: { width: number; height: number }) {
  await page.setViewportSize(size);
  await expect(page.getByTestId('mobile-shell')).toHaveCount(size.width < 1024 ? 1 : 0);
}

/**
 * 부재 확인 — ms 동안 값이 expected 로 유지되는지 50ms 간격으로 지켜본다(중간에 잠깐 어긋나도 잡는다).
 * "요청이 더 나가지 않는다 / 무언가 나타나지 않는다"는 일정 시간 아무 일도 없음을 봐야 하므로 고정 대기가
 * 불가피하다 — 그 대기를 이 한 곳에 모은다. 앱 타이머(디바운스·재시도 백오프·지연 삭제)가 원인이면 먼저
 * page.clock 으로 그 타이머를 넘긴 뒤 짧은 창(200ms 안팎)으로 쓴다.
 *
 * 기본은 엄격 — 창 시작 순간부터 expected 여야 한다(이미 어긋나 있으면 바로 실패).
 * 직전 동작이 값을 expected 로 "바꾸는" 중이면(첫 PATCH 1회 도착, 닫히는 중인 레이어) reach: true 로
 * expected 에 닿을 때까지 기다린 뒤 창을 연다.
 *
 *   await expectStays(page, () => patchCount, 0)                       // 아무 요청도 없어야 함
 *   await expectStays(page, () => puts.length, 1, { reach: true })      // 첫 PUT 도착 뒤 더 없음
 *   await expectStays(page, () => toolbar.count(), 0, { ms: 500 })      // 화면 요소
 */
export async function expectStays<T>(
  page: Page,
  read: () => T | Promise<T>,
  expected: T,
  { ms = 300, reach = false, message }: { ms?: number; reach?: boolean; message?: string } = {},
) {
  if (reach) await expect.poll(async (): Promise<unknown> => read(), { message }).toEqual(expected);
  const deadline = Date.now() + ms;
  for (;;) {
    const value: unknown = await read();
    expect(value, message).toEqual(expected);
    const left = deadline - Date.now();
    if (left <= 0) return;
    // eslint-disable-next-line playwright/no-wait-for-timeout -- 부재 확인은 일정 시간 아무 일도 없음을 지켜봐야 한다
    await page.waitForTimeout(Math.min(50, left));
  }
}

/**
 * 한 프레임을 온전히 넘긴다(두 번의 rAF) — 크기 변화 보정(ResizeObserver)은 레이아웃 뒤·페인트 전에 돌아 화면엔 밀린 모습이 그려지지 않지만,
 * 테스트가 DOM 삽입 직후 boundingBox 로 강제 레이아웃을 하면 보정 전 값을 읽는다. 페인트된 결과를 재려면 이 뒤에 잰다.
 */
export function nextFrame(page: Page): Promise<void> {
  return page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
}

/**
 * dnd-kit 키보드 끌기를 시작한다 — Space 로 집은 뒤 센서가 방향키를 받을 준비가 될 때까지 기다린다.
 * KeyboardSensor 는 시작 직후 방향키 리스너를 setTimeout(0) 으로 다음 태스크에 붙이는데, Chrome 은 연속 입력을 타이머보다
 * 먼저 처리해 부하에서 바로 누른 방향키가 리스너보다 먼저 와 조용히 버려진다(드롭 대상은 allowed 인 채 over 가 안 된다).
 * ready(시작 뒤 렌더로만 생기는 상태 — 드롭 대상의 allowed 등)를 확인한 뒤, 한 프레임과 같은 지연(0)의 타이머를 흘려
 * 먼저 예약된 센서 타이머가 실행됐음을 보장한다(같은 지연의 타이머는 예약 순서대로 실행된다).
 */
export async function startKeyboardDrag(row: Locator, ready: () => Promise<void>): Promise<void> {
  // 목록 로딩 중에는 끌기가 꺼져 있다 — 끌 수 있는 행이 된 뒤에 집는다.
  await expect(row).toHaveAttribute('aria-roledescription', /.+/);
  await row.focus();
  const page = row.page();
  await page.keyboard.press('Space');
  await ready();
  await nextFrame(page);
  await page.evaluate(() => new Promise<void>((r) => setTimeout(r, 0)));
}

/**
 * dnd-kit 끌기를 놓는다 — mouse.up() 뒤 dnd-kit 의 click 막음이 풀릴 때까지 기다려, 이어지는 클릭이 삼켜지지 않게 한다.
 * dnd-kit 은 놓은 뒤 setTimeout(50ms) 동안 document 캡처 단계에서 click 전파를 막는데, 부하로 그 타이머가 늦으면 놓은 직후의
 * 클릭(토스트 「되돌리기」·구간 펼치기 등)이 조용히 삼켜진다. 탐침 click 이 제 대상까지 닿는지로 직접 확인한다
 * (버블은 없지만 window·document 의 캡처 리스너에는 닿는다 — 앱은 click 캡처로 바깥 클릭을 판정하지 않는다).
 */
export async function dropDnd(page: Page): Promise<void> {
  await page.mouse.up();
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const probe = document.createElement('div');
          let reached = false;
          probe.addEventListener('click', () => (reached = true));
          document.body.appendChild(probe);
          probe.dispatchEvent(new MouseEvent('click', { bubbles: false }));
          probe.remove();
          return reached;
        }),
      { message: 'dnd-kit 놓은 뒤 click 막음 해제', intervals: [10, 20, 50, 100] },
    )
    .toBe(true);
}

/**
 * 테스트가 풀 때까지 목 응답을 붙잡는 게이트 — route 핸들러에서 `await g.p` 로 보류하고 테스트가 `g.release()` 로 푼다.
 * 부하에서도 "응답이 아직 안 왔다"를 시간이 아니라 상태로 관측하려는 용도.
 */
export function gate(): { p: Promise<void>; release: () => void } {
  let release!: () => void;
  const p = new Promise<void>((r) => (release = r));
  return { p, release };
}
