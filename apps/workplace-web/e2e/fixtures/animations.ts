// 공통 fixture(auth.fixture)가 넣은 애니메이션 끄기 style 을 걷는 헬퍼 — 전환 중간 프레임·전환 끝 재측정을 보는 @layout 테스트가 함께 쓴다.
import { expect, type Page } from '@playwright/test'

/**
 * 공통 fixture 가 넣은 애니메이션 끄기 style(data-test-no-animation)을 뗀다 — 전환이 한 프레임에 끝나 버리면
 * 「중간 프레임에도 판정이 흔들리지 않음」(help-panel)·「전환이 끝난 뒤 다시 잼」(WP-1612 top-center-dock)을 볼 수 없어서.
 * 지금 문서에만 적용된다(새로 열면 다시 깔린다). 이어 쓰는 page(WP-1002)에 전환이 켜진 채 남지 않도록 page.addInitScript 를 불러
 * 이 테스트가 끝나면 컨텍스트가 버려지게 한다(reuse-app 의 DIRTY_PAGE_METHODS — 이미 다른 init script 를 건 테스트면 중복이지만 해가 없다).
 */
export async function restoreAnimations(page: Page) {
  await page.addInitScript(() => {})
  await page.evaluate(() => document.querySelectorAll('style[data-test-no-animation]').forEach((el) => el.remove()))
  await expect.poll(() => page.evaluate(() => document.querySelectorAll('style[data-test-no-animation]').length)).toBe(0)
}
