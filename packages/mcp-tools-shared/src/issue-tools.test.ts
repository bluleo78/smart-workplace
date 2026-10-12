import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { buildSharedIssueTools } from './issue-tools.js';
import type { IssueToolClient } from './tool-client.js';
import { resultText } from './mcp-content.js';

/** 전 메서드 vi.fn() 인 mock. 개별 테스트에서 필요한 것만 재설정. */
function mockClient(): IssueToolClient {
  return {
    getProjectTypes: vi.fn().mockResolvedValue([{ id: 2, name: 'BUG' }]),
    getProjectMembers: vi.fn().mockResolvedValue([{ userId: 10, username: 'alice' }]),
    getMe: vi.fn().mockResolvedValue({ id: 10, username: 'alice' }),
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
    getProjectMilestones: vi.fn().mockResolvedValue([{ id: 7, name: 'v1.0' }]),
    getProjectCycles: vi.fn().mockResolvedValue([{ id: 30, name: 'Sprint 3' }]),
    replaceIssueCycles: vi.fn().mockResolvedValue([]),
    getIssueCycles: vi.fn().mockResolvedValue([]),
    watchIssue: vi.fn().mockResolvedValue(undefined),
    unwatchIssue: vi.fn().mockResolvedValue(undefined),
  };
}

describe('buildSharedIssueTools', () => {
  it('정확히 9종을 반환한다', () => {
    const names = buildSharedIssueTools(mockClient()).map((t) => t.name).sort();
    expect(names).toEqual(
      [
        'add_comment',
        'add_issue_dependency',
        'create_issue',
        'update_comment',
        'get_issue_detail',
        'remove_issue_dependency',
        'unwatch_issue',
        'update_issue',
        'watch_issue',
      ].sort(),
    );
  });

  it('get_issue_detail 은 normalizeIssueDetail 출력(superset)을 반환', async () => {
    const c = mockClient();
    vi.mocked(c.getIssueDetail).mockResolvedValue({
      issueKey: 'WP-12',
      summary: { projectKey: 'WP', number: 12, title: 'T', status: 'TODO', priority: 'MID', assignees: [], blockedBy: [{ number: 5, title: 'x', status: 'TODO' }], blocks: [], blocked: true },
      body: 'b',
      comments: [],
    });
    const out = JSON.parse(resultText(await buildSharedIssueTools(c).find((t) => t.name === 'get_issue_detail')!.handler({ issueKey: 'WP-12' })));
    expect(out).toMatchObject({ issueKey: 'WP-12', title: 'T', blocked: true, blockedBy: [{ issueKey: 'WP-5', title: 'x', status: 'TODO' }] });
    expect(c.getIssueDetail).toHaveBeenCalledWith('WP-12');
  });

  it('WP-353: get_issue_detail 은 코멘트를 최근 30건으로 자르고, allComments:true 면 전부 준다', async () => {
    const c = mockClient();
    const comments = Array.from({ length: 45 }, (_, i) => ({ id: i + 1, body: `c${i + 1}`, authorName: 'x', authorKind: 'HUMAN' }));
    vi.mocked(c.getIssueDetail).mockResolvedValue({ issueKey: 'WP-12', summary: { projectKey: 'WP', number: 12, title: 'T' }, comments });
    const detail = buildSharedIssueTools(c).find((t) => t.name === 'get_issue_detail')!;
    const cut = JSON.parse(resultText(await detail.handler({ issueKey: 'WP-12' })));
    expect(cut.comments).toHaveLength(30);
    expect(cut.commentsOmitted).toBe(15);
    const all = JSON.parse(resultText(await detail.handler({ issueKey: 'WP-12', allComments: true })));
    expect(all.comments).toHaveLength(45);
    expect(all).not.toHaveProperty('commentsOmitted');
    expect(detail.description).toMatch(/commentsOmitted/);
    expect(detail.description).toMatch(/allComments/);
    expect(detail.description).toMatch(/200건/);
  });

  it('WP-176: get_issue_detail 은 이슈의 사이클을 name·status 로 동봉한다(숫자 id 없음)', async () => {
    const c = mockClient();
    vi.mocked(c.getIssueDetail).mockResolvedValue({
      issueKey: 'WP-12',
      summary: { title: 'T', status: 'DONE', priority: 'MID', assignees: [] },
      comments: [],
    });
    vi.mocked(c.getIssueCycles).mockResolvedValue([
      { id: 3001, name: 'Sprint 2', status: 'COMPLETED' },
      { id: 3002, name: 'Sprint 3', status: 'ACTIVE' },
    ]);
    const raw = await buildSharedIssueTools(c).find((t) => t.name === 'get_issue_detail')!.handler({ issueKey: 'WP-12' });
    expect(JSON.parse(resultText(raw)).cycles).toEqual([
      { name: 'Sprint 2', status: 'COMPLETED' },
      { name: 'Sprint 3', status: 'ACTIVE' },
    ]);
    expect(resultText(raw)).not.toContain('3001');
    expect(c.getIssueCycles).toHaveBeenCalledWith('WP-12');
  });

  it('WP-307: get_issue_detail 은 서버가 준 마일스톤 이름·작성자 username 을 쓰고 보조 조회를 하지 않는다', async () => {
    const c = mockClient();
    vi.mocked(c.getIssueDetail).mockResolvedValue({
      issueKey: 'WP-12',
      summary: { title: 'T', status: 'TODO', priority: 'MID', assignees: [], milestoneId: 7, milestoneName: 'v1.0' },
      comments: [{ id: 1, body: 'b', authorId: 10, authorName: 'Alice', authorKind: 'HUMAN', authorUsername: 'alice', createdAt: '2026-10-01T00:00:00Z' }],
    });
    const out = JSON.parse(resultText(await buildSharedIssueTools(c).find((t) => t.name === 'get_issue_detail')!.handler({ issueKey: 'WP-12' })));
    expect(out.milestone).toBe('v1.0');
    expect(out.comments[0].author).toEqual({ username: 'alice', name: 'Alice', kind: 'HUMAN' });
    expect(c.getProjectMilestones).not.toHaveBeenCalled();
    expect(c.getProjectMembers).not.toHaveBeenCalled();
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

  // WP-353: parent 는 이슈 도구의 다른 입력(issueKey·otherIssueKey)과 같은 이슈 키(WP-12)로 받고, 서버용 번호로 옮긴다.
  it('create_issue 의 parent 는 이슈 키 — 서버에는 같은 프로젝트의 번호(parentNumber)로 보낸다', async () => {
    const c = mockClient();
    const t = buildSharedIssueTools(c).find((x) => x.name === 'create_issue')!;
    await t.handler({ projectKey: 'WP', title: '하위', parent: 'WP-7' });
    expect(c.createIssue).toHaveBeenCalledWith('WP', expect.objectContaining({ parentNumber: 7 }));
  });

  // 옛 클라이언트가 숫자를 보내 검증에 걸렸을 때 스키마 설명이 이슈 키를 안내한다.
  it('create_issue·update_issue 의 parent 입력 설명이 이슈 키(예: WP-12, 같은 프로젝트)를 안내한다', () => {
    for (const name of ['create_issue', 'update_issue']) {
      const schema = z.toJSONSchema(buildSharedIssueTools(mockClient()).find((x) => x.name === name)!.inputSchema as z.ZodType) as unknown as { properties: { parent: { description?: string } } };
      expect(schema.properties.parent.description, name).toContain('부모 이슈 키(예: WP-12)');
      expect(schema.properties.parent.description, name).toContain('같은 프로젝트만');
    }
  });

  it('create_issue 는 다른 프로젝트의 부모 키를 이슈를 만들기 전에 거부한다', async () => {
    const c = mockClient();
    const t = buildSharedIssueTools(c).find((x) => x.name === 'create_issue')!;
    await expect(t.handler({ projectKey: 'WP', title: '하위', parent: 'AB-7' })).rejects.toThrow('같은 프로젝트(WP)');
    expect(c.createIssue).not.toHaveBeenCalled();
    await expect(t.handler({ projectKey: 'WP', title: '하위', parent: 7 })).rejects.toThrow(); // 번호만은 더 이상 받지 않는다
  });

  it('update_issue 의 parent 는 이슈 키(설정)·null(해제), 다른 프로젝트 키는 아무것도 쓰기 전에 거부한다', async () => {
    const c = mockClient();
    const t = buildSharedIssueTools(c).find((x) => x.name === 'update_issue')!;
    await t.handler({ issueKey: 'WP-12', parent: 'WP-3' });
    expect(c.setIssueParent).toHaveBeenLastCalledWith('WP-12', 3);
    await t.handler({ issueKey: 'WP-12', parent: null });
    expect(c.setIssueParent).toHaveBeenLastCalledWith('WP-12', null);
    vi.mocked(c.setIssueParent).mockClear();
    vi.mocked(c.updateIssueContent).mockClear();
    await expect(t.handler({ issueKey: 'WP-12', title: '수정', parent: 'AB-3' })).rejects.toThrow('같은 프로젝트(WP)');
    expect(c.updateIssueContent).not.toHaveBeenCalled();
    expect(c.setIssueParent).not.toHaveBeenCalled();
  });

  it('create_issue 결과에는 숫자 사용자 ID(reporterId·assignees[].id)가 없고 issueKey 가 있다 (#833, WP-353)', async () => {
    const c = mockClient();
    // 서버 IssueResponse 모양.
    vi.mocked(c.createIssue).mockResolvedValue({
      id: 100, projectKey: 'WP', number: 21, title: '새 이슈', status: 'TODO', priority: 'MID', reporterId: 10, milestoneId: null, version: 0,
      assignees: [{ id: 10, username: 'alice', name: '앨리스', kind: 'HUMAN' }], labels: [], blockedBy: [], blocks: [], blocked: false,
    });
    const t = buildSharedIssueTools(c).find((x) => x.name === 'create_issue')!;
    const text = resultText(await t.handler({ projectKey: 'WP', title: '새 이슈', assignees: ['alice'] }));
    const out = JSON.parse(text);
    expect(out).toMatchObject({ issueKey: 'WP-21', title: '새 이슈', assignees: [{ username: 'alice', name: '앨리스', kind: 'HUMAN' }] });
    expect(text).not.toMatch(/reporterId|"id"/);
  });

  it('add_issue_dependency 결과는 갱신된 의존성만 — 상세 raw 의 숫자 사용자 ID 를 싣지 않는다 (#833, WP-353)', async () => {
    const c = mockClient();
    vi.mocked(c.addIssueDependency).mockResolvedValue({
      summary: {
        id: 1, projectKey: 'WP', number: 1, title: 't', status: 'TODO', reporterId: 10,
        blockedBy: [], blocks: [{ number: 2, title: '후속', status: 'TODO', dueDate: null, type: null }], blocked: false,
      },
      comments: [{ id: 5, body: 'c', authorId: 10, authorName: '앨리스' }],
      history: [{ actorId: 10, actorName: '앨리스', eventType: 'DEPENDENCY_ADDED' }],
      reporter: { id: 10, username: 'alice', name: '앨리스', kind: 'HUMAN' },
    });
    const t = buildSharedIssueTools(c).find((x) => x.name === 'add_issue_dependency')!;
    const text = resultText(await t.handler({ issueKey: 'WP-1', otherIssueKey: 'WP-2', direction: 'blocks' }));
    expect(JSON.parse(text)).toEqual({ issueKey: 'WP-1', blockedBy: [], blocks: [{ issueKey: 'WP-2', title: '후속', status: 'TODO' }], blocked: false });
    expect(text).not.toMatch(/Id"|"id"/);
  });

  it('update_issue 는 fan-out 후 {ok,results}', async () => {
    const c = mockClient();
    const t = buildSharedIssueTools(c).find((x) => x.name === 'update_issue')!;
    const out = JSON.parse(resultText(await t.handler({ issueKey: 'WP-12', title: '수정', assignees: ['alice'] })));
    expect(out.ok).toBe(true);
    expect(out.results).toEqual({ content: 'ok', assignees: 'ok' });
    expect(c.updateIssueContent).toHaveBeenCalledWith('WP-12', { title: '수정' });
    expect(c.replaceIssueAssignees).toHaveBeenCalledWith('WP-12', [10]);
  });

  // WP-53: "나에게 할당해줘" — assignees 의 'me' 는 호출자 본인으로 지정된다.
  it("update_issue 는 assignees 'me' 를 호출자 userId 로 교체한다", async () => {
    const c = mockClient();
    const t = buildSharedIssueTools(c).find((x) => x.name === 'update_issue')!;
    const out = JSON.parse(resultText(await t.handler({ issueKey: 'WP-12', assignees: ['me'] })));
    expect(out.results).toEqual({ assignees: 'ok' });
    expect(c.replaceIssueAssignees).toHaveBeenCalledWith('WP-12', [10]);
  });

  it("create_issue 는 assignees 'me' 를 호출자 userId 로 생성한다", async () => {
    const c = mockClient();
    const t = buildSharedIssueTools(c).find((x) => x.name === 'create_issue')!;
    await t.handler({ projectKey: 'WP', title: '새 이슈', assignees: ['me'] });
    expect(c.createIssue).toHaveBeenCalledWith('WP', expect.objectContaining({ assigneeIds: [10] }));
  });

  it('update_issue 는 milestone 이름을 milestoneId 로, cycles 이름을 집합 교체로 보낸다 (#854)', async () => {
    const c = mockClient();
    const t = buildSharedIssueTools(c).find((x) => x.name === 'update_issue')!;
    const out = JSON.parse(resultText(await t.handler({ issueKey: 'WP-12', milestone: 'v1.0', cycles: ['Sprint 3'] })));
    expect(out.results).toEqual({ content: 'ok', cycles: 'ok' });
    expect(c.updateIssueContent).toHaveBeenCalledWith('WP-12', { milestoneId: 7 });
    expect(c.replaceIssueCycles).toHaveBeenCalledWith('WP-12', [30]);
  });

  it('update_issue 는 milestone null 이면 clearMilestone, cycles [] 면 전부 해제 (#854)', async () => {
    const c = mockClient();
    const t = buildSharedIssueTools(c).find((x) => x.name === 'update_issue')!;
    await t.handler({ issueKey: 'WP-12', milestone: null, cycles: [] });
    expect(c.updateIssueContent).toHaveBeenCalledWith('WP-12', { clearMilestone: true });
    expect(c.replaceIssueCycles).toHaveBeenCalledWith('WP-12', []);
    expect(c.getProjectMilestones).not.toHaveBeenCalled();
  });

  it('update_issue 는 모르는 마일스톤이면 아무것도 쓰지 않고 throw (#854)', async () => {
    const c = mockClient();
    const t = buildSharedIssueTools(c).find((x) => x.name === 'update_issue')!;
    await expect(t.handler({ issueKey: 'WP-12', title: '수정', milestone: 'v9' })).rejects.toThrow('사용 가능: v1.0');
    expect(c.updateIssueContent).not.toHaveBeenCalled();
  });

  it('watch_issue / unwatch_issue 는 issueKey 로 호출 (#854)', async () => {
    const c = mockClient();
    const tools = buildSharedIssueTools(c);
    await expect(tools.find((x) => x.name === 'watch_issue')!.handler({ issueKey: 'WP-3' })).resolves.toBe('ok');
    await expect(tools.find((x) => x.name === 'unwatch_issue')!.handler({ issueKey: 'WP-3' })).resolves.toBe('ok');
    expect(c.watchIssue).toHaveBeenCalledWith('WP-3');
    expect(c.unwatchIssue).toHaveBeenCalledWith('WP-3');
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
