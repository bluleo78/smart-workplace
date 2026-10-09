import { describe, expect, it } from 'vitest';

import { IME_TRAILING_ENTER_MS, isImeComposing, isTrailingImeEnter } from './imeKey';

// Enter 조합 판정은 submitEnter.test.ts 가 다룬다 — 여기선 키 종류와 무관하게 조합 신호만 보는지 확인한다(RecipientInput 의 Backspace·Esc).
describe('isImeComposing', () => {
  const key = (init: Partial<KeyboardEvent>) => ({ isComposing: false, keyCode: 0, ...init }) as KeyboardEvent;
  it('조합 중(isComposing) 이거나 keyCode 229 면 키 종류와 무관하게 IME 키다', () => {
    expect(isImeComposing(key({ key: 'Backspace', isComposing: true }))).toBe(true);
    expect(isImeComposing(key({ key: 'Backspace', keyCode: 229 }))).toBe(true);
  });
  it('조합이 아닌 키는 IME 키가 아니다', () => {
    expect(isImeComposing(key({ key: 'Enter', keyCode: 13 }))).toBe(false);
    expect(isImeComposing(key({ key: 'Backspace', keyCode: 8 }))).toBe(false);
  });
});

// macOS Chrome 꼬리 Enter(WP-331) — 같은 키 입력에 딸린 이벤트로 볼 만큼 가까운지(짧은 창 안)만 본다.
describe('isTrailingImeEnter', () => {
  it('창 안이면 같은 키 입력에 딸린 이벤트다', () => {
    expect(isTrailingImeEnter(1000, 1000)).toBe(true);
    expect(isTrailingImeEnter(1000 + IME_TRAILING_ENTER_MS - 1, 1000)).toBe(true);
  });
  it('창이 지났거나 기준 이벤트가 없으면 별개 입력이다', () => {
    expect(isTrailingImeEnter(1000 + IME_TRAILING_ENTER_MS, 1000)).toBe(false);
    expect(isTrailingImeEnter(1000, Number.NEGATIVE_INFINITY)).toBe(false);
  });
});
