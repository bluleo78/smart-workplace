// useVersionedPatch — 필드별 충돌 판정(WP-2095). mutation·fetchLatest 는 vi.fn 으로 두고 409 뒤 분기를 검증한다.
import { act, renderHook } from '@testing-library/react';
import { AxiosError } from 'axios';
import { describe, expect, it, vi } from 'vitest';

import type { IssueDetailResponse } from '@/types/issue';

import { useVersionedPatch } from './useVersionedPatch';

/** 409 응답 오류 — isConflictError 가 axios 409 로 판정한다. */
function conflictError() {
  return new AxiosError('conflict', '409', undefined, undefined, { status: 409, data: {} } as never);
}
/** 코드가 붙은 409 — 버전 충돌이 아니다(STATUS_DELETED). */
function codedConflictError() {
  return new AxiosError('gone', '409', undefined, undefined, { status: 409, data: { errors: { code: 'STATUS_DELETED' } } } as never);
}
function serverError() {
  return new AxiosError('boom', '500', undefined, undefined, { status: 500, data: {} } as never);
}
const saved = (version: number) => ({ summary: { version } }) as unknown as IssueDetailResponse;

function setup(opts: { current?: number; latest?: { version: number; values: { title: string; body: string } } } = {}) {
  const mutateAsync = vi.fn();
  const fetchLatest = vi.fn().mockResolvedValue(opts.latest ?? { version: 5, values: { title: 'T', body: 'B' } });
  const hook = renderHook(() =>
    useVersionedPatch<'title' | 'body'>({ mutateAsync }, opts.current ?? 3, fetchLatest),
  );
  return { mutateAsync, fetchLatest, hook };
}

describe('useVersionedPatch', () => {
  it('다른 필드만 바뀐 409 는 최신 version 으로 한 번 자동 재저장한다', async () => {
    const { mutateAsync, fetchLatest, hook } = setup();
    mutateAsync.mockRejectedValueOnce(conflictError()).mockResolvedValueOnce(saved(6));
    act(() => hook.result.current.beginEdit('body', 'B'));
    let ok = false;
    await act(async () => {
      ok = await hook.result.current.patch({ body: 'mine', version: hook.result.current.baseVersion('body') });
    });
    expect(ok).toBe(true);
    expect(fetchLatest).toHaveBeenCalledTimes(1);
    expect(mutateAsync).toHaveBeenCalledTimes(2);
    expect(mutateAsync.mock.calls[0][0].version).toBe(3);
    expect(mutateAsync.mock.calls[1][0].version).toBe(5);
    expect(hook.result.current.conflict('body')).toBeNull();
  });

  it('그 필드가 바뀐 409 는 충돌로 두고 다시 저장해도 처음 기준 version 으로 보낸다(덮어쓰지 않는다)', async () => {
    const { mutateAsync, hook } = setup({ latest: { version: 5, values: { title: 'T', body: 'theirs' } } });
    mutateAsync.mockRejectedValue(conflictError());
    act(() => hook.result.current.beginEdit('body', 'B'));
    let ok = true;
    await act(async () => {
      ok = await hook.result.current.patch({ body: 'mine', version: hook.result.current.baseVersion('body') });
    });
    expect(ok).toBe(false);
    expect(mutateAsync).toHaveBeenCalledTimes(1);
    expect(hook.result.current.conflict('body')).toEqual({ latest: 'theirs', latestVersion: 5 });
    expect(hook.result.current.baseVersion('body')).toBe(3);
    await act(async () => {
      await hook.result.current.patch({ body: 'mine', version: hook.result.current.baseVersion('body') });
    });
    expect(mutateAsync.mock.calls[1][0].version).toBe(3);
  });

  it('overwrite 뒤 저장은 안내에 보여 준 latestVersion 을 기준으로 보낸다', async () => {
    const { mutateAsync, hook } = setup({ latest: { version: 5, values: { title: 'T', body: 'theirs' } } });
    mutateAsync.mockRejectedValueOnce(conflictError()).mockResolvedValueOnce(saved(6));
    act(() => hook.result.current.beginEdit('body', 'B'));
    await act(async () => { await hook.result.current.patch({ body: 'mine', version: 3 }); });
    act(() => hook.result.current.overwrite('body'));
    expect(hook.result.current.conflict('body')).toBeNull();
    let ok = false;
    await act(async () => {
      ok = await hook.result.current.patch({ body: 'mine', version: hook.result.current.baseVersion('body') });
    });
    expect(ok).toBe(true);
    expect(mutateAsync.mock.calls[1][0].version).toBe(5);
  });

  it('overwrite 뒤 또 바뀐 409 는 다시 충돌로 둔다', async () => {
    const { mutateAsync, fetchLatest, hook } = setup({ latest: { version: 5, values: { title: 'T', body: 'theirs' } } });
    mutateAsync.mockRejectedValue(conflictError());
    act(() => hook.result.current.beginEdit('body', 'B'));
    await act(async () => { await hook.result.current.patch({ body: 'mine', version: 3 }); });
    act(() => hook.result.current.overwrite('body'));
    fetchLatest.mockResolvedValue({ version: 7, values: { title: 'T', body: 'theirs2' } });
    await act(async () => { await hook.result.current.patch({ body: 'mine', version: 5 }); });
    expect(hook.result.current.conflict('body')).toEqual({ latest: 'theirs2', latestVersion: 7 });
  });

  // 코드 리뷰 지적 1 — 자동 재저장 성공이 옛 version 기준인 다른 편집 필드를 새 version 으로 끌어올려, 그 사이 남이 바꾼 그 필드를 덮어쓰던 문제.
  it('자동 재저장 뒤에도 그 사이 남이 바꾼 다른 편집 필드는 옛 기준에 남아, 그 필드 저장이 덮어쓰지 않고 충돌이 된다', async () => {
    // v3 에서 제목·본문을 함께 편집 → 남이 제목만 바꿈(v4) → 내 본문 저장 409 → 본문은 그대로라 v4 로 재저장(→ v5).
    const { mutateAsync, fetchLatest, hook } = setup({ latest: { version: 4, values: { title: '남의 제목', body: 'B0' } } });
    mutateAsync.mockRejectedValueOnce(conflictError()).mockResolvedValueOnce(saved(5)).mockRejectedValueOnce(conflictError());
    act(() => hook.result.current.beginEdit('title', 'T0'));
    act(() => hook.result.current.beginEdit('body', 'B0'));
    let ok = false;
    await act(async () => {
      ok = await hook.result.current.patch({ body: '내 본문', version: hook.result.current.baseVersion('body') });
    });
    expect(ok).toBe(true);
    expect(mutateAsync.mock.calls[1][0].version).toBe(4);
    // 제목 기준은 v3 그대로 — v5 로 옮겨졌다면 다음 제목 저장이 남의 v4 제목을 조용히 덮어쓴다.
    expect(hook.result.current.baseVersion('title')).toBe(3);
    fetchLatest.mockResolvedValue({ version: 5, values: { title: '남의 제목', body: '내 본문' } });
    let titleOk = true;
    await act(async () => {
      titleOk = await hook.result.current.patch({ title: '내 제목', version: hook.result.current.baseVersion('title') });
    });
    expect(titleOk).toBe(false);
    expect(mutateAsync.mock.calls[2][0].version).toBe(3);
    expect(hook.result.current.conflict('title')).toEqual({ latest: '남의 제목', latestVersion: 5 });
  });

  it('자동 재저장 때 아무도 안 바꾼 다른 편집 필드는 새 version 으로 함께 오른다(스스로와 충돌하지 않는다)', async () => {
    const { mutateAsync, hook } = setup({ latest: { version: 4, values: { title: 'T0', body: 'B0' } } });
    mutateAsync.mockRejectedValueOnce(conflictError()).mockResolvedValueOnce(saved(5));
    act(() => hook.result.current.beginEdit('title', 'T0'));
    act(() => hook.result.current.beginEdit('body', 'B0'));
    await act(async () => {
      await hook.result.current.patch({ body: '내 본문', version: 3 });
    });
    expect(hook.result.current.baseVersion('title')).toBe(5);
  });

  // 코드 리뷰 지적 4 — 재저장이 또 409 여도 값을 비교한다.
  it('자동 재저장이 또 409 이고 그 필드 값이 그대로면 충돌로 두지 않고 일반 실패로 끝낸다(더 재저장하지 않는다)', async () => {
    const { mutateAsync, fetchLatest, hook } = setup({ latest: { version: 4, values: { title: 'T', body: 'B' } } });
    mutateAsync.mockRejectedValue(conflictError());
    fetchLatest
      .mockResolvedValueOnce({ version: 4, values: { title: 'T', body: 'B' } })
      .mockResolvedValueOnce({ version: 6, values: { title: 'T', body: 'B' } });
    act(() => hook.result.current.beginEdit('body', 'B'));
    let ok = true;
    await act(async () => {
      ok = await hook.result.current.patch({ body: 'mine', version: 3 });
    });
    expect(ok).toBe(false);
    expect(mutateAsync).toHaveBeenCalledTimes(2);
    expect(fetchLatest).toHaveBeenCalledTimes(2);
    expect(hook.result.current.conflict('body')).toBeNull();
  });

  it('자동 재저장이 또 409 이고 그 사이 그 필드가 바뀌었으면 바뀐 필드만 충돌이 된다', async () => {
    const { mutateAsync, fetchLatest, hook } = setup();
    mutateAsync.mockRejectedValue(conflictError());
    fetchLatest
      .mockResolvedValueOnce({ version: 4, values: { title: 'T', body: 'B' } })
      .mockResolvedValueOnce({ version: 6, values: { title: 'T', body: 'theirs' } });
    act(() => hook.result.current.beginEdit('title', 'T'));
    act(() => hook.result.current.beginEdit('body', 'B'));
    await act(async () => {
      await hook.result.current.patch({ title: 'my title', body: 'mine', version: 3 });
    });
    expect(mutateAsync).toHaveBeenCalledTimes(2);
    expect(hook.result.current.conflict('body')).toEqual({ latest: 'theirs', latestVersion: 6 });
    expect(hook.result.current.conflict('title')).toBeNull();
  });

  // 코드 리뷰 지적 5 — 충돌이 없으면 돌려줄 최신 값이 없다.
  it('takeLatest 는 충돌이 없으면 null 을 돌려주고 기준을 바꾸지 않는다', () => {
    const { hook } = setup();
    act(() => hook.result.current.beginEdit('body', 'B'));
    let got: string | null = 'x';
    act(() => { got = hook.result.current.takeLatest('body'); });
    expect(got).toBeNull();
    expect(hook.result.current.baseVersion('body')).toBe(3);
  });

  it('takeLatest 는 최신 값을 돌려주고 기준을 latestVersion 으로 옮긴다', async () => {
    const { mutateAsync, hook } = setup({ latest: { version: 5, values: { title: 'T', body: 'theirs' } } });
    mutateAsync.mockRejectedValue(conflictError());
    act(() => hook.result.current.beginEdit('body', 'B'));
    await act(async () => { await hook.result.current.patch({ body: 'mine', version: 3 }); });
    let got: string | null = '';
    act(() => { got = hook.result.current.takeLatest('body'); });
    expect(got).toBe('theirs');
    expect(hook.result.current.baseVersion('body')).toBe(5);
    expect(hook.result.current.conflict('body')).toBeNull();
  });

  it('reopenConflict 는 그 필드의 충돌을 최신 값으로 다시 연다', () => {
    const { hook } = setup();
    act(() => hook.result.current.beginEdit('body', 'B'));
    expect(hook.result.current.conflict('body')).toBeNull();
    act(() => hook.result.current.reopenConflict('body', 'B의 글'));
    expect(hook.result.current.conflict('body')?.latest).toBe('B의 글');
    expect(hook.result.current.conflict('title')).toBeNull();
  });

  it('endEdit 은 기준·충돌을 비운다', async () => {
    const { mutateAsync, hook } = setup({ latest: { version: 5, values: { title: 'T', body: 'theirs' } } });
    mutateAsync.mockRejectedValue(conflictError());
    act(() => hook.result.current.beginEdit('body', 'B'));
    await act(async () => { await hook.result.current.patch({ body: 'mine', version: 3 }); });
    act(() => hook.result.current.endEdit('body'));
    expect(hook.result.current.conflict('body')).toBeNull();
    expect(hook.result.current.baseVersion('body')).toBeUndefined();
  });

  it('changedWhileEditing — 기준 있고 충돌 없고 version 이 올랐고 값이 시작 값과 다를 때만 참', () => {
    const { hook } = setup();
    act(() => hook.result.current.beginEdit('body', 'B'));
    const c = hook.result.current.changedWhileEditing;
    expect(c('body', 'X', 4)).toBe(true);
    expect(c('body', 'B', 4)).toBe(false);
    expect(c('body', 'X', 3)).toBe(false);
    expect(c('body', 'X', undefined)).toBe(false);
    expect(c('title', 'X', 4)).toBe(false);
  });

  it('코드가 붙은 409(STATUS_DELETED)는 fetchLatest 를 부르지 않고 충돌로 두지 않는다', async () => {
    const { mutateAsync, fetchLatest, hook } = setup();
    mutateAsync.mockRejectedValue(codedConflictError());
    act(() => hook.result.current.beginEdit('body', 'B'));
    let ok = true;
    await act(async () => { ok = await hook.result.current.patch({ body: 'mine', version: 3 }); });
    expect(ok).toBe(false);
    expect(fetchLatest).not.toHaveBeenCalled();
    expect(hook.result.current.conflict('body')).toBeNull();
    expect(mutateAsync).toHaveBeenCalledTimes(1);
  });

  it('500 은 기준을 유지하고 fetchLatest 를 부르지 않는다', async () => {
    const { mutateAsync, fetchLatest, hook } = setup();
    mutateAsync.mockRejectedValue(serverError());
    act(() => hook.result.current.beginEdit('body', 'B'));
    let ok = true;
    await act(async () => { ok = await hook.result.current.patch({ body: 'mine', version: 3 }); });
    expect(ok).toBe(false);
    expect(fetchLatest).not.toHaveBeenCalled();
    expect(hook.result.current.baseVersion('body')).toBe(3);
  });

  it('이슈를 바꾼 첫 렌더에 앞 이슈의 충돌을 보이지 않는다', async () => {
    const mutateAsync = vi.fn().mockRejectedValue(conflictError());
    const fetchLatest = vi.fn().mockResolvedValue({ version: 5, values: { title: 'theirs', body: 'B' } });
    // 렌더마다 결과를 기록한다 — rerender 직후 첫 렌더의 값을 봐야 effect 초기화와 구분된다.
    const renders: { scope: string; conflict: unknown; changed: boolean }[] = [];
    const hook = renderHook(
      ({ scope }) => {
        const h = useVersionedPatch<'title' | 'body'>({ mutateAsync }, 3, fetchLatest, scope);
        renders.push({ scope, conflict: h.conflict('title'), changed: h.changedWhileEditing('title', 'x', 9) });
        return h;
      },
      { initialProps: { scope: 'WP-1' } },
    );
    act(() => hook.result.current.beginEdit('title', 'T'));
    await act(async () => {
      await hook.result.current.patch({ title: 'mine', version: 3 });
    });
    expect(hook.result.current.conflict('title')).not.toBeNull();
    renders.length = 0;
    hook.rerender({ scope: 'WP-2' });
    const first = renders.find((r) => r.scope === 'WP-2');
    expect(first?.conflict).toBeNull();
    expect(first?.changed).toBe(false);
  });
});
