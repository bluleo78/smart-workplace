// 4 type 별 acknowledgment 핸들러 검증.
// client 는 vi.fn 으로 모킹 — workplace-api 호출은 client.test.ts 가 검증.
import { describe, it, expect, beforeEach, vi } from 'vitest';

import type { WorkplaceApiClient } from '../clients/workplace-api.js';
import {
  handleIssueAssigned,
  handleIssueCommented,
  handleIssueCreated,
  handleIssueStatusChanged,
} from './event-handler.js';

function mockClient(): WorkplaceApiClient {
  return {
    addIssueComment: vi.fn().mockResolvedValue(undefined),
    updateIssueStatus: vi.fn(),
  };
}

const baseCommon = {
  projectKey: 'WP',
  issueKey: 'WP-42',
  issueId: 42,
  issueTitle: '분석',
  actor: { id: 7, username: 'alice', kind: 'HUMAN' as const },
  assignees: [{ id: 201, username: 'ai-bot', kind: 'AGENT' as const }],
  occurredAt: '2026-05-25T12:00:00Z',
};

describe('event-handler', () => {
  let client: WorkplaceApiClient;

  beforeEach(() => {
    client = mockClient();
  });

  it('handleIssueCreated → ack 코멘트', async () => {
    await handleIssueCreated(client, {
      ...baseCommon,
      status: 'TODO',
      priority: 'MID',
    });
    expect(client.addIssueComment).toHaveBeenCalledOnce();
    const [issueKey, body] = vi.mocked(client.addIssueComment).mock.calls[0];
    expect(issueKey).toBe('WP-42');
    expect(body).toContain('새 이슈 생성을 확인했습니다 — WP-42 "분석"');
    expect(body).toContain('_(자동 응답)_');
  });

  it('handleIssueAssigned → ack 코멘트', async () => {
    await handleIssueAssigned(client, {
      ...baseCommon,
      added: baseCommon.assignees,
      removed: [],
    });
    const [issueKey, body] = vi.mocked(client.addIssueComment).mock.calls[0];
    expect(issueKey).toBe('WP-42');
    expect(body).toContain('작업을 맡았습니다 — WP-42');
  });

  it('handleIssueCommented → actor username + commentBody 포함', async () => {
    await handleIssueCommented(client, {
      ...baseCommon,
      commentId: 99,
      commentBody: '확인 부탁해요',
    });
    const [, body] = vi.mocked(client.addIssueComment).mock.calls[0];
    expect(body).toContain('코멘트 확인했습니다 (by @alice)');
    expect(body).toContain('확인 부탁해요');
  });

  it('handleIssueCommented → 80자 초과 commentBody 는 80자 + …', async () => {
    const long = 'x'.repeat(100);
    await handleIssueCommented(client, {
      ...baseCommon,
      commentId: 99,
      commentBody: long,
    });
    const [, body] = vi.mocked(client.addIssueComment).mock.calls[0];
    // 80자 + ellipsis
    expect(body).toContain('x'.repeat(80) + '…');
    // 100자 그대로는 포함하지 않음
    expect(body).not.toContain('x'.repeat(100));
  });

  it('handleIssueCommented → actor 가 AGENT 면 self-loop 차단 (호출 0)', async () => {
    await handleIssueCommented(client, {
      ...baseCommon,
      actor: { id: 999, username: 'ai', kind: 'AGENT' as const },
      commentId: 99,
      commentBody: '스스로 단 코멘트',
    });
    expect(client.addIssueComment).not.toHaveBeenCalled();
  });

  it('handleIssueStatusChanged → previous → new 포함', async () => {
    await handleIssueStatusChanged(client, {
      ...baseCommon,
      previousStatus: 'TODO',
      newStatus: 'IN_PROGRESS',
    });
    const [, body] = vi.mocked(client.addIssueComment).mock.calls[0];
    expect(body).toContain('상태 변경 확인 — TODO → IN_PROGRESS');
  });
});
