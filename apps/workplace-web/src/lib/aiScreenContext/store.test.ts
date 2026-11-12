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

  // WP-1261: 첨부 미리 보기는 overlay 층 — 페이지 컨텍스트 위에 얹히고, 페이지가 뒤에 다시 등록해도 밀려나지 않는다.
  describe('overlay 층', () => {
    const file = { view: '미리 보기', focus: { type: '파일', label: 'a.pdf', refs: { source: 'drive', driveFileId: '3' } } };

    it('페이지 대상은 범위로 내려가고 미리 보는 파일이 대상이 된다', () => {
      const store = createScreenContextStore();
      store.set(Symbol('page'), ctxA);
      store.set(Symbol('viewer'), file, 'overlay');
      expect(store.get()).toEqual({
        view: '이슈 상세',
        focus: file.focus,
        scope: { label: '이슈 WP-1 A', refs: { issueKey: 'WP-1' } },
      });
    });

    it('페이지가 나중에 다시 등록해도 overlay 가 유지되고 페이지 값만 갱신된다', () => {
      const store = createScreenContextStore();
      const page = Symbol('page');
      store.set(page, ctxA);
      store.set(Symbol('viewer'), file, 'overlay');
      store.set(page, { ...ctxA, focus: { ...ctxA.focus, label: 'WP-1 바뀐 제목' } });
      expect(store.get()?.focus).toEqual(file.focus);
      expect(store.get()?.scope?.label).toBe('이슈 WP-1 바뀐 제목');
    });

    it('overlay 를 풀면 페이지 컨텍스트로 돌아간다', () => {
      const store = createScreenContextStore();
      const viewer = Symbol('viewer');
      store.set(Symbol('page'), ctxA);
      store.set(viewer, file, 'overlay');
      store.release(viewer);
      expect(store.get()).toEqual(ctxA);
    });

    it('페이지가 없으면 overlay 를 그대로 쓴다', () => {
      const store = createScreenContextStore();
      store.set(Symbol('viewer'), file, 'overlay');
      expect(store.get()).toEqual(file);
    });
  });

  describe('help 층(WP-1511)', () => {
    const section = { id: 'agent.run.repo', path: ['설정', '에이전트', '저장소 연결'], body: '본문' };

    it('help 층은 page 문맥 위에 help 필드로 합쳐진다', () => {
      const s = createScreenContextStore();
      const p = Symbol('p');
      const h = Symbol('h');
      s.set(p, { view: '설정 · 에이전트 상세' });
      s.setHelp(h, { section });
      expect(s.get()).toEqual({ view: '설정 · 에이전트 상세', help: { section } });
    });

    it('help 층만 있고 page 가 없으면 view 는 도움말', () => {
      const s = createScreenContextStore();
      s.setHelp(Symbol('h'), { section });
      expect(s.get()?.view).toBe('도움말');
      expect(s.get()?.help?.section).toEqual(section);
    });

    it('검색어만 있어도 page 가 없으면 도움말 문맥이 된다', () => {
      const s = createScreenContextStore();
      s.setHelp(Symbol('h'), { query: '토큰' });
      expect(s.get()).toEqual({ view: '도움말', help: { query: '토큰' } });
    });

    it('help 층 여러 등록자는 dialogs 를 합치고(같은 id 한 번) 나머지 키는 최근 값', () => {
      const s = createScreenContextStore();
      s.set(Symbol('p'), { view: 'V' });
      s.setHelp(Symbol('a'), { query: 'old', dialogs: [{ id: 'x', label: 'X' }] });
      s.setHelp(Symbol('b'), { query: 'q', dialogs: [{ id: 'x', label: 'X' }, { id: 'y', label: 'Y' }] });
      expect(s.get()?.help?.dialogs).toHaveLength(2);
      expect(s.get()?.help?.query).toBe('q');
    });

    it('releaseHelp 하면 help 가 빠지고 page 문맥만 남는다(알림 1회)', () => {
      const s = createScreenContextStore();
      const h = Symbol('h');
      s.set(Symbol('p'), { view: 'V' });
      s.setHelp(h, { section });
      const fn = vi.fn();
      s.subscribe(fn);
      s.releaseHelp(h);
      expect(s.get()).toEqual({ view: 'V' });
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('dialogs 만 있는 help 는 page 가 없으면 현재 값을 만들지 않는다(null)', () => {
      const s = createScreenContextStore();
      s.setHelp(Symbol('h'), { dialogs: [{ id: 'x', label: 'X' }] });
      expect(s.get()).toBeNull();
    });

    it('같은 내용의 help 재등록은 알리지 않는다', () => {
      const s = createScreenContextStore();
      const h = Symbol('h');
      s.set(Symbol('p'), { view: 'V' });
      s.setHelp(h, { section });
      const fn = vi.fn();
      s.subscribe(fn);
      s.setHelp(h, { section: { ...section } });
      expect(fn).not.toHaveBeenCalled();
    });

    it('overlay 가 있어도 help 는 합쳐진 값에 얹힌다', () => {
      const s = createScreenContextStore();
      s.set(Symbol('p'), { view: 'V' });
      s.set(Symbol('o'), { view: '미리 보기', focus: { type: '파일', label: 'a.pdf', refs: {} } }, 'overlay');
      s.setHelp(Symbol('h'), { section });
      expect(s.get()?.help).toEqual({ section });
      expect(s.get()?.focus?.label).toBe('a.pdf');
    });

    it('releaseHelp 는 도움말 층만 걷는다', () => {
      const s = createScreenContextStore();
      const h = Symbol('h');
      s.set(Symbol('p'), { view: 'V' });
      s.setHelp(h, { section });
      s.releaseHelp(h);
      expect(s.get()).toEqual({ view: 'V' });
    });
  });
});
