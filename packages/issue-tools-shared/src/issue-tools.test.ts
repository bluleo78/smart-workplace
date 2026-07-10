import { describe, expect, it, vi } from 'vitest';
import { buildSharedIssueTools } from './issue-tools.js';
import type { IssueToolClient } from './issue-client.js';

/** 전 메서드 vi.fn() 인 mock. 개별 테스트에서 필요한 것만 재설정. */
function mockClient(): IssueToolClient {
  return {
    getProjectTypes: vi.fn().mockResolvedValue([{ id: 2, name: 'BUG' }]),
    getProjectMembers: vi.fn().mockResolvedValue([{ userId: 10, username: 'alice' }]),
    getProjectLabels: vi.fn().mockResolvedValue([{ id: 100, name: 'urgent' }]),
    getIssueDetail: vi.fn(),
    createIssue: vi.fn().mockResolvedValue({ ok: true }),
    updateIssueContent: vi.fn().mockResolvedValue({}),
    setIssueType: vi.fn().mockResolvedValue({}),
    setIssueParent: vi.fn().mockResolvedValue({}),
    replaceIssueAssignees: vi.fn().mockResolvedValue({}),
    replaceIssueLabels: vi.fn().mockResolvedValue({}),
    addComment: vi.fn().mockResolvedValue(undefined),
    editComment: vi.fn().mockResolvedValue(undefined),
    addIssueDependency: vi.fn().mockResolvedValue({ summary: { title: 't', status: 'TODO', priority: 'MID', assignees: [] } }),
    removeIssueDependency: vi.fn().mockResolvedValue(undefined),
  };
}

describe('buildSharedIssueTools', () => {
  it('정확히 7종을 반환한다', () => {
    const names = buildSharedIssueTools(mockClient()).map((t) => t.name).sort();
    expect(names).toEqual(
      ['add_comment', 'add_issue_dependency', 'create_issue', 'edit_comment', 'get_issue_detail', 'remove_issue_dependency', 'update_issue'].sort(),
    );
  });

  it('get_issue_detail 은 normalizeIssueDetail 출력(superset)을 반환', async () => {
    const c = mockClient();
    vi.mocked(c.getIssueDetail).mockResolvedValue({
      issueKey: 'WP-12',
      summary: { title: 'T', status: 'TODO', priority: 'MID', assignees: [], blockedBy: [{ number: 5, title: 'x', status: 'TODO' }], blocks: [], blocked: true },
      body: 'b',
      comments: [],
    });
    const out = JSON.parse(await buildSharedIssueTools(c).find((t) => t.name === 'get_issue_detail')!.handler({ issueKey: 'WP-12' }));
    expect(out).toMatchObject({ issueKey: 'WP-12', title: 'T', blocked: true, blockedBy: [{ number: 5, title: 'x', status: 'TODO' }] });
    expect(c.getIssueDetail).toHaveBeenCalledWith('WP-12');
  });

  it('add_comment 은 client.addComment 호출 후 "ok"', async () => {
    const c = mockClient();
    const t = buildSharedIssueTools(c).find((x) => x.name === 'add_comment')!;
    await expect(t.handler({ issueKey: 'WP-12', body: '안녕' })).resolves.toBe('ok');
    expect(c.addComment).toHaveBeenCalledWith('WP-12', '안녕');
  });

  it('create_issue 는 type/assignees 를 리졸브 후 createIssue 호출', async () => {
    const c = mockClient();
    const t = buildSharedIssueTools(c).find((x) => x.name === 'create_issue')!;
    await t.handler({ projectKey: 'WP', title: '새 이슈', type: 'BUG', assignees: ['alice'] });
    expect(c.createIssue).toHaveBeenCalledWith('WP', expect.objectContaining({ title: '새 이슈', typeId: 2, assigneeIds: [10] }));
  });

  it('update_issue 는 fan-out 후 {ok,results}', async () => {
    const c = mockClient();
    const t = buildSharedIssueTools(c).find((x) => x.name === 'update_issue')!;
    const out = JSON.parse(await t.handler({ issueKey: 'WP-12', title: '수정', assignees: ['alice'] }));
    expect(out.ok).toBe(true);
    expect(out.results).toEqual({ content: 'ok', assignees: 'ok' });
    expect(c.updateIssueContent).toHaveBeenCalledWith('WP-12', { title: '수정' });
    expect(c.replaceIssueAssignees).toHaveBeenCalledWith('WP-12', [10]);
  });

  it('add_issue_dependency 는 다른 프로젝트면 클라이언트측 거부', async () => {
    const c = mockClient();
    const t = buildSharedIssueTools(c).find((x) => x.name === 'add_issue_dependency')!;
    await expect(t.handler({ issueKey: 'WP-1', otherIssueKey: 'AB-2', direction: 'blocks' })).rejects.toThrow(
      '동일 프로젝트 이슈 간에만 의존성을 설정할 수 있습니다.',
    );
    expect(c.addIssueDependency).not.toHaveBeenCalled();
  });

  it('add_issue_dependency 는 같은 프로젝트면 otherNumber 로 호출', async () => {
    const c = mockClient();
    const t = buildSharedIssueTools(c).find((x) => x.name === 'add_issue_dependency')!;
    await t.handler({ issueKey: 'WP-1', otherIssueKey: 'WP-2', direction: 'blocks' });
    expect(c.addIssueDependency).toHaveBeenCalledWith('WP-1', 2, 'blocks');
  });

  it('remove_issue_dependency 는 "ok"', async () => {
    const c = mockClient();
    const t = buildSharedIssueTools(c).find((x) => x.name === 'remove_issue_dependency')!;
    await expect(t.handler({ issueKey: 'WP-1', otherIssueKey: 'WP-2', direction: 'blockedBy' })).resolves.toBe('ok');
    expect(c.removeIssueDependency).toHaveBeenCalledWith('WP-1', 2, 'blockedBy');
  });
});
