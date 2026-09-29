import type { QueryClient } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./useChatStream', () => ({ handleChatEvent: vi.fn() }));
vi.mock('./useMessageStream', () => ({ handleMessagingEvent: vi.fn() }));
vi.mock('./useNotificationStream', () => ({ handleNotifyEvent: vi.fn() }));
vi.mock('./useIssueStream', () => ({ handleIssueEvent: vi.fn() }));
vi.mock('./useResourceStream', () => ({ handleResourceEvent: vi.fn() }));
vi.mock('../lib/aiEventBus', () => ({ emitAiStreamEvent: vi.fn() }));

import { emitAiStreamEvent } from '../lib/aiEventBus';
import { handleChatEvent } from './useChatStream';
import { createCatchUp, reconnectCatchUp, routeStreamEvent } from './useEventStream';
import { handleIssueEvent } from './useIssueStream';
import { handleMessagingEvent } from './useMessageStream';
import { handleNotifyEvent } from './useNotificationStream';
import { handleResourceEvent } from './useResourceStream';

const qc = {} as never;

describe('routeStreamEvent', () => {
  it('resource.changed → handleResourceEvent', () => {
    routeStreamEvent('resource.changed', { resource: 'issue' }, { qc, currentUserId: 9 });
    expect(handleResourceEvent).toHaveBeenCalledWith(qc, { resource: 'issue' });
  });

  it('chat.* → handleChatEvent', () => {
    routeStreamEvent('chat.message.created', { threadId: 1 }, { qc, currentUserId: 9 });
    expect(handleChatEvent).toHaveBeenCalledWith(qc, 'chat.message.created', { threadId: 1 });
  });

  it('messaging.* → handleMessagingEvent (currentUserId 전달)', () => {
    routeStreamEvent('messaging.message.read', { channelId: 2 }, { qc, currentUserId: 9 });
    expect(handleMessagingEvent).toHaveBeenCalledWith(qc, 'messaging.message.read', { channelId: 2 }, 9);
  });

  it('notify.* → handleNotifyEvent', () => {
    routeStreamEvent('notify.created', undefined, { qc, currentUserId: 9 });
    expect(handleNotifyEvent).toHaveBeenCalledWith(qc, 'notify.created');
  });

  it('issue.* → handleIssueEvent', () => {
    routeStreamEvent('issue.commented', { projectKey: 'EX', issueNumber: 21 }, { qc, currentUserId: 9 });
    expect(handleIssueEvent).toHaveBeenCalledWith(qc, 'issue.commented', { projectKey: 'EX', issueNumber: 21 });
  });

  it('wiki.ai.*/drive.overview.*/home.chat.* → emitAiStreamEvent', () => {
    routeStreamEvent('wiki.ai.delta', { correlationId: 'a' }, { qc, currentUserId: 9 });
    expect(emitAiStreamEvent).toHaveBeenCalledWith('wiki.ai.delta', { correlationId: 'a' });
    routeStreamEvent('drive.overview.done', { correlationId: 'b' }, { qc, currentUserId: 9 });
    expect(emitAiStreamEvent).toHaveBeenCalledWith('drive.overview.done', { correlationId: 'b' });
    routeStreamEvent('home.chat.tool', { correlationId: 'c' }, { qc, currentUserId: 9 });
    expect(emitAiStreamEvent).toHaveBeenCalledWith('home.chat.tool', { correlationId: 'c' });
  });

  it('알 수 없는 prefix 는 무시', () => {
    expect(() => routeStreamEvent('wiki.x', {}, { qc, currentUserId: 9 })).not.toThrow();
  });
});

describe('reconnectCatchUp', () => {
  it('보호 키를 뺀 활성 쿼리를 무효화한다', () => {
    const qc = { invalidateQueries: vi.fn() } as unknown as QueryClient;
    reconnectCatchUp(qc);
    const arg = (qc.invalidateQueries as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg.refetchType).toBe('active');
    expect(arg.predicate({ queryKey: ['issues', 'search', 'EX'] })).toBe(true);
    expect(arg.predicate({ queryKey: ['mail-summary', 3] })).toBe(false);
    expect(arg.predicate({ queryKey: ['chat', 'messages', 1] })).toBe(false);
  });
});

describe('createCatchUp', () => {
  it('첫 연결은 catch-up 생략, 재연결은 실행한다', () => {
    const qc = { invalidateQueries: vi.fn() } as unknown as QueryClient;
    const { onOpen: catchUp } = createCatchUp(qc);

    // 첫 번째 onOpen (초기 연결) — catch-up 실행 안 함
    catchUp();
    expect((qc.invalidateQueries as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);

    // 두 번째 onOpen (재연결) — catch-up 실행
    catchUp();
    expect((qc.invalidateQueries as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
    const arg = (qc.invalidateQueries as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg.refetchType).toBe('active');
  });
});

describe('createCatchUp 최소 간격(trailing 유예)', () => {
  const setup = () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const qc = { invalidateQueries: vi.fn() } as unknown as QueryClient;
    const h = createCatchUp(qc);
    const calls = () => (qc.invalidateQueries as ReturnType<typeof vi.fn>).mock.calls.length;
    return { h, calls };
  };
  afterEach(() => vi.useRealTimers());

  it('첫 open 생략 · 두 번째 즉시 실행 · 창 안의 세 번째는 창 끝에 1회 실행', () => {
    const { h, calls } = setup();
    h.onOpen(); // 첫 연결
    expect(calls()).toBe(0);
    h.onOpen(); // 재연결 → 즉시
    expect(calls()).toBe(1);
    vi.advanceTimersByTime(10_000);
    h.onOpen(); // 창 안 → 즉시 실행 없음
    expect(calls()).toBe(1);
    vi.advanceTimersByTime(19_999);
    expect(calls()).toBe(1);
    vi.advanceTimersByTime(1); // lastRun+30s
    expect(calls()).toBe(2);
  });

  it('창 안 재연결이 여러 번이어도 유예 실행은 정확히 1회', () => {
    const { h, calls } = setup();
    h.onOpen();
    h.onOpen();
    vi.advanceTimersByTime(5_000);
    h.onOpen();
    vi.advanceTimersByTime(5_000);
    h.onOpen();
    vi.advanceTimersByTime(60_000);
    expect(calls()).toBe(2);
  });

  it('30초 경과 후 재연결은 즉시 실행', () => {
    const { h, calls } = setup();
    h.onOpen();
    h.onOpen();
    vi.advanceTimersByTime(30_000);
    h.onOpen();
    expect(calls()).toBe(2);
  });

  it('dispose 는 대기 중인 유예 실행을 취소한다', () => {
    const { h, calls } = setup();
    h.onOpen();
    h.onOpen();
    h.onOpen(); // 유예 예약
    h.dispose();
    vi.advanceTimersByTime(60_000);
    expect(calls()).toBe(1);
  });
});
