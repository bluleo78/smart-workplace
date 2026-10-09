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

// macOS Chrome 꼬리 Enter(WP-331) — compositionend 직후 짧은 창 안의 Enter 만 꼬리로 본다.
describe('isTrailingImeEnter', () => {
  it('compositionend 직후(창 안) Enter 는 꼬리 Enter 다', () => {
    expect(isTrailingImeEnter(1000, 1000)).toBe(true);
    expect(isTrailingImeEnter(1000 + IME_TRAILING_ENTER_MS - 1, 1000)).toBe(true);
  });
  it('창이 지난 Enter·조합 이력이 없는 Enter 는 사용자의 진짜 Enter 다', () => {
    expect(isTrailingImeEnter(1000 + IME_TRAILING_ENTER_MS, 1000)).toBe(false);
    expect(isTrailingImeEnter(1000, Number.NEGATIVE_INFINITY)).toBe(false);
  });
});
