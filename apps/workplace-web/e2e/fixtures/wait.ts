// 비동기 E2E 공용 대기 헬퍼 (WP-225).
// 간헐 실패의 공통 원인은 "보인다"를 확인하자마자 앱이 아직 준비되지 않은 순간에 행동·측정하는 것이다.
// Playwright 의 boundingBox()·evaluate()·좌표 클릭은 자동 대기·재시도가 없어, 레이아웃이 다시 그려지거나
// 문서가 교체되는 찰나에 걸리면 null·예외·무시된 입력이 된다. 아래 헬퍼는 그 찰나를 넘길 때까지 다시 시도한다.
import { expect, type Locator, type Page } from '@playwright/test';

type Box = NonNullable<Awaited<ReturnType<Locator['boundingBox']>>>;

/**
 * 요소의 boundingBox 를 null 이 아닐 때까지 다시 잰다(끝내 없으면 실패).
 * 뷰포트가 1024 경계를 넘으면 목록이 모바일/데스크톱 레이아웃으로 다시 마운트되는 등, 보인다고 확인한
 * 직후에도 요소가 바뀌어 null 이 될 수 있다. 측정값으로 단언까지 하려면 expect(...).toPass() 로 감싼다.
 */
export async function stableBox(locator: Locator, message = 'boundingBox'): Promise<Box> {
  let box: Box | null = null;
  await expect.poll(async () => (box = await locator.boundingBox()), { message }).not.toBeNull();
  return box!;
}

/**
 * 문서가 교체되는 순간을 넘겨 측정·조작을 다시 실행한다 — 주로 `locator.evaluate` 를 감싼다.
 * iframe srcdoc 재작성·리마운트 중에 걸리면 "Execution context was destroyed" 로 던지는데, expect.poll 은
 * 콜백 예외를 재시도하지 않고 바로 실패한다. 이 오류만 골라 새 문서가 뜰 때까지 다시 시도한다.
 *
 *   await expect.poll(() => retryOnNavigation(() => frame.locator('#a').evaluate((el) => getComputedStyle(el).color)))
 */
export async function retryOnNavigation<R>(run: () => Promise<R>): Promise<R> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await run();
    } catch (e) {
      if (attempt >= 4 || !String(e).includes('Execution context was destroyed')) throw e;
    }
  }
}

/**
 * 바깥(기본 좌상단 2,2) 클릭으로 레이어(다이얼로그·팝오버)를 닫는다 — 닫힐 때까지 클릭을 재시도한다.
 * Radix DismissableLayer 는 바깥 클릭 감지를 열린 다음 틱에 등록해, 열리자마자 누른 클릭은 무시될 수 있다.
 * 닫히면 곧바로 통과하므로 닫힌 뒤의 페이지를 다시 누르지 않는다.
 */
export async function dismissByOutsideClick(page: Page, layer: Locator, point = { x: 2, y: 2 }) {
  await expect(async () => {
    await page.mouse.click(point.x, point.y);
    await expect(layer).toHaveCount(0, { timeout: 1000 });
  }).toPass();
}

/**
 * 뷰포트를 바꾸고 앱 셸 전환(1024 경계: 데스크톱 AppLayout ↔ MobileShell)이 끝날 때까지 기다린다.
 * 경계를 넘으면 화면이 통째로 다시 마운트되므로, 바로 재면 옛 배치나 사라지는 요소를 잡는다.
 * 셸 전환 뒤에도 내부가 늦게 자리 잡을 수 있으니 측정 단언은 stableBox·expect(...).toPass() 와 함께 쓴다.
 * AppLayout 밖 화면(로그인 등)은 셸이 없으므로 settleShell: false 로 크기만 바꾼다.
 */
export async function resizeAndSettle(
  page: Page,
  size: { width: number; height: number },
  { settleShell = true }: { settleShell?: boolean } = {},
) {
  await page.setViewportSize(size);
  if (settleShell) await expect(page.getByTestId('mobile-shell')).toHaveCount(size.width < 1024 ? 1 : 0);
}
