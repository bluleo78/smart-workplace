import { describe, expect, it } from 'vitest';

import { Semaphore } from './semaphore.js';

describe('Semaphore', () => {
  it('limit 이내면 즉시 획득한다', async () => {
    const s = new Semaphore(2);
    await s.acquire();
    await s.acquire();
    expect(s.availableSlots).toBe(0);
  });

  it('limit 초과 획득은 release 될 때까지 대기한다', async () => {
    const s = new Semaphore(2);
    await s.acquire();
    await s.acquire();

    let acquired = false;
    const pending = s.acquire().then(() => {
      acquired = true;
    });

    await Promise.resolve();
    expect(acquired).toBe(false); // 슬롯 없음 → 대기
    expect(s.queuedCount).toBe(1);

    s.release(); // 대기자에게 슬롯 전달
    await pending;
    expect(acquired).toBe(true);
    expect(s.queuedCount).toBe(0);
  });

  it('대기자가 없으면 release 가 가용 슬롯을 늘린다', async () => {
    const s = new Semaphore(1);
    await s.acquire();
    expect(s.availableSlots).toBe(0);
    s.release();
    expect(s.availableSlots).toBe(1);
  });

  it('대기 순서대로(FIFO) 슬롯을 넘긴다', async () => {
    const s = new Semaphore(1);
    await s.acquire();

    const order: number[] = [];
    const p1 = s.acquire().then(() => order.push(1));
    const p2 = s.acquire().then(() => order.push(2));

    s.release(); // p1 에게
    await p1;
    s.release(); // p2 에게
    await p2;

    expect(order).toEqual([1, 2]);
  });

  it('limit 이 0 이하라도 최소 1 로 동작한다(교착 방지)', async () => {
    const s = new Semaphore(0);
    await s.acquire(); // 교착 없이 획득돼야 함
    expect(s.availableSlots).toBe(0);
  });

  it('tryAcquire 는 슬롯이 있으면 true(소비), 없으면 false(무변화)', () => {
    const s = new Semaphore(1);
    expect(s.tryAcquire()).toBe(true);
    expect(s.availableSlots).toBe(0);
    expect(s.tryAcquire()).toBe(false); // 슬롯 없음
    expect(s.availableSlots).toBe(0);
    s.release();
    expect(s.tryAcquire()).toBe(true);
  });
});
