// useMailDraftAutosave(WP-577) — 자동 저장 순서 규칙을 브라우저 없이 지킨다. 화면 배선(입력 → 저장 → 상태 표시)은 E2E(mail-drafts.spec)가 본다.
// - 1.5초 디바운스, 첫 저장 POST → 이후 PUT+version, 저장은 차례로(첫 POST 가 끝나기 전 변경도 임시저장 하나로)
// - 빈 새 메일은 저장하지 않음, 409 충돌은 멈춤 → 닫을 때 새 임시저장(업로드는 서버가 옮겨 묶는다), 404 는 되살리지 않고 멈춘다(gone)
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { AxiosError, type AxiosResponse } from 'axios';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createMailDraft, deleteMailDraft, updateMailDraft } from '@/api/mailDrafts';
import type { MailDraftSaveRequest } from '@/types/mailDraft';

import { mailDraftKeys } from './queries/mailDraftKeys';
import { DRAFT_AUTOSAVE_DELAY_MS, type DraftSnapshot, hasUnsavedDraft, shortSaveReason, useMailDraftAutosave } from './useMailDraftAutosave';

vi.mock('@/api/mailDrafts', () => ({
  createMailDraft: vi.fn(),
  updateMailDraft: vi.fn(),
  deleteMailDraft: vi.fn(),
}));

const create = vi.mocked(createMailDraft);
const update = vi.mocked(updateMailDraft);
const remove = vi.mocked(deleteMailDraft);

/** 서버 오류 응답 — ErrorResponse 모양(errors.code). */
function apiError(status: number, code?: string, errors?: Record<string, string>, message = 'x'): AxiosError {
  const response = { status, data: { status, message, errors: errors ?? (code ? { code } : undefined) } } as AxiosResponse;
  return new AxiosError('x', 'ERR_BAD_REQUEST', undefined, undefined, response);
}

function payload(over: Partial<MailDraftSaveRequest> = {}): MailDraftSaveRequest {
  return {
    accountId: 1,
    mode: 'new',
    to: [],
    cc: [],
    bcc: [],
    subject: '제목',
    bodyHtml: '<p>본문</p>',
    bodyText: '본문',
    sourceMessageId: null,
    quoteRemoved: false,
    attachmentIds: [],
    forwardAttachmentIds: [],
    ...over,
  };
}

/** 지연시킨 promise — 첫 POST 가 끝나기 전에 또 바뀌는 순서를 만든다. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

interface Props {
  instanceId: number | undefined;
  initialDraftId?: number;
  initialVersion?: number;
  initialUnsaved?: boolean;
}

function setup(initial: Props, snap: { current: DraftSnapshot }) {
  const qc = new QueryClient();
  const invalidate = vi.spyOn(qc, 'invalidateQueries');
  const onCreated = vi.fn();
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  const hook = renderHook(
    (p: Props) => useMailDraftAutosave({ ...p, accountId: 1, getSnapshot: () => snap.current, onCreated }),
    { wrapper, initialProps: initial },
  );
  return { hook, onCreated, invalidate, qc };
}

/** 디바운스를 지나 저장 사슬이 끝날 때까지 돌린다. */
async function elapse(ms = DRAFT_AUTOSAVE_DELAY_MS) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  create.mockReset();
  update.mockReset();
  remove.mockReset();
});
afterEach(() => vi.useRealTimers());

describe('shortSaveReason', () => {
  it('서버 문구의 첫 문장만 — 마침표는 뗀다, 비면 일반 안내', () => {
    expect(shortSaveReason('첨부 파일을 찾을 수 없어요. 만료됐을 수 있으니 파일을 다시 올려 주세요')).toBe('첨부 파일을 찾을 수 없어요');
    expect(shortSaveReason('제목이 너무 길어요')).toBe('제목이 너무 길어요');
    expect(shortSaveReason('')).toBe('내용을 확인해 주세요');
  });
});

describe('hasUnsavedDraft', () => {
  it('대기·저장 중·실패·충돌만 저장하지 않은 변경 — 다른 곳에서 보냈거나 버린 것(gone)은 경고하지 않는다', () => {
    expect(['pending', 'saving', 'error', 'conflict'].every((s) => hasUnsavedDraft(s as never))).toBe(true);
    expect(hasUnsavedDraft('idle')).toBe(false);
    expect(hasUnsavedDraft('saved')).toBe(false);
    expect(hasUnsavedDraft('gone')).toBe(false);
    expect(hasUnsavedDraft('invalid')).toBe(true);
  });
});

describe('useMailDraftAutosave', () => {
  it('1.5초 뒤 첫 저장은 POST, 다음 변경은 PUT + 받은 version', async () => {
    const snap = { current: { payload: payload(), empty: false } };
    create.mockResolvedValue({ id: 40, version: 1, updatedAt: '' });
    update.mockResolvedValue({ version: 2, updatedAt: '', attachmentCount: 0 });
    const { hook, onCreated } = setup({ instanceId: 1 }, snap);

    act(() => hook.result.current.schedule());
    expect(hook.result.current.status).toBe('pending');
    await elapse(DRAFT_AUTOSAVE_DELAY_MS - 1);
    expect(create).not.toHaveBeenCalled();
    await elapse(1);
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith(payload());
    expect(onCreated).toHaveBeenCalledWith(1, 40);
    expect(hook.result.current.status).toBe('saved');

    snap.current = { payload: payload({ subject: '고친 제목' }), empty: false };
    act(() => hook.result.current.schedule());
    await elapse();
    expect(update).toHaveBeenCalledWith(40, { ...payload({ subject: '고친 제목' }), version: 1 });
    expect(hook.result.current.status).toBe('saved');
  });

  it('첫 POST 가 끝나기 전에 또 바뀌어도 임시저장은 하나 — 끝난 뒤 그 id 로 PUT', async () => {
    const snap = { current: { payload: payload(), empty: false } };
    const first = deferred<{ id: number; version: number; updatedAt: string }>();
    create.mockReturnValue(first.promise);
    update.mockResolvedValue({ version: 2, updatedAt: '', attachmentCount: 0 });
    const { hook } = setup({ instanceId: 1 }, snap);

    act(() => hook.result.current.schedule());
    await elapse();
    act(() => hook.result.current.schedule());
    await elapse();
    expect(create).toHaveBeenCalledTimes(1);
    expect(update).not.toHaveBeenCalled();

    await act(async () => first.resolve({ id: 41, version: 1, updatedAt: '' }));
    await elapse(0);
    expect(create).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith(41, expect.objectContaining({ version: 1 }));
  });

  it('빈 새 메일은 저장하지 않는다', async () => {
    const snap = { current: { payload: payload({ subject: '', bodyHtml: '' }), empty: true } };
    const { hook } = setup({ instanceId: 1 }, snap);
    act(() => hook.result.current.schedule());
    await elapse();
    const r = await act(() => hook.result.current.flush());
    expect(create).not.toHaveBeenCalled();
    expect(r).toEqual({ wrote: false, ok: true, draftId: null, version: null });
    expect(hook.result.current.status).toBe('idle');
  });

  it('임시보관함에서 연 작성 — 처음엔 저장됨, 비워져도 PUT(이미 있는 임시저장)', async () => {
    const snap = { current: { payload: payload({ subject: '', bodyHtml: '' }), empty: true } };
    update.mockResolvedValue({ version: 6, updatedAt: '', attachmentCount: 0 });
    const { hook } = setup({ instanceId: 1, initialDraftId: 9, initialVersion: 5 }, snap);
    expect(hook.result.current.status).toBe('saved');
    act(() => hook.result.current.schedule());
    await elapse();
    expect(create).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(9, expect.objectContaining({ version: 5 }));
  });

  it('409 충돌이면 멈추고, 닫을 때 내 내용을 새 임시저장으로 — 업로드도 그대로 싣는다(서버가 옮겨 묶는다)', async () => {
    const snap = { current: { payload: payload({ attachmentIds: [501, 777] }), empty: false } };
    update.mockRejectedValue(apiError(409, 'DRAFT_CONFLICT'));
    create.mockResolvedValue({ id: 50, version: 1, updatedAt: '' });
    // 501 은 연 임시저장에 묶인 업로드, 777 은 이번에 새로 올린 것
    const { hook, onCreated } = setup({ instanceId: 1, initialDraftId: 9, initialVersion: 5 }, snap);

    act(() => hook.result.current.schedule());
    await elapse();
    expect(hook.result.current.status).toBe('conflict');
    // 충돌 중에는 입력해도 서버 내용을 덮지 않는다
    act(() => hook.result.current.schedule());
    await elapse();
    expect(update).toHaveBeenCalledTimes(1);

    const r = await act(() => hook.result.current.flush());
    expect(create).toHaveBeenCalledWith(payload({ attachmentIds: [501, 777] }));
    expect(onCreated).toHaveBeenCalledWith(1, 50);
    expect(r).toEqual({ wrote: true, ok: true, draftId: 50, version: 1 });
  });

  it('PUT 404(다른 곳에서 보냈거나 버림)면 되살리지 않고 멈춘다 — 이후 저장 없음, 닫아도 저장 안 함, 보내기는 draftId 없이', async () => {
    const snap = { current: { payload: payload(), empty: false } };
    update.mockRejectedValue(apiError(404, 'DRAFT_NOT_FOUND'));
    const { hook } = setup({ instanceId: 1, initialDraftId: 9, initialVersion: 5 }, snap);
    act(() => hook.result.current.schedule());
    await elapse();
    expect(update).toHaveBeenCalledTimes(1);
    expect(create).not.toHaveBeenCalled();
    expect(hook.result.current.status).toBe('gone');
    expect(hasUnsavedDraft(hook.result.current.status)).toBe(false);

    // 더 써도 저장하지 않고 상태도 그대로
    act(() => hook.result.current.schedule());
    await elapse();
    act(() => hook.result.current.retry());
    await elapse();
    expect(update).toHaveBeenCalledTimes(1);
    expect(create).not.toHaveBeenCalled();
    expect(hook.result.current.status).toBe('gone');

    // 닫기 — 저장하지 않고, 저장했다고 알리지 않는다
    const r = await act(() => hook.result.current.flush());
    expect(r).toEqual({ wrote: false, ok: true, draftId: null, version: null });
    expect(create).not.toHaveBeenCalled();
    // 보내기 — 없어진 draftId 를 싣지 않는다
    const ticket = await act(() => hook.result.current.beginSend());
    expect(ticket.draftId).toBeUndefined();
  });

  it('저장 실패는 「저장하지 못했어요」 — 다시 시도하면 같은 내용을 다시 보낸다', async () => {
    const snap = { current: { payload: payload(), empty: false } };
    create.mockRejectedValueOnce(apiError(500)).mockResolvedValue({ id: 70, version: 1, updatedAt: '' });
    const { hook } = setup({ instanceId: 1 }, snap);
    act(() => hook.result.current.schedule());
    await elapse();
    expect(hook.result.current.status).toBe('error');
    expect(hasUnsavedDraft(hook.result.current.status)).toBe(true);
    act(() => hook.result.current.retry());
    await elapse(0);
    expect(create).toHaveBeenCalledTimes(2);
    expect(hook.result.current.status).toBe('saved');
  });

  it('임시저장이 아닌 404(계정 비활성 등)는 없어진 것으로 보지 않고 일반 저장 실패로 — 다시 시도할 수 있다', async () => {
    const snap = { current: { payload: payload(), empty: false } };
    update.mockRejectedValueOnce(apiError(404)).mockResolvedValue({ version: 6, updatedAt: '', attachmentCount: 0 });
    const { hook } = setup({ instanceId: 1, initialDraftId: 9, initialVersion: 5 }, snap);
    act(() => hook.result.current.schedule());
    await elapse();
    expect(hook.result.current.status).toBe('error');
    act(() => hook.result.current.retry());
    await elapse(0);
    expect(update).toHaveBeenCalledTimes(2);
    expect(update).toHaveBeenLastCalledWith(9, expect.objectContaining({ version: 5 }));
    expect(hook.result.current.status).toBe('saved');
  });

  it('400 검증 오류는 원인을 짧게 보이고 같은 내용으로는 다시 시도하지 않는다 — 고치면 다시 저장한다', async () => {
    const snap = { current: { payload: payload(), empty: false } };
    // 서버 상한 검사(MailComposeLimits)는 문구를 message 에 싣는다
    create
      .mockRejectedValueOnce(apiError(400, undefined, undefined, '받는사람이 너무 많아요'))
      .mockResolvedValue({ id: 91, version: 1, updatedAt: '' });
    const { hook } = setup({ instanceId: 1 }, snap);
    act(() => hook.result.current.schedule());
    await elapse();
    expect(hook.result.current.status).toBe('invalid');
    expect(hook.result.current.statusReason).toBe('받는사람이 너무 많아요');
    expect(hasUnsavedDraft(hook.result.current.status)).toBe(true);
    // 다시 시도·디바운스·닫기 모두 같은 내용을 다시 보내지 않는다
    act(() => hook.result.current.retry());
    await elapse(DRAFT_AUTOSAVE_DELAY_MS * 2);
    const r = await act(() => hook.result.current.flush());
    expect(create).toHaveBeenCalledTimes(1);
    expect(r.ok).toBe(false);
    // 고치면 다시 저장
    snap.current = { payload: payload({ to: ['a@x.com'] }), empty: false };
    act(() => hook.result.current.schedule());
    await elapse();
    expect(create).toHaveBeenCalledTimes(2);
    expect(hook.result.current.status).toBe('saved');
  });

  it('만들면 목록·개수를 다시 받고, 고치면 목록의 그 행만 그 자리에서 고쳐 맨 위로(첨부 수는 서버 값) — 다시 받지 않는다', async () => {
    const snap = { current: { payload: payload(), empty: false } };
    create.mockResolvedValue({ id: 92, version: 1, updatedAt: '2026-10-21T02:00:00Z' });
    update.mockResolvedValue({ version: 2, updatedAt: '2026-10-21T03:00:00Z', attachmentCount: 1 });
    const { hook, invalidate, qc } = setup({ instanceId: 1 }, snap);
    act(() => hook.result.current.schedule());
    await elapse();
    expect(invalidate).toHaveBeenLastCalledWith({ queryKey: mailDraftKeys.account(1) });
    invalidate.mockClear();

    const row = (id: number, updatedAt: string) => ({
      id,
      accountId: 1,
      mode: 'new' as const,
      to: [],
      subject: '옛 제목',
      preview: '옛',
      attachmentCount: 0,
      updatedAt,
    });
    qc.setQueryData(mailDraftKeys.list(1), [row(5, '2026-10-21T02:30:00Z'), row(92, '2026-10-21T02:00:00Z')]);
    snap.current = {
      payload: payload({ subject: '새 제목', to: ['a@x.com'], bodyText: '새 본문', attachmentIds: [1], forwardAttachmentIds: [2] }),
      empty: false,
    };
    act(() => hook.result.current.schedule());
    await elapse();
    expect(invalidate).not.toHaveBeenCalled();
    expect(qc.getQueryData(mailDraftKeys.list(1))).toEqual([
      // 첨부 수는 요청(2개)이 아니라 서버가 정한 값(남의 전달 원본을 버려 1개)
      { ...row(92, '2026-10-21T03:00:00Z'), subject: '새 제목', to: ['a@x.com'], preview: '새 본문', attachmentCount: 1 },
      row(5, '2026-10-21T02:30:00Z'),
    ]);

    // 목록에 그 행이 없으면(그사이 바뀜) 다시 받는다
    qc.setQueryData(mailDraftKeys.list(1), [row(5, '2026-10-21T02:30:00Z')]);
    act(() => hook.result.current.schedule());
    await elapse();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: mailDraftKeys.list(1) });
  });

  it('검증 오류 중 보내기에 실패하면 다시 저장하지 않고 사유를 그대로 둔다 — 고치면 저장하고, 그때 네트워크 오류면 「다시 시도」가 산다', async () => {
    const snap = { current: { payload: payload(), empty: false } };
    create
      .mockRejectedValueOnce(apiError(400, undefined, undefined, '제목이 너무 길어요'))
      .mockRejectedValueOnce(apiError(503))
      .mockResolvedValue({ id: 95, version: 1, updatedAt: '' });
    const { hook } = setup({ instanceId: 1 }, snap);
    act(() => hook.result.current.schedule());
    await elapse();
    expect(hook.result.current.status).toBe('invalid');

    const ticket = await act(() => hook.result.current.beginSend());
    let saving: unknown;
    act(() => {
      saving = ticket.failed();
    });
    expect(saving).toBeNull();
    await elapse(DRAFT_AUTOSAVE_DELAY_MS * 2);
    expect(create).toHaveBeenCalledTimes(1);
    expect(hook.result.current.status).toBe('invalid');
    expect(hook.result.current.statusReason).toBe('제목이 너무 길어요');

    // 고치면 저장 — 네트워크 오류면 「다시 시도」가 산다(앞 검증 오류가 남지 않는다)
    snap.current = { payload: payload({ subject: '짧은 제목' }), empty: false };
    act(() => hook.result.current.schedule());
    await elapse();
    expect(create).toHaveBeenCalledTimes(2);
    expect(hook.result.current.status).toBe('error');
    act(() => hook.result.current.retry());
    await elapse(0);
    expect(create).toHaveBeenCalledTimes(3);
    expect(hook.result.current.status).toBe('saved');
  });

  it('충돌 중 보내기는 draftId 를 싣지 않는다 — 다른 곳에서 더 새로 저장한 임시저장을 지우지 않게', async () => {
    const snap = { current: { payload: payload(), empty: false } };
    update.mockRejectedValue(apiError(409, 'DRAFT_CONFLICT'));
    const { hook } = setup({ instanceId: 1, initialDraftId: 9, initialVersion: 5 }, snap);
    act(() => hook.result.current.schedule());
    await elapse();
    expect(hook.result.current.status).toBe('conflict');
    const ticket = await act(() => hook.result.current.beginSend());
    expect(ticket.draftId).toBeUndefined();
  });

  it('보내는 동안 닫았거나 다른 작성으로 바꾼 뒤 실패하면 — 이 작성의 내용으로만 바로 저장하고 결과를 돌려준다(지금 화면의 다른 작성 내용을 싣지 않는다)', async () => {
    const snap = { current: { payload: payload({ subject: 'A 제목' }), empty: false } };
    update.mockResolvedValue({ version: 6, updatedAt: '', attachmentCount: 0 });
    create.mockResolvedValue({ id: 300, version: 1, updatedAt: '' });
    const { hook } = setup({ instanceId: 1, initialDraftId: 9, initialVersion: 5 }, snap);

    // A 를 보내기 시작 → 보내는 동안 A 를 고치고 닫는다(닫기는 저장하지 않고 그 순간의 A 내용을 잡아 둔다)
    const ticket = await act(() => hook.result.current.beginSend());
    snap.current = { payload: payload({ subject: 'A 제목 (보내는 중 고침)' }), empty: false };
    act(() => hook.result.current.schedule());
    const closed = await act(() => hook.result.current.flush());
    expect(closed).toEqual({ wrote: false, ok: true, draftId: null, version: null });
    expect(update).not.toHaveBeenCalled();
    // 다른 작성(B, 다른 계정)으로 바뀐다
    hook.rerender({ instanceId: 2 });
    snap.current = { payload: payload({ subject: 'B 제목', accountId: 2 }), empty: false };

    let saving: Promise<unknown> | null = null;
    act(() => {
      saving = ticket.failed();
    });
    expect(saving).not.toBeNull();
    const r = await act(() => saving as Promise<unknown>);
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith(9, { ...payload({ subject: 'A 제목 (보내는 중 고침)' }), version: 5 });
    expect(create).not.toHaveBeenCalled();
    expect(r).toEqual({ wrote: true, ok: true, draftId: 9, version: 6 });
    // B 의 표시는 바꾸지 않는다
    expect(hook.result.current.status).toBe('idle');
  });

  it('보내기 시작 — 기다리던 저장은 취소하고 진행 중인 POST 의 id 를 돌려준다', async () => {
    const snap = { current: { payload: payload(), empty: false } };
    const first = deferred<{ id: number; version: number; updatedAt: string }>();
    create.mockReturnValue(first.promise);
    const { hook } = setup({ instanceId: 1 }, snap);
    act(() => hook.result.current.schedule());
    await elapse();
    act(() => hook.result.current.schedule()); // 디바운스 대기 중인 변경
    const starting = hook.result.current.beginSend();
    await act(async () => first.resolve({ id: 80, version: 1, updatedAt: '' }));
    const ticket = await starting;
    expect(ticket.draftId).toBe(80);
    await elapse();
    expect(update).not.toHaveBeenCalled();
  });

  it('보내는 동안 고친 내용·닫기는 저장하지 않고, 보내기에 성공하면 끝, 실패하면 자동 저장을 다시 켠다', async () => {
    const snap = { current: { payload: payload(), empty: false } };
    create.mockResolvedValue({ id: 81, version: 1, updatedAt: '' });
    update.mockResolvedValue({ version: 2, updatedAt: '', attachmentCount: 0 });
    const { hook } = setup({ instanceId: 1 }, snap);
    act(() => hook.result.current.schedule());
    await elapse();
    expect(create).toHaveBeenCalledTimes(1);

    const ticket = await act(() => hook.result.current.beginSend());
    expect(ticket.draftId).toBe(81);
    // 보내는 중에 고침 → 저장 안 함, 닫기(flush)도 저장 안 하고 알리지 않음
    snap.current = { payload: payload({ subject: '보내는 중 고침' }), empty: false };
    act(() => hook.result.current.schedule());
    await elapse(DRAFT_AUTOSAVE_DELAY_MS * 2);
    const r = await act(() => hook.result.current.flush());
    expect(r).toEqual({ wrote: false, ok: true, draftId: null, version: null });
    expect(update).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledTimes(1);

    // 실패 → 자동 저장 재개(같은 임시저장에 PUT)
    act(() => ticket.failed());
    expect(hook.result.current.status).toBe('pending');
    await elapse();
    expect(update).toHaveBeenCalledWith(81, expect.objectContaining({ subject: '보내는 중 고침', version: 1 }));
    expect(create).toHaveBeenCalledTimes(1);

    // 다시 보내 성공 → 이후 저장하지 않는다
    const again = await act(() => hook.result.current.beginSend());
    act(() => again.succeeded());
    act(() => hook.result.current.schedule());
    await elapse();
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('「다시 열기」로 연 저장 안 된 작성 — 새 메일은 곧 POST, 기존 임시저장은 곧 PUT, 저장 전에 닫아도 저장한다', async () => {
    const snap = { current: { payload: payload(), empty: false } };
    create.mockResolvedValue({ id: 90, version: 1, updatedAt: '' });
    update.mockResolvedValue({ version: 4, updatedAt: '', attachmentCount: 0 });
    const fresh = setup({ instanceId: 1, initialUnsaved: true }, snap);
    expect(fresh.hook.result.current.status).toBe('pending');
    expect(hasUnsavedDraft(fresh.hook.result.current.status)).toBe(true);
    await elapse();
    expect(create).toHaveBeenCalledTimes(1);
    fresh.hook.unmount();

    const existing = setup({ instanceId: 2, initialDraftId: 9, initialVersion: 3, initialUnsaved: true }, snap);
    // 디바운스 전에 닫아도 저장한다
    const r = await act(() => existing.hook.result.current.flush());
    expect(update).toHaveBeenCalledWith(9, expect.objectContaining({ version: 3 }));
    expect(r).toMatchObject({ wrote: true, ok: true, draftId: 9, version: 4 });
  });

  it('버리기 — 진행 중인 저장이 끝나 id 가 정해지면 지운다, 이후 저장하지 않는다', async () => {
    const snap = { current: { payload: payload(), empty: false } };
    create.mockResolvedValue({ id: 90, version: 1, updatedAt: '' });
    remove.mockResolvedValue();
    const { hook } = setup({ instanceId: 1 }, snap);
    act(() => hook.result.current.schedule());
    await elapse();
    await act(() => hook.result.current.discard());
    expect(remove).toHaveBeenCalledWith(90);
    act(() => hook.result.current.schedule());
    await elapse();
    expect(update).not.toHaveBeenCalled();
  });

  it('다른 작성으로 바뀌면 새 세션 — 앞 작성의 id 로 PUT 하지 않는다', async () => {
    const snap = { current: { payload: payload(), empty: false } };
    create.mockResolvedValueOnce({ id: 100, version: 1, updatedAt: '' }).mockResolvedValueOnce({ id: 101, version: 1, updatedAt: '' });
    const { hook } = setup({ instanceId: 1 }, snap);
    act(() => hook.result.current.schedule());
    await elapse();
    hook.rerender({ instanceId: 2 });
    expect(hook.result.current.status).toBe('idle');
    act(() => hook.result.current.schedule());
    await elapse();
    expect(create).toHaveBeenCalledTimes(2);
    expect(update).not.toHaveBeenCalled();
  });
});
