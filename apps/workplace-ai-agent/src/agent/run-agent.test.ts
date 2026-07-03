import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// 인-프로세스 러너·MCP 서버를 모킹 — 호출 인자만 검증(LLM/네트워크 미실행).
vi.mock('./sdk-runner.js', () => ({
  runSdkCollect: vi.fn().mockResolvedValue([]),
}));
const MCP_SENTINEL = { __sentinel: 'workplace-mcp' };
vi.mock('./sdk-mcp-server.js', () => ({
  buildInProcessWorkplaceMcpServer: vi.fn(() => MCP_SENTINEL),
}));

import { runAgent } from './run-agent.js';
import { runSdkCollect } from './sdk-runner.js';
import { buildInProcessWorkplaceMcpServer } from './sdk-mcp-server.js';
import { SYSTEM_PROMPT } from './system-prompt.js';
import type { WorkplaceApiClient } from '../clients/workplace-api.js';
import type { IssueEventEnvelope } from '../types/issue-events.js';

function client(token: string | Error): WorkplaceApiClient {
  return {
    addIssueComment: vi.fn().mockResolvedValue(undefined),
    updateIssueStatus: vi.fn().mockResolvedValue(undefined),
    getIssueDetail: vi.fn().mockResolvedValue({} as never),
    listIssues: vi.fn().mockResolvedValue([]),
    unassignSelf: vi.fn().mockResolvedValue(undefined),
    getProviderCredential:
      token instanceof Error
        ? vi.fn().mockRejectedValue(token)
        : vi.fn().mockResolvedValue({ provider: 'anthropic', token, model: null }),
    getChatMessages: vi.fn().mockResolvedValue([]),
    addChatMessage: vi.fn().mockResolvedValue(undefined),
    postChatProgress: vi.fn().mockResolvedValue(undefined),
    getChannelMessages: vi.fn().mockResolvedValue([]),
    addChannelMessage: vi.fn().mockResolvedValue(undefined),
    postMessagingProgress: vi.fn().mockResolvedValue(undefined),
    listIssueAttachments: vi.fn().mockResolvedValue([]),
    downloadIssueAttachment: vi.fn(),
    searchWikiPages: vi.fn().mockResolvedValue([]),
    getWikiPage: vi.fn().mockResolvedValue({} as never),
    listEvents: vi.fn().mockResolvedValue([]),
    getEvent: vi.fn().mockResolvedValue({} as never),
    createWikiPage: vi.fn().mockResolvedValue({} as never),
    updateWikiPage: vi.fn().mockResolvedValue({} as never),
    listMail: vi.fn().mockResolvedValue([]),
    getMail: vi.fn().mockResolvedValue({} as never),
    listMailAccounts: vi.fn().mockResolvedValue([]),
    syncMail: vi.fn().mockResolvedValue({} as never),
    listContacts: vi.fn().mockResolvedValue([]),
    getExternalContact: vi.fn().mockResolvedValue({} as never),
    createExternalContact: vi.fn().mockResolvedValue({} as never),
    updateExternalContact: vi.fn().mockResolvedValue({} as never),
    listProjects: vi.fn().mockResolvedValue([]),
    getProject: vi.fn().mockResolvedValue({} as never),
    listProjectMembers: vi.fn().mockResolvedValue([]),
    listMySpaces: vi.fn().mockResolvedValue([]),
    listSpaceItems: vi.fn().mockResolvedValue([]),
    searchDrive: vi.fn().mockResolvedValue([]),
    createFolder: vi.fn().mockResolvedValue({} as never),
    renameFolder: vi.fn().mockResolvedValue({} as never),
    moveFolder: vi.fn().mockResolvedValue(undefined),
    moveFile: vi.fn().mockResolvedValue(undefined),
    listChannels: vi.fn().mockResolvedValue([]),
    discoverChannels: vi.fn().mockResolvedValue([]),
    proposeCreateIssue: vi.fn().mockResolvedValue(undefined),
    proposeCreateEvent: vi.fn().mockResolvedValue(undefined),
    listDelegationCandidates: vi.fn().mockResolvedValue([]),
  };
}

const baseCommon = {
  projectKey: 'WP',
  issueKey: 'WP-1',
  issueId: 1,
  issueTitle: 't',
  actor: { id: 7, username: 'a', kind: 'HUMAN' as const },
  occurredAt: '2026-05-26T00:00:00Z',
};

function envWithAgent(): IssueEventEnvelope {
  return {
    type: 'issue.created',
    payload: {
      ...baseCommon,
      assignees: [{ id: 201, username: 'ai', kind: 'AGENT' }],
      status: 'TODO',
      priority: 'MID',
    },
  };
}

function envHumanOnly(): IssueEventEnvelope {
  return {
    type: 'issue.created',
    payload: {
      ...baseCommon,
      assignees: [{ id: 7, username: 'alice', kind: 'HUMAN' }],
      status: 'TODO',
      priority: 'MID',
    },
  };
}

describe('runAgent (인-프로세스 SDK)', () => {
  beforeEach(() => {
    vi.mocked(runSdkCollect).mockClear();
    vi.mocked(buildInProcessWorkplaceMcpServer).mockClear();
    vi.mocked(runSdkCollect).mockResolvedValue([]);
    vi.mocked(buildInProcessWorkplaceMcpServer).mockReturnValue(MCP_SENTINEL as never);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('AGENT assignee 1명 → getProviderCredential(201) + runSdkCollect 1회', async () => {
    const c = client('tk-X');
    await runAgent(envWithAgent(), { client: c });
    expect(c.getProviderCredential).toHaveBeenCalledWith(201);
    expect(runSdkCollect).toHaveBeenCalledOnce();
  });

  it('runSdkCollect 호출 인자: token·agentId·systemPrompt·mcpServers 보존', async () => {
    const c = client('tk-X');
    await runAgent(envWithAgent(), { client: c });
    const arg = vi.mocked(runSdkCollect).mock.calls[0][0];
    expect(arg.token).toBe('tk-X');
    expect(arg.agentId).toBe(201);
    expect(arg.systemPrompt).toBe(SYSTEM_PROMPT);
    expect(arg.model).toBeTruthy();
    expect(arg.maxTurns).toBeGreaterThan(0);
    expect(arg.timeoutMs).toBeGreaterThan(0);
    // MCP 서버 인스턴스가 그대로 전달되는지(동일성).
    expect(arg.mcpServers?.workplace).toBe(MCP_SENTINEL);
    // 이슈 경로는 요청자 user 가 없음 — userId 미전달.
    expect(arg.userId).toBeUndefined();
  });

  it('MCP 서버는 onBehalfOfId=agentId·profile=issue·브리지 미전달로 생성', async () => {
    const c = client('tk-X');
    await runAgent(envWithAgent(), { client: c });
    const arg = vi.mocked(buildInProcessWorkplaceMcpServer).mock.calls[0][0];
    expect(arg.onBehalfOfId).toBe(201);
    expect(arg.profile).toBe('issue');
    expect(arg.hostBridge).toBeUndefined();
    expect(arg.onTool).toBeUndefined();
    expect(arg.client).toBe(c);
  });

  it('AGENT 없는 envelope → 실행 생략', async () => {
    const c = client('tk-X');
    await runAgent(envHumanOnly(), { client: c });
    expect(c.getProviderCredential).not.toHaveBeenCalled();
    expect(runSdkCollect).not.toHaveBeenCalled();
    expect(buildInProcessWorkplaceMcpServer).not.toHaveBeenCalled();
  });

  it('token fetch 실패 → 실행 생략', async () => {
    const c = client(new Error('boom'));
    await runAgent(envWithAgent(), { client: c });
    expect(c.getProviderCredential).toHaveBeenCalledOnce();
    expect(runSdkCollect).not.toHaveBeenCalled();
  });

  it('모델 결정 이원화 해소: credential.model(redeem 응답)이 env/기본값보다 우선한다', async () => {
    const c = client('tk-X');
    vi.mocked(c.getProviderCredential).mockResolvedValue({
      provider: 'anthropic',
      token: 'tk-X',
      model: 'claude-opus-4-1',
    });
    await runAgent(envWithAgent(), { client: c });
    const arg = vi.mocked(runSdkCollect).mock.calls[0][0];
    expect(arg.model).toBe('claude-opus-4-1');
  });

  it('credential.model 이 null 이면 env/기본값으로 폴백한다', async () => {
    const c = client('tk-X');
    vi.mocked(c.getProviderCredential).mockResolvedValue({
      provider: 'anthropic',
      token: 'tk-X',
      model: null,
    });
    await runAgent(envWithAgent(), { client: c });
    const arg = vi.mocked(runSdkCollect).mock.calls[0][0];
    expect(arg.model).toBe('claude-sonnet-5');
  });
});
