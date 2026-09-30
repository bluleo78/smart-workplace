import { describe, expect, it, vi } from 'vitest';

import { createScreenContextStore } from './store';

const ctxA = { view: '이슈 상세', focus: { type: '이슈', label: 'WP-1 A', refs: { issueKey: 'WP-1' } } };
const ctxB = { view: '메일함', scope: { label: '받은편지함' } };

describe('createScreenContextStore', () => {
  it('등록한 컨텍스트를 반환하고 구독자에게 알린다', () => {
    const store = createScreenContextStore();
    const fn = vi.fn();
    store.subscribe(fn);
    store.set(Symbol('a'), ctxA);
    expect(store.get()).toEqual(ctxA);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('동일 내용 재등록은 참조를 유지하고 알림하지 않는다(렌더 루프 방지)', () => {
    const store = createScreenContextStore();
    const t = Symbol('a');
    store.set(t, ctxA);
    const first = store.get();
    const fn = vi.fn();
    store.subscribe(fn);
    store.set(t, JSON.parse(JSON.stringify(ctxA)));
    expect(store.get()).toBe(first);
    expect(fn).not.toHaveBeenCalled();
  });

  it('이전 화면 토큰의 늦은 release 는 현재 컨텍스트를 지우지 않는다(뒤늦은 cleanup 방어)', () => {
    const store = createScreenContextStore();
    const a = Symbol('a');
    const b = Symbol('b');
    store.set(a, ctxA);
    store.set(b, ctxB); // 화면 B 가 먼저 등록
    store.release(a); // 화면 A 의 늦은 cleanup
    expect(store.get()).toEqual(ctxB);
  });

  it('유일한 등록자의 release 는 컨텍스트를 비운다', () => {
    const store = createScreenContextStore();
    const a = Symbol('a');
    store.set(a, ctxA);
    store.release(a);
    expect(store.get()).toBeNull();
  });

  it('등록자가 null 을 set 하면 자기 항목을 지운다', () => {
    const store = createScreenContextStore();
    const a = Symbol('a');
    store.set(a, ctxA);
    store.set(a, null);
    expect(store.get()).toBeNull();
  });

  it('한 화면의 두 등록자 — 나중 등록이 우선, 그쪽이 null 이 되면 앞 등록으로 복귀', () => {
    const store = createScreenContextStore();
    const list = Symbol('list');
    const panel = Symbol('panel');
    store.set(list, ctxB);
    store.set(panel, ctxA);
    expect(store.get()).toEqual(ctxA);
    store.set(panel, null); // 패널 닫힘
    expect(store.get()).toEqual(ctxB);
  });

  it('unsubscribe 후에는 알림을 받지 않는다', () => {
    const store = createScreenContextStore();
    const fn = vi.fn();
    const off = store.subscribe(fn);
    off();
    store.set(Symbol('a'), ctxA);
    expect(fn).not.toHaveBeenCalled();
  });
});
