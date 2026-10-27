import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { buildSharedIssueTools } from './issue-tools.js';
import type { IssueToolClient } from './tool-client.js';
import { resultText } from './mcp-content.js';

/** 관계 유형 목록 mock(GET /issue-relation-types) — 기본 유형 일부 + 사용자 정의 유형 + 숨긴 유형. */
const relationType = (o: Record<string, unknown>) => ({ id: 0, code: null, name: '', directed: true, outwardLabel: '', inwardLabel: null, externalOnly: false, hidden: false, sortOrder: 1000, ...o });
const RELATION_TYPES = [
  relationType({ id: 1, code: 'BLOCKS', name: '차단', outwardLabel: '차단 중', inwardLabel: '차단됨', sortOrder: 10 }),
  relationType({ id: 2, code: 'RELATES', name: '관련', directed: false, outwardLabel: '관련', sortOrder: 20 }),
  relationType({ id: 3, code: 'DUPLICATES', name: '중복', outwardLabel: '중복임', inwardLabel: '원본임', sortOrder: 30 }),
  relationType({ id: 6, code: 'PARENT_EPIC', name: '상위 에픽', outwardLabel: '에픽에 속함', externalOnly: true, sortOrder: 60 }),
  relationType({ id: 9, name: '검토 요청', outwardLabel: '검토를 요청함', inwardLabel: '검토 요청받음' }),
  relationType({ id: 10, name: '옛 유형', outwardLabel: '옛', inwardLabel: '옛2', hidden: true }),
];

/** 프로젝트 구성요소 mock(GET /projects/{key}/components) — 사용 중 둘 + 보관 하나. */
const COMPONENTS = [
  { id: 21, name: 'Compute', archived: false, defaultAssignee: { username: 'alice' } },
  { id: 22, name: 'Storage', archived: false, defaultAssignee: null },
  { id: 23, name: '옛 구성요소', archived: true, defaultAssignee: null },
];

/** 프로젝트 버전 mock(GET /projects/{key}/versions) — 미출시·출시됨 + 보관 하나(WP-888). */
const VERSIONS = [
  { id: 31, name: 'v1.0', status: 'UNRELEASED' },
  { id: 32, name: 'v0.9', status: 'RELEASED' },
  { id: 33, name: 'v0.1', status: 'ARCHIVED' },
];

/** 전 메서드 vi.fn() 인 mock. 개별 테스트에서 필요한 것만 재설정. */
function mockClient(): IssueToolClient {
  return {
    getProjectTypes: vi.fn().mockResolvedValue([{ id: 2, name: 'BUG' }]),
    getProjectMembers: vi.fn().mockResolvedValue([{ userId: 10, username: 'alice' }]),
    getProject: vi.fn().mockResolvedValue({ key: 'WP', type: 'TEAM' }),
    getMe: vi.fn().mockResolvedValue({ id: 10, username: 'alice' }),
    getProjectLabels: vi.fn().mockResolvedValue([{ id: 100, name: 'urgent' }]),
    getProjectComponents: vi.fn().mockResolvedValue(COMPONENTS),
    getProjectVersions: vi.fn().mockResolvedValue(VERSIONS),
    replaceIssueComponents: vi.fn().mockResolvedValue([]),
    replaceIssueVersions: vi.fn().mockResolvedValue({ fixVersions: [], affectsVersions: [] }),
    getIssueDetail: vi.fn(),
    createIssue: vi.fn().mockResolvedValue({ ok: true }),
    updateIssueContent: vi.fn().mockResolvedValue({}),
    setIssueType: vi.fn().mockResolvedValue({}),
    setIssueParent: vi.fn().mockResolvedValue({}),
    replaceIssueAssignees: vi.fn().mockResolvedValue({}),
    changeIssueReporter: vi.fn().mockResolvedValue(undefined),
    replaceIssueLabels: vi.fn().mockResolvedValue({}),
    addComment: vi.fn().mockResolvedValue(undefined),
    reportAgentWork: vi.fn().mockResolvedValue({ work: null, ended: true }),
    editComment: vi.fn().mockResolvedValue(undefined),
    addIssueDependency: vi.fn().mockResolvedValue({ summary: { title: 't', status: 'TODO', priority: 'MID', assignees: [] } }),
    removeIssueDependency: vi.fn().mockResolvedValue(undefined),
    addCommentReaction: vi.fn().mockResolvedValue(undefined),
    removeCommentReaction: vi.fn().mockResolvedValue(undefined),
    addIssueRelation: vi.fn().mockResolvedValue([]),
    removeIssueRelation: vi.fn().mockResolvedValue(undefined),
    addIssueExternalLink: vi.fn().mockResolvedValue([]),
    removeIssueExternalLink: vi.fn().mockResolvedValue(undefined),
    listIssueRelationTypes: vi.fn().mockResolvedValue(RELATION_TYPES),
    getProjectMilestones: vi.fn().mockResolvedValue([{ id: 7, name: 'v1.0' }]),
    getProjectCycles: vi.fn().mockResolvedValue([{ id: 30, name: 'Sprint 3' }]),
    replaceIssueCycles: vi.fn().mockResolvedValue([]),
    getIssueCycles: vi.fn().mockResolvedValue([]),
    watchIssue: vi.fn().mockResolvedValue(undefined),
    unwatchIssue: vi.fn().mockResolvedValue(undefined),
    getIssueWatchers: vi.fn().mockResolvedValue([]),
    getIssueDriveLinks: vi.fn().mockResolvedValue([]),
    getIssueChatThreadId: vi.fn().mockResolvedValue(55),
    getIssueChatThread: vi.fn().mockResolvedValue({ threadId: 55, members: [] }),
    addIssueChatMessage: vi.fn().mockResolvedValue(undefined),
    searchMembers: vi.fn().mockResolvedValue([]),
    listIssueChatMessages: vi.fn().mockResolvedValue({ items: [], nextCursor: null, hasMore: false }),
    getProjectFields: vi.fn().mockResolvedValue([
      { id: 8, name: '고객사', type: 'SELECT', options: ['A사', 'B사'] },
      { id: 9, name: '견적', type: 'NUMBER', options: null },
      { id: 10, name: '태그', type: 'MULTI_SELECT', options: ['x', 'y'] },
    ]),
    updateIssueFields: vi.fn().mockResolvedValue({}),
    getProjectStatuses: vi.fn().mockResolvedValue([
      { id: 10, name: '할 일', category: 'TODO', position: 0 },
      { id: 11, name: '진행 중', category: 'IN_PROGRESS', position: 1 },
      { id: 12, name: '검토 중', category: 'IN_PROGRESS', position: 2 },
    ]),
    addIssueDriveLink: vi.fn().mockResolvedValue(undefined),
    claimIssueAttachments: vi.fn().mockResolvedValue([]),
    claimIssue: vi.fn().mockResolvedValue({ assignees: [], labels: [] }),
  };
}

describe('buildSharedIssueTools', () => {
  it('정확히 13종을 반환한다', () => {
    const names = buildSharedIssueTools(mockClient()).map((t) => t.name).sort();
    expect(names).toEqual(
      [
        'add_comment',
        'add_issue_chat',
        'link_issues',
        'add_issue_relation',
        'claim_issue',
        'create_issue',
        'update_comment',
        'get_issue_chat',
        'get_issue_detail',
        'remove_issue_relation',
        'report_agent_work',
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
    expect(detail.description).toMatch(/up to 200 comments/);
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

  it('add_comment·update_comment 는 @username 을 멘션 토큰으로 바꿔 보낸다 — 멘션된 사람·AI 가 알림을 받게(WP-720)', async () => {
    const c = mockClient();
    vi.mocked(c.searchMembers).mockImplementation(async ({ search }) =>
      [{ userId: 9, username: 'teamleader', name: 'AI 팀장', kind: 'AGENT' }].filter((m) => m.username.includes(String(search))),
    );
    const tools = buildSharedIssueTools(c);
    await tools.find((x) => x.name === 'add_comment')!.handler({ issueKey: 'WP-12', body: '@teamleader 리뷰 부탁해요' });
    expect(c.addComment).toHaveBeenCalledWith('WP-12', '<@9> 리뷰 부탁해요');
    await tools.find((x) => x.name === 'update_comment')!.handler({ issueKey: 'WP-12', commentId: 3, body: '@teamleader 다시 봐 주세요' });
    expect(c.editComment).toHaveBeenCalledWith('WP-12', 3, '<@9> 다시 봐 주세요');
  });

  describe('report_agent_work', () => {
    const reportTool = (c: IssueToolClient) => buildSharedIssueTools(c).find((x) => x.name === 'report_agent_work')!;

    it('issueKey 를 뺀 본문을 reportAgentWork 로 넘기고 work.state 를 돌려준다', async () => {
      const c = mockClient();
      vi.mocked(c.reportAgentWork).mockResolvedValue({
        work: { worker: { id: 7, username: 'claude', name: 'Claude', kind: 'AI' }, tool: 'mcp', state: 'INPUT_REQUIRED', updatedAt: '2026-10-14T00:00:00Z' },
        ended: false,
      });
      const out = JSON.parse(resultText(await reportTool(c).handler({ issueKey: 'WP-12', state: 'INPUT_REQUIRED', message: '질문' })));
      expect(c.reportAgentWork).toHaveBeenCalledWith('WP-12', { state: 'INPUT_REQUIRED', message: '질문' });
      expect(out.work.state).toBe('INPUT_REQUIRED');
      expect(out.work.worker).toEqual({ username: 'claude', name: 'Claude', kind: 'AI' });
    });

    it('message 의 @username 을 멘션 토큰 <@id> 로 바꿔 보낸다 — 메일 형식 username 도, 일반 메일 주소는 그대로(WP-1009)', async () => {
      const c = mockClient();
      vi.mocked(c.searchMembers).mockImplementation(async ({ search }) =>
        [
          { userId: 7, username: 'dh.yang@iacloud.kr', name: '양동희', kind: 'HUMAN' },
          { userId: 9, username: 'teamleader', name: 'AI 팀장', kind: 'AGENT' },
        ].filter((m) => m.username.includes(String(search))),
      );
      await reportTool(c).handler({
        issueKey: 'WP-12',
        state: 'REVIEW',
        message: '@teamleader 리뷰 부탁해요. @dh.yang@iacloud.kr 님 참고 — 문의는 help@iacloud.kr',
      });
      expect(c.reportAgentWork).toHaveBeenCalledWith('WP-12', {
        state: 'REVIEW',
        message: '<@9> 리뷰 부탁해요. <@7> 님 참고 — 문의는 help@iacloud.kr',
      });
    });

    it('message 의 공백 든 표시 이름 멘션(@AI 개발자1)도 이름 전체를 <@id> 로 바꾼다(WP-1030)', async () => {
      const c = mockClient();
      vi.mocked(c.searchMembers).mockImplementation(async ({ search }) =>
        [
          { userId: 11, username: 'developer1', name: 'AI 개발자1', kind: 'AGENT' },
          { userId: 20, username: 'developer10', name: 'AI 개발자10', kind: 'AGENT' },
        ].filter((m) => m.username.includes(String(search)) || m.name.includes(String(search))),
      );
      await reportTool(c).handler({ issueKey: 'WP-12', state: 'REVIEW', message: '@AI 개발자1님 리뷰 부탁, @AI 개발자10(developer10) 참고' });
      expect(c.reportAgentWork).toHaveBeenCalledWith('WP-12', { state: 'REVIEW', message: '<@11>님 리뷰 부탁, <@20> 참고' });
    });

    it('message 길이는 도구가 막지 않는다 — 멘션을 바꾼 뒤 글에 거는 서버 @Size 에 맡긴다', async () => {
      const c = mockClient();
      await reportTool(c).handler({ issueKey: 'WP-12', state: 'WORKING', message: 'x'.repeat(4001) });
      expect(c.reportAgentWork).toHaveBeenCalled();
    });

    it('message 가 없으면 구성원을 찾지 않고, 찾기가 실패하면 원문 그대로 보낸다', async () => {
      const c = mockClient();
      await reportTool(c).handler({ issueKey: 'WP-12', state: 'WORKING', note: '진행' });
      expect(c.searchMembers).not.toHaveBeenCalled();
      vi.mocked(c.searchMembers).mockRejectedValue(new Error('boom'));
      await reportTool(c).handler({ issueKey: 'WP-12', state: 'WORKING', message: '@kodi 확인' });
      expect(c.reportAgentWork).toHaveBeenLastCalledWith('WP-12', { state: 'WORKING', message: '@kodi 확인' });
    });

    it.each(['COMPLETED', 'FAILED', 'CANCELED', 'REJECTED'])('%s 보고는 work 없이 ended:true 만 돌려준다', async (state) => {
      const c = mockClient();
      const out = JSON.parse(resultText(await reportTool(c).handler({ issueKey: 'WP-12', state })));
      expect(c.reportAgentWork).toHaveBeenCalledWith('WP-12', { state });
      expect(out).toEqual({ ended: true });
    });

    it('상태 12종(대기 중 WAITING 포함, WP-1024)을 받고 옛 ENDED 는 거절한다', async () => {
      const c = mockClient();
      for (const state of ['WORKING', 'INPUT_REQUIRED', 'AUTH_REQUIRED', 'BLOCKED', 'PAUSED', 'REVIEW', 'WAITING', 'SCHEDULED', 'COMPLETED', 'FAILED', 'CANCELED', 'REJECTED']) {
        await reportTool(c).handler({ issueKey: 'WP-12', state });
      }
      expect(c.reportAgentWork).toHaveBeenCalledTimes(12);
      await expect(reportTool(c).handler({ issueKey: 'WP-12', state: 'ENDED' })).rejects.toThrow();
      expect(c.reportAgentWork).toHaveBeenCalledTimes(12);
    });

    it('SCHEDULED 보고는 nextRunAt 을 그대로 넘기고 응답 시각은 KST 로 바꾼다', async () => {
      const c = mockClient();
      vi.mocked(c.reportAgentWork).mockResolvedValue({
        work: { worker: { id: 7, username: 'claude', name: 'Claude', kind: 'AI' }, tool: 'mcp', state: 'SCHEDULED', updatedAt: '2026-10-14T00:00:00Z', nextRunAt: '2026-10-19T00:00:00Z' },
        ended: false,
      });
      const out = JSON.parse(resultText(await reportTool(c).handler({ issueKey: 'WP-12', state: 'SCHEDULED', nextRunAt: '2026-10-19T09:00:00+09:00' })));
      expect(c.reportAgentWork).toHaveBeenCalledWith('WP-12', { state: 'SCHEDULED', nextRunAt: '2026-10-19T09:00:00+09:00' });
      expect(out.work.nextRunAt).toBe('2026-10-19T09:00:00+09:00');
    });

    it.each([
      ['2026-10-19T09:00:00+09:00', '2026-10-19T09:00:00+09:00'],
      ['2026-10-19T00:00:00Z', '2026-10-19T00:00:00Z'],
      ['2026-10-19T00:00Z', '2026-10-19T00:00Z'],
      ['2026-10-19T00:00:00.123Z', '2026-10-19T00:00:00.123Z'],
      ['2026-10-19T09:00:00', '2026-10-19T09:00:00+09:00'],
      ['2026-10-19T09:00', '2026-10-19T09:00+09:00'],
    ])('nextRunAt %s 는 허용되고 %s 로 전송된다(오프셋 없으면 +09:00)', async (nextRunAt, sent) => {
      const c = mockClient();
      vi.mocked(c.reportAgentWork).mockResolvedValue({ work: null, ended: false });
      await reportTool(c).handler({ issueKey: 'WP-12', state: 'SCHEDULED', nextRunAt });
      expect(c.reportAgentWork).toHaveBeenCalledWith('WP-12', { state: 'SCHEDULED', nextRunAt: sent });
    });

    it.each([
      ['SCHEDULED 가 아닌 상태 + nextRunAt', { state: 'WORKING', nextRunAt: '2026-10-19T09:00:00+09:00' }],
      ['상태 없이 nextRunAt', { nextRunAt: '2026-10-19T09:00:00+09:00' }],
      ['RFC 2822 형식 nextRunAt', { state: 'SCHEDULED', nextRunAt: 'Mon, 19 Oct 2026 09:00:00 +09:00' }],
      ['공백 구분 nextRunAt', { state: 'SCHEDULED', nextRunAt: '2026-10-19 09:00' }],
      ['날짜가 아닌 nextRunAt', { state: 'SCHEDULED', nextRunAt: 'tomorrow' }],
    ])('nextRunAt 검증 실패: %s', async (_label, extra) => {
      const c = mockClient();
      await expect(reportTool(c).handler({ issueKey: 'WP-12', ...extra })).rejects.toThrow();
      expect(c.reportAgentWork).not.toHaveBeenCalled();
    });

    it('fileIds 는 message 와 함께 그대로 넘긴다(WP-515 — 챗 글 첨부)', async () => {
      const c = mockClient();
      await reportTool(c).handler({ issueKey: 'WP-12', state: 'INPUT_REQUIRED', message: 'A안/B안?', fileIds: [3, 4] });
      expect(c.reportAgentWork).toHaveBeenCalledWith('WP-12', { state: 'INPUT_REQUIRED', message: 'A안/B안?', fileIds: [3, 4] });
    });

    it.each([
      ['message 없이 fileIds', { state: 'REVIEW', fileIds: [3] }],
      ['공백 message + fileIds', { message: '   ', fileIds: [3] }],
      ['fileIds 11개', { message: '보고', fileIds: Array.from({ length: 11 }, (_, i) => i + 1) }],
    ])('fileIds 검증 실패: %s', async (_label, extra) => {
      const c = mockClient();
      await expect(reportTool(c).handler({ issueKey: 'WP-12', ...extra })).rejects.toThrow();
      expect(c.reportAgentWork).not.toHaveBeenCalled();
    });

    it.each([
      ['stepsDone 만', { stepsDone: 2 }],
      ['stepsTotal 만', { stepsTotal: 5 }],
      ['stepsDone > stepsTotal', { stepsDone: 6, stepsTotal: 5 }],
      ['progress 101', { progress: 101 }],
      ['note 121자', { note: 'a'.repeat(121) }],
    ])('입력 검증 실패: %s', async (_label, extra) => {
      const c = mockClient();
      await expect(reportTool(c).handler({ issueKey: 'WP-12', ...extra })).rejects.toThrow();
      expect(c.reportAgentWork).not.toHaveBeenCalled();
    });
  });

  it('WP-356: get_issue_detail 은 워처(username·name)와 드라이브 링크(driveFileId·이름)를 숫자 사용자 ID·core fileId 없이 동봉한다', async () => {
    const c = mockClient();
    vi.mocked(c.getIssueDetail).mockResolvedValue({ issueKey: 'WP-12', summary: { title: 'T' }, comments: [] });
    vi.mocked(c.getIssueWatchers).mockResolvedValue([{ userId: 4321, username: 'bob', name: '밥' }]);
    vi.mocked(c.getIssueDriveLinks).mockResolvedValue([
      { driveFileId: 77, fileId: 9911, name: '견적서.pdf', mimeType: 'application/pdf', sizeBytes: 10, hasThumbnail: false, spaceId: 3,
        spaceName: '영업', availability: 'ACTIVE', createdById: 4321, createdAt: '2026-10-01T00:00:00Z' },
      { driveFileId: 78, fileId: 9912, name: '옛 파일', spaceId: 3, spaceName: '영업', availability: 'TRASHED', createdById: 4321 },
    ]);
    const raw = resultText(await buildSharedIssueTools(c).find((t) => t.name === 'get_issue_detail')!.handler({ issueKey: 'WP-12' }));
    const out = JSON.parse(raw);
    expect(out.watchers).toEqual([{ username: 'bob', name: '밥' }]);
    expect(out.driveLinks).toEqual([
      { driveFileId: 77, name: '견적서.pdf', spaceName: '영업' },
      { driveFileId: 78, name: '옛 파일', spaceName: '영업', availability: 'TRASHED' },
    ]);
    expect(raw).not.toMatch(/4321|9911|createdById|"fileId"/);
    // 링크가 없으면 키를 싣지 않는다.
    vi.mocked(c.getIssueDriveLinks).mockResolvedValue([]);
    const none = JSON.parse(resultText(await buildSharedIssueTools(c).find((t) => t.name === 'get_issue_detail')!.handler({ issueKey: 'WP-12' })));
    expect(none).not.toHaveProperty('driveLinks');
  });

  it('WP-356: create_issue 는 labels·milestone·cycles 이름을 id 로 바꿔 생성 요청 한 번에 싣는다', async () => {
    const c = mockClient();
    const t = buildSharedIssueTools(c).find((x) => x.name === 'create_issue')!;
    await t.handler({ projectKey: 'WP', title: '새 이슈', labels: ['urgent'], milestone: 'v1.0', cycles: ['Sprint 3'] });
    expect(c.createIssue).toHaveBeenCalledTimes(1);
    expect(c.createIssue).toHaveBeenCalledWith('WP', expect.objectContaining({ labelIds: [100], milestoneId: 7, cycleIds: [30] }));
    // 후속 쓰기 호출이 없다(원자적 생성).
    expect(c.replaceIssueLabels).not.toHaveBeenCalled();
    expect(c.replaceIssueCycles).not.toHaveBeenCalled();
    expect(c.updateIssueContent).not.toHaveBeenCalled();
  });

  it('WP-356: create_issue 는 모르는 마일스톤·사이클이면 이슈를 만들지 않고 사용 가능 목록을 담아 throw', async () => {
    const c = mockClient();
    const t = buildSharedIssueTools(c).find((x) => x.name === 'create_issue')!;
    await expect(t.handler({ projectKey: 'WP', title: 'x', milestone: 'v9' })).rejects.toThrow('사용 가능: v1.0');
    await expect(t.handler({ projectKey: 'WP', title: 'x', cycles: ['S9'] })).rejects.toThrow('사용 가능: Sprint 3');
    expect(c.createIssue).not.toHaveBeenCalled();
  });

  it('WP-394: create_issue 는 없는 라벨을 이름으로 넘기고(서버가 만든다) 새로 생길 이름을 createdLabels 로 알린다', async () => {
    const c = mockClient();
    vi.mocked(c.createIssue).mockResolvedValue({ projectKey: 'WP', number: 5, title: '새 이슈', status: 'TODO', priority: 'MID', assignees: [], labels: [] });
    const t = buildSharedIssueTools(c).find((x) => x.name === 'create_issue')!;
    const out = JSON.parse(resultText(await t.handler({ projectKey: 'WP', title: '새 이슈', labels: [' urgent', 'ai-fix', 'ai-fix'] })));
    // 있는 라벨은 id(구버전 API 도 기존 라벨을 지우지 않게), 없는 라벨만 이름 — 서버가 만든다.
    expect(c.createIssue).toHaveBeenCalledWith('WP', expect.objectContaining({ labelIds: [100], labelNames: ['ai-fix'] }));
    expect(out.createdLabels).toEqual(['ai-fix']);
  });

  it('WP-394: create_issue 는 빈 라벨 이름·40자 초과면 이슈를 만들지 않고 throw', async () => {
    const c = mockClient();
    const t = buildSharedIssueTools(c).find((x) => x.name === 'create_issue')!;
    await expect(t.handler({ projectKey: 'WP', title: 'x', labels: [' '] })).rejects.toThrow('라벨 이름이 비어 있습니다.');
    await expect(t.handler({ projectKey: 'WP', title: 'x', labels: ['x'.repeat(41)] })).rejects.toThrow('40자 이하');
    expect(c.createIssue).not.toHaveBeenCalled();
  });

  it('WP-394: update_issue 는 있는 라벨 id·없는 라벨 이름으로 집합을 교체하고, 교체가 성공했을 때만 createdLabels 를 싣는다', async () => {
    const c = mockClient();
    const t = buildSharedIssueTools(c).find((x) => x.name === 'update_issue')!;
    const out = JSON.parse(resultText(await t.handler({ issueKey: 'WP-12', labels: ['urgent', 'ai-fix'] })));
    expect(c.replaceIssueLabels).toHaveBeenCalledWith('WP-12', [100], ['ai-fix']);
    expect(out).toEqual({ ok: true, results: { labels: 'ok' }, createdLabels: ['ai-fix'] });

    // 교체가 실패하면 서버 트랜잭션이 롤백돼 라벨도 생기지 않았다 — createdLabels 를 싣지 않는다.
    vi.mocked(c.replaceIssueLabels).mockRejectedValueOnce(new Error('이슈를 찾을 수 없습니다'));
    const failed = JSON.parse(resultText(await t.handler({ issueKey: 'WP-12', labels: ['ai-fix'] })));
    expect(failed).toEqual({ ok: false, results: { labels: 'failed: 이슈를 찾을 수 없습니다' } });
  });

  it('WP-933: create_issue 는 components 이름(대소문자 무시)을 componentIds 로 바꿔 생성 요청 한 번에 싣는다', async () => {
    const c = mockClient();
    const t = buildSharedIssueTools(c).find((x) => x.name === 'create_issue')!;
    await t.handler({ projectKey: 'WP', title: '새 이슈', components: ['compute', 'Storage'] });
    expect(c.getProjectComponents).toHaveBeenCalledWith('WP');
    expect(c.createIssue).toHaveBeenCalledTimes(1);
    expect(c.createIssue).toHaveBeenCalledWith('WP', expect.objectContaining({ componentIds: [21, 22] }));
    expect(c.replaceIssueComponents).not.toHaveBeenCalled();
  });

  it('WP-933: create_issue 는 components 를 안 주면 구성요소를 조회하지 않고 componentIds 도 보내지 않는다', async () => {
    const c = mockClient();
    const t = buildSharedIssueTools(c).find((x) => x.name === 'create_issue')!;
    await t.handler({ projectKey: 'WP', title: '새 이슈' });
    expect(c.getProjectComponents).not.toHaveBeenCalled();
    expect(vi.mocked(c.createIssue).mock.calls[0][1].componentIds).toBeUndefined();
  });

  it('WP-933: 없는 구성요소 이름이면 만들지 않고 이슈 생성 전에 사용 가능 목록을 담아 throw 한다', async () => {
    const c = mockClient();
    const t = buildSharedIssueTools(c).find((x) => x.name === 'create_issue')!;
    await expect(t.handler({ projectKey: 'WP', title: 'x', components: ['Network'] })).rejects.toThrow('사용 가능: Compute, Storage');
    expect(c.createIssue).not.toHaveBeenCalled();
  });

  it('WP-933: 보관된 구성요소 이름은 새로 붙일 수 없어 이슈 생성 전에 throw 한다', async () => {
    const c = mockClient();
    const t = buildSharedIssueTools(c).find((x) => x.name === 'create_issue')!;
    await expect(t.handler({ projectKey: 'WP', title: 'x', components: ['옛 구성요소'] })).rejects.toThrow('보관');
    expect(c.createIssue).not.toHaveBeenCalled();
  });

  it('WP-933: update_issue 는 components 를 집합 교체로 PUT 하고 결과에 components 를 싣는다', async () => {
    const c = mockClient();
    const t = buildSharedIssueTools(c).find((x) => x.name === 'update_issue')!;
    const out = JSON.parse(resultText(await t.handler({ issueKey: 'WP-12', components: ['Compute'] })));
    expect(c.replaceIssueComponents).toHaveBeenCalledWith('WP-12', [21]);
    expect(out).toEqual({ ok: true, results: { components: 'ok' } });
  });

  it('WP-933: update_issue 의 components: [] 는 구성요소 조회 없이 비운다', async () => {
    const c = mockClient();
    const t = buildSharedIssueTools(c).find((x) => x.name === 'update_issue')!;
    await t.handler({ issueKey: 'WP-12', components: [] });
    expect(c.getProjectComponents).not.toHaveBeenCalled();
    expect(c.replaceIssueComponents).toHaveBeenCalledWith('WP-12', []);
  });

  it('WP-933: update_issue 는 없는 구성요소 이름이면 다른 필드도 쓰지 않고 throw 한다', async () => {
    const c = mockClient();
    const t = buildSharedIssueTools(c).find((x) => x.name === 'update_issue')!;
    await expect(t.handler({ issueKey: 'WP-12', title: '바꿈', components: ['Network'] })).rejects.toThrow('사용 가능: Compute, Storage');
    expect(c.updateIssueContent).not.toHaveBeenCalled();
    expect(c.replaceIssueComponents).not.toHaveBeenCalled();
  });

  it('WP-933: update_issue 는 새로 붙이려는 보관 구성요소를 쓰기 전에 거절하지만, 이미 붙어 있는 보관 구성요소는 유지하게 둔다', async () => {
    const c = mockClient();
    const t = buildSharedIssueTools(c).find((x) => x.name === 'update_issue')!;
    vi.mocked(c.getIssueDetail).mockResolvedValue({ summary: { components: [{ id: 22, name: 'Storage', archived: false }] } });
    await expect(t.handler({ issueKey: 'WP-12', title: '바꿈', components: ['옛 구성요소'] })).rejects.toThrow('보관');
    expect(c.updateIssueContent).not.toHaveBeenCalled();
    expect(c.replaceIssueComponents).not.toHaveBeenCalled();

    vi.mocked(c.getIssueDetail).mockResolvedValue({ summary: { components: [{ id: 23, name: '옛 구성요소', archived: true }] } });
    await t.handler({ issueKey: 'WP-12', components: ['옛 구성요소', 'Compute'] });
    expect(c.replaceIssueComponents).toHaveBeenCalledWith('WP-12', [23, 21]);
  });

  it('WP-888: createIssueSetsVersionsAfterCreate — 이름을 해석해 이슈를 만든 뒤 PUT versions 로 두 종류를 붙이고 결과에 싣는다', async () => {
    const c = mockClient();
    vi.mocked(c.createIssue).mockResolvedValue({ number: 7, issueKey: 'WP-7', title: 'x' });
    vi.mocked(c.replaceIssueVersions).mockResolvedValue({ fixVersions: [{ id: 31, name: 'v1.0', status: 'UNRELEASED' }], affectsVersions: [{ id: 32, name: 'v0.9', status: 'RELEASED' }] });
    const t = buildSharedIssueTools(c).find((x) => x.name === 'create_issue')!;
    const out = JSON.parse(resultText(await t.handler({ projectKey: 'WP', title: 'x', fixVersions: ['V1.0'], affectsVersions: ['v0.9'] })));
    expect(vi.mocked(c.createIssue).mock.calls[0][1]).not.toHaveProperty('fixVersionIds');
    expect(c.replaceIssueVersions).toHaveBeenCalledWith('WP-7', { fixVersionIds: [31], affectsVersionIds: [32] });
    expect(out).toMatchObject({ issueKey: 'WP-7', fixVersions: ['v1.0'], affectsVersions: ['v0.9'] });
    expect(out).not.toHaveProperty('versionsError');
  });

  it('WP-888: create_issue 는 버전을 안 주면 버전 조회·PUT 을 하지 않는다', async () => {
    const c = mockClient();
    const t = buildSharedIssueTools(c).find((x) => x.name === 'create_issue')!;
    await t.handler({ projectKey: 'WP', title: 'x' });
    expect(c.getProjectVersions).not.toHaveBeenCalled();
    expect(c.replaceIssueVersions).not.toHaveBeenCalled();
  });

  it('WP-888: unknownVersionFailsBeforeWrite — 없는 버전 이름이면 이슈를 만들지 않고 사용 가능 목록을 담아 throw 한다', async () => {
    const c = mockClient();
    const t = buildSharedIssueTools(c).find((x) => x.name === 'create_issue')!;
    await expect(t.handler({ projectKey: 'WP', title: 'x', fixVersions: ['v9'] })).rejects.toThrow('사용 가능: v1.0, v0.9');
    expect(c.createIssue).not.toHaveBeenCalled();
    expect(c.replaceIssueVersions).not.toHaveBeenCalled();
  });

  it('WP-888: archivedVersionFailsOnCreate — 보관된 버전은 이슈를 만들기 전에 거절한다', async () => {
    const c = mockClient();
    const t = buildSharedIssueTools(c).find((x) => x.name === 'create_issue')!;
    await expect(t.handler({ projectKey: 'WP', title: 'x', affectsVersions: ['v0.1'] })).rejects.toThrow('보관');
    expect(c.createIssue).not.toHaveBeenCalled();
  });

  it('WP-888: 만든 뒤 버전 붙이기가 실패하면 이슈는 남기고 versionsError 로 알린다', async () => {
    const c = mockClient();
    vi.mocked(c.createIssue).mockResolvedValue({ number: 7, issueKey: 'WP-7', title: 'x' });
    vi.mocked(c.replaceIssueVersions).mockRejectedValue(new Error('서버 오류'));
    const t = buildSharedIssueTools(c).find((x) => x.name === 'create_issue')!;
    const out = JSON.parse(resultText(await t.handler({ projectKey: 'WP', title: 'x', fixVersions: ['v1.0'] })));
    expect(out.issueKey).toBe('WP-7');
    expect(out.versionsError).toContain('서버 오류');
  });

  it('WP-888: updateReplacesOnlyGivenKind — fixVersions 만 주면 PUT 본문에 그 종류만 싣는다', async () => {
    const c = mockClient();
    const t = buildSharedIssueTools(c).find((x) => x.name === 'update_issue')!;
    const out = JSON.parse(resultText(await t.handler({ issueKey: 'WP-12', fixVersions: ['v1.0', 'v0.9'] })));
    expect(c.replaceIssueVersions).toHaveBeenCalledWith('WP-12', { fixVersionIds: [31, 32] });
    expect(out).toEqual({ ok: true, results: { versions: 'ok' } });
  });

  it('WP-888: update_issue 의 affectsVersions: [] 는 조회 없이 그 종류만 비운다', async () => {
    const c = mockClient();
    const t = buildSharedIssueTools(c).find((x) => x.name === 'update_issue')!;
    await t.handler({ issueKey: 'WP-12', affectsVersions: [] });
    expect(c.getProjectVersions).not.toHaveBeenCalled();
    expect(c.replaceIssueVersions).toHaveBeenCalledWith('WP-12', { affectsVersionIds: [] });
  });

  it('WP-888: update_issue 는 없는 버전이면 다른 필드도 쓰지 않고 throw 한다', async () => {
    const c = mockClient();
    const t = buildSharedIssueTools(c).find((x) => x.name === 'update_issue')!;
    await expect(t.handler({ issueKey: 'WP-12', title: '바꿈', fixVersions: ['v9'] })).rejects.toThrow('사용 가능: v1.0, v0.9');
    expect(c.updateIssueContent).not.toHaveBeenCalled();
    expect(c.replaceIssueVersions).not.toHaveBeenCalled();
  });

  it('WP-888: updateKeepsAttachedArchived — 같은 종류로 이미 붙은 보관 버전은 유지하고, 새로 붙이는 보관 버전·다른 종류는 거절한다', async () => {
    const c = mockClient();
    const t = buildSharedIssueTools(c).find((x) => x.name === 'update_issue')!;
    vi.mocked(c.getIssueDetail).mockResolvedValue({ summary: { fixVersions: [{ id: 33, name: 'v0.1', status: 'ARCHIVED' }], affectsVersions: [] } });
    await t.handler({ issueKey: 'WP-12', fixVersions: ['v0.1', 'v1.0'] });
    expect(c.replaceIssueVersions).toHaveBeenCalledWith('WP-12', { fixVersionIds: [33, 31] });
    // 수정 버전으로 붙은 보관 버전은 영향 버전으로는 새로 붙이는 것이라 거절된다.
    vi.mocked(c.replaceIssueVersions).mockClear();
    await expect(t.handler({ issueKey: 'WP-12', affectsVersions: ['v0.1'] })).rejects.toThrow('보관');
    expect(c.replaceIssueVersions).not.toHaveBeenCalled();
  });

  it('WP-745: update_issue 는 유형과 부모를 함께 바꾸면 유형 요청 하나에 부모를 실어 보낸다', async () => {
    const c = mockClient();
    const t = buildSharedIssueTools(c).find((x) => x.name === 'update_issue')!;
    const out = JSON.parse(resultText(await t.handler({ issueKey: 'WP-12', type: 'BUG', parent: 'WP-3' })));
    expect(c.setIssueType).toHaveBeenCalledWith('WP-12', 2, 3);
    expect(c.setIssueParent).not.toHaveBeenCalled();
    expect(out).toEqual({ ok: true, results: { type: 'ok', parent: 'ok' } });

    // 부모만 바꾸거나 부모를 떼는 것(null)은 지금처럼 부모 요청으로 따로 보낸다.
    vi.mocked(c.setIssueType).mockClear();
    await t.handler({ issueKey: 'WP-12', type: 'BUG', parent: null });
    expect(c.setIssueType).toHaveBeenCalledWith('WP-12', 2);
    expect(c.setIssueParent).toHaveBeenCalledWith('WP-12', null);
  });

  it('WP-394: update_issue 는 담당자 이름이 틀리면 라벨을 포함해 아무것도 쓰지 않는다', async () => {
    const c = mockClient();
    const t = buildSharedIssueTools(c).find((x) => x.name === 'update_issue')!;
    await expect(t.handler({ issueKey: 'WP-12', labels: ['ai-fix'], assignees: ['nobody'] })).rejects.toThrow();
    expect(c.replaceIssueLabels).not.toHaveBeenCalled();
  });

  it('WP-394: update_issue 의 labels: [] 는 비우기 — 라벨 조회 없이 비우고 createdLabels 도 없다', async () => {
    const c = mockClient();
    const t = buildSharedIssueTools(c).find((x) => x.name === 'update_issue')!;
    const out = JSON.parse(resultText(await t.handler({ issueKey: 'WP-12', labels: [] })));
    expect(c.replaceIssueLabels).toHaveBeenCalledWith('WP-12', [], []);
    expect(c.getProjectLabels).not.toHaveBeenCalled();
    expect(out).toEqual({ ok: true, results: { labels: 'ok' } });
  });

  it('WP-356: update_issue 는 커스텀 필드를 이름으로 받아 정의 id·값으로 바꿔 한 번에 보내고 결과에 fields 를 싣는다', async () => {
    const c = mockClient();
    const t = buildSharedIssueTools(c).find((x) => x.name === 'update_issue')!;
    const out = JSON.parse(resultText(await t.handler({ issueKey: 'WP-12', fields: { 고객사: 'A사', 견적: '1500', 태그: ['x', 'y'] } })));
    expect(c.updateIssueFields).toHaveBeenCalledWith('WP-12', [
      { defId: 8, value: 'A사' },
      { defId: 9, value: 1500 },
      { defId: 10, value: ['x', 'y'] },
    ]);
    expect(out).toEqual({ ok: true, results: { fields: 'ok' } });
    // null 은 비우기 — 값 검증 없이 그대로 보낸다.
    await t.handler({ issueKey: 'WP-12', fields: { 고객사: null } });
    expect(c.updateIssueFields).toHaveBeenLastCalledWith('WP-12', [{ defId: 8, value: null }]);
  });

  it('WP-356: update_issue 는 없는 필드·선택지 밖 값·숫자 아님이면 아무것도 쓰지 않고 throw', async () => {
    const c = mockClient();
    const t = buildSharedIssueTools(c).find((x) => x.name === 'update_issue')!;
    await expect(t.handler({ issueKey: 'WP-12', title: '바꿈', fields: { 없음: 1 } })).rejects.toThrow('사용 가능: 고객사, 견적, 태그');
    await expect(t.handler({ issueKey: 'WP-12', title: '바꿈', fields: { 고객사: 'C사' } })).rejects.toThrow('사용 가능: A사, B사');
    await expect(t.handler({ issueKey: 'WP-12', title: '바꿈', fields: { 견적: '많이' } })).rejects.toThrow('숫자');
    expect(c.updateIssueContent).not.toHaveBeenCalled();
    expect(c.updateIssueFields).not.toHaveBeenCalled();
  });

  it('WP-356: update_issue 의 driveFileId 는 드라이브 링크를 추가하고 실패는 driveLink 결과로만 알린다', async () => {
    const c = mockClient();
    const t = buildSharedIssueTools(c).find((x) => x.name === 'update_issue')!;
    await t.handler({ issueKey: 'WP-12', driveFileId: 77 });
    expect(c.addIssueDriveLink).toHaveBeenCalledWith('WP-12', 77);
    vi.mocked(c.addIssueDriveLink).mockRejectedValueOnce(new Error('드라이브 권한 없음'));
    const out = JSON.parse(resultText(await t.handler({ issueKey: 'WP-12', status: 'DONE', driveFileId: 78 })));
    expect(out.ok).toBe(false);
    expect(out.results).toEqual({ content: 'ok', driveLink: 'failed: 드라이브 권한 없음' });
  });

  // WP-422: 외부 MCP 가 upload_file 로 스테이징한 파일을 이슈에 붙인다 — 생성은 본문에 실어 한 번에, 수정은 클레임 API 한 번.
  it('WP-422: create_issue: fileIds 는 생성 본문에 실려 한 번에 붙는다(클레임 호출 없음)', async () => {
    const c = mockClient();
    const t = buildSharedIssueTools(c).find((x) => x.name === 'create_issue')!;
    await t.handler({ projectKey: 'WP', title: '새 이슈', fileIds: [5, 6] });
    expect(c.createIssue).toHaveBeenCalledTimes(1);
    expect(c.createIssue).toHaveBeenCalledWith('WP', expect.objectContaining({ fileIds: [5, 6] }));
    expect(c.claimIssueAttachments).not.toHaveBeenCalled();
  });

  it('WP-422: update_issue: fileIds 는 attachments 단계로 저장되고 실패는 results.attachments 에 담긴다', async () => {
    const c = mockClient();
    const t = buildSharedIssueTools(c).find((x) => x.name === 'update_issue')!;
    const ok = JSON.parse(resultText(await t.handler({ issueKey: 'WP-12', fileIds: [5, 6] })));
    expect(c.claimIssueAttachments).toHaveBeenCalledWith('WP-12', [5, 6]);
    expect(ok).toEqual({ ok: true, results: { attachments: 'ok' } });
    vi.mocked(c.claimIssueAttachments).mockRejectedValueOnce(new Error('만료된 파일'));
    const out = JSON.parse(resultText(await t.handler({ issueKey: 'WP-12', status: 'DONE', fileIds: [7] })));
    expect(out.ok).toBe(false);
    expect(out.results).toEqual({ content: 'ok', attachments: 'failed: 만료된 파일' });
  });

  it('WP-422: update_issue: fileIds 와 status 를 함께 주면 첨부 클레임을 먼저, 내용(상태) 저장을 나중에 한다', async () => {
    // 첨부 클레임이 서버에서 일으키는 이슈 수정 알림(상태 미기재)이 같은 호출의 명시 status 를 덮지 않게 — 상태가 마지막에 저장돼야 한다.
    const c = mockClient();
    const t = buildSharedIssueTools(c).find((x) => x.name === 'update_issue')!;
    await t.handler({ issueKey: 'WP-12', status: 'TODO', fileIds: [5] });
    const claimOrder = vi.mocked(c.claimIssueAttachments).mock.invocationCallOrder[0];
    const contentOrder = vi.mocked(c.updateIssueContent).mock.invocationCallOrder[0];
    expect(c.updateIssueContent).toHaveBeenCalledWith('WP-12', { status: 'TODO' });
    expect(claimOrder).toBeLessThan(contentOrder);
  });

  it('update_issue: driveFileId 와 status 를 함께 주면 드라이브 링크를 먼저, 내용(상태) 저장을 나중에 한다', async () => {
    // 드라이브 링크도 작업 쓰기라 같은 이유로 명시 status 보다 먼저 저장한다 — 첨부·링크·상태를 함께 줘도 상태가 마지막이다.
    const c = mockClient();
    const t = buildSharedIssueTools(c).find((x) => x.name === 'update_issue')!;
    await t.handler({ issueKey: 'WP-12', status: 'TODO', driveFileId: 77, fileIds: [5] });
    const linkOrder = vi.mocked(c.addIssueDriveLink).mock.invocationCallOrder[0];
    const claimOrder = vi.mocked(c.claimIssueAttachments).mock.invocationCallOrder[0];
    const contentOrder = vi.mocked(c.updateIssueContent).mock.invocationCallOrder[0];
    expect(c.addIssueDriveLink).toHaveBeenCalledWith('WP-12', 77);
    expect(linkOrder).toBeLessThan(contentOrder);
    expect(claimOrder).toBeLessThan(contentOrder);
  });

  it('WP-422: update_issue: 빈 fileIds 는 부르지 않는다', async () => {
    const c = mockClient();
    const t = buildSharedIssueTools(c).find((x) => x.name === 'update_issue')!;
    const out = JSON.parse(resultText(await t.handler({ issueKey: 'WP-12', status: 'DONE', fileIds: [] })));
    expect(c.claimIssueAttachments).not.toHaveBeenCalled();
    expect(out).toEqual({ ok: true, results: { content: 'ok' } });
  });

  it('WP-422: get_issue_detail 은 클레임된 첨부를 기존 attachments 뷰 그대로 보여 준다', async () => {
    const c = mockClient();
    vi.mocked(c.getIssueDetail).mockResolvedValue({
      issueKey: 'WP-12',
      summary: { projectKey: 'WP', number: 12, title: 'T', status: 'TODO', priority: 'MID', assignees: [] },
      body: 'b',
      comments: [],
      attachments: [
        { fileId: 11, issueId: 5, originalName: 'a.md', mimeType: 'text/markdown', sizeBytes: 100, attachedById: 3, attachedByName: 'Bob', attachedByUsername: 'bob', attachedAt: '2026-10-01T00:00:00Z' },
      ],
    });
    const out = JSON.parse(resultText(await buildSharedIssueTools(c).find((t) => t.name === 'get_issue_detail')!.handler({ issueKey: 'WP-12' })));
    expect(out.attachments).toEqual([
      { attachmentId: 11, name: 'a.md', mimeType: 'text/markdown', sizeBytes: 100, attachedBy: { username: 'bob', name: 'Bob', kind: null }, attachedAt: '2026-10-01T09:00:00+09:00' },
    ]);
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
      expect(schema.properties.parent.description, name).toContain('Parent issue key');
      expect(schema.properties.parent.description, name).toContain('same project');
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

  it('link_issues(linked: true) 결과는 갱신된 의존성만 — 상세 raw 의 숫자 사용자 ID 를 싣지 않는다 (#833, WP-353)', async () => {
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
    const t = buildSharedIssueTools(c).find((x) => x.name === 'link_issues')!;
    const text = resultText(await t.handler({ issueKey: 'WP-1', otherIssueKey: 'WP-2', direction: 'blocks', linked: true }));
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

  // WP-944: reporter username 은 담당자와 같은 이름 해석으로 id 를 찾아 PUT .../reporter 로 보낸다. 모르는 이름이면 아무것도 쓰지 않는다.
  it('update_issue 는 reporter 를 바꾸고, 모르는 이름이면 다른 필드도 쓰지 않는다', async () => {
    const c = mockClient();
    const t = buildSharedIssueTools(c).find((x) => x.name === 'update_issue')!;
    const out = JSON.parse(resultText(await t.handler({ issueKey: 'WP-12', reporter: 'alice' })));
    expect(out).toEqual({ ok: true, results: { reporter: 'ok' } });
    expect(c.changeIssueReporter).toHaveBeenCalledWith('WP-12', 10);

    vi.mocked(c.changeIssueReporter).mockClear();
    await expect(t.handler({ issueKey: 'WP-12', title: 'x', reporter: 'nobody' })).rejects.toThrow();
    expect(c.changeIssueReporter).not.toHaveBeenCalled();
    expect(c.updateIssueContent).not.toHaveBeenCalled();
  });

  // WP-1012: 오픈(OPEN) 프로젝트는 서버가 비멤버 구성원을 보고자로 받는다(WP-967) — 도구도 워크스페이스 구성원으로 해석한다. 팀 프로젝트는 그대로 멤버만.
  describe('reporter — 오픈 프로젝트의 비멤버 (WP-1012)', () => {
    const outsider = { userId: 77, username: 'jey@iacloud.kr', name: '양정모', kind: 'HUMAN', active: true };
    const tool = (c: IssueToolClient) => buildSharedIssueTools(c).find((x) => x.name === 'update_issue')!;

    it('오픈 프로젝트면 멤버가 아닌 워크스페이스 구성원도 보고자로 보낸다', async () => {
      const c = mockClient();
      vi.mocked(c.getProject).mockResolvedValue({ key: 'WP', type: 'OPEN' });
      vi.mocked(c.searchMembers).mockResolvedValue([outsider]);
      const out = JSON.parse(resultText(await tool(c).handler({ issueKey: 'WP-12', reporter: 'jey@iacloud.kr' })));
      expect(out).toEqual({ ok: true, results: { reporter: 'ok' } });
      expect(c.changeIssueReporter).toHaveBeenCalledWith('WP-12', 77);
    });

    it('오픈 프로젝트에서도 워크스페이스에 없는 이름은 아무것도 쓰지 않고 거절한다', async () => {
      const c = mockClient();
      vi.mocked(c.getProject).mockResolvedValue({ key: 'WP', type: 'OPEN' });
      await expect(tool(c).handler({ issueKey: 'WP-12', title: 'x', reporter: 'nobody' })).rejects.toThrow('search_members');
      expect(c.updateIssueContent).not.toHaveBeenCalled();
      expect(c.changeIssueReporter).not.toHaveBeenCalled();
    });

    it('팀 프로젝트는 비멤버를 여전히 거절하고 워크스페이스를 찾지 않는다', async () => {
      const c = mockClient();
      vi.mocked(c.searchMembers).mockResolvedValue([outsider]);
      await expect(tool(c).handler({ issueKey: 'WP-12', reporter: 'jey@iacloud.kr' })).rejects.toThrow('사용 가능 username: alice');
      expect(c.searchMembers).not.toHaveBeenCalled();
      expect(c.changeIssueReporter).not.toHaveBeenCalled();
    });

    it("멤버는 오픈 프로젝트에서도 프로젝트 조회 없이 해석하고, 'me' 가 비멤버여도 오픈이면 호출자로 지정한다", async () => {
      const c = mockClient();
      vi.mocked(c.getProject).mockResolvedValue({ key: 'WP', type: 'OPEN' });
      await tool(c).handler({ issueKey: 'WP-12', reporter: 'alice' });
      expect(c.changeIssueReporter).toHaveBeenLastCalledWith('WP-12', 10);
      expect(c.getProject).not.toHaveBeenCalled();

      vi.mocked(c.getMe).mockResolvedValue({ id: 55, username: 'outsider' });
      await tool(c).handler({ issueKey: 'WP-12', reporter: 'me' });
      expect(c.changeIssueReporter).toHaveBeenLastCalledWith('WP-12', 55);
    });
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

  // WP-870: status 는 범주(TODO/IN_PROGRESS/DONE/CANCELED) 또는 프로젝트 상태 이름 — 범주면 status, 이름이면 statusName 으로 보내 서버가 해석한다.
  it('update_issue: 범주 값이면 status 로 보낸다', async () => {
    const c = mockClient();
    const t = buildSharedIssueTools(c).find((x) => x.name === 'update_issue')!;
    const out = JSON.parse(resultText(await t.handler({ issueKey: 'WP-12', status: 'DONE' })));
    expect(out.results).toEqual({ content: 'ok' });
    expect(c.updateIssueContent).toHaveBeenCalledWith('WP-12', { status: 'DONE' });
    expect(c.getProjectStatuses).not.toHaveBeenCalled();
  });

  it('update_issue: 이름이면 statusName 으로 보내고 상태 목록을 조회하지 않는다', async () => {
    const c = mockClient();
    const t = buildSharedIssueTools(c).find((x) => x.name === 'update_issue')!;
    await t.handler({ issueKey: 'WP-12', status: ' 검토 중 ' });
    expect(c.updateIssueContent).toHaveBeenCalledWith('WP-12', { statusName: '검토 중' });
    expect(c.getProjectStatuses).not.toHaveBeenCalled();
  });

  it('update_issue: "DONE" 이름 상태가 있어도 범주로 해석한다', async () => {
    const c = mockClient();
    vi.mocked(c.getProjectStatuses).mockResolvedValue([{ id: 40, name: 'DONE', category: 'IN_PROGRESS', position: 0 }]);
    const t = buildSharedIssueTools(c).find((x) => x.name === 'update_issue')!;
    await t.handler({ issueKey: 'WP-12', status: 'done' });
    expect(c.updateIssueContent).toHaveBeenCalledWith('WP-12', { status: 'DONE' });
    expect(c.getProjectStatuses).not.toHaveBeenCalled();
  });

  it('update_issue: 빈 status 는 스키마 오류다', async () => {
    const c = mockClient();
    const t = buildSharedIssueTools(c).find((x) => x.name === 'update_issue')!;
    await expect(t.handler({ issueKey: 'WP-12', status: '' })).rejects.toThrow();
    expect(c.updateIssueContent).not.toHaveBeenCalled();
  });

  // WP-870: 모르는 이름은 서버가 사용 가능 목록과 함께 400 으로 거절한다 — 그 문구가 content 결과로 그대로 전달된다.
  it('update_issue: 모르는 이름은 서버 400 문구를 content 결과로 전한다', async () => {
    const c = mockClient();
    const message = "상태 'WRONG' 을(를) 찾을 수 없습니다. 사용 가능: 할 일, 진행 중, 검토 중";
    vi.mocked(c.updateIssueContent).mockRejectedValue(Object.assign(new Error('x'), { response: { status: 400, data: { message } } }));
    const t = buildSharedIssueTools(c).find((x) => x.name === 'update_issue')!;
    const out = JSON.parse(resultText(await t.handler({ issueKey: 'WP-12', title: '수정', status: 'WRONG' })));
    expect(c.updateIssueContent).toHaveBeenCalledWith('WP-12', { title: '수정', statusName: 'WRONG' });
    expect(out.results.content).toBe(`failed: API 오류 400: ${message}`);
    expect(c.getProjectStatuses).not.toHaveBeenCalled();
  });

  // 모르는 상태 이름은 다른 쓰기보다 먼저 실패해야 한다 — 담당자·라벨만 바뀌고 상태는 그대로인 반쯤 고친 이슈를 남기지 않게.
  it('update_issue: 모르는 상태 이름이면 내용 저장이 먼저 실패하고 담당자·라벨·사이클·필드는 쓰지 않는다', async () => {
    const c = mockClient();
    const message = "상태 'WRONG' 을(를) 찾을 수 없습니다. 사용 가능: 할 일, 진행 중";
    vi.mocked(c.updateIssueContent).mockRejectedValue(Object.assign(new Error('x'), { response: { status: 400, data: { message } } }));
    const t = buildSharedIssueTools(c).find((x) => x.name === 'update_issue')!;
    const out = JSON.parse(
      resultText(await t.handler({ issueKey: 'WP-12', status: 'WRONG', assignees: ['alice'], labels: ['urgent'], cycles: [], type: 'BUG' })),
    );
    expect(out).toEqual({ ok: false, results: { content: `failed: API 오류 400: ${message}` } });
    expect(c.replaceIssueAssignees).not.toHaveBeenCalled();
    expect(c.replaceIssueLabels).not.toHaveBeenCalled();
    expect(c.replaceIssueCycles).not.toHaveBeenCalled();
    expect(c.setIssueType).not.toHaveBeenCalled();
    expect(c.getProjectStatuses).not.toHaveBeenCalled();
  });

  // 첨부·드라이브 링크는 상태 저장보다 먼저 해야 해(위 WP-422 순서) 내용 저장을 앞당길 수 없다 — 그때만 상태 목록으로 이름을 먼저 확인한다.
  it('update_issue: 첨부와 모르는 상태 이름을 함께 주면 아무것도 쓰지 않고 content 실패로 알린다', async () => {
    const c = mockClient();
    const t = buildSharedIssueTools(c).find((x) => x.name === 'update_issue')!;
    const out = JSON.parse(resultText(await t.handler({ issueKey: 'WP-12', status: 'WRONG', fileIds: [5], driveFileId: 77, assignees: ['alice'] })));
    expect(out.ok).toBe(false);
    expect(Object.keys(out.results)).toEqual(['content']);
    expect(out.results.content).toMatch(/^failed: 상태 'WRONG' 을\(를\) 찾을 수 없습니다\. 사용 가능: /);
    expect(c.claimIssueAttachments).not.toHaveBeenCalled();
    expect(c.addIssueDriveLink).not.toHaveBeenCalled();
    expect(c.updateIssueContent).not.toHaveBeenCalled();
    expect(c.replaceIssueAssignees).not.toHaveBeenCalled();
  });

  it('update_issue: 첨부와 아는 상태 이름(대소문자·공백 무시)이면 첨부를 먼저, 상태를 나중에 저장한다', async () => {
    const c = mockClient();
    vi.mocked(c.getProjectStatuses).mockResolvedValue([{ id: 40, name: 'Code Review', category: 'IN_PROGRESS', position: 2 }]);
    const t = buildSharedIssueTools(c).find((x) => x.name === 'update_issue')!;
    const out = JSON.parse(resultText(await t.handler({ issueKey: 'WP-12', status: ' code review ', fileIds: [5] })));
    expect(out).toEqual({ ok: true, results: { attachments: 'ok', content: 'ok' } });
    expect(c.updateIssueContent).toHaveBeenCalledWith('WP-12', { statusName: 'code review' });
    const claimOrder = vi.mocked(c.claimIssueAttachments).mock.invocationCallOrder[0];
    const contentOrder = vi.mocked(c.updateIssueContent).mock.invocationCallOrder[0];
    expect(claimOrder).toBeLessThan(contentOrder);
  });

  it('update_issue 는 모르는 마일스톤이면 아무것도 쓰지 않고 throw (#854)', async () => {
    const c = mockClient();
    const t = buildSharedIssueTools(c).find((x) => x.name === 'update_issue')!;
    await expect(t.handler({ issueKey: 'WP-12', title: '수정', milestone: 'v9' })).rejects.toThrow('사용 가능: v1.0');
    expect(c.updateIssueContent).not.toHaveBeenCalled();
  });

  // WP-421: 구독·해제를 watch_issue 하나로 합쳤다 — watching 이 최종 상태라 멱등이고, 빠뜨리면 어느 쪽인지 모호해 거절한다.
  it('watch_issue: watching true 면 watchIssue, false 면 unwatchIssue', async () => {
    const c = mockClient();
    const t = buildSharedIssueTools(c).find((x) => x.name === 'watch_issue')!;
    await expect(t.handler({ issueKey: 'WP-3', watching: true })).resolves.toBe('ok');
    expect(c.watchIssue).toHaveBeenCalledWith('WP-3');
    expect(c.unwatchIssue).not.toHaveBeenCalled();
    await expect(t.handler({ issueKey: 'WP-3', watching: false })).resolves.toBe('ok');
    expect(c.unwatchIssue).toHaveBeenCalledWith('WP-3');
    expect(c.watchIssue).toHaveBeenCalledTimes(1);
  });

  it('watch_issue: watching 이 없으면 거절', async () => {
    const c = mockClient();
    const t = buildSharedIssueTools(c).find((x) => x.name === 'watch_issue')!;
    await expect(t.handler({ issueKey: 'WP-3' })).rejects.toThrow();
    await expect(t.handler({ issueKey: 'WP-3', watching: null })).rejects.toThrow();
    expect(c.watchIssue).not.toHaveBeenCalled();
    expect(c.unwatchIssue).not.toHaveBeenCalled();
  });

  // WP-800: AI 가 대기열 라벨 이슈를 한 동작으로 가져간다 — 결과는 사람을 username 으로만(#833) 가리키는 {assignees, labels} 로 줄인다.
  it('claim_issue: claimIssue(issueKey, queueLabel) 를 부르고 username·라벨 이름만 돌려준다', async () => {
    const c = mockClient();
    vi.mocked(c.claimIssue).mockResolvedValue({
      assignees: [
        { id: 3, username: 'dhyang', name: '양동희', kind: 'HUMAN' },
        { id: 9, username: 'dev-ai', name: 'AI 개발자', kind: 'AGENT' },
      ],
      labels: [{ id: 5, name: 'urgent', colorToken: 'RED' }],
    });
    const t = buildSharedIssueTools(c).find((x) => x.name === 'claim_issue')!;
    expect(t.kind).toBe('write');
    expect(t.hints).toEqual({ destructive: false, idempotent: false });
    const out = JSON.parse(resultText(await t.handler({ issueKey: 'WP-9', queueLabel: 'AI 개발팀' })));
    expect(c.claimIssue).toHaveBeenCalledWith('WP-9', 'AI 개발팀');
    expect(out).toEqual({ assignees: ['dhyang', 'dev-ai'], labels: ['urgent'] });
  });

  it('claim_issue: 빈 queueLabel·40자 초과·빠진 issueKey 는 서버 호출 없이 거절', async () => {
    const c = mockClient();
    const t = buildSharedIssueTools(c).find((x) => x.name === 'claim_issue')!;
    await expect(t.handler({ issueKey: 'WP-9', queueLabel: '' })).rejects.toThrow();
    await expect(t.handler({ issueKey: 'WP-9', queueLabel: 'x'.repeat(41) })).rejects.toThrow();
    await expect(t.handler({ queueLabel: 'AI 개발팀' })).rejects.toThrow();
    expect(c.claimIssue).not.toHaveBeenCalled();
    // 경계: 40자는 통과
    await t.handler({ issueKey: 'WP-9', queueLabel: 'x'.repeat(40) });
    expect(c.claimIssue).toHaveBeenCalledTimes(1);
  });

  it('claim_issue: 서버 거절(409)은 그대로 던진다', async () => {
    const c = mockClient();
    vi.mocked(c.claimIssue).mockRejectedValue(new Error('API 오류 409: 대기열에 없습니다 — code: NOT_IN_QUEUE'));
    const t = buildSharedIssueTools(c).find((x) => x.name === 'claim_issue')!;
    await expect(t.handler({ issueKey: 'WP-9', queueLabel: 'AI 개발팀' })).rejects.toThrow('NOT_IN_QUEUE');
  });

  it('link_issues 는 다른 프로젝트면 클라이언트측 거부', async () => {
    const c = mockClient();
    const t = buildSharedIssueTools(c).find((x) => x.name === 'link_issues')!;
    await expect(t.handler({ issueKey: 'WP-1', otherIssueKey: 'AB-2', direction: 'blocks', linked: true })).rejects.toThrow(
      '동일 프로젝트 이슈 간에만 의존성을 설정할 수 있습니다.',
    );
    expect(c.addIssueDependency).not.toHaveBeenCalled();
  });

  it('link_issues(linked: true) 는 같은 프로젝트면 otherNumber 로 호출', async () => {
    const c = mockClient();
    const t = buildSharedIssueTools(c).find((x) => x.name === 'link_issues')!;
    await t.handler({ issueKey: 'WP-1', otherIssueKey: 'WP-2', direction: 'blocks', linked: true });
    expect(c.addIssueDependency).toHaveBeenCalledWith('WP-1', 2, 'blocks');
  });

  it('link_issues(linked: false) 는 "ok" 이고 제거만 부른다', async () => {
    const c = mockClient();
    const t = buildSharedIssueTools(c).find((x) => x.name === 'link_issues')!;
    await expect(t.handler({ issueKey: 'WP-1', otherIssueKey: 'WP-2', direction: 'blockedBy', linked: false })).resolves.toBe('ok');
    expect(c.removeIssueDependency).toHaveBeenCalledWith('WP-1', 2, 'blockedBy');
    expect(c.addIssueDependency).not.toHaveBeenCalled();
  });

  it('link_issues 는 linked 를 빠뜨리면 거절한다(추가인지 제거인지 모호)', async () => {
    const c = mockClient();
    const t = buildSharedIssueTools(c).find((x) => x.name === 'link_issues')!;
    await expect(t.handler({ issueKey: 'WP-1', otherIssueKey: 'WP-2', direction: 'blocks' })).rejects.toThrow();
    expect(c.addIssueDependency).not.toHaveBeenCalled();
    expect(c.removeIssueDependency).not.toHaveBeenCalled();
  });
});

describe('add_issue_chat (WP-719)', () => {
  const chatTool = (c: IssueToolClient) => buildSharedIssueTools(c).find((x) => x.name === 'add_issue_chat')!;

  it('이슈 키로 스레드를 찾아 글을 남기고 @username 을 멘션 토큰으로 바꾼다', async () => {
    const c = mockClient();
    vi.mocked(c.searchMembers).mockImplementation(async ({ search }) =>
      [{ userId: 7, username: 'dh.yang@iacloud.kr', name: '양동희', kind: 'HUMAN' }].filter((m) => m.username.includes(String(search))),
    );
    const out = await chatTool(c).handler({ issueKey: 'WP-1', body: '@dh.yang@iacloud.kr 원인은 X 입니다' });
    expect(c.getIssueChatThreadId).toHaveBeenCalledWith('WP-1');
    expect(c.addIssueChatMessage).toHaveBeenCalledWith(55, '<@7> 원인은 X 입니다');
    expect(resultText(out)).toBe('ok');
  });

  it('빈 본문은 보내기 전에 거절한다', async () => {
    const c = mockClient();
    await expect(chatTool(c).handler({ issueKey: 'WP-1', body: '' })).rejects.toThrow();
    expect(c.addIssueChatMessage).not.toHaveBeenCalled();
  });
});

describe('get_issue_chat (WP-373)', () => {
  const rows = [
    { id: 11, authorId: 7, authorName: '코디', authorUsername: 'kodi', authorKind: 'AGENT', body: '질문', question: true,
      createdAt: '2026-10-14T01:00:00Z', editedAt: null, deleted: false, mentions: [], driveLinks: [],
      attachments: [{ fileId: 900, messageId: 11, originalName: 'a.txt', mimeType: 'text/plain', sizeBytes: 12, attachedById: 7, attachedByName: '코디', attachedAt: 'x', extraction: { status: 'READY', totalChars: 12, truncated: false, reasonCode: null } }] },
    { id: 12, authorId: 3, authorName: '양동희', authorUsername: 'dh', authorKind: 'HUMAN', body: '(삭제됨)', question: false,
      createdAt: '2026-10-14T01:01:00Z', editedAt: null, deleted: true, mentions: [], driveLinks: [], attachments: [] },
  ];
  const chatTool = (c: IssueToolClient) => buildSharedIssueTools(c).find((x) => x.name === 'get_issue_chat')!;

  it('after 가 없으면 afterMine 경로로 읽고 author 를 username 으로 준다(숫자 사용자 id 없음)', async () => {
    const c = mockClient();
    vi.mocked(c.listIssueChatMessages).mockResolvedValue({ items: rows, nextCursor: null, hasMore: false });
    const out = JSON.parse(resultText(await chatTool(c).handler({ issueKey: 'WP-1' })));
    expect(c.getIssueChatThread).toHaveBeenCalledWith('WP-1');
    expect(c.listIssueChatMessages).toHaveBeenCalledWith(55, { after: undefined, limit: 30 });
    expect(out).toEqual({
      messages: [
        { id: 11, author: { username: 'kodi', name: '코디', kind: 'AGENT' }, body: '질문', question: true, createdAt: '2026-10-14T10:00:00+09:00',
          attachments: [{ attachmentId: 900, name: 'a.txt', mimeType: 'text/plain', size: 12, extraction: { status: 'READY', totalChars: 12 } }] },
        { id: 12, author: { username: 'dh', name: '양동희', kind: 'HUMAN' }, deleted: true, createdAt: '2026-10-14T10:01:00+09:00' },
      ],
      hasMore: false,
    });
    expect(JSON.stringify(out)).not.toMatch(/authorId|attachedById/);
  });

  it('after 가 없으면 현재 참여자를 username·name·kind 로 함께 준다(숫자 id·읽음 위치 없음, WP-1009)', async () => {
    const c = mockClient();
    vi.mocked(c.getIssueChatThread).mockResolvedValue({
      threadId: 55,
      members: [
        { userId: 3, username: 'dh', name: '양동희', kind: 'HUMAN', lastReadMessageId: 12, joinedAt: '2026-10-14T01:00:00Z' },
        { userId: 7, username: 'kodi', name: '코디', kind: 'AGENT', lastReadMessageId: null, joinedAt: '2026-10-14T01:00:00Z' },
      ],
    });
    const out = JSON.parse(resultText(await chatTool(c).handler({ issueKey: 'WP-1' })));
    expect(out.participants).toEqual([
      { username: 'dh', name: '양동희', kind: 'HUMAN' },
      { username: 'kodi', name: '코디', kind: 'AGENT' },
    ]);
  });

  it('참여자 조회가 실패해도 메시지는 돌려준다(참여자만 빠진다)', async () => {
    const c = mockClient();
    vi.mocked(c.getIssueChatThread).mockRejectedValue(new Error('boom'));
    vi.mocked(c.listIssueChatMessages).mockResolvedValue({ items: rows.slice(0, 1), nextCursor: null, hasMore: false });
    const out = JSON.parse(resultText(await chatTool(c).handler({ issueKey: 'WP-1' })));
    expect(out.messages).toHaveLength(1);
    expect('participants' in out).toBe(false);
  });

  it('after 로 이어 읽을 때는 캐시된 스레드 id 로 메시지만 받고 참여자는 싣지 않는다', async () => {
    const c = mockClient();
    const out = JSON.parse(resultText(await chatTool(c).handler({ issueKey: 'WP-1', after: 10 })));
    expect(c.getIssueChatThread).not.toHaveBeenCalled();
    expect(c.getIssueChatThreadId).toHaveBeenCalledWith('WP-1');
    expect('participants' in out).toBe(false);
  });

  it('본문의 멘션 토큰 <@id> 은 이름으로 풀어 숫자 id 를 AI 에 넘기지 않는다', async () => {
    const c = mockClient();
    const row = { ...rows[0], id: 13, body: '<@3> A안으로 가죠', question: false,
      mentions: [{ id: 3, username: 'dh', name: '양동희', kind: 'HUMAN' }], attachments: [] };
    vi.mocked(c.listIssueChatMessages).mockResolvedValue({ items: [row], nextCursor: null, hasMore: false });
    const text = resultText(await chatTool(c).handler({ issueKey: 'WP-1' }));
    expect(JSON.parse(text).messages[0].body).toBe('@양동희(dh) A안으로 가죠');
    expect(text).not.toContain('<@');
  });

  it('extraction 은 {status,totalChars,reason} 만 준다(truncated·reasonCode 제외)', async () => {
    const c = mockClient();
    const att = { ...rows[0].attachments[0], extraction: { status: 'SKIPPED', totalChars: null, truncated: false, reasonCode: 'TOO_BIG', reason: '너무 큼' } };
    vi.mocked(c.listIssueChatMessages).mockResolvedValue({ items: [{ ...rows[0], attachments: [att] }], nextCursor: null, hasMore: false });
    const out = JSON.parse(resultText(await chatTool(c).handler({ issueKey: 'WP-1' })));
    expect(out.messages[0].attachments[0].extraction).toEqual({ status: 'SKIPPED', reason: '너무 큼' });
  });

  it('after·limit 을 넘기고 hasMore 면 next 를 숫자로 준다', async () => {
    const c = mockClient();
    vi.mocked(c.listIssueChatMessages).mockResolvedValue({ items: rows.slice(0, 1), nextCursor: '11', hasMore: true });
    const out = JSON.parse(resultText(await chatTool(c).handler({ issueKey: 'WP-1', after: 10, limit: 1 })));
    expect(c.listIssueChatMessages).toHaveBeenCalledWith(55, { after: 10, limit: 1 });
    expect(out.hasMore).toBe(true);
    expect(out.next).toBe(11);
  });

  it('서버가 truncated 를 주면 그대로 싣고, 없으면 키를 싣지 않는다', async () => {
    const c = mockClient();
    vi.mocked(c.listIssueChatMessages).mockResolvedValue({ items: rows.slice(0, 1), nextCursor: null, hasMore: false, truncated: true });
    const cut = JSON.parse(resultText(await chatTool(c).handler({ issueKey: 'WP-1' })));
    expect(cut.truncated).toBe(true);
    expect(cut.hasMore).toBe(false);
    vi.mocked(c.listIssueChatMessages).mockResolvedValue({ items: rows.slice(0, 1), nextCursor: null, hasMore: false });
    expect('truncated' in JSON.parse(resultText(await chatTool(c).handler({ issueKey: 'WP-1' })))).toBe(false);
  });
});

describe('이슈 관계·외부 링크 도구 (WP-887)', () => {
  const addTool = (c: IssueToolClient) => buildSharedIssueTools(c).find((x) => x.name === 'add_issue_relation')!;
  const removeTool = (c: IssueToolClient) => buildSharedIssueTools(c).find((x) => x.name === 'remove_issue_relation')!;
  /** 서버가 돌려주는 상세 raw(관계·외부 링크 포함) — 쓰기 뒤 결과 조립이 이걸 다시 읽는다. */
  const detailRaw = {
    summary: { projectKey: 'WP', number: 1, title: 't', status: 'TODO', priority: 'MID', assignees: [] },
    relations: [{ id: 31, typeId: 2, typeCode: 'RELATES', label: '관련', issue: { projectKey: 'AB', number: 7, title: '다른 팀', status: 'TODO', type: null } }],
    externalLinks: [{ id: 41, typeId: 9, typeCode: null, label: '검토를 요청함', url: 'https://jira.example/CLIM-1', key: 'CLIM-1', title: '외부' }],
    comments: [], history: [], attachments: [],
  };

  it('add_issue_relation: 코드로 유형을 풀어 POST — side 기본 source, 같은 프로젝트도 키를 실어 보낸다', async () => {
    const c = mockClient();
    vi.mocked(c.getIssueDetail).mockResolvedValue(detailRaw);
    const out = JSON.parse(resultText(await addTool(c).handler({ issueKey: 'WP-1', type: 'relates', otherIssueKey: 'AB-7' })));
    expect(c.addIssueRelation).toHaveBeenCalledWith('WP-1', { typeId: 2, side: 'source', target: { projectKey: 'AB', number: 7 } });
    expect(c.addIssueExternalLink).not.toHaveBeenCalled();
    // 결과는 두 목록 모두 — 사용자 정의 유형은 이름으로 채운다. 숫자 id 는 relationId·externalLinkId 뿐.
    expect(out).toEqual({
      issueKey: 'WP-1',
      relations: [{ relationId: 31, type: 'RELATES', label: '관련', issueKey: 'AB-7', title: '다른 팀', status: 'TODO' }],
      externalLinks: [{ externalLinkId: 41, type: '검토 요청', label: '검토를 요청함', key: 'CLIM-1', title: '외부', url: 'https://jira.example/CLIM-1' }],
    });
  });

  it('add_issue_relation: 이름으로도 풀고 side:target 을 그대로 보낸다', async () => {
    const c = mockClient();
    vi.mocked(c.getIssueDetail).mockResolvedValue(detailRaw);
    await addTool(c).handler({ issueKey: 'WP-1', type: '중복', side: 'target', otherIssueKey: 'WP-2' });
    expect(c.addIssueRelation).toHaveBeenCalledWith('WP-1', { typeId: 3, side: 'target', target: { projectKey: 'WP', number: 2 } });
  });

  it('add_issue_relation: externalLink 는 외부 링크 경로로 — 외부 전용 유형도 허용, key 생략 가능', async () => {
    const c = mockClient();
    vi.mocked(c.getIssueDetail).mockResolvedValue(detailRaw);
    await addTool(c).handler({ issueKey: 'WP-1', type: 'PARENT_EPIC', externalLink: { url: 'https://jira.example/CLIM-1', key: 'CLIM-1', title: '에픽' } });
    expect(c.addIssueExternalLink).toHaveBeenCalledWith('WP-1', { typeId: 6, side: 'source', url: 'https://jira.example/CLIM-1', key: 'CLIM-1', title: '에픽' });
    expect(c.addIssueRelation).not.toHaveBeenCalled();
    await addTool(c).handler({ issueKey: 'WP-1', type: '검토 요청', side: 'target', externalLink: { url: 'https://x.example/1', title: '키 없음' } });
    expect(c.addIssueExternalLink).toHaveBeenLastCalledWith('WP-1', { typeId: 9, side: 'target', url: 'https://x.example/1', key: undefined, title: '키 없음' });
  });

  it('add_issue_relation: null 로 채운 반대쪽 인자는 생략으로 받는다', async () => {
    const c = mockClient();
    vi.mocked(c.getIssueDetail).mockResolvedValue(detailRaw);
    await addTool(c).handler({ issueKey: 'WP-1', type: 'RELATES', otherIssueKey: 'WP-2', externalLink: null });
    expect(c.addIssueRelation).toHaveBeenCalledTimes(1);
  });

  it('add_issue_relation: 둘 다/둘 다 없음, 차단·외부 전용·숨김·모르는 유형은 쓰기 전에 거부한다', async () => {
    const c = mockClient();
    const link = { url: 'https://x.example', title: 't' };
    await expect(addTool(c).handler({ issueKey: 'WP-1', type: 'RELATES' })).rejects.toThrow('정확히 하나');
    await expect(addTool(c).handler({ issueKey: 'WP-1', type: 'RELATES', otherIssueKey: 'WP-2', externalLink: link })).rejects.toThrow('정확히 하나');
    await expect(addTool(c).handler({ issueKey: 'WP-1', type: 'BLOCKS', otherIssueKey: 'WP-2' })).rejects.toThrow('link_issues');
    await expect(addTool(c).handler({ issueKey: 'WP-1', type: '차단', otherIssueKey: 'WP-2' })).rejects.toThrow('link_issues');
    await expect(addTool(c).handler({ issueKey: 'WP-1', type: 'PARENT_EPIC', otherIssueKey: 'WP-2' })).rejects.toThrow('externalLink');
    await expect(addTool(c).handler({ issueKey: 'WP-1', type: '옛 유형', otherIssueKey: 'WP-2' })).rejects.toThrow('숨겨져');
    await expect(addTool(c).handler({ issueKey: 'WP-1', type: '없는유형', otherIssueKey: 'WP-2' })).rejects.toThrow(/사용 가능: .*RELATES.*검토 요청/);
    // 숨긴 유형은 사용 가능 목록에도 나오지 않는다.
    const message = await addTool(c).handler({ issueKey: 'WP-1', type: '없는유형', otherIssueKey: 'WP-2' }).catch((e: Error) => e.message);
    expect(message).not.toContain('옛 유형');
    expect(c.addIssueRelation).not.toHaveBeenCalled();
    expect(c.addIssueExternalLink).not.toHaveBeenCalled();
  });

  it('add_issue_relation: 서버 거절(읽을 수 없는 상대 등)은 그대로 전파한다', async () => {
    const c = mockClient();
    vi.mocked(c.addIssueRelation).mockRejectedValue(new Error('상대 이슈를 찾을 수 없습니다'));
    await expect(addTool(c).handler({ issueKey: 'WP-1', type: 'RELATES', otherIssueKey: 'XX-9' })).rejects.toThrow('상대 이슈');
  });

  it('remove_issue_relation: relationId 면 관계, externalLinkId 면 외부 링크를 지우고 "ok"', async () => {
    const c = mockClient();
    await expect(removeTool(c).handler({ issueKey: 'WP-1', relationId: 31 })).resolves.toBe('ok');
    expect(c.removeIssueRelation).toHaveBeenCalledWith('WP-1', 31);
    await expect(removeTool(c).handler({ issueKey: 'WP-1', externalLinkId: 41, relationId: null })).resolves.toBe('ok');
    expect(c.removeIssueExternalLink).toHaveBeenCalledWith('WP-1', 41);
  });

  it('remove_issue_relation: 둘 다/둘 다 없음은 거부한다', async () => {
    const c = mockClient();
    await expect(removeTool(c).handler({ issueKey: 'WP-1' })).rejects.toThrow('정확히 하나');
    await expect(removeTool(c).handler({ issueKey: 'WP-1', relationId: 1, externalLinkId: 2 })).rejects.toThrow('정확히 하나');
    expect(c.removeIssueRelation).not.toHaveBeenCalled();
    expect(c.removeIssueExternalLink).not.toHaveBeenCalled();
  });

  it('get_issue_detail: relations·externalLinks 를 싣고, 사용자 정의 유형이 있을 때만 유형 목록을 읽어 이름을 채운다', async () => {
    const c = mockClient();
    vi.mocked(c.getIssueDetail).mockResolvedValue(detailRaw);
    const t = buildSharedIssueTools(c).find((x) => x.name === 'get_issue_detail')!;
    const out = JSON.parse(resultText(await t.handler({ issueKey: 'WP-1' })));
    expect(out.relations).toEqual([{ relationId: 31, type: 'RELATES', label: '관련', issueKey: 'AB-7', title: '다른 팀', status: 'TODO' }]);
    expect(out.externalLinks[0]).toMatchObject({ externalLinkId: 41, type: '검토 요청', key: 'CLIM-1' });
    expect(c.listIssueRelationTypes).toHaveBeenCalledTimes(1);
    // 기본 유형뿐이면 유형 목록을 읽지 않는다.
    vi.mocked(c.listIssueRelationTypes).mockClear();
    vi.mocked(c.getIssueDetail).mockResolvedValue({ ...detailRaw, externalLinks: [] });
    await t.handler({ issueKey: 'WP-1' });
    expect(c.listIssueRelationTypes).not.toHaveBeenCalled();
  });

  it('get_issue_detail: 유형 목록 조회가 실패해도 상세는 돌려준다(type 은 이 이슈 쪽 말)', async () => {
    const c = mockClient();
    vi.mocked(c.getIssueDetail).mockResolvedValue(detailRaw);
    vi.mocked(c.listIssueRelationTypes).mockRejectedValue(new Error('boom'));
    const t = buildSharedIssueTools(c).find((x) => x.name === 'get_issue_detail')!;
    const out = JSON.parse(resultText(await t.handler({ issueKey: 'WP-1' })));
    expect(out.externalLinks[0].type).toBe('검토를 요청함');
  });
});
