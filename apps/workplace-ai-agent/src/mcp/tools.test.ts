// 4 도구의 handler 가 client 의 정확한 메서드를 정확한 인자로 호출하는지 검증.
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
    getCachedSelfUserId: vi.fn().mockResolvedValue(201),
  };
}

describe('buildTools', () => {
  it('get_issue_detail 호출 → client.getIssueDetail 호출 후 JSON 문자열 반환', async () => {
    const c = client();
    const tools = buildTools(c);
    const t = tools.find((x) => x.name === 'get_issue_detail')!;
    const out = await t.handler({ issueKey: 'WP-1' });
    expect(c.getIssueDetail).toHaveBeenCalledWith('WP-1');
    expect(JSON.parse(out)).toMatchObject({ issueKey: 'WP-1' });
  });

  it('add_comment → client.addIssueComment(issueKey, body)', async () => {
    const c = client();
    const tools = buildTools(c);
    const t = tools.find((x) => x.name === 'add_comment')!;
    await t.handler({ issueKey: 'WP-1', body: '안녕' });
    expect(c.addIssueComment).toHaveBeenCalledWith('WP-1', '안녕');
  });

  it('update_status → client.updateIssueStatus(issueKey, status)', async () => {
    const c = client();
    const tools = buildTools(c);
    const t = tools.find((x) => x.name === 'update_status')!;
    await t.handler({ issueKey: 'WP-1', status: 'DONE' });
    expect(c.updateIssueStatus).toHaveBeenCalledWith('WP-1', 'DONE');
  });

  it('unassign_self → client.unassignSelf(issueKey)', async () => {
    const c = client();
    const tools = buildTools(c);
    const t = tools.find((x) => x.name === 'unassign_self')!;
    await t.handler({ issueKey: 'WP-1' });
    expect(c.unassignSelf).toHaveBeenCalledWith('WP-1');
  });

  it('update_status — 잘못된 status 는 zod 가 reject', async () => {
    const c = client();
    const tools = buildTools(c);
    const t = tools.find((x) => x.name === 'update_status')!;
    await expect(t.handler({ issueKey: 'WP-1', status: 'WRONG' })).rejects.toThrow();
    expect(c.updateIssueStatus).not.toHaveBeenCalled();
  });
});
