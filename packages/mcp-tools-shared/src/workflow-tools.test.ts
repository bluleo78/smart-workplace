// src/workflow-tools.test.ts — 워크플로우 도구 6종(실행 get/start/move_issue_workflow·정의 get/validate/update_workflow, WP-1988) 테스트.
// 목은 서버 record 필드를 그대로 따른다 — IssueWorkflowView·UserSummary(id·username·name·kind), WorkflowSummary, MemberRow(userId).
// 필드가 빠진 목은 「숫자 id 를 뺀다」 단언이 아무것도 검증하지 못하기 때문이다.
import { describe, expect, it, vi } from 'vitest';
import { resultText } from './mcp-content.js';
import { describeApiError } from './parse.js';
import type { IssueWorkflowViewRow, MemberRow, WorkflowDetailRow, WorkflowProblemRow, WorkflowSummaryRow } from './tool-client.js';
import { buildWorkflowTools, formatProblems } from './workflow-tools.js';

/** 서버 UserSummary 모양의 사람(숫자 id 포함). */
const kim = { id: 42, username: 'kim', name: '김개발', kind: 'HUMAN' };
const lee = { id: 43, username: 'lee', name: '이검토', kind: 'HUMAN' };

/** 진행 중인 실행 view — 서버 IssueWorkflowView 와 같은 필드. */
const runningView: IssueWorkflowViewRow = {
  runId: 11,
  status: 'RUNNING',
  revision: 3,
  workflowId: 5,
  versionNo: 2,
  currentNode: {
    key: 'dev',
    name: '개발',
    type: 'task',
    roleKey: 'developer',
    assignees: [kim],
    enteredAt: '2026-11-23T01:00:00Z',
    nodeRunStatus: 'ACTIVE',
    instructions: 'PR 을 올리고 prUrl 을 남기세요.',
  },
  outcomes: [
    {
      key: 'done',
      name: '완료',
      toNode: 'review',
      requiredOutputs: [{ key: 'prUrl', name: 'PR 주소', type: 'string' }],
      requireComment: false,
      assignTo: 'reviewer',
      candidateAssignees: [lee],
      assigneeRequired: true,
    },
  ],
  path: [{ key: 'plan', name: '계획', outcome: 'ok', outcomeName: '확인', actor: kim, enteredAt: '2026-11-22T01:00:00Z', leftAt: '2026-11-23T01:00:00Z' }],
  remainingNodeKeys: ['review', 'end'],
  context: { plan: { summary: '요약' } },
};

/** 실행이 없는 이슈의 view — 서버 IssueWorkflowView.none(). */
const noneView: IssueWorkflowViewRow = {
  runId: null,
  status: null,
  revision: 0,
  workflowId: null,
  versionNo: null,
  currentNode: null,
  outcomes: [],
  path: [],
  remainingNodeKeys: [],
  context: {},
};

/** 서버 MemberSummary 모양의 검색 행. */
const member = (userId: number, username: string): MemberRow =>
  ({ userId, username, name: username, email: `${username}@x.com`, kind: 'HUMAN', active: true }) as MemberRow;

const wf = (id: number, name: string, enabled: boolean, activeVersionNo: number | null): WorkflowSummaryRow => ({
  id,
  name,
  enabled,
  activeVersionNo,
  draftChanged: false,
});

function mockClient() {
  return {
    getIssueWorkflow: vi.fn().mockResolvedValue(runningView),
    startIssueWorkflow: vi.fn().mockResolvedValue(runningView),
    moveIssueWorkflow: vi.fn().mockResolvedValue(runningView),
    listWorkflows: vi.fn().mockResolvedValue([]),
    getWorkflow: vi.fn(),
    getWorkflowVersionYaml: vi.fn(),
    createWorkflow: vi.fn(),
    saveWorkflowDraft: vi.fn(),
    validateWorkflow: vi.fn(),
    publishWorkflow: vi.fn(),
    getProjectMembers: vi.fn().mockResolvedValue([]),
    getMe: vi.fn(),
    getMember: vi.fn().mockRejectedValue({ response: { status: 404 } }),
    searchMembers: vi.fn().mockResolvedValue([]),
  };
}
type Client = ReturnType<typeof mockClient>;

const tool = (c: Client, name: string) => buildWorkflowTools(c).find((t) => t.name === name)!;
const out = (r: unknown) => JSON.parse(resultText(r as never));

/** axios 오류 모양 — 서버 WorkflowErrorResponse 본문. */
function apiError(status: number, errors: Record<string, string>, message = '거절') {
  return { response: { status, data: { status, error: 'x', message, errors, timestamp: 't', path: '/p', problems: [] } } };
}

/** 공유 레이어(workplace-mcp summarizeError·ai-agent)가 isError 텍스트로 만드는 방식 — 던진 axios 오류의 본문을 한 줄로. */
async function errorText(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    const r = (e as { response?: { status?: number; data?: unknown } }).response;
    return r ? describeApiError(r.status, r.data) : (e as Error).message;
  }
  throw new Error('오류가 나야 한다');
}

describe('get_issue_workflow', () => {
  it('getIssueWorkflow_showsInstructionsAndOutcomes: 지시·고를 결과를 싣고 사람은 username·name 만', async () => {
    const c = mockClient();
    const body = out(await tool(c, 'get_issue_workflow').handler({ issueKey: 'WP-7' }));
    expect(c.getIssueWorkflow).toHaveBeenCalledWith('WP-7');
    expect(body.currentNode.instructions).toBe('PR 을 올리고 prUrl 을 남기세요.');
    expect(body.currentNode.role).toBe('developer');
    expect(body.currentNode.assignees[0]).toEqual({ username: 'kim', name: '김개발' });
    expect(body.currentNode.assignees[0]).not.toHaveProperty('id');
    expect(body.outcomes[0]).toEqual({
      key: 'done',
      name: '완료',
      toNode: 'review',
      requiredOutputs: [{ key: 'prUrl', name: 'PR 주소', type: 'string' }],
      requireComment: false,
      assignTo: 'reviewer',
      candidates: [{ username: 'lee', name: '이검토' }],
      assigneeRequired: true,
    });
    expect(body).toMatchObject({ runId: 11, status: 'RUNNING', revision: 3, versionNo: 2, remaining: ['review', 'end'] });
    expect(body.path[0]).toMatchObject({ outcome: 'ok', outcomeName: '확인' });
    expect(body.path[0].actor).toEqual({ username: 'kim', name: '김개발' });
    expect(body.context).toEqual({ plan: { summary: '요약' } });
    expect(JSON.stringify(body)).not.toMatch(/"id":/);
  });

  it('qaUserIds_resolvedToUsernames: context._qa 의 askedBy·answeredBy·<@id> 를 사람 이름으로 풀고, 못 푼 id 는 숫자 없이 둔다', async () => {
    const c = mockClient();
    // 서버 WorkflowRunService.withQa 모양 — askedBy·answeredBy 는 숫자 사용자 id, 본문에는 멘션 토큰.
    c.getIssueWorkflow.mockResolvedValueOnce({
      ...runningView,
      context: {
        plan: { summary: '요약' },
        _qa: [
          { askNode: 'dev', answerNode: 'plan', question: '<@42> 확인? <@99>', askedBy: 42, answer: '네 <@43>', answeredBy: 99 },
          { askNode: 'dev', answerNode: 'plan', askedBy: 42 },
        ],
      },
    });
    c.getMember.mockImplementation(async (id: number) => {
      if (id === 42) return member(42, 'kim');
      if (id === 43) return member(43, 'lee');
      throw { response: { status: 404 } };
    });
    const body = out(await tool(c, 'get_issue_workflow').handler({ issueKey: 'WP-7' }));
    expect(body.context.plan).toEqual({ summary: '요약' });
    expect(body.context._qa).toEqual([
      { askNode: 'dev', answerNode: 'plan', question: '@kim(kim) 확인? @(알 수 없는 사용자)', askedBy: { username: 'kim', name: 'kim' }, answer: '네 @lee(lee)' },
      { askNode: 'dev', answerNode: 'plan', askedBy: { username: 'kim', name: 'kim' } },
    ]);
    // 같은 id 는 한 번만 조회한다(42·43·99 각 한 번).
    expect(c.getMember).toHaveBeenCalledTimes(3);
    expect(JSON.stringify(body)).not.toMatch(/<@\d+>|"askedBy":\d|"answeredBy"/);
  });

  it('_qa 가 없으면 구성원을 조회하지 않는다', async () => {
    const c = mockClient();
    await tool(c, 'get_issue_workflow').handler({ issueKey: 'WP-7' });
    expect(c.getMember).not.toHaveBeenCalled();
  });

  it('noActiveRun_saysStartFirst: 실행이 없으면 start_issue_workflow 로 시작하라고만 한다', async () => {
    const c = mockClient();
    c.getIssueWorkflow.mockResolvedValueOnce(noneView);
    const text = resultText((await tool(c, 'get_issue_workflow').handler({ issueKey: 'WP-7' })) as never);
    expect(text).toContain('start_issue_workflow');
    expect(JSON.parse(text)).toEqual({ status: null, hint: '진행 중인 워크플로우가 없습니다 — start_issue_workflow 로 시작하세요.' });
  });
});

describe('start_issue_workflow', () => {
  it('start_withoutName_multipleEnabled_listsNames: 켜진 게시본이 여럿이면 이름을 대라고 거절한다', async () => {
    const c = mockClient();
    c.listWorkflows.mockResolvedValueOnce([wf(1, '개발', true, 1), wf(2, '버그', true, 3), wf(3, '꺼짐', false, 1)]);
    await expect(tool(c, 'start_issue_workflow').handler({ issueKey: 'WP-7' })).rejects.toThrow(
      '워크플로우가 여럿입니다 — workflowName 을 주세요 (있는 것: 개발, 버그)',
    );
    expect(c.listWorkflows).toHaveBeenCalledWith('WP');
    expect(c.startIssueWorkflow).not.toHaveBeenCalled();
  });

  it('이름 없이 켜진 게시본이 하나면 그것으로 시작하고 get 과 같은 모양으로 답한다', async () => {
    const c = mockClient();
    c.listWorkflows.mockResolvedValueOnce([wf(1, '개발', true, 1), wf(2, '초안만', true, null), wf(3, '꺼짐', false, 1)]);
    const body = out(await tool(c, 'start_issue_workflow').handler({ issueKey: 'WP-7' }));
    expect(c.startIssueWorkflow).toHaveBeenCalledWith('WP-7', 1);
    expect(body.currentNode.key).toBe('dev');
  });

  it('이름 없이 켜진 게시본이 없으면 거절한다', async () => {
    const c = mockClient();
    c.listWorkflows.mockResolvedValueOnce([wf(2, '초안만', true, null), wf(3, '꺼짐', false, 1)]);
    await expect(tool(c, 'start_issue_workflow').handler({ issueKey: 'WP-7' })).rejects.toThrow('켜진(게시된) 워크플로우가 없습니다.');
  });

  it('start_byName_caseInsensitive: 정확히 같은 이름이 없으면 대소문자를 무시해 고른다', async () => {
    const c = mockClient();
    c.listWorkflows.mockResolvedValueOnce([wf(1, 'Dev Flow', true, 1), wf(2, 'Bug', true, 1)]);
    await tool(c, 'start_issue_workflow').handler({ issueKey: 'WP-7', workflowName: 'dev flow' });
    expect(c.startIssueWorkflow).toHaveBeenCalledWith('WP-7', 1);
  });

  it('정확히 같은 이름이 대소문자 무시 후보보다 먼저다', async () => {
    const c = mockClient();
    c.listWorkflows.mockResolvedValueOnce([wf(1, 'dev', true, 1), wf(2, 'Dev', true, 1)]);
    await tool(c, 'start_issue_workflow').handler({ issueKey: 'WP-7', workflowName: 'Dev' });
    expect(c.startIssueWorkflow).toHaveBeenCalledWith('WP-7', 2);
  });

  it('없는 이름이면 있는 이름을 함께 알린다', async () => {
    const c = mockClient();
    c.listWorkflows.mockResolvedValueOnce([wf(1, 'dev', true, 1), wf(2, 'bug', false, 1)]);
    await expect(tool(c, 'start_issue_workflow').handler({ issueKey: 'WP-7', workflowName: 'ops' })).rejects.toThrow(
      '워크플로우를 찾을 수 없습니다: ops (있는 것: dev, bug)',
    );
    expect(c.startIssueWorkflow).not.toHaveBeenCalled();
  });

  it('pick_ambiguousName_saysExactName: 대소문자만 다른 여럿이면 「찾을 수 없음」이 아니라 정확한 이름을 달라고 거절한다', async () => {
    const c = mockClient();
    c.listWorkflows.mockResolvedValueOnce([wf(1, 'dev', true, 1), wf(2, 'DEV', true, 1)]);
    await expect(tool(c, 'start_issue_workflow').handler({ issueKey: 'WP-7', workflowName: 'Dev' })).rejects.toThrow(
      '이름이 대소문자만 다른 워크플로우가 여럿입니다: Dev (있는 것: dev, DEV) — 정확한 이름을 주세요.',
    );
    expect(c.startIssueWorkflow).not.toHaveBeenCalled();
  });
});

describe('move_issue_workflow', () => {
  const base = { issueKey: 'WP-7', fromNode: 'dev', outcome: 'done', expectedRevision: 3 };

  it('description_explainsAskGoesToChat: ask 의견은 이슈 챗 질문으로 남고 챗 답이 answered 로 되돌린다고 안내한다(WP-2093)', () => {
    const c = mockClient();
    const description = tool(c, 'move_issue_workflow').description;
    expect(description).toContain('issue chat');
    expect(description).toContain('answered');
    expect(description).toContain('get_issue_chat');
    // 결과(outcome)는 get_issue_workflow 가 돌려준 후보에서 고른다 — 출처 안내를 지우지 않는다(WP-2093 리뷰 후속).
    expect(description).toContain('by an outcome from get_issue_workflow');
    // 질문 의견은 챗 글 상한(4000자)을 넘으면 서버가 422 로 거절한다 — 미리 알린다(WP-2093 리뷰 후속).
    // 상한은 @username 을 <@id> 토큰으로 바꾼 뒤 글자로 잰다 — 도구 검사·서버 판정과 같은 기준임을 알린다.
    expect(description).toContain('max 4000 chars after @username→<@id>');
  });

  it('move_askCommentTooLongAfterLinking_rejectedBeforeServer: 멘션 토큰으로 바꾼 뒤 4000자를 넘는 질문 의견은 서버를 부르지 않고 몇 자인지 알려 거절한다', async () => {
    const c = mockClient();
    c.searchMembers.mockResolvedValue([member(12345, 'kim')]);
    // 바꾸기 전 4000자(@kim 4자 + 3996자) — <@12345> 로 바뀌면 4004자가 된다.
    const comment = '@kim ' + 'a'.repeat(3995);
    expect([...comment].length).toBe(4000);
    await expect(tool(c, 'move_issue_workflow').handler({ ...base, outcome: 'ask', comment })).rejects.toThrow(
      '질문 의견이 4004자입니다(@username 을 <@id> 멘션 토큰으로 바꾼 뒤 기준) — 4000자 이하로 줄여 다시 보내세요.',
    );
    expect(c.moveIssueWorkflow).not.toHaveBeenCalled();
  });

  it('move_askCommentAtLimitAfterLinking_sent: 바뀐 뒤 딱 4000자(코드포인트)면 그대로 보낸다', async () => {
    const c = mockClient();
    c.searchMembers.mockResolvedValue([member(12345, 'kim')]);
    // 이모지(서로게이트 쌍)도 서버처럼 한 글자로 센다 — <@12345>(8) + 공백(1) + 이모지 3991개 = 4000자.
    const comment = '@kim ' + '😀'.repeat(3991);
    await tool(c, 'move_issue_workflow').handler({ ...base, outcome: 'ask', comment });
    expect(c.moveIssueWorkflow).toHaveBeenCalledWith('WP-7', expect.objectContaining({ comment: '<@12345> ' + '😀'.repeat(3991) }));
  });

  it('assigneesByUsername_resolvedToIds: username 을 id 로 풀고 idempotencyKey 를 규칙대로 만든다', async () => {
    const c = mockClient();
    c.getProjectMembers.mockResolvedValue([member(42, 'kim')]);
    const body = out(
      await tool(c, 'move_issue_workflow').handler({ ...base, assignees: ['kim'], outputs: { prUrl: 'https://x/pr/1' }, comment: '올림' }),
    );
    expect(c.moveIssueWorkflow).toHaveBeenCalledWith('WP-7', {
      fromNode: 'dev',
      outcome: 'done',
      outputs: { prUrl: 'https://x/pr/1' },
      assigneeIds: [42],
      comment: '올림',
      expectedRevision: 3,
      idempotencyKey: 'WP-7:dev:3:done',
    });
    expect(body.currentNode.key).toBe('dev');
  });

  it('move_commentMentions_linked: 의견의 @username 을 <@id> 멘션 토큰으로 바꿔 보낸다 — ask 의견이 챗 질문이 되어 멘션 알림이 가게(WP-2093)', async () => {
    const c = mockClient();
    c.searchMembers.mockResolvedValue([member(42, 'kim')]);
    await tool(c, 'move_issue_workflow').handler({ ...base, outcome: 'ask', comment: '@kim A 와 B 중 어느 쪽?' });
    expect(c.moveIssueWorkflow).toHaveBeenCalledWith('WP-7', {
      fromNode: 'dev',
      outcome: 'ask',
      comment: '<@42> A 와 B 중 어느 쪽?',
      expectedRevision: 3,
      idempotencyKey: 'WP-7:dev:3:ask',
    });
  });

  it('assignees·outputs·comment 를 안 주면 본문에 싣지 않는다', async () => {
    const c = mockClient();
    await tool(c, 'move_issue_workflow').handler({ ...base, assignees: null, comment: null });
    expect(c.moveIssueWorkflow).toHaveBeenCalledWith('WP-7', {
      fromNode: 'dev',
      outcome: 'done',
      expectedRevision: 3,
      idempotencyKey: 'WP-7:dev:3:done',
    });
    expect(c.getProjectMembers).not.toHaveBeenCalled();
  });

  it('move_runId_forwarded: runId 를 주면 본문에 싣는다(get_issue_workflow 의 실행을 겨눈다)', async () => {
    const c = mockClient();
    await tool(c, 'move_issue_workflow').handler({ ...base, runId: 11 });
    expect(c.moveIssueWorkflow).toHaveBeenCalledWith('WP-7', {
      fromNode: 'dev',
      outcome: 'done',
      expectedRevision: 3,
      idempotencyKey: 'WP-7:dev:3:done',
      runId: 11,
    });
  });

  it('runId 는 양의 정수만 받는다', async () => {
    const c = mockClient();
    await expect(tool(c, 'move_issue_workflow').handler({ ...base, runId: 0 })).rejects.toThrow();
    expect(c.moveIssueWorkflow).not.toHaveBeenCalled();
  });

  it('move_askWithMockupsAndOptions_forwarded: ask 의견과 함께 준 fileIds·options 를 본문에 싣는다(WP-2147 — 시안을 보고 칩으로 고르게)', async () => {
    const c = mockClient();
    await tool(c, 'move_issue_workflow').handler({
      ...base,
      outcome: 'ask',
      comment: '배치 두 안 중 고르세요',
      fileIds: [31, 32],
      options: [' 1안 — 카드형 ', '2안 — 표형'],
    });
    expect(c.moveIssueWorkflow).toHaveBeenCalledWith('WP-7', {
      fromNode: 'dev',
      outcome: 'ask',
      comment: '배치 두 안 중 고르세요',
      expectedRevision: 3,
      idempotencyKey: 'WP-7:dev:3:ask',
      fileIds: [31, 32],
      options: ['1안 — 카드형', '2안 — 표형'],
    });
  });

  it('move_extrasWithoutComment_rejectedBeforeServer: 질문 글(의견) 없이 fileIds·options 를 주면 서버를 부르지 않고 거절한다(WP-2147)', async () => {
    const c = mockClient();
    await expect(tool(c, 'move_issue_workflow').handler({ ...base, outcome: 'ask', fileIds: [31] })).rejects.toThrow(/질문 글/);
    await expect(
      tool(c, 'move_issue_workflow').handler({ ...base, outcome: 'ask', comment: '  ', options: ['가', '나'] }),
    ).rejects.toThrow(/질문 글/);
    expect(c.moveIssueWorkflow).not.toHaveBeenCalled();
  });

  it('move_optionsShape_validated: 선택지는 2~4개·중복 없이 — report_agent_work 와 같은 규칙(WP-2147)', async () => {
    const c = mockClient();
    const t = tool(c, 'move_issue_workflow');
    await expect(t.handler({ ...base, outcome: 'ask', comment: 'q', options: ['하나'] })).rejects.toThrow();
    await expect(t.handler({ ...base, outcome: 'ask', comment: 'q', options: ['가', ' 가 '] })).rejects.toThrow(/distinct/);
    expect(c.moveIssueWorkflow).not.toHaveBeenCalled();
  });

  it('move_blankComment_omitted: 공백뿐인 comment 는 본문에서 뺀다', async () => {
    const c = mockClient();
    await tool(c, 'move_issue_workflow').handler({ ...base, comment: '   ' });
    expect(c.moveIssueWorkflow).toHaveBeenCalledWith('WP-7', {
      fromNode: 'dev',
      outcome: 'done',
      expectedRevision: 3,
      idempotencyKey: 'WP-7:dev:3:done',
    });
  });

  it('move_unknownAssignee_failsBeforeServer: 프로젝트 멤버가 아니면 서버를 부르지 않고 사용 가능 username 을 안내한다', async () => {
    const c = mockClient();
    c.getProjectMembers.mockResolvedValue([member(42, 'kim')]);
    await expect(tool(c, 'move_issue_workflow').handler({ ...base, assignees: ['kim', 'ghost'] })).rejects.toThrow(
      /ghost.*사용 가능 username: kim/,
    );
    expect(c.getProjectMembers).toHaveBeenCalledWith('WP');
    expect(c.moveIssueWorkflow).not.toHaveBeenCalled();
  });

  it('move_meAssignee_resolvedToCaller: "me" 는 호출자 본인 id 로 푼다', async () => {
    const c = mockClient();
    c.getProjectMembers.mockResolvedValue([member(42, 'kim')]);
    c.getMe.mockResolvedValue({ id: 42, username: 'kim' });
    await tool(c, 'move_issue_workflow').handler({ ...base, assignees: ['me'] });
    expect(c.moveIssueWorkflow.mock.calls[0][1].assigneeIds).toEqual([42]);
  });

  it('move_staleRevision_returnsCurrentNodeHint: 409 STALE 은 오류 경로로 code·지금 노드·revision 을 한 줄에 보인다', async () => {
    const c = mockClient();
    const err = apiError(409, { code: 'WORKFLOW_STALE', currentNode: 'review', revision: '5' }, '그사이 워크플로우가 바뀌었습니다.');
    c.moveIssueWorkflow.mockRejectedValueOnce(err);
    const text = await errorText(tool(c, 'move_issue_workflow').handler(base));
    expect(text).toContain('409');
    expect(text).toContain('WORKFLOW_STALE');
    expect(text).toContain('currentNode: review');
    expect(text).toContain('revision: 5');
  });

  it('move_outputMissing_namesTheKey: 422 OUTPUT_MISSING 은 빠진 키를 보인다', async () => {
    const c = mockClient();
    c.moveIssueWorkflow.mockRejectedValueOnce(apiError(422, { code: 'WORKFLOW_OUTPUT_MISSING', keys: 'prUrl' }, '꼭 내놓아야 할 값이 빠졌습니다.'));
    const text = await errorText(tool(c, 'move_issue_workflow').handler(base));
    expect(text).toContain('WORKFLOW_OUTPUT_MISSING');
    expect(text).toContain('prUrl');
  });

  // Review Focus 3: 서버 오류 errors 칸에 숫자 사용자 id 가 들어가는지 서버를 읽어 확인했다 — 없다.
  // MoveViolation 의 errors 칸은 STALE 의 currentNode·revision, 출력의 keys, 담당의 role·candidates 뿐이고,
  // candidates 는 AssigneeResolution.usernames(…)가 만든 「username 쉼표 목록」이다(id 가 아니다). WorkflowException 의 다른 사유는 errors 가 code 뿐.
  // 그래서 도구는 오류를 가공하지 않고 그대로 다시 던진다 — 이 테스트는 「errors 를 그대로 둔다」를 단언한다.
  it('move_errorDetails_noUserIds: 서버 errors(candidates 는 username 목록)를 바꾸지 않고 그대로 던진다', async () => {
    const c = mockClient();
    c.getProjectMembers.mockResolvedValue([member(42, 'kim')]);
    const err = apiError(422, { code: 'WORKFLOW_ASSIGNEE_NOT_IN_ROLE', role: 'reviewer', candidates: 'lee,park' });
    c.moveIssueWorkflow.mockRejectedValueOnce(err);
    await expect(tool(c, 'move_issue_workflow').handler({ ...base, assignees: ['kim'] })).rejects.toBe(err);
    expect(err.response.data.errors).toEqual({ code: 'WORKFLOW_ASSIGNEE_NOT_IN_ROLE', role: 'reviewer', candidates: 'lee,park' });
    const text = await errorText(Promise.reject(err));
    expect(text).toContain('candidates: lee,park');
    expect(text).not.toMatch(/\b42\b/);
  });

  it('같은 username 을 두 번 줘도 멤버 조회는 한 번이고 id 는 그대로 보낸다', async () => {
    const c = mockClient();
    c.getProjectMembers.mockResolvedValue([member(42, 'kim')]);
    await tool(c, 'move_issue_workflow').handler({ ...base, assignees: ['kim', 'kim'] });
    expect(c.getProjectMembers).toHaveBeenCalledTimes(1);
    expect(c.moveIssueWorkflow.mock.calls[0][1].assigneeIds).toEqual([42]);
  });

  it('expectedRevision 은 필수다', async () => {
    const c = mockClient();
    await expect(tool(c, 'move_issue_workflow').handler({ issueKey: 'WP-7', fromNode: 'dev', outcome: 'done' })).rejects.toThrow();
    expect(c.moveIssueWorkflow).not.toHaveBeenCalled();
  });
});

describe('도구 메타', () => {
  it('실행 3종은 issue 앱·정의 3종은 project 앱이고, get·validate 는 read, start·move·update 는 비파괴 write 다', () => {
    const tools = buildWorkflowTools(mockClient());
    const meta = Object.fromEntries(tools.map((t) => [t.name, [t.app, t.kind, t.hints ?? null]]));
    expect(meta).toEqual({
      get_issue_workflow: ['issue', 'read', null],
      start_issue_workflow: ['issue', 'write', { destructive: false, idempotent: false }],
      move_issue_workflow: ['issue', 'write', { destructive: false, idempotent: true }],
      get_workflow: ['project', 'read', null],
      validate_workflow: ['project', 'read', null],
      update_workflow: ['project', 'write', { destructive: false, idempotent: false }],
    });
  });
});

/** 서버 WorkflowProblem 모양의 문제 한 건. */
const problem = (severity: 'ERROR' | 'WARNING', line: number, code: string, nodeKey: string | null = null): WorkflowProblemRow => ({
  severity,
  code,
  message: `${code} 문제`,
  line,
  column: 3,
  nodeKey,
});

/** 서버 WorkflowDetail 모양 — 게시한 사람(WorkflowActor)은 숫자 id 를 갖는다. */
const detail = (over: Partial<WorkflowDetailRow> = {}): WorkflowDetailRow => ({
  id: 5,
  projectId: 9,
  name: '개발',
  enabled: true,
  activeVersion: { no: 2, createdAt: '2026-11-20T00:00:00Z', createdBy: { id: 42, username: 'kim', name: '김개발' } },
  draftYaml: 'name: 개발\n',
  draftUpdatedAt: '2026-11-22T00:00:00Z',
  draftProblems: [],
  ...over,
});

describe('formatProblems', () => {
  it('줄:열 [SEVERITY CODE] 메시지 에 노드가 있으면 (노드 key) 를 붙인다', () => {
    expect(
      formatProblems([
        { line: 12, column: 3, severity: 'ERROR', code: 'UNKNOWN_NODE', message: '없는 노드', nodeKey: 'dev' },
        { line: 1, column: 1, severity: 'WARNING', code: 'UNUSED', message: '안 쓰임', nodeKey: null },
      ]),
    ).toEqual(['12:3 [ERROR UNKNOWN_NODE] 없는 노드 (노드 dev)', '1:1 [WARNING UNUSED] 안 쓰임']);
  });
});

describe('get_workflow', () => {
  it('getWorkflow_list_and_detail: 이름 없으면 목록, 이름 있으면 상세(게시한 사람은 username·name 만)', async () => {
    const c = mockClient();
    c.listWorkflows.mockResolvedValue([{ ...wf(5, '개발', true, 2), draftChanged: true }, wf(6, '버그', false, null)]);
    const list = out(await tool(c, 'get_workflow').handler({ projectKey: 'WP' }));
    expect(c.listWorkflows).toHaveBeenCalledWith('WP');
    expect(list).toEqual({
      workflows: [
        { name: '개발', enabled: true, activeVersionNo: 2, draftChanged: true },
        { name: '버그', enabled: false, activeVersionNo: null, draftChanged: false },
      ],
    });

    c.getWorkflow.mockResolvedValueOnce(detail({ draftProblems: [problem('WARNING', 4, 'UNUSED')] }));
    c.getWorkflowVersionYaml.mockResolvedValueOnce('name: 개발 게시본\n');
    const body = out(await tool(c, 'get_workflow').handler({ projectKey: 'WP', name: '개발' }));
    expect(c.getWorkflow).toHaveBeenCalledWith(5);
    expect(c.getWorkflowVersionYaml).toHaveBeenCalledWith(5, 2);
    expect(body).toEqual({
      name: '개발',
      enabled: true,
      activeVersionNo: 2,
      publishedAt: '2026-11-20T00:00:00Z',
      publishedBy: { username: 'kim', name: '김개발' },
      draftYaml: 'name: 개발\n',
      draftUpdatedAt: '2026-11-22T00:00:00Z',
      draftProblems: ['4:3 [WARNING UNUSED] UNUSED 문제'],
      publishedYaml: 'name: 개발 게시본\n',
    });
    expect(JSON.stringify(body)).not.toMatch(/"id":/);
  });

  it('초안이 게시본과 같으면 publishedYaml 을 붙이지 않는다(대소문자 무시로 찾는다)', async () => {
    const c = mockClient();
    c.listWorkflows.mockResolvedValue([wf(5, 'Dev', true, 2)]);
    c.getWorkflow.mockResolvedValueOnce(detail({ name: 'Dev' }));
    c.getWorkflowVersionYaml.mockResolvedValueOnce('name: 개발\n');
    const body = out(await tool(c, 'get_workflow').handler({ projectKey: 'WP', name: 'dev' }));
    expect(c.getWorkflowVersionYaml).toHaveBeenCalledWith(5, 2);
    expect(body).not.toHaveProperty('publishedYaml');
  });

  it('getWorkflow_staleListDraftChanged_decidesFromDetail: 목록이 초안 같음이라 해도 상세 초안이 게시본과 다르면 publishedYaml 을 싣는다', async () => {
    const c = mockClient();
    // 목록을 읽은 뒤 그사이 누가 초안을 바꿨다 — 목록 draftChanged 는 false 지만 상세 draftYaml 은 게시본과 다르다.
    c.listWorkflows.mockResolvedValue([wf(5, '개발', true, 2)]);
    c.getWorkflow.mockResolvedValueOnce(detail({ draftYaml: 'name: 개발 새 초안\n' }));
    c.getWorkflowVersionYaml.mockResolvedValueOnce('name: 개발\n');
    const body = out(await tool(c, 'get_workflow').handler({ projectKey: 'WP', name: '개발' }));
    expect(body).toMatchObject({ draftYaml: 'name: 개발 새 초안\n', publishedYaml: 'name: 개발\n' });
  });

  it('getWorkflow_publishedYaml_usesDetailActiveVersion: 목록을 읽은 뒤 그사이 게시돼도 상세의 activeVersion.no 버전 YAML 을 읽는다', async () => {
    const c = mockClient();
    // 목록은 2번이 활성이라 했지만 상세를 읽을 때는 3번이 게시돼 있다.
    c.listWorkflows.mockResolvedValue([{ ...wf(5, '개발', true, 2), draftChanged: true }]);
    c.getWorkflow.mockResolvedValueOnce(detail({ activeVersion: { no: 3, createdAt: '2026-11-23T00:00:00Z', createdBy: null } }));
    c.getWorkflowVersionYaml.mockResolvedValueOnce('name: 개발 3판\n');
    const body = out(await tool(c, 'get_workflow').handler({ projectKey: 'WP', name: '개발' }));
    expect(c.getWorkflowVersionYaml).toHaveBeenCalledWith(5, 3);
    expect(body).toMatchObject({ activeVersionNo: 3, publishedYaml: 'name: 개발 3판\n' });
  });

  it('게시한 적 없으면 activeVersionNo·publishedAt·publishedBy 가 null 이다', async () => {
    const c = mockClient();
    c.listWorkflows.mockResolvedValue([{ ...wf(5, '개발', true, null), draftChanged: true }]);
    c.getWorkflow.mockResolvedValueOnce(detail({ activeVersion: null }));
    const body = out(await tool(c, 'get_workflow').handler({ projectKey: 'WP', name: '개발' }));
    expect(body).toMatchObject({ activeVersionNo: null, publishedAt: null, publishedBy: null });
    expect(body).not.toHaveProperty('publishedYaml');
    expect(c.getWorkflowVersionYaml).not.toHaveBeenCalled();
  });
});

describe('validate_workflow', () => {
  it('validateWorkflow_okWhenOnlyWarnings: 경고만 있으면 ok, 오류가 하나라도 있으면 ok 가 아니다', async () => {
    const c = mockClient();
    c.validateWorkflow.mockResolvedValueOnce({ problems: [problem('WARNING', 2, 'UNUSED')] });
    const ok = out(await tool(c, 'validate_workflow').handler({ projectKey: 'WP', yaml: 'a: 1' }));
    expect(c.validateWorkflow).toHaveBeenCalledWith('WP', 'a: 1');
    expect(ok).toEqual({ ok: true, problems: ['2:3 [WARNING UNUSED] UNUSED 문제'] });

    c.validateWorkflow.mockResolvedValueOnce({ problems: [problem('ERROR', 7, 'BAD', 'dev')] });
    const bad = out(await tool(c, 'validate_workflow').handler({ projectKey: 'WP', yaml: 'a: 1' }));
    expect(bad).toEqual({ ok: false, problems: ['7:3 [ERROR BAD] BAD 문제 (노드 dev)'] });
  });
});

describe('update_workflow', () => {
  it('saveWorkflow_errors_listLineNumbers: 저장 응답의 문제를 줄 번호와 함께 보인다', async () => {
    const c = mockClient();
    c.listWorkflows.mockResolvedValue([wf(5, '개발', true, 2)]);
    c.saveWorkflowDraft.mockResolvedValueOnce({
      draftUpdatedAt: 't',
      problems: [{ line: 12, column: 3, severity: 'ERROR', code: 'UNKNOWN_NODE', message: '없는 노드입니다', nodeKey: 'dev' }],
    });
    const text = resultText((await tool(c, 'update_workflow').handler({ projectKey: 'WP', name: '개발', yaml: 'y' })) as never);
    expect(text).toContain('12:3 [ERROR UNKNOWN_NODE]');
    expect(JSON.parse(text)).toEqual({ saved: true, created: false, problems: ['12:3 [ERROR UNKNOWN_NODE] 없는 노드입니다 (노드 dev)'] });
  });

  it('update_existing_savesDraft: 있는 이름이면(대소문자 무시) 초안을 저장하고 만들지 않는다', async () => {
    const c = mockClient();
    c.listWorkflows.mockResolvedValue([wf(5, 'Dev', true, 2)]);
    c.saveWorkflowDraft.mockResolvedValueOnce({ draftUpdatedAt: 't', problems: [] });
    const body = out(await tool(c, 'update_workflow').handler({ projectKey: 'WP', name: 'dev', yaml: 'y' }));
    expect(c.saveWorkflowDraft).toHaveBeenCalledWith(5, 'y', undefined);
    expect(c.createWorkflow).not.toHaveBeenCalled();
    expect(c.publishWorkflow).not.toHaveBeenCalled();
    expect(body).toEqual({ saved: true, created: false, problems: [] });
  });

  it('update_expectedDraftUpdatedAt_forwarded: 주면 초안 저장에 넘기고, 그사이 바뀌어 409 WORKFLOW_DRAFT_CONFLICT 면 그대로 던진다', async () => {
    const c = mockClient();
    c.listWorkflows.mockResolvedValue([wf(5, '개발', true, 2)]);
    c.saveWorkflowDraft.mockResolvedValueOnce({ draftUpdatedAt: 't2', problems: [] });
    await tool(c, 'update_workflow').handler({ projectKey: 'WP', name: '개발', yaml: 'y', expectedDraftUpdatedAt: '2026-11-22T00:00:00Z' });
    expect(c.saveWorkflowDraft).toHaveBeenCalledWith(5, 'y', '2026-11-22T00:00:00Z');

    const err = apiError(409, { code: 'WORKFLOW_DRAFT_CONFLICT' }, '그사이 초안이 바뀌었습니다.');
    c.saveWorkflowDraft.mockRejectedValueOnce(err);
    await expect(
      tool(c, 'update_workflow').handler({ projectKey: 'WP', name: '개발', yaml: 'y', expectedDraftUpdatedAt: 'old', publish: true }),
    ).rejects.toBe(err);
    expect(c.publishWorkflow).not.toHaveBeenCalled();
  });

  it('update_newName_createsThenPublishes: 새 이름이면 만들고 publish 면 게시한다', async () => {
    const c = mockClient();
    c.listWorkflows.mockResolvedValue([wf(5, '개발', true, 2)]);
    c.createWorkflow.mockResolvedValueOnce(detail({ id: 8, name: '버그', activeVersion: null, draftProblems: [problem('WARNING', 1, 'UNUSED')] }));
    c.publishWorkflow.mockResolvedValueOnce({ versionNo: 1, runningRunsOnOlderVersions: 0 });
    const body = out(await tool(c, 'update_workflow').handler({ projectKey: 'WP', name: '버그', yaml: 'y', publish: true }));
    expect(c.createWorkflow).toHaveBeenCalledWith('WP', '버그', 'y');
    expect(c.saveWorkflowDraft).not.toHaveBeenCalled();
    expect(c.publishWorkflow).toHaveBeenCalledWith(8, '2026-11-22T00:00:00Z');
    expect(body).toEqual({
      saved: true,
      created: true,
      published: true,
      versionNo: 1,
      runningRunsOnOlderVersions: 0,
      problems: ['1:3 [WARNING UNUSED] UNUSED 문제'],
    });
  });

  it('update_existingPublish_forwardsDraftUpdatedAt: 저장 응답의 draftUpdatedAt 을 게시의 expectedDraftUpdatedAt 으로 넘긴다', async () => {
    const c = mockClient();
    c.listWorkflows.mockResolvedValue([wf(5, '개발', true, 2)]);
    c.saveWorkflowDraft.mockResolvedValueOnce({ draftUpdatedAt: '2026-11-23T01:02:03Z', problems: [] });
    c.publishWorkflow.mockResolvedValueOnce({ versionNo: 3, runningRunsOnOlderVersions: 0 });
    await tool(c, 'update_workflow').handler({ projectKey: 'WP', name: '개발', yaml: 'y', publish: true });
    expect(c.publishWorkflow).toHaveBeenCalledWith(5, '2026-11-23T01:02:03Z');
  });

  it('update_publishDraftConflict409_passesThrough: 게시가 409 WORKFLOW_DRAFT_CONFLICT 면 그대로 던진다', async () => {
    const c = mockClient();
    c.listWorkflows.mockResolvedValue([wf(5, '개발', true, 2)]);
    c.saveWorkflowDraft.mockResolvedValueOnce({ draftUpdatedAt: 't', problems: [] });
    const err = apiError(409, { code: 'WORKFLOW_DRAFT_CONFLICT' }, '그사이 초안이 바뀌었습니다.');
    c.publishWorkflow.mockRejectedValueOnce(err);
    await expect(tool(c, 'update_workflow').handler({ projectKey: 'WP', name: '개발', yaml: 'y', publish: true })).rejects.toBe(err);
  });

  it('update_publishWithErrors_skipsPublish: 오류가 있으면 저장만 하고 게시를 부르지 않는다', async () => {
    const c = mockClient();
    c.listWorkflows.mockResolvedValue([wf(5, '개발', true, 2)]);
    c.saveWorkflowDraft.mockResolvedValueOnce({ draftUpdatedAt: 't', problems: [problem('ERROR', 3, 'BAD')] });
    const body = out(await tool(c, 'update_workflow').handler({ projectKey: 'WP', name: '개발', yaml: 'y', publish: true }));
    expect(c.publishWorkflow).not.toHaveBeenCalled();
    expect(body).toEqual({
      saved: true,
      created: false,
      published: false,
      reason: '오류가 있어 게시하지 않았습니다.',
      problems: ['3:3 [ERROR BAD] BAD 문제'],
    });
  });

  it('update_publishRejected422_listsProblems: 게시가 422 WORKFLOW_INVALID 면 문제 줄을 오류 문장에 붙인다', async () => {
    const c = mockClient();
    c.listWorkflows.mockResolvedValue([wf(5, '개발', true, 2)]);
    c.saveWorkflowDraft.mockResolvedValueOnce({ draftUpdatedAt: 't', problems: [] });
    const err = apiError(422, { code: 'WORKFLOW_INVALID' }, '워크플로우에 오류가 있습니다.');
    err.response.data.problems = [problem('ERROR', 9, 'ROLE_EMPTY', 'review')] as never;
    c.publishWorkflow.mockRejectedValueOnce(err);
    const text = await errorText(tool(c, 'update_workflow').handler({ projectKey: 'WP', name: '개발', yaml: 'y', publish: true }));
    expect(text).toContain('422');
    expect(text).toContain('WORKFLOW_INVALID');
    expect(text).toContain('워크플로우에 오류가 있습니다.');
    expect(text).toContain('9:3 [ERROR ROLE_EMPTY] ROLE_EMPTY 문제 (노드 review)');
  });

  it('게시의 다른 오류(403 등)는 그대로 던진다', async () => {
    const c = mockClient();
    c.listWorkflows.mockResolvedValue([wf(5, '개발', true, 2)]);
    c.saveWorkflowDraft.mockResolvedValueOnce({ draftUpdatedAt: 't', problems: [] });
    const err = apiError(403, { code: 'FORBIDDEN' });
    c.publishWorkflow.mockRejectedValueOnce(err);
    await expect(tool(c, 'update_workflow').handler({ projectKey: 'WP', name: '개발', yaml: 'y', publish: true })).rejects.toBe(err);
  });

  it('update_expectedDraftUpdatedAt_unknownName_rejects: 본 초안 시각을 줬는데 이름이 없으면 새로 만들지 않고 거절한다', async () => {
    const c = mockClient();
    c.listWorkflows.mockResolvedValue([wf(5, '개발', true, 2)]);
    await expect(
      tool(c, 'update_workflow').handler({ projectKey: 'WP', name: '개발2', yaml: 'y', expectedDraftUpdatedAt: '2026-11-22T00:00:00Z', publish: true }),
    ).rejects.toThrow('이름 개발2 의 워크플로우가 없습니다 — get_workflow 로 이름을 확인하세요 (있는 것: 개발)');
    expect(c.createWorkflow).not.toHaveBeenCalled();
    expect(c.saveWorkflowDraft).not.toHaveBeenCalled();
    expect(c.publishWorkflow).not.toHaveBeenCalled();
  });

  it('워크플로우가 하나도 없으면 「있는 것: 없음」으로 알린다', async () => {
    const c = mockClient();
    await expect(
      tool(c, 'update_workflow').handler({ projectKey: 'WP', name: '개발', yaml: 'y', expectedDraftUpdatedAt: 't' }),
    ).rejects.toThrow('(있는 것: 없음)');
  });

  it('대소문자만 다른 여럿과 겹치면 새로 만들지 않고 거절한다', async () => {
    const c = mockClient();
    c.listWorkflows.mockResolvedValue([wf(1, 'dev', true, 1), wf(2, 'DEV', true, 1)]);
    await expect(tool(c, 'update_workflow').handler({ projectKey: 'WP', name: 'Dev', yaml: 'y' })).rejects.toThrow(/dev, DEV/);
    expect(c.createWorkflow).not.toHaveBeenCalled();
    expect(c.saveWorkflowDraft).not.toHaveBeenCalled();
  });
});
