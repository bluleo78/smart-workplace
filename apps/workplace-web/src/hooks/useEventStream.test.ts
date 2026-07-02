import { describe, expect, it, vi } from 'vitest';

vi.mock('./useChatStream', () => ({ handleChatEvent: vi.fn() }));
vi.mock('./useMessageStream', () => ({ handleMessagingEvent: vi.fn() }));
vi.mock('./useNotificationStream', () => ({ handleNotifyEvent: vi.fn() }));
vi.mock('./useIssueStream', () => ({ handleIssueEvent: vi.fn() }));
vi.mock('../lib/aiEventBus', () => ({ emitAiStreamEvent: vi.fn() }));

import { emitAiStreamEvent } from '../lib/aiEventBus';
import { handleChatEvent } from './useChatStream';
import { routeStreamEvent } from './useEventStream';
import { handleIssueEvent } from './useIssueStream';
import { handleMessagingEvent } from './useMessageStream';
import { handleNotifyEvent } from './useNotificationStream';

const qc = {} as never;

describe('routeStreamEvent', () => {
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
