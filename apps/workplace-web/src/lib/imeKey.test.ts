import { describe, expect, it } from 'vitest';

import { isImeComposing } from './imeKey';

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
