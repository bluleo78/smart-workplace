// 5c-2: 4 type 핸들러가 runAgent 를 fire-and-forget 으로 호출하는지 검증.
// 5c-1 의 ack 텍스트 코드는 모두 제거됐다.
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('./run-agent.js', () => ({
  runAgent: vi.fn().mockResolvedValue(undefined),
}));

import { handleEvent } from './event-handler.js';
import { runAgent } from './run-agent.js';
import type { IssueEventEnvelope } from '../types/issue-events.js';

const common = {
  projectKey: 'WP',
  issueKey: 'WP-42',
  issueId: 42,
  issueTitle: '분석',
  actor: { id: 7, username: 'alice', kind: 'HUMAN' as const },
  assignees: [{ id: 201, username: 'ai-bot', kind: 'AGENT' as const }],
  occurredAt: '2026-05-25T12:00:00Z',
};

describe('handleEvent', () => {
  beforeEach(() => {
    vi.mocked(runAgent).mockClear();
    vi.mocked(runAgent).mockResolvedValue(undefined);
  });

  it('issue.created → runAgent 1회 호출, 동기 반환', () => {
    const env: IssueEventEnvelope = {
      type: 'issue.created',
      payload: { ...common, status: 'TODO', priority: 'MID' },
    };
    handleEvent(env);
    expect(runAgent).toHaveBeenCalledOnce();
    expect(runAgent).toHaveBeenCalledWith(env);
  });

  it('issue.assigned → runAgent 호출', () => {
    handleEvent({
      type: 'issue.assigned',
      payload: { ...common, added: common.assignees, removed: [] },
    });
    expect(runAgent).toHaveBeenCalledOnce();
  });

  it('issue.commented → AGENT actor 면 self-loop 차단 (runAgent 호출 0)', () => {
    handleEvent({
      type: 'issue.commented',
      payload: {
        ...common,
        actor: { id: 999, username: 'ai', kind: 'AGENT' as const },
        commentId: 1,
        commentBody: '자기 코멘트',
      },
    });
    expect(runAgent).not.toHaveBeenCalled();
  });

  it('issue.commented → HUMAN actor 면 runAgent 호출', () => {
    handleEvent({
      type: 'issue.commented',
      payload: { ...common, commentId: 1, commentBody: '확인' },
    });
    expect(runAgent).toHaveBeenCalledOnce();
  });

  it('issue.status_changed → runAgent 호출', () => {
    handleEvent({
      type: 'issue.status_changed',
      payload: { ...common, previousStatus: 'TODO', newStatus: 'IN_PROGRESS' },
    });
    expect(runAgent).toHaveBeenCalledOnce();
  });

  it('runAgent 가 reject 해도 handleEvent 는 throw 하지 않는다 (fire-and-forget)', async () => {
    vi.mocked(runAgent).mockRejectedValueOnce(new Error('boom'));
    expect(() =>
      handleEvent({
        type: 'issue.created',
        payload: { ...common, status: 'TODO', priority: 'MID' },
      }),
    ).not.toThrow();
    // microtask 비우기
    await new Promise((r) => setImmediate(r));
  });
});
