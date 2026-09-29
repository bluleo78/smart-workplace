import type { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

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
    const catchUp = createCatchUp(qc);

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

describe('createCatchUp 최소 간격', () => {
  it('첫 open 생략 · 두 번째 실행 · 30초 내 세 번째 생략 · 30초 후 네 번째 실행', () => {
    const qc = { invalidateQueries: vi.fn() } as unknown as QueryClient;
    let t = 1_000_000;
    const catchUp = createCatchUp(qc, () => t);
    const calls = () => (qc.invalidateQueries as ReturnType<typeof vi.fn>).mock.calls.length;
    catchUp(); // 첫 연결
    expect(calls()).toBe(0);
    catchUp(); // 재연결 → 실행
    expect(calls()).toBe(1);
    t += 29_999;
    catchUp(); // 30초 내 → 생략
    expect(calls()).toBe(1);
    t += 1;
    catchUp(); // 30초 경과 → 실행
    expect(calls()).toBe(2);
  });
});
