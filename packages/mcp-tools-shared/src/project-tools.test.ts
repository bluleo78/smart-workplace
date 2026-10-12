import { describe, expect, it, vi } from 'vitest';
import { buildProjectTools, toIssueListItem } from './project-tools.js';
import type { MemberToolClient, ProjectToolClient } from './tool-client.js';
import { resultText } from './mcp-content.js';

type Client = ProjectToolClient & Pick<MemberToolClient, 'searchMembers'>;

/** 멤버 추가 대상 해석용 구성원 디렉터리(검색어와 username 이 정확히 같은 행만 돌려준다). */
const DIRECTORY = [
  { userId: 5, username: 'minsu', name: '김민수', active: true },
  { userId: 9, username: 'retired', name: '퇴사자', active: false },
];

/** 프로젝트·이슈 목록 클라이언트 mock. */
function mockClient(): Client {
  return {
    searchMembers: vi.fn(async ({ search }: { search?: string }) => DIRECTORY.filter((m) => m.username === search)),
    createProject: vi.fn().mockResolvedValue({ key: 'NEW', name: '새 프로젝트' }),
    addProjectMember: vi.fn().mockResolvedValue({ userId: 5, username: 'minsu', name: '김민수', role: 'MEMBER', kind: 'HUMAN' }),
    listProjects: vi.fn().mockResolvedValue({ items: [{ key: 'WP' }], total: 1, hasMore: false, page: 0 }),
    getProject: vi.fn().mockResolvedValue({ key: 'WP' }),
    getProjectTypes: vi.fn().mockResolvedValue([]),
    getProjectLabels: vi.fn().mockResolvedValue([]),
    getProjectMembers: vi.fn().mockResolvedValue([]),
    getProjectMilestones: vi.fn().mockResolvedValue([]),
    getProjectCycles: vi.fn().mockResolvedValue([]),
    listIssues: vi.fn().mockResolvedValue({ items: [] }),
    updateProject: vi.fn().mockResolvedValue({ key: 'WP' }),
  };
}

const tool = (c: Client, name: string) => buildProjectTools(c).find((x) => x.name === name)!;
/** listIssues 에 실제 전달된 쿼리 객체(undefined 키 유무까지 보려고 toStrictEqual 로 비교한다). */
const issueQuery = (c: Client) => vi.mocked(c.listIssues).mock.calls[0][0];

describe('list_projects', () => {
  it('기본 page 0 / size 50 으로 client.listProjects 호출', async () => {
    const c = mockClient();
    const out = await tool(c, 'list_projects').handler({});
    expect(c.listProjects).toHaveBeenCalledWith(0, 50);
    // 마지막 페이지면 total 만 싣고 hasMore·nextPage 는 생략한다(WP-352).
    expect(JSON.parse(resultText(out))).toEqual({ items: [{ key: 'WP' }], total: 1 });
  });

  it('page/size 지정 시 그대로 전달', async () => {
    const c = mockClient();
    await tool(c, 'list_projects').handler({ page: 2, size: 10 });
    expect(c.listProjects).toHaveBeenCalledWith(2, 10);
  });

  it('WP-352: 다음 페이지가 있으면 hasMore:true 와 nextPage(다음 page 인자)·total 을 싣는다', async () => {
    const c = mockClient();
    vi.mocked(c.listProjects).mockResolvedValue({ items: [{ key: 'WP' }], total: 120, hasMore: true, page: 1 });
    const out = JSON.parse(resultText(await tool(c, 'list_projects').handler({ page: 1, size: 50 })));
    expect(out).toEqual({ items: [{ key: 'WP' }], total: 120, hasMore: true, nextPage: 2 });
  });

  it('WP-352: 설명이 이어 조회하거나 잘렸다고 알리라고 안내한다', () => {
    const d = tool(mockClient(), 'list_projects').description;
    expect(d).toContain('nextPage');
    expect(d).toContain('일부만 담겼다고 밝히세요');
  });
});

describe('get_project', () => {
  it('projectKey 로 조회하고 빈 메타는 빈 배열로 동봉한다', async () => {
    const c = mockClient();
    const out = JSON.parse(resultText(await tool(c, 'get_project').handler({ projectKey: 'WP' })));
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
    expect(JSON.parse(resultText(raw))).toEqual({
      key: 'WP',
      name: '워크플레이스',
      type: 'TEAM', // description:null 은 값이 없는 키라 생략된다(WP-353)
      issueTypes: ['TASK', 'BUG'],
      labels: ['frontend'],
      milestones: ['v1.0'],
      cycles: [{ name: 'Sprint 3', status: 'ACTIVE' }],
      members: [{ username: 'alice', name: 'Alice', role: 'OWNER' }],
    });
    expect(resultText(raw)).not.toContain('userId');
    expect(resultText(raw)).not.toContain('1010');
    for (const fn of [c.getProjectTypes, c.getProjectLabels, c.getProjectMilestones, c.getProjectCycles, c.getProjectMembers]) {
      expect(fn).toHaveBeenCalledWith('WP');
    }
  });
});

describe('프로젝트 정리 뷰 (WP-353)', () => {
  // 서버 ProjectResponse 형태 — id·ownerId·memberNames·isDefault:false·description:null 은 LLM 에 쓸모없다.
  const row = {
    id: 5, key: 'WP', name: '워크플레이스', description: null, ownerId: 9, type: 'TEAM', isDefault: false,
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z', issueTotal: 10, issueDone: 4, memberCount: 3, memberNames: ['앨리스', '밥', '캐롤'], viewerIsMember: true,
  };

  it('list_projects 는 id·ownerId·memberNames 와 값이 없는/기본값 키를 뺀다', async () => {
    const c = mockClient();
    vi.mocked(c.listProjects).mockResolvedValue({ items: [row], total: 1, hasMore: false, page: 0 });
    const out = JSON.parse(resultText(await tool(c, 'list_projects').handler({})));
    expect(out.items[0]).toEqual({
      key: 'WP', name: '워크플레이스', type: 'TEAM', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z',
      issueTotal: 10, issueDone: 4, memberCount: 3, viewerIsMember: true,
    });
    expect(JSON.stringify(out.items[0]).length).toBeLessThan(JSON.stringify(row).length * 0.8);
  });

  it('기본 프로젝트(isDefault:true)는 그 표시를 남긴다', async () => {
    const c = mockClient();
    vi.mocked(c.listProjects).mockResolvedValue({ items: [{ ...row, isDefault: true }], total: 1, hasMore: false, page: 0 });
    const out = JSON.parse(resultText(await tool(c, 'list_projects').handler({})));
    expect(out.items[0].isDefault).toBe(true);
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

  it('WP-176: assignee="any" 면 담당자 조건을 싣지 않는다(담당자 무관 조회)', async () => {
    const c = mockClient();
    await tool(c, 'list_issues').handler({ projectKey: 'WP', assignee: 'ANY' });
    expect(issueQuery(c)).toStrictEqual({ projectKey: 'WP', size: 30 });
  });

  it('WP-176: cycle none/backlog 는 서버 토큰(none/null)으로 바꾸고 사이클 조회 없이 보낸다', async () => {
    const c = mockClient();
    await tool(c, 'list_issues').handler({ cycle: 'none, Backlog' });
    expect(issueQuery(c)).toMatchObject({ cycle: 'none,null' });
    expect(c.getProjectCycles).not.toHaveBeenCalled();
  });

  it('WP-176: cycle 이름·active 는 projectKey 의 사이클로 id 를 해석한다', async () => {
    const c = mockClient();
    vi.mocked(c.getProjectCycles).mockResolvedValue([
      { id: 5, name: 'Sprint 3', status: 'ACTIVE' },
      { id: 6, name: 'Sprint 4', status: 'PLANNED' },
    ]);
    await tool(c, 'list_issues').handler({ projectKey: 'WP', cycle: 'active,Sprint 4,none' });
    expect(issueQuery(c)).toMatchObject({ projectKey: 'WP', cycle: '5,6,none' });
    expect(c.getProjectCycles).toHaveBeenCalledTimes(1);
  });

  it('WP-176: 활성 사이클이 없으면 필터가 빠진 결과 대신 오류를 낸다', async () => {
    const c = mockClient();
    vi.mocked(c.getProjectCycles).mockResolvedValue([{ id: 6, name: 'Sprint 4', status: 'PLANNED' }]);
    await expect(tool(c, 'list_issues').handler({ projectKey: 'WP', cycle: 'active' })).rejects.toThrow('활성');
    expect(c.listIssues).not.toHaveBeenCalled();
  });

  it('WP-176: 없는 사이클 이름은 사용 가능 목록을, projectKey 없는 이름은 안내를 담아 거부한다', async () => {
    const c = mockClient();
    vi.mocked(c.getProjectCycles).mockResolvedValue([{ id: 5, name: 'Sprint 3', status: 'ACTIVE' }]);
    await expect(tool(c, 'list_issues').handler({ projectKey: 'WP', cycle: 'Sprint 9' })).rejects.toThrow('사용 가능: Sprint 3');
    await expect(tool(c, 'list_issues').handler({ cycle: 'active' })).rejects.toThrow('projectKey');
    expect(c.listIssues).not.toHaveBeenCalled();
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
    vi.mocked(c.listIssues).mockResolvedValue({ items: [
      {
        id: 9001,
        projectKey: 'WP',
        number: 3,
        title: '버그',
        status: 'IN_PROGRESS',
        priority: 'HIGH',
        assignees: [{ id: 5005, username: 'alice', name: 'Alice', kind: 'HUMAN' }],
        dueDate: '2026-10-01',
        type: { id: 7, name: 'BUG', colorToken: 'RED', icon: 'Bug' },
        blocked: true,
      },
    ] });
    const raw = await tool(c, 'list_issues').handler({ status: 'IN_PROGRESS' });
    // #850: 값이 없는 키(null·빈 배열)는 생략된다. 다음 페이지가 없으면 hasMore·nextCursor 도 없다(WP-352).
    expect(JSON.parse(resultText(raw))).toEqual({ items: [
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
    ] });
    expect(raw).not.toContain('9001');
    expect(raw).not.toContain('5005');
  });

  it('WP-307: 날짜·라벨·마일스톤·부모·하위 진행률을 싣고, 시각은 KST·유형은 이름만', async () => {
    const c = mockClient();
    vi.mocked(c.listIssues).mockResolvedValue({ items: [
      {
        projectKey: 'WP',
        number: 4,
        title: '하위 작업',
        status: 'DONE',
        priority: 'MID',
        assignees: [],
        dueDate: '2026-10-10',
        startDate: '2026-10-01',
        createdAt: '2026-09-30T23:30:00Z',
        updatedAt: '2026-10-07T15:30:00Z',
        closedAt: '2026-10-07T15:30:00Z',
        type: { id: 6, name: 'TASK', colorToken: 'BLUE', icon: 'Circle' },
        labels: [{ id: 3, name: 'frontend', color: 'RED' }],
        milestoneName: 'v1.0',
        parent: { number: 1, title: '에픽', type: { name: 'EPIC' }, status: 'IN_PROGRESS' },
        childCount: 3,
        childDoneCount: 1,
        blocked: false,
      },
    ] });
    const {
      items: [item],
    } = JSON.parse(resultText(await tool(c, 'list_issues').handler({ projectKey: 'WP', closedFrom: '2026-10-08' })));
    expect(item).toEqual({
      issueKey: 'WP-4',
      title: '하위 작업',
      status: 'DONE',
      priority: 'MID',
      type: 'TASK',
      dueDate: '2026-10-10',
      startDate: '2026-10-01',
      createdAt: '2026-10-01T08:30:00+09:00',
      updatedAt: '2026-10-08T00:30:00+09:00',
      closedAt: '2026-10-08T00:30:00+09:00',
      labels: ['frontend'],
      milestone: 'v1.0',
      parent: { issueKey: 'WP-1', title: '에픽', status: 'IN_PROGRESS' },
      children: { total: 3, done: 1 },
      blocked: false,
    });
    expect(c.getProjectMilestones).not.toHaveBeenCalled();
    // 종료일 필터는 그대로 서버 쿼리로 간다.
    expect(issueQuery(c)).toMatchObject({ closedFrom: '2026-10-08' });
  });
});

describe('list_issues 페이지 (WP-352)', () => {
  const row = (number: number) => ({ projectKey: 'WP', number, title: `이슈 ${number}`, status: 'TODO', priority: 'MID', assignees: [] });

  it('다음 페이지가 없으면 { items } 만 — hasMore·nextCursor 키는 생략한다(null 도 싣지 않는다)', async () => {
    const c = mockClient();
    vi.mocked(c.listIssues).mockResolvedValue({ items: [row(1)], nextCursor: null, hasMore: false });
    const out = JSON.parse(resultText(await tool(c, 'list_issues').handler({})));
    expect(Object.keys(out)).toEqual(['items']);
    expect(out.items).toHaveLength(1);
  });

  it('size 를 안 줘도 기본 30건에서 잘리면 hasMore:true·nextCursor 로 알린다', async () => {
    const c = mockClient();
    vi.mocked(c.listIssues).mockResolvedValue({ items: [row(1), row(2)], nextCursor: 'abc==', hasMore: true });
    const out = JSON.parse(resultText(await tool(c, 'list_issues').handler({ projectKey: 'WP' })));
    expect(issueQuery(c)).toMatchObject({ size: 30 });
    expect(out).toMatchObject({ hasMore: true, nextCursor: 'abc==' });
    expect(out.items.map((i: { issueKey: string }) => i.issueKey)).toEqual(['WP-1', 'WP-2']);
  });

  it('cursor 입력은 서버 쿼리의 cursor 로 그대로 전달한다', async () => {
    const c = mockClient();
    await tool(c, 'list_issues').handler({ projectKey: 'WP', cursor: 'abc==', size: 100 });
    expect(issueQuery(c)).toMatchObject({ projectKey: 'WP', cursor: 'abc==', size: 100 });
  });

  it('cursor 를 안 주면 쿼리에 cursor 키가 없다', async () => {
    const c = mockClient();
    await tool(c, 'list_issues').handler({});
    expect(issueQuery(c)).not.toHaveProperty('cursor');
  });

  it('설명이 이어 조회하거나 잘렸다고 알리라고 안내한다(전부로 오해 금지)', () => {
    const d = tool(mockClient(), 'list_issues').description;
    expect(d).toContain('nextCursor');
    expect(d).toContain('cursor 로 넘겨');
    expect(d).toContain('일부만 담겼다고 밝히세요');
  });
});

describe('toIssueListItem', () => {
  it('issueKey 가 있으면 그대로 쓰고, 누락 필드는 기본값으로 채운다', () => {
    expect(toIssueListItem({ issueKey: 'AB-1', assignees: [{ username: 'bob' }] })).toEqual({
      issueKey: 'AB-1',
      title: '',
      status: '',
      priority: '',
      type: null,
      assignees: [{ username: 'bob', name: 'bob', kind: 'HUMAN' }],
      dueDate: null,
      startDate: null,
      createdAt: null,
      updatedAt: null,
      closedAt: null,
      labels: [],
      milestone: null,
      parent: null,
      children: null,
      blocked: false,
    });
  });

  it('assignees 가 배열이 아니면 빈 배열', () => {
    expect(toIssueListItem({ projectKey: 'WP', number: 1, assignees: null }).assignees).toEqual([]);
  });
});

describe('update_project (#854, #858)', () => {
  // 서버 PATCH 가 부분 수정이라(#858) 현재 값을 읽어 병합하지 않고 준 필드만 보낸다.
  it('이름만 주면 이름만 보내고 현재 값을 조회하지 않는다', async () => {
    const c = mockClient();
    await tool(c, 'update_project').handler({ projectKey: 'WP', name: '새 이름' });
    expect(c.updateProject).toHaveBeenCalledWith('WP', { name: '새 이름', description: undefined });
    expect(c.getProject).not.toHaveBeenCalled();
  });

  it('설명을 주면 설명만, description null 은 clearDescription 으로 보낸다', async () => {
    const c = mockClient();
    await tool(c, 'update_project').handler({ projectKey: 'WP', description: '새 설명' });
    await tool(c, 'update_project').handler({ projectKey: 'WP', description: null });
    expect(vi.mocked(c.updateProject).mock.calls).toEqual([
      ['WP', { name: undefined, description: '새 설명' }],
      ['WP', { name: undefined, clearDescription: true }],
    ]);
  });

  it('바꿀 필드가 없으면 거절한다', async () => {
    const c = mockClient();
    await expect(tool(c, 'update_project').handler({ projectKey: 'WP' })).rejects.toThrow();
    expect(c.updateProject).not.toHaveBeenCalled();
  });
});

describe('create_project (WP-349)', () => {
  it('projectKey 를 서버 필드 key 로 옮겨 POST /projects 하고 응답을 그대로 돌려준다', async () => {
    const c = mockClient();
    const out = await tool(c, 'create_project').handler({ projectKey: 'NEW', name: '새 프로젝트', type: 'OPEN' });
    expect(c.createProject).toHaveBeenCalledWith({ key: 'NEW', name: '새 프로젝트', type: 'OPEN' });
    expect(JSON.parse(resultText(out))).toEqual({ key: 'NEW', name: '새 프로젝트' });
  });

  it('서버 key 형식(대문자 시작 대문자·숫자 2~10자)이 아니면 부르지 않는다', async () => {
    const c = mockClient();
    for (const projectKey of ['wp', 'W', '1WP', 'ABCDEFGHIJK']) {
      await expect(tool(c, 'create_project').handler({ projectKey, name: 'n' }), projectKey).rejects.toThrow();
    }
    expect(c.createProject).not.toHaveBeenCalled();
  });
});

describe('add_project_member (WP-349)', () => {
  it('username 을 user id 로 해석해 추가하고, 결과에는 숫자 userId 없이 username·name·role 만 싣는다', async () => {
    const c = mockClient();
    const out = await tool(c, 'add_project_member').handler({ projectKey: 'WP', username: 'minsu' });
    expect(c.addProjectMember).toHaveBeenCalledWith('WP', { userId: 5, role: 'MEMBER' });
    expect(JSON.parse(resultText(out))).toEqual({ projectKey: 'WP', member: { username: 'minsu', name: '김민수', role: 'MEMBER' } });
  });

  it('없는 username·비활성 계정은 서버를 부르지 않고 교정 가능한 사유로 거절한다', async () => {
    const c = mockClient();
    await expect(tool(c, 'add_project_member').handler({ projectKey: 'WP', username: 'ghost' })).rejects.toThrow(
      "username='ghost' 인 구성원을 찾을 수 없습니다",
    );
    await expect(tool(c, 'add_project_member').handler({ projectKey: 'WP', username: 'retired' })).rejects.toThrow(
      '퇴사자(retired) 은 비활성 계정입니다',
    );
    expect(c.addProjectMember).not.toHaveBeenCalled();
  });

  it('OWNER 부여(권한 변경)는 확인 카드만 한다 — 입력에 role 이 없고 role 을 줘도 늘 MEMBER 로 추가한다', async () => {
    const c = mockClient();
    expect(Object.keys((tool(c, 'add_project_member').inputSchema as unknown as { shape: object }).shape)).toEqual(['projectKey', 'username']);
    await tool(c, 'add_project_member').handler({ projectKey: 'WP', username: 'minsu', role: 'OWNER' });
    expect(c.addProjectMember).toHaveBeenCalledWith('WP', { userId: 5, role: 'MEMBER' });
  });
});
