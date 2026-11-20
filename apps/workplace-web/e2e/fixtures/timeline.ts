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
async function waitScrollAfter(page: Page, seq: number, timeout?: number) {
  await expect.poll(() => scrollSeq(page), { message: `차트 스크롤(${seq}번째 뒤)`, timeout }).toBeGreaterThan(seq);
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

/**
 * 타임라인 첫 로드 대기 한도 — 부하 속 push 게이트에서 간트 첫 표시·첫 그리기가 기본 expect 한도(10초)를 넘었다.
 * WP-1650 이 테스트 둘에만 넣었던 30초 대책을 공용으로 올렸다(WP-1854).
 */
export const TIMELINE_FIRST_LOAD_TIMEOUT = 30_000;

/** 테스트 한도(파일 범위 `describe.configure`) — 첫 로드 한 번(30초) + 나머지 단계. 첫 로드가 두 번이면 TIMELINE_FIRST_LOAD_TIMEOUT 을 더 얹는다. */
export const TIMELINE_SPEC_TIMEOUT = 90_000;

/** 간트(`timeline-gantt`)가 보일 때까지 첫 로드 한도로 기다린다. */
async function expectGanttVisible(page: Page) {
  await expect(page.getByTestId('timeline-gantt')).toBeVisible({ timeout: TIMELINE_FIRST_LOAD_TIMEOUT });
}

/** 타임라인으로 이동해 간트가 보일 때까지 기다린다. */
export async function openTimelineGantt(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await expectGanttVisible(page);
}

/** 열려 있는 타임라인을 새로고침하고 간트가 다시 보일 때까지 기다린다 — 새로고침도 간트를 처음부터 다시 그린다. */
export async function reloadTimeline(page: Page): Promise<void> {
  await page.reload();
  await expectGanttVisible(page);
}

/**
 * 타임라인을 열고 첫 진입 스크롤(오늘 쪽, WP-486)이 걸릴 때까지 기다린다 — 막대를 재거나 끌기 전에 이걸로 연다.
 * 스크롤 수는 간트 뿌리에 붙어 첫 스크롤이 걸렸다면 간트는 이미 그려졌으므로 이 대기 하나가 30초 예산 전체다.
 */
export async function gotoTimeline(page: Page, url: string) {
  await page.goto(url);
  await waitScrollAfter(page, 0, TIMELINE_FIRST_LOAD_TIMEOUT);
}
