import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/api/home', () => ({
  homeApi: {
    startChat: vi.fn(),
    cancelChat: vi.fn(),
  },
}));

import { homeApi } from '@/api/home';
import { emitAiStreamEvent } from '@/lib/aiEventBus';

import { chatStream } from './useHomeQueries';

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('chatStream', () => {
  beforeEach(() => {
    vi.mocked(homeApi.startChat).mockReset();
    vi.mocked(homeApi.cancelChat).mockReset();
  });

  it('시작 응답의 correlationId 로 델타를 누적해 onDelta 로 전달하고 done 시 resolve 한다', async () => {
    vi.mocked(homeApi.startChat).mockResolvedValue({ data: { correlationId: 'corr-1' } } as never);
    const onDelta = vi.fn();
    const ac = new AbortController();

    const promise = chatStream({ sessionId: null, query: '안녕' }, onDelta, ac.signal);
    await flush();

    emitAiStreamEvent('home.chat.delta', { correlationId: 'other', text: '무시됨' });
    emitAiStreamEvent('home.chat.delta', { correlationId: 'corr-1', text: '안녕하세요' });
    emitAiStreamEvent('home.chat.done', {
      correlationId: 'corr-1',
      sessionId: 'sess-1',
      widgets: null,
    });

    const result = await promise;

    expect(onDelta).toHaveBeenCalledTimes(1);
    expect(onDelta).toHaveBeenCalledWith('안녕하세요');
    expect(result).toEqual({ sessionId: 'sess-1', widgets: undefined });
  });

  it('progress/pending_action/tool 이벤트를 correlationId 로 필터링해 각 콜백에 전달한다', async () => {
    vi.mocked(homeApi.startChat).mockResolvedValue({ data: { correlationId: 'corr-2' } } as never);
    const onDelta = vi.fn();
    const onProgress = vi.fn();
    const onPendingAction = vi.fn();
    const onTool = vi.fn();
    const ac = new AbortController();

    const promise = chatStream(
      { sessionId: null, query: 'q' },
      onDelta,
      ac.signal,
      onProgress,
      onPendingAction,
      onTool,
    );
    await flush();

    emitAiStreamEvent('home.chat.progress', { correlationId: 'corr-2', label: '위임 중' });
    // #593: pending_action 은 이제 { correlationId, actions: [...] } 봉투.
    emitAiStreamEvent('home.chat.pending_action', {
      correlationId: 'corr-2',
      actions: [{ actionType: 'calendar.create_event', params: {} }],
    });
    emitAiStreamEvent('home.chat.tool', {
      correlationId: 'corr-2',
      phase: 'start',
      seq: 1,
      toolName: 'show_issue_list',
    });
    emitAiStreamEvent('home.chat.done', { correlationId: 'corr-2' });
    await promise;

    expect(onProgress).toHaveBeenCalledWith('위임 중');
    expect(onPendingAction).toHaveBeenCalledWith([
      { actionType: 'calendar.create_event', params: {} },
    ]);
    expect(onTool).toHaveBeenCalledWith(
      expect.objectContaining({ phase: 'start', seq: 1, toolName: 'show_issue_list' }),
    );
  });

  it('pending_action 이 빈 배열이면 onPendingAction 을 호출하지 않는다', async () => {
    vi.mocked(homeApi.startChat).mockResolvedValue({ data: { correlationId: 'corr-3' } } as never);
    const onPendingAction = vi.fn();
    const ac = new AbortController();

    const promise = chatStream(
      { sessionId: null, query: 'q' },
      vi.fn(),
      ac.signal,
      undefined,
      onPendingAction,
    );
    await flush();

    emitAiStreamEvent('home.chat.pending_action', { correlationId: 'corr-3', actions: [] });
    emitAiStreamEvent('home.chat.done', { correlationId: 'corr-3' });
    await promise;

    expect(onPendingAction).not.toHaveBeenCalled();
  });

  it('error(cancelled:true) 이벤트는 타임아웃 메시지로 reject 한다', async () => {
    vi.mocked(homeApi.startChat).mockResolvedValue({ data: { correlationId: 'corr-4' } } as never);
    const ac = new AbortController();

    const promise = chatStream({ sessionId: null, query: 'q' }, vi.fn(), ac.signal);
    await flush();

    emitAiStreamEvent('home.chat.error', { correlationId: 'corr-4', cancelled: true });

    await expect(promise).rejects.toThrow('생성 시간이 초과되었습니다.');
  });

  it('error(일반 오류) 이벤트는 message 로 reject 한다', async () => {
    vi.mocked(homeApi.startChat).mockResolvedValue({ data: { correlationId: 'corr-5' } } as never);
    const ac = new AbortController();

    const promise = chatStream({ sessionId: null, query: 'q' }, vi.fn(), ac.signal);
    await flush();

    emitAiStreamEvent('home.chat.error', { correlationId: 'corr-5', message: '실패했어요' });

    await expect(promise).rejects.toThrow('실패했어요');
  });

  it('signal.abort() 시 AbortError 로 reject 하고 cancelChat 을 호출한다', async () => {
    vi.mocked(homeApi.startChat).mockResolvedValue({ data: { correlationId: 'corr-6' } } as never);
    vi.mocked(homeApi.cancelChat).mockResolvedValue({} as never);
    const onDelta = vi.fn();
    const ac = new AbortController();

    const promise = chatStream({ sessionId: null, query: 'q' }, onDelta, ac.signal);
    await flush();
    ac.abort();

    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    expect(homeApi.cancelChat).toHaveBeenCalledWith('corr-6');

    // teardown 이후 이벤트는 무시된다.
    emitAiStreamEvent('home.chat.delta', { correlationId: 'corr-6', text: '늦게 도착' });
    expect(onDelta).not.toHaveBeenCalled();
  });

  it('시작 전 이미 aborted 된 signal 이면 즉시 AbortError 로 reject 하고 startChat 을 호출하지 않는다', async () => {
    const ac = new AbortController();
    ac.abort();

    await expect(chatStream({ sessionId: null, query: 'q' }, vi.fn(), ac.signal)).rejects.toMatchObject(
      { name: 'AbortError' },
    );
    expect(homeApi.startChat).not.toHaveBeenCalled();
  });
});
