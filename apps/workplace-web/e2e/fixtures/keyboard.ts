// 모바일 키보드 시뮬레이션 — 헤드리스에선 가상 키보드가 없어 visualViewport 를 가짜로 바꿔 useVisualViewport(WP-154)를 구동한다.
import type { Page } from '@playwright/test';

/** 가짜 visualViewport 설치 — goto 전에 호출(addInitScript). height 는 setKeyboard 가 조절한다. */
export async function installFakeViewport(page: Page) {
  await page.addInitScript(() => {
    let override: number | null = null;
    const vv = Object.assign(new EventTarget(), { offsetTop: 0, scale: 1 });
    Object.defineProperty(vv, 'height', { get: () => override ?? window.innerHeight, set: (v: number) => { override = v; } });
    Object.defineProperty(window, 'visualViewport', { value: vv, configurable: true });
    (window as unknown as { __vv: typeof vv }).__vv = vv;
  });
}

/** 키보드 열림/닫힘 흉내 — 보이는 뷰포트 높이를 바꾸고 resize 이벤트를 쏜 뒤 그 높이를 돌려준다. */
export function setKeyboard(page: Page, open: boolean, px = 300) {
  return page.evaluate(([o, kb]) => {
    const vv = (window as unknown as { __vv: EventTarget & { height: number } }).__vv;
    vv.height = o ? window.innerHeight - (kb as number) : window.innerHeight;
    vv.dispatchEvent(new Event('resize'));
    return vv.height;
  }, [open, px] as const);
}
