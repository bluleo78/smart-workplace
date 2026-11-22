import type { Page } from '@playwright/test'

// E2E 시계 멈춤 공용 도우미 (WP-1940).
// 「페이지 시각 + N ms 에서 멈춤」은 읽은 뒤 pauseAt 까지 N ms 넘게 지나면(부하가 큰 커밋 훅·병렬 실행)
// "Cannot fast-forward to the past" 로 거절된다. 재시도는 한 번이면 된다 — Playwright 1.60 의 pauseAt 은
// 시계를 먼저 멈추고(`_innerPause`) 그다음에 과거인지 검사하므로, 거절된 때 시계는 이미 멈춰 있어
// 다시 읽은 시각 + aheadMs 는 과거가 될 수 없다(시계는 「거절된 시점 + aheadMs」에 멈춘다).
// 이 순서와 메시지 문자열은 Playwright 1.60 기준으로 확인했다 — 올리면 다시 확인한다.

const PAST_ERROR = 'fast-forward to the past'

/** 지금 페이지 시각 + aheadMs 에서 시계를 멈춘다. 지연으로 과거가 되어 거절되면 멈춘 시각을 다시 읽어 한 번 더 시도한다. */
export async function pauseClockAhead(page: Page, aheadMs: number): Promise<void> {
  const now = await page.evaluate(() => Date.now())
  try {
    await page.clock.pauseAt(now + aheadMs)
  } catch (e) {
    // 과거 시각 거절만 재시도 대상 — 그 밖의 오류는 진짜 문제이므로 숨기지 않는다.
    if (!(e instanceof Error) || !e.message.includes(PAST_ERROR)) throw e
    const pausedNow = await page.evaluate(() => Date.now())
    await page.clock.pauseAt(pausedNow + aheadMs)
  }
}
