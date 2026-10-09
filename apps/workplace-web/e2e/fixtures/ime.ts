// IME(한글) 키 입력 재현 도우미 — Playwright 로는 실제 IME 조합을 만들 수 없어, 브라우저가 보내는 이벤트 순서를 그대로 디스패치한다.
import type { Locator } from '@playwright/test';

/**
 * macOS Chrome 한글 IME 에서 마지막 글자를 조합하던 중 Enter 를 누른 순간의 이벤트 순서(WP-331):
 * 조합 Enter keydown(isComposing, 229) → compositionend → 조합 아닌 Enter keydown(13, "꼬리 Enter").
 * 앱은 둘 다 Enter 동작(저장·이동)으로 보면 안 된다. 왕복 지연이 무시 창을 넘지 않게 한 번의 evaluate 로 보낸다.
 */
export async function pressMacChromeImeEnter(field: Locator, composed: string): Promise<void> {
  await field.evaluate((el, data) => {
    const enter = (init: KeyboardEventInit & { keyCode: number }) =>
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...init }));
    enter({ isComposing: true, keyCode: 229 });
    el.dispatchEvent(new CompositionEvent('compositionend', { data, bubbles: true }));
    enter({ keyCode: 13 });
  }, composed);
}

/**
 * 조합을 끝내며 진짜 Enter 를 한 번만 보내는 순서 — 모바일 키보드(compositionend → Enter 13),
 * Safari(compositionend → 조합 Enter 229 → 사용자가 다시 누른 Enter 13). 마지막 Enter 는 동작(저장·이동)해야 한다.
 */
export async function pressEnterAfterComposition(field: Locator, composed: string, opts: { safari?: boolean } = {}): Promise<void> {
  await field.evaluate(
    (el, { data, safari }) => {
      const enter = (init: KeyboardEventInit & { keyCode: number }) =>
        el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...init }));
      el.dispatchEvent(new CompositionEvent('compositionend', { data, bubbles: true }));
      if (safari) enter({ keyCode: 229 });
      enter({ keyCode: 13 });
    },
    { data: composed, safari: opts.safari ?? false },
  );
}
