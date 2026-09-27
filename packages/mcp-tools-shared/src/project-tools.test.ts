import { describe, expect, it, vi } from 'vitest';
import { buildProjectTools, toIssueListItem } from './project-tools.js';
import type { ProjectToolClient } from './tool-client.js';

/** 프로젝트·이슈 목록 클라이언트 mock. */
function mockClient(): ProjectToolClient {
  return {
    listProjects: vi.fn().mockResolvedValue([{ key: 'WP' }]),
    getProject: vi.fn().mockResolvedValue({ key: 'WP' }),
    getProjectTypes: vi.fn().mockResolvedValue([]),
    getProjectLabels: vi.fn().mockResolvedValue([]),
    getProjectMembers: vi.fn().mockResolvedValue([]),
    getProjectMilestones: vi.fn().mockResolvedValue([]),
    getProjectCycles: vi.fn().mockResolvedValue([]),
    listIssues: vi.fn().mockResolvedValue([]),
    updateProject: vi.fn().mockResolvedValue({ key: 'WP' }),
  };
}

const tool = (c: ProjectToolClient, name: string) => buildProjectTools(c).find((x) => x.name === name)!;
/** listIssues 에 실제 전달된 쿼리 객체(undefined 키 유무까지 보려고 toStrictEqual 로 비교한다). */
const issueQuery = (c: ProjectToolClient) => vi.mocked(c.listIssues).mock.calls[0][0];

describe('list_projects', () => {
  it('기본 page 0 / size 50 으로 client.listProjects 호출', async () => {
    const c = mockClient();
    const out = await tool(c, 'list_projects').handler({});
    expect(c.listProjects).toHaveBeenCalledWith(0, 50);
    expect(JSON.parse(out)).toEqual([{ key: 'WP' }]);
  });

  it('page/size 지정 시 그대로 전달', async () => {
    const c = mockClient();
    await tool(c, 'list_projects').handler({ page: 2, size: 10 });
    expect(c.listProjects).toHaveBeenCalledWith(2, 10);
  });
});

describe('get_project', () => {
  it('projectKey 로 조회하고 빈 메타는 빈 배열로 동봉한다', async () => {
    const c = mockClient();
    const out = JSON.parse(await tool(c, 'get_project').handler({ projectKey: 'WP' }));
    expect(c.getProject).toHaveBeenCalledWith('WP');
    expect(out).toEqual({ key: 'WP', issueTypes: [], labels: [], milestones: [], cycles: [], members: [] });
  });

  it('옛 파라미터 key 는 거부한다(projectKey 만)', async () => {
    const c = mockClient();
    await expect(tool(c, 'get_project').handler({ key: 'WP' })).rejects.toThrow();
    expect(c.getProject).not.toHaveBeenCalled();
  });

  it('#844: 이슈 유형·라벨은 이름 목록, 멤버는 username·name·role 만(숫자 userId 없음) 동봉한다', async () => {
    const c = mockClient();
    vi.mocked(c.getProject).mockResolvedValue({ key: 'WP', name: '워크플레이스', description: null, type: 'TEAM' });
    vi.mocked(c.getProjectTypes).mockResolvedValue([
      { id: 1, name: 'TASK' },
      { id: 2, name: 'BUG' },
    ]);
    vi.mocked(c.getProjectLabels).mockResolvedValue([{ id: 3, name: 'frontend' }]);
    vi.mocked(c.getProjectMilestones).mockResolvedValue([{ id: 4, name: 'v1.0' }]);
    vi.mocked(c.getProjectCycles).mockResolvedValue([{ id: 5, name: 'Sprint 3', status: 'ACTIVE' }]);
    vi.mocked(c.getProjectMembers).mockResolvedValue([
      { userId: 1010, username: 'alice', name: 'Alice', role: 'OWNER' } as { userId: number; username: string },
    ]);
    const raw = await tool(c, 'get_project').handler({ projectKey: 'WP' });
    expect(JSON.parse(raw)).toEqual({
      key: 'WP',
      name: '워크플레이스',
      description: null,
      type: 'TEAM',
      issueTypes: ['TASK', 'BUG'],
      labels: ['frontend'],
      milestones: ['v1.0'],
      cycles: [{ name: 'Sprint 3', status: 'ACTIVE' }],
      members: [{ username: 'alice', name: 'Alice', role: 'OWNER' }],
    });
    expect(raw).not.toContain('userId');
    expect(raw).not.toContain('1010');
    for (const fn of [c.getProjectTypes, c.getProjectLabels, c.getProjectMilestones, c.getProjectCycles, c.getProjectMembers]) {
      expect(fn).toHaveBeenCalledWith('WP');
    }
  });
});

describe('list_issues', () => {
  it('assignee·reporter 모두 생략 시 assignee=me, 기본 size 30, undefined 필드는 쿼리에 없다', async () => {
    const c = mockClient();
    await tool(c, 'list_issues').handler({ status: 'TODO' });
    expect(issueQuery(c)).toStrictEqual({ status: 'TODO', assignee: 'me', size: 30 });
  });

  it('reporter 만 있으면 assignee 기본값을 붙이지 않는다 (#519/#841)', async () => {
    const c = mockClient();
    await tool(c, 'list_issues').handler({ reporter: 'user42' });
    expect(issueQuery(c)).toStrictEqual({ reporter: 'user42', size: 30 });
  });

  it('명시한 assignee 는 그대로 쓴다', async () => {
    const c = mockClient();
    await tool(c, 'list_issues').handler({ assignee: 'null', reporter: 'me' });
    expect(issueQuery(c)).toStrictEqual({ assignee: 'null', reporter: 'me', size: 30 });
  });

  it('#841: projectKey·label·type 은 그대로, priority 는 CSV 로 합쳐 서버에 전달한다', async () => {
    const c = mockClient();
    await tool(c, 'list_issues').handler({
      projectKey: 'WP',
      label: '버그',
      type: 'BUG',
      priority: ['HIGH', 'MID'],
      blocked: false,
      size: 10,
    });
    expect(issueQuery(c)).toStrictEqual({
      projectKey: 'WP',
      label: '버그',
      type: 'BUG',
      blocked: false,
      priority: 'HIGH,MID',
      assignee: 'me',
      size: 10,
    });
  });

  it('빈 priority 배열은 쿼리에 싣지 않는다', async () => {
    const c = mockClient();
    await tool(c, 'list_issues').handler({ priority: [] });
    expect(issueQuery(c)).not.toHaveProperty('priority');
  });

  it('#519 priority MID 는 통과하고 MEDIUM/CRITICAL 은 zod 파싱에서 거부된다', async () => {
    const c = mockClient();
    await expect(tool(c, 'list_issues').handler({ priority: ['MID'] })).resolves.toBeDefined();
    await expect(tool(c, 'list_issues').handler({ priority: ['MEDIUM'] })).rejects.toThrow();
    await expect(tool(c, 'list_issues').handler({ priority: ['CRITICAL'] })).rejects.toThrow();
  });

  it('응답 항목은 toIssueListItem 형태 — assignees 는 username/name/kind 만, 숫자 id 없음', async () => {
    const c = mockClient();
    vi.mocked(c.listIssues).mockResolvedValue([
      {
        id: 9001,
        projectKey: 'WP',
        number: 3,
        title: '버그',
        status: 'IN_PROGRESS',
        priority: 'HIGH',
        assignees: [{ id: 5005, username: 'alice', name: 'Alice', kind: 'HUMAN' }],
        dueDate: '2026-10-01',
        type: 'BUG',
        blocked: true,
      },
    ]);
    const raw = await tool(c, 'list_issues').handler({ status: 'IN_PROGRESS' });
    expect(JSON.parse(raw)).toEqual([
      {
        issueKey: 'WP-3',
        title: '버그',
        status: 'IN_PROGRESS',
        priority: 'HIGH',
        assignees: [{ username: 'alice', name: 'Alice', kind: 'HUMAN' }],
        dueDate: '2026-10-01',
        type: 'BUG',
        blocked: true,
      },
    ]);
    expect(raw).not.toContain('9001');
    expect(raw).not.toContain('5005');
  });
});

describe('toIssueListItem', () => {
  it('issueKey 가 있으면 그대로 쓰고, 누락 필드는 기본값으로 채운다', () => {
    expect(toIssueListItem({ issueKey: 'AB-1', assignees: [{ username: 'bob' }] })).toEqual({
      issueKey: 'AB-1',
      title: '',
      status: '',
      priority: '',
      assignees: [{ username: 'bob', name: 'bob', kind: 'HUMAN' }],
      dueDate: null,
      type: null,
      blocked: false,
    });
  });

  it('assignees 가 배열이 아니면 빈 배열', () => {
    expect(toIssueListItem({ projectKey: 'WP', number: 1, assignees: null }).assignees).toEqual([]);
  });
});

describe('update_project (#854)', () => {
  // 서버 PATCH 는 name 필수·description 생략=null 덮어쓰기라, 병합을 빠뜨리면 이름만 바꿔도 설명이 지워진다.
  it('이름만 주면 현재 설명을 유지해 보낸다', async () => {
    const c = mockClient();
    vi.mocked(c.getProject).mockResolvedValue({ key: 'WP', name: '옛 이름', description: '기존 설명' });
    await tool(c, 'update_project').handler({ projectKey: 'WP', name: '새 이름' });
    expect(c.updateProject).toHaveBeenCalledWith('WP', { name: '새 이름', description: '기존 설명' });
  });

  it('설명만 주면 현재 이름을 유지하고, description null 은 설명을 비운다', async () => {
    const c = mockClient();
    vi.mocked(c.getProject).mockResolvedValue({ key: 'WP', name: '이름', description: '기존 설명' });
    await tool(c, 'update_project').handler({ projectKey: 'WP', description: '새 설명' });
    await tool(c, 'update_project').handler({ projectKey: 'WP', description: null });
    expect(vi.mocked(c.updateProject).mock.calls).toEqual([
      ['WP', { name: '이름', description: '새 설명' }],
      ['WP', { name: '이름', description: null }],
    ]);
  });

  it('바꿀 필드가 없으면 거절한다', async () => {
    const c = mockClient();
    await expect(tool(c, 'update_project').handler({ projectKey: 'WP' })).rejects.toThrow();
    expect(c.updateProject).not.toHaveBeenCalled();
  });
});
