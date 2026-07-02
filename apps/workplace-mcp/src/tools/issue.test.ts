import { describe, expect, it, vi } from 'vitest';
import { buildIssueTools, parseIssueKey } from './issue.js';
import { mockPatApiClient } from './test-support.js';

/** 테스트용 mock PatApiClient — 각 메서드 호출 인자를 검증하기 위한 vi.fn 래핑(이슈 메서드만 응답 값 설정). */
function mockClient() {
  const client = mockPatApiClient();
  (client.listProjects as ReturnType<typeof vi.fn>).mockResolvedValue([{ key: 'WP' }]);
  (client.getProject as ReturnType<typeof vi.fn>).mockResolvedValue({ key: 'WP' });
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
    expect(JSON.parse(out)).toEqual({ key: 'WP' });
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

  it('add_comment → getIssueDetail 로 issueId 조회 후 addIssueComment 호출', async () => {
    const c = mockClient();
    const t = buildIssueTools(c).find((x) => x.name === 'add_comment')!;
    const out = await t.handler({ issueKey: 'WP-12', body: '코멘트' });
    expect(c.getIssueDetail).toHaveBeenCalledWith('WP', 12);
    expect(c.addIssueComment).toHaveBeenCalledWith(42, '코멘트');
    expect(out).toBe('ok');
  });

  it('update_status 는 issueKey 를 projectKey/number 로 분해한다', async () => {
    const c = mockClient();
    const t = buildIssueTools(c).find((x) => x.name === 'update_status')!;
    const out = await t.handler({ issueKey: 'WP-12', status: 'DONE' });
    expect(c.updateIssueStatus).toHaveBeenCalledWith('WP', 12, 'DONE');
    expect(out).toBe('ok');
  });

  it('update_status 는 허용되지 않은 status 값을 거부한다', async () => {
    const c = mockClient();
    const t = buildIssueTools(c).find((x) => x.name === 'update_status')!;
    await expect(t.handler({ issueKey: 'WP-12', status: 'INVALID' })).rejects.toThrow();
    expect(c.updateIssueStatus).not.toHaveBeenCalled();
  });
});
