import { describe, expect, test } from 'vitest';

import { orderActivity, parseActivityOrder } from './activityOrder';

describe('activityOrder', () => {
  test('저장값은 newest 만 최신순, 그 밖(없음·모르는 값)은 오래된 순', () => {
    expect(parseActivityOrder('newest')).toBe('newest');
    expect(parseActivityOrder('oldest')).toBe('oldest');
    expect(parseActivityOrder(null)).toBe('oldest');
    expect(parseActivityOrder('asc')).toBe('oldest');
  });

  test('최신순은 뒤집은 새 배열, 오래된 순은 받은 그대로 — 원본은 바꾸지 않는다', () => {
    const items = [1, 2, 3];
    expect(orderActivity(items, 'newest')).toEqual([3, 2, 1]);
    expect(items).toEqual([1, 2, 3]);
    expect(orderActivity(items, 'oldest')).toBe(items);
  });
});
