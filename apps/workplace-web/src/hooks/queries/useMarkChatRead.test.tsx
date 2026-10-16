// useMarkChatRead — 1초 디바운스·중복 억제·언마운트 flush 가 읽음 요청을 정확히 한 번만 보내는지.
import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { chatApi } from '../../api/chat';
import { useMarkChatRead } from './useMarkChatRead';

describe('useMarkChatRead', () => {
  let markRead: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    vi.useFakeTimers();
    markRead = vi.spyOn(chatApi, 'markRead').mockResolvedValue(undefined as never);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('1초 안의 연속 요청은 마지막 id 하나로 모아 보낸다', () => {
    const { result } = renderHook(() => useMarkChatRead(100));
    result.current(10);
    result.current(20);
    vi.advanceTimersByTime(999);
    expect(markRead).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(markRead).toHaveBeenCalledExactlyOnceWith(100, { uptoMessageId: 20 });
  });

  it('보낸 id 이하·0 이하 id·미오픈 스레드는 보내지 않는다', () => {
    const { result } = renderHook(() => useMarkChatRead(100));
    result.current(20);
    vi.advanceTimersByTime(1000);
    result.current(20);
    result.current(5);
    result.current(-3);
    vi.advanceTimersByTime(1000);
    expect(markRead).toHaveBeenCalledTimes(1);

    const unopened = renderHook(() => useMarkChatRead(0));
    unopened.result.current(30);
    vi.advanceTimersByTime(1000);
    expect(markRead).toHaveBeenCalledTimes(1);
  });

  it('디바운스 중 언마운트하면 보류 id 를 한 번만 보낸다', () => {
    const { result, unmount } = renderHook(() => useMarkChatRead(100));
    result.current(50);
    unmount();
    vi.advanceTimersByTime(1000);
    expect(markRead).toHaveBeenCalledExactlyOnceWith(100, { uptoMessageId: 50 });
  });

  it('이미 보낸 뒤 언마운트하면 다시 보내지 않는다', () => {
    const { result, unmount } = renderHook(() => useMarkChatRead(100));
    result.current(50);
    vi.advanceTimersByTime(1000);
    unmount();
    expect(markRead).toHaveBeenCalledTimes(1);
  });

  it('리마운트 없이 스레드가 바뀌면 이전 스레드 몫을 보내고 기준을 리셋한다', () => {
    const { result, rerender } = renderHook(({ id }) => useMarkChatRead(id), { initialProps: { id: 100 } });
    result.current(500);
    rerender({ id: 200 });
    expect(markRead).toHaveBeenCalledExactlyOnceWith(100, { uptoMessageId: 500 });
    result.current(30);
    vi.advanceTimersByTime(1000);
    expect(markRead).toHaveBeenLastCalledWith(200, { uptoMessageId: 30 });
  });
});
