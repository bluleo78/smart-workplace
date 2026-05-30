import { describe, expect, it, vi } from 'vitest';

import type { WorkplaceApiClient } from '../clients/workplace-api.js';
import { buildTools } from './tools.js';

function client(): WorkplaceApiClient {
  return {
    addIssueComment: vi.fn().mockResolvedValue(undefined),
    updateIssueStatus: vi.fn().mockResolvedValue(undefined),
    getIssueDetail: vi.fn().mockResolvedValue({
      issueKey: 'WP-1',
      title: 't',
      status: 'TODO',
      priority: 'MID',
      assignees: [],
    }),
    unassignSelf: vi.fn().mockResolvedValue(undefined),
    getOAuthToken: vi.fn(),
    getChatMessages: vi.fn().mockResolvedValue([]),
    addChatMessage: vi.fn().mockResolvedValue(undefined),
    listIssueAttachments: vi.fn().mockResolvedValue([]),
    downloadIssueAttachment: vi.fn(),
  };
}

const AGENT_ID = 201;

describe('buildTools (agentId bound)', () => {
  it('get_issue_detail → client.getIssueDetail(agentId, key)', async () => {
    const c = client();
    const tools = buildTools(c, AGENT_ID);
    const t = tools.find((x) => x.name === 'get_issue_detail')!;
    const out = await t.handler({ issueKey: 'WP-1' });
    expect(c.getIssueDetail).toHaveBeenCalledWith(AGENT_ID, 'WP-1');
    expect(JSON.parse(out)).toMatchObject({ issueKey: 'WP-1' });
  });

  it('add_comment → client.addIssueComment(agentId, key, body)', async () => {
    const c = client();
    const t = buildTools(c, AGENT_ID).find((x) => x.name === 'add_comment')!;
    await t.handler({ issueKey: 'WP-1', body: '안녕' });
    expect(c.addIssueComment).toHaveBeenCalledWith(AGENT_ID, 'WP-1', '안녕');
  });

  it('update_status → client.updateIssueStatus(agentId, key, status)', async () => {
    const c = client();
    const t = buildTools(c, AGENT_ID).find((x) => x.name === 'update_status')!;
    await t.handler({ issueKey: 'WP-1', status: 'DONE' });
    expect(c.updateIssueStatus).toHaveBeenCalledWith(AGENT_ID, 'WP-1', 'DONE');
  });

  it('unassign_self → client.unassignSelf(agentId, key)', async () => {
    const c = client();
    const t = buildTools(c, AGENT_ID).find((x) => x.name === 'unassign_self')!;
    await t.handler({ issueKey: 'WP-1' });
    expect(c.unassignSelf).toHaveBeenCalledWith(AGENT_ID, 'WP-1');
  });

  it('update_status — 잘못된 status 는 zod reject', async () => {
    const c = client();
    const t = buildTools(c, AGENT_ID).find((x) => x.name === 'update_status')!;
    await expect(t.handler({ issueKey: 'WP-1', status: 'WRONG' })).rejects.toThrow();
    expect(c.updateIssueStatus).not.toHaveBeenCalled();
  });

  // --- 6c: 프로필 ---

  it('chat 프로필: get_issue_detail, get_chat_thread, add_chat_message 만', () => {
    const names = buildTools(client(), AGENT_ID, 'chat').map((t) => t.name).sort();
    expect(names).toEqual(['add_chat_message', 'get_chat_thread', 'get_issue_detail']);
  });

  it('issue 프로필(기본): 기존 4개 그대로', () => {
    const names = buildTools(client(), AGENT_ID, 'issue').map((t) => t.name).sort();
    expect(names).toEqual(['add_comment', 'get_issue_detail', 'unassign_self', 'update_status']);
  });

  it('add_chat_message → client.addChatMessage(agentId, threadId, body)', async () => {
    const c = client();
    const t = buildTools(c, AGENT_ID, 'chat').find((x) => x.name === 'add_chat_message')!;
    await t.handler({ threadId: 5, body: '답변' });
    expect(c.addChatMessage).toHaveBeenCalledWith(AGENT_ID, 5, '답변');
  });

  it('get_chat_thread → client.getChatMessages(agentId, threadId, 50)', async () => {
    const c = client();
    vi.mocked(c.getChatMessages).mockResolvedValue([
      { id: 1, authorName: 'A', authorKind: 'HUMAN', body: 'hi', createdAt: 't', deleted: false },
    ]);
    const t = buildTools(c, AGENT_ID, 'chat').find((x) => x.name === 'get_chat_thread')!;
    const out = await t.handler({ threadId: 5 });
    expect(c.getChatMessages).toHaveBeenCalledWith(AGENT_ID, 5, 50);
    expect(out).toContain('hi');
  });
});
