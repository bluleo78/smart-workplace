// 타임라인 E2E 공용 헬퍼.
import { expect, type Page } from '@playwright/test';

const root = (page: Page) => page.locator('.timeline-gantt-root');

/** 지금까지 걸린 차트 스크롤 수 — 앱이 스크롤을 걸 때마다 차트 뿌리의 `data-scroll-seq` 를 올린다(TimelineGantt). */
async function scrollSeq(page: Page): Promise<number> {
  return Number((await root(page).getAttribute('data-scroll-seq')) ?? 0);
}

/**
 * 차트 스크롤이 seq 번째보다 더 걸릴 때까지 기다린다 — 「오늘」·첫 진입 스크롤은 React 효과 다음 프레임에 걸려 부하에 따라
 * 늦게 오는데, 그 전에 막대·오늘선을 재면 잰 직후 차트가 밀려 좌표가 어긋났다(프레임 몇 개 기다리기로는 못 막는다).
 */
async function waitScrollAfter(page: Page, seq: number) {
  await expect.poll(() => scrollSeq(page), { message: `차트 스크롤(${seq}번째 뒤)` }).toBeGreaterThan(seq);
}

/**
 * action(「오늘」·보기 전환 클릭 등)이 일으킨 차트 스크롤이 걸릴 때까지 기다린다 — 수는 action 전에 잡아야 action 직후 곧바로
 * 걸린 스크롤을 놓치지 않는다.
 */
export async function afterScroll(page: Page, action: () => Promise<unknown>) {
  const seq = await scrollSeq(page);
  await action();
  await waitScrollAfter(page, seq);
}

/** 타임라인을 열고 첫 진입 스크롤(오늘 쪽, WP-486)이 걸릴 때까지 기다린다 — 막대를 재거나 끌기 전에 이걸로 연다. */
export async function gotoTimeline(page: Page, url: string) {
  await page.goto(url);
  await waitScrollAfter(page, 0);
}
