// 지연 삭제 Undo 토스트 단위 테스트 (WP-238) — 삭제 시점이 토스트의 닫힘 경로에만 묶이는지 본다.
import type { ExternalToast } from 'sonner';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const success = vi.fn<(message: string, data?: ExternalToast) => void>();
vi.mock('sonner', () => ({ toast: { success: (...args: [string, ExternalToast?]) => success(...args) } }));

const { deleteMessageWithUndo, UNDO_DELETE_DELAY_MS } = await import('./deleteWithUndo');

/** 마지막으로 띄운 토스트의 옵션 — 닫힘 콜백을 직접 호출해 Sonner 동작을 흉내 낸다. */
function lastToast(): ExternalToast {
  return success.mock.calls.at(-1)![1]!;
}
const fakeToast = { id: 1 } as Parameters<NonNullable<ExternalToast['onDismiss']>>[0];

describe('deleteMessageWithUndo', () => {
  beforeEach(() => {
    success.mockClear();
    vi.useFakeTimers();
  });

  it('토스트 노출 시간만큼 지나도 토스트가 닫히기 전에는 삭제하지 않는다(hover 등으로 카운트다운이 멈춘 경우)', () => {
    const execute = vi.fn();
    deleteMessageWithUndo(execute);
    expect(lastToast().duration).toBe(UNDO_DELETE_DELAY_MS);
    vi.advanceTimersByTime(UNDO_DELETE_DELAY_MS * 3);
    expect(execute).not.toHaveBeenCalled();
  });

  it('토스트가 자동으로 닫히면 삭제한다', () => {
    const execute = vi.fn();
    deleteMessageWithUndo(execute);
    lastToast().onAutoClose!(fakeToast);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('사용자가 토스트를 닫으면(스와이프) 즉시 삭제한다', () => {
    const execute = vi.fn();
    deleteMessageWithUndo(execute);
    lastToast().onDismiss!(fakeToast);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('실행 취소를 누르면 이어지는 닫힘 콜백이 와도 삭제하지 않는다', () => {
    const execute = vi.fn();
    deleteMessageWithUndo(execute);
    const t = lastToast();
    const action = t.action as { onClick: (e: unknown) => void };
    action.onClick({});
    t.onDismiss!(fakeToast);
    t.onAutoClose!(fakeToast);
    expect(execute).not.toHaveBeenCalled();
  });

  it('닫힘 콜백이 겹쳐 와도 삭제는 한 번만 한다', () => {
    const execute = vi.fn();
    deleteMessageWithUndo(execute);
    lastToast().onDismiss!(fakeToast);
    lastToast().onAutoClose!(fakeToast);
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
