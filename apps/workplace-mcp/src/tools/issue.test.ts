import { describe, expect, it, vi } from 'vitest';
import { buildIssueTools, parseIssueKey } from './issue.js';
import { mockPatApiClient } from './test-support.js';

/** 테스트용 mock PatApiClient — 각 메서드 호출 인자를 검증하기 위한 vi.fn 래핑(이슈 메서드만 응답 값 설정). */
function mockClient() {
  const client = mockPatApiClient();
  (client.listProjects as ReturnType<typeof vi.fn>).mockResolvedValue([{ key: 'WP' }]);
  (client.getProject as ReturnType<typeof vi.fn>).mockResolvedValue({ key: 'WP' });
  (client.getProjectTypes as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  (client.getProjectLabels as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  (client.getProjectMembers as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  (client.listMyIssues as ReturnType<typeof vi.fn>).mockResolvedValue([{ number: 1 }]);
  (client.getIssueDetail as ReturnType<typeof vi.fn>).mockResolvedValue({
    summary: { id: 42 },
    body: 'b',
    comments: [],
  });
  (client.createIssue as ReturnType<typeof vi.fn>).mockResolvedValue({
    number: 1,
    title: '버그 수정',
  });
  (client.addIssueComment as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  (client.updateIssueStatus as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  (client.addIssueDependency as ReturnType<typeof vi.fn>).mockResolvedValue({
    summary: { id: 42, blocks: [{ number: 7 }] },
  });
  (client.removeIssueDependency as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  return client;
}

describe('parseIssueKey', () => {
  it('마지막 하이픈 기준으로 projectKey/number 를 분리한다', () => {
    expect(parseIssueKey('WP-12')).toEqual({ projectKey: 'WP', number: 12 });
  });

  it('프로젝트 키 자체에 하이픈이 있어도 마지막 세그먼트만 number 로 취급한다', () => {
    expect(parseIssueKey('SUB-PROJ-3')).toEqual({ projectKey: 'SUB-PROJ', number: 3 });
  });

  it('하이픈이 없는 등 형식이 올바르지 않으면 명확한 에러를 던진다', () => {
    expect(() => parseIssueKey('WP12')).toThrow('issueKey 형식이 올바르지 않습니다: WP12');
  });
});

describe('buildIssueTools', () => {
  it('list_projects → client.listProjects()', async () => {
    const c = mockClient();
    const t = buildIssueTools(c).find((x) => x.name === 'list_projects')!;
    const out = await t.handler({});
    expect(c.listProjects).toHaveBeenCalled();
    expect(JSON.parse(out)).toEqual([{ key: 'WP' }]);
  });

  it('get_project → client.getProject(projectKey)', async () => {
    const c = mockClient();
    const t = buildIssueTools(c).find((x) => x.name === 'get_project')!;
    const out = await t.handler({ projectKey: 'WP' });
    expect(c.getProject).toHaveBeenCalledWith('WP');
    expect(JSON.parse(out)).toEqual({ key: 'WP', types: [], labels: [], members: [] });
  });

  it('get_project 는 프로젝트에 types/labels/members 를 동봉한다', async () => {
    const c = mockClient();
    (c.getProject as ReturnType<typeof vi.fn>).mockResolvedValue({ key: 'WP', name: 'Work' });
    (c.getProjectTypes as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: 1, name: 'TASK' }]);
    (c.getProjectLabels as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: 5, name: 'urgent' }]);
    (c.getProjectMembers as ReturnType<typeof vi.fn>).mockResolvedValue([
      { userId: 10, username: 'alice' },
    ]);
    const t = buildIssueTools(c).find((x) => x.name === 'get_project')!;
    const out = JSON.parse(await t.handler({ projectKey: 'WP' }));
    expect(out).toEqual({
      key: 'WP',
      name: 'Work',
      types: [{ id: 1, name: 'TASK' }],
      labels: [{ id: 5, name: 'urgent' }],
      members: [{ userId: 10, username: 'alice' }],
    });
  });

  it('list_issues → client.listMyIssues 에 assignee=me 기본 주입 + 필터+기본 size 30 전달', async () => {
    const c = mockClient();
    const t = buildIssueTools(c).find((x) => x.name === 'list_issues')!;
    await t.handler({ status: 'TODO' });
    expect(c.listMyIssues).toHaveBeenCalledWith({ status: 'TODO', assignee: 'me', size: 30 });
  });

  it('list_issues 는 projectKey 를 서버에 전달하지 않고 응답을 issueKey 접두어로 클라이언트측 필터링한다', async () => {
    const c = mockClient();
    (c.listMyIssues as ReturnType<typeof vi.fn>).mockResolvedValue([
      { issueKey: 'WP-1' },
      { issueKey: 'OTHER-2' },
      { issueKey: 'WP-3' },
    ]);
    const t = buildIssueTools(c).find((x) => x.name === 'list_issues')!;
    const out = await t.handler({ projectKey: 'WP' });
    expect(c.listMyIssues).toHaveBeenCalledWith({ assignee: 'me', size: 30 });
    expect(JSON.parse(out)).toEqual([{ issueKey: 'WP-1' }, { issueKey: 'WP-3' }]);
  });

  it('get_issue_detail → issueKey 를 분해해 client.getIssueDetail 호출', async () => {
    const c = mockClient();
    const t = buildIssueTools(c).find((x) => x.name === 'get_issue_detail')!;
    const out = await t.handler({ issueKey: 'WP-12' });
    expect(c.getIssueDetail).toHaveBeenCalledWith('WP', 12);
    expect(JSON.parse(out)).toMatchObject({ summary: { id: 42 } });
  });

  it('create_issue → client.createIssue(projectKey, {title,...})', async () => {
    const c = mockClient();
    const t = buildIssueTools(c).find((x) => x.name === 'create_issue')!;
    const out = await t.handler({ projectKey: 'WP', title: '버그 수정' });
    expect(c.createIssue).toHaveBeenCalledWith('WP', { title: '버그 수정' });
    expect(JSON.parse(out)).toMatchObject({ number: 1 });
  });

  it('create_issue 는 title 누락 시 zod 파싱을 거부한다', async () => {
    const c = mockClient();
    const t = buildIssueTools(c).find((x) => x.name === 'create_issue')!;
    await expect(t.handler({ projectKey: 'WP' })).rejects.toThrow();
    expect(c.createIssue).not.toHaveBeenCalled();
  });

  it('create_issue 는 type/assignees 를 리졸브하고 parent/startDate 를 전달한다', async () => {
    const c = mockClient();
    (c.getProjectTypes as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: 2, name: 'BUG' }]);
    (c.getProjectMembers as ReturnType<typeof vi.fn>).mockResolvedValue([
      { userId: 11, username: 'bob' },
    ]);
    const t = buildIssueTools(c).find((x) => x.name === 'create_issue')!;
    await t.handler({
      projectKey: 'WP',
      title: '버그',
      type: 'BUG',
      assignees: ['bob'],
      parent: 7,
      startDate: '2026-07-01',
    });
    expect(c.createIssue).toHaveBeenCalledWith('WP', {
      title: '버그',
      typeId: 2,
      assigneeIds: [11],
      parentNumber: 7,
      startDate: '2026-07-01',
    });
  });

  it('create_issue 는 없는 유형이면 createIssue 를 호출하지 않고 에러를 던진다', async () => {
    const c = mockClient();
    (c.getProjectTypes as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: 1, name: 'TASK' }]);
    const t = buildIssueTools(c).find((x) => x.name === 'create_issue')!;
    await expect(t.handler({ projectKey: 'WP', title: 'x', type: 'BUG' })).rejects.toThrow(
      "유형 'BUG'",
    );
    expect(c.createIssue).not.toHaveBeenCalled();
  });

  it('add_comment → getIssueDetail 로 issueId 조회 후 addIssueComment 호출', async () => {
    const c = mockClient();
    const t = buildIssueTools(c).find((x) => x.name === 'add_comment')!;
    const out = await t.handler({ issueKey: 'WP-12', body: '코멘트' });
    expect(c.getIssueDetail).toHaveBeenCalledWith('WP', 12);
    expect(c.addIssueComment).toHaveBeenCalledWith(42, '코멘트');
    expect(out).toBe('ok');
  });

  it('edit_comment 는 issueKey 로 issueId 를 얻어 코멘트를 수정한다', async () => {
    const c = mockClient(); // getIssueDetail → summary.id: 42
    (c.editIssueComment as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    const t = buildIssueTools(c).find((x) => x.name === 'edit_comment')!;
    const out = await t.handler({ issueKey: 'WP-12', commentId: 7, body: '수정된 코멘트' });
    expect(c.getIssueDetail).toHaveBeenCalledWith('WP', 12);
    expect(c.editIssueComment).toHaveBeenCalledWith(42, 7, '수정된 코멘트');
    expect(out).toBe('ok');
  });

  it('update_issue 는 지정된 필드만 각 엔드포인트로 팬아웃하고 결과를 구조화한다', async () => {
    const c = mockClient();
    (c.getProjectTypes as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: 2, name: 'BUG' }]);
    (c.getProjectMembers as ReturnType<typeof vi.fn>).mockResolvedValue([
      { userId: 11, username: 'bob' },
    ]);
    (c.getProjectLabels as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: 5, name: 'urgent' }]);
    (c.updateIssue as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (c.setIssueType as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    (c.replaceIssueAssignees as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (c.replaceIssueLabels as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    const t = buildIssueTools(c).find((x) => x.name === 'update_issue')!;
    const out = JSON.parse(
      await t.handler({
        issueKey: 'WP-12',
        title: '수정',
        status: 'IN_PROGRESS',
        type: 'BUG',
        assignees: ['bob'],
        labels: ['urgent'],
      }),
    );
    expect(c.updateIssue).toHaveBeenCalledWith('WP', 12, { title: '수정', status: 'IN_PROGRESS' });
    expect(c.setIssueType).toHaveBeenCalledWith('WP', 12, 2);
    expect(c.replaceIssueAssignees).toHaveBeenCalledWith('WP', 12, [11]);
    expect(c.replaceIssueLabels).toHaveBeenCalledWith('WP', 12, [5]);
    expect(out).toEqual({
      ok: true,
      results: { content: 'ok', type: 'ok', assignees: 'ok', labels: 'ok' },
    });
  });

  it('update_issue 는 parent:null 로 부모를 해제한다', async () => {
    const c = mockClient();
    (c.setIssueParent as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    const t = buildIssueTools(c).find((x) => x.name === 'update_issue')!;
    const out = JSON.parse(await t.handler({ issueKey: 'WP-12', parent: null }));
    expect(c.setIssueParent).toHaveBeenCalledWith('WP', 12, null);
    expect(out).toEqual({ ok: true, results: { parent: 'ok' } });
  });

  it('update_issue 는 한 단계 실패 시 ok:false 로 부분 결과를 보고한다', async () => {
    const c = mockClient();
    (c.updateIssue as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (c.setIssueParent as ReturnType<typeof vi.fn>).mockRejectedValue({
      response: { data: 'EPIC 은 부모를 가질 수 없습니다' },
    });
    const t = buildIssueTools(c).find((x) => x.name === 'update_issue')!;
    const out = JSON.parse(await t.handler({ issueKey: 'WP-12', title: 'x', parent: 99 }));
    expect(out.ok).toBe(false);
    expect(out.results.content).toBe('ok');
    expect(out.results.parent).toContain('EPIC 은 부모를 가질 수 없습니다');
  });

  it('update_issue 는 리졸브 실패 시 아무 쓰기도 하지 않고 에러를 던진다', async () => {
    const c = mockClient();
    (c.getProjectTypes as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: 1, name: 'TASK' }]);
    const t = buildIssueTools(c).find((x) => x.name === 'update_issue')!;
    await expect(t.handler({ issueKey: 'WP-12', type: 'BUG', title: 'x' })).rejects.toThrow(
      "유형 'BUG'",
    );
    expect(c.updateIssue).not.toHaveBeenCalled();
  });

  describe('add_issue_dependency', () => {
    it('같은 프로젝트 이슈 간 의존성을 추가하고 갱신된 상세를 반환한다', async () => {
      const c = mockClient();
      const t = buildIssueTools(c).find((x) => x.name === 'add_issue_dependency')!;
      const out = await t.handler({ issueKey: 'WP-12', otherIssueKey: 'WP-7', direction: 'blocks' });
      expect(c.addIssueDependency).toHaveBeenCalledWith('WP', 12, 7, 'blocks');
      expect(JSON.parse(out)).toEqual({ summary: { id: 42, blocks: [{ number: 7 }] } });
    });

    it('프로젝트가 다르면 API 호출 없이 에러를 던진다', async () => {
      const c = mockClient();
      const t = buildIssueTools(c).find((x) => x.name === 'add_issue_dependency')!;
      await expect(
        t.handler({ issueKey: 'WP-12', otherIssueKey: 'OTHER-7', direction: 'blocks' }),
      ).rejects.toThrow('동일 프로젝트 이슈 간에만 의존성을 설정할 수 있습니다.');
      expect(c.addIssueDependency).not.toHaveBeenCalled();
    });
  });

  describe('remove_issue_dependency', () => {
    it('의존성을 제거하고 ok 를 반환한다', async () => {
      const c = mockClient();
      const t = buildIssueTools(c).find((x) => x.name === 'remove_issue_dependency')!;
      const out = await t.handler({ issueKey: 'WP-12', otherIssueKey: 'WP-7', direction: 'blockedBy' });
      expect(c.removeIssueDependency).toHaveBeenCalledWith('WP', 12, 7, 'blockedBy');
      expect(out).toBe('ok');
    });
  });
});
