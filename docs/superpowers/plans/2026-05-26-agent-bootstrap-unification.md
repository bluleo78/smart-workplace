# ai-agent bootstrap 단일화 구현 계획 (#34)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ai-agent 의 부트스트랩 비밀을 `INTERNAL_SERVICE_TOKEN` 하나로 통합하고, envelope 의 assignees 첫 AGENT 를 골라 `Authorization: Internal` + `X-On-Behalf-Of` 헤더로 workplace-api 를 호출한다. `WORKPLACE_AGENT_API_KEY` 는 ai-agent 부트스트랩에서 완전 제거.

**Architecture:** workplace-api 의 기존 `JwtAuthenticationFilter` 가 이미 Internal+X-On-Behalf-Of 패턴을 지원해 백엔드 변경 0. ai-agent 의 client/cli-runner/run-agent/MCP server/tools 시그니처를 일관 갱신해 매 호출에 `agentId` 가 명시되도록 한다. MCP server child 는 spawn 시점에 `ACTING_AGENT_ID` env 로 받음.

**Tech Stack:** Node 22 + TypeScript NodeNext + axios + Vitest 4 + nock.

**Spec 출처:** `docs/superpowers/specs/2026-05-26-agent-bootstrap-unification-design.md`

**커밋 정책:** 단일 commit (한국어) — `refactor(ai-agent): bootstrap 단일화 — INTERNAL + X-On-Behalf-Of 로 다중 AGENT 대행 — #34`. push 는 사용자 명시 승인 후, **#33 commit (`ce557f1`) 위에 쌓아 두 개 함께 push**.

---

## Phase 0 — 사전 확인

### Task 0: 상태 확인

- [ ] **Step 1: 브랜치/상태/직전 commit 확인**

Run: `git status && git log --oneline -3`
Expected: `main`. 직전 commit `ce557f1 feat: AGENT OAuth 토큰 DB 저장 + 관리 UI — #33`. push 안 된 상태 (`origin/main` 보다 2개 앞 — 본 epic commit 이후 3개).

- [ ] **Step 2: workplace-api 의 Internal+X-On-Behalf-Of 지원 확인**

Read: `apps/workplace-api/src/main/java/com/workplace/global/security/JwtAuthenticationFilter.java:59-91`
Expected: `authenticateWithInternalToken` 메서드가 `X-On-Behalf-Of` 헤더에서 userId 파싱 후 SecurityContext 설정. 이미 존재 확인.

---

## Phase 1 — agent-resolver 신규

### Task 1: `pickActingAgentId` 유틸

**Files:**
- Create: `apps/workplace-ai-agent/src/agent/agent-resolver.ts`
- Create: `apps/workplace-ai-agent/src/agent/agent-resolver.test.ts`

- [ ] **Step 1: 실패 테스트**

```ts
import { describe, expect, it } from 'vitest';
import { pickActingAgentId } from './agent-resolver.js';
import type { IssueEventEnvelope } from '../types/issue-events.js';

const baseCommon = {
  projectKey: 'WP',
  issueKey: 'WP-42',
  issueId: 42,
  issueTitle: 't',
  actor: { id: 7, username: 'alice', kind: 'HUMAN' as const },
  occurredAt: '2026-05-26T12:00:00Z',
};

function env(assignees: { id: number; username: string; kind: 'HUMAN' | 'AGENT' }[]): IssueEventEnvelope {
  return {
    type: 'issue.created',
    payload: { ...baseCommon, assignees, status: 'TODO', priority: 'MID' },
  };
}

describe('pickActingAgentId', () => {
  it('1 AGENT → 그 id', () => {
    expect(pickActingAgentId(env([{ id: 201, username: 'ai', kind: 'AGENT' }]))).toBe(201);
  });

  it('AGENT 없음 (HUMAN only) → null', () => {
    expect(pickActingAgentId(env([{ id: 7, username: 'alice', kind: 'HUMAN' }]))).toBeNull();
  });

  it('빈 assignees → null', () => {
    expect(pickActingAgentId(env([]))).toBeNull();
  });

  it('여러 AGENT → 첫 번째 id', () => {
    expect(
      pickActingAgentId(
        env([
          { id: 7, username: 'alice', kind: 'HUMAN' },
          { id: 201, username: 'ai-a', kind: 'AGENT' },
          { id: 202, username: 'ai-b', kind: 'AGENT' },
        ]),
      ),
    ).toBe(201);
  });
});
```

- [ ] **Step 2: 테스트 실행 → FAIL**

Run: `cd apps/workplace-ai-agent && pnpm test src/agent/agent-resolver.test.ts`
Expected: FAIL — Cannot find module.

- [ ] **Step 3: 구현**

```ts
// envelope.assignees 에서 대행할 AGENT 1명 선택. 다중 AGENT 는 v1 비목표 — 첫 번째.
// AGENT 가 없는 이벤트 (HUMAN-only 이슈) 는 null → run-agent 가 spawn 생략.
import type { IssueEventEnvelope } from '../types/issue-events.js';

export function pickActingAgentId(env: IssueEventEnvelope): number | null {
  const agents = env.payload.assignees.filter((u) => u.kind === 'AGENT');
  return agents.length > 0 ? agents[0].id : null;
}
```

- [ ] **Step 4: PASS**

Run: `cd apps/workplace-ai-agent && pnpm test src/agent/agent-resolver.test.ts`
Expected: 4/4 PASS.

---

## Phase 2 — workplace-api client 시그니처 전환

### Task 2: client.test.ts 갱신 (TDD red)

**Files:**
- Modify: `apps/workplace-ai-agent/src/clients/workplace-api.test.ts`

- [ ] **Step 1: 파일 전체 교체 — Authorization+X-On-Behalf-Of 헤더 검증, agentId 첫 인자**

```ts
// workplace-api client — Internal + X-On-Behalf-Of 패턴 (#34). 매 메서드에 agentId 명시.
import { afterEach, describe, expect, it } from 'vitest';
import nock from 'nock';

import { createWorkplaceApiClient, parseIssueKey } from './workplace-api.js';

afterEach(() => {
  nock.cleanAll();
});

describe('parseIssueKey', () => {
  it('WP-42 → projectKey=WP, number=42', () => {
    expect(parseIssueKey('WP-42')).toEqual({ projectKey: 'WP', number: 42 });
  });

  it('A-B-7 → projectKey=A-B, number=7 (lastIndexOf 정책)', () => {
    expect(parseIssueKey('A-B-7')).toEqual({ projectKey: 'A-B', number: 7 });
  });
});

describe('createWorkplaceApiClient (Internal + X-On-Behalf-Of)', () => {
  const BASE = 'http://api.test';
  const PREFIX = '/api/v1';
  const AGENT_ID = 201;

  function newClient() {
    return createWorkplaceApiClient({
      baseURL: `${BASE}${PREFIX}`,
      internalToken: 'tk-internal',
    });
  }

  it('addIssueComment → POST + Internal + X-On-Behalf-Of', async () => {
    const scope = nock(BASE)
      .matchHeader('authorization', 'Internal tk-internal')
      .matchHeader('x-on-behalf-of', String(AGENT_ID))
      .post(`${PREFIX}/projects/WP/issues/42/comments`, { body: '안녕' })
      .reply(201, {});
    await newClient().addIssueComment(AGENT_ID, 'WP-42', '안녕');
    expect(scope.isDone()).toBe(true);
  });

  it('updateIssueStatus → PATCH + 헤더', async () => {
    const scope = nock(BASE)
      .matchHeader('authorization', 'Internal tk-internal')
      .matchHeader('x-on-behalf-of', String(AGENT_ID))
      .patch(`${PREFIX}/projects/WP/issues/1/status`, { status: 'DONE' })
      .reply(200, {});
    await newClient().updateIssueStatus(AGENT_ID, 'WP-1', 'DONE');
    expect(scope.isDone()).toBe(true);
  });

  it('getIssueDetail → GET + 헤더 + 응답 파싱', async () => {
    nock(BASE)
      .matchHeader('authorization', 'Internal tk-internal')
      .matchHeader('x-on-behalf-of', String(AGENT_ID))
      .get(`${PREFIX}/projects/WP/issues/42`)
      .reply(200, {
        key: 'WP-42',
        title: '분석',
        body: '본문',
        status: 'TODO',
        priority: 'MID',
        assignees: [{ id: 201, username: 'ai-bot', name: 'AI', kind: 'AGENT' }],
        comments: [],
      });
    const d = await newClient().getIssueDetail(AGENT_ID, 'WP-42');
    expect(d.issueKey).toBe('WP-42');
    expect(d.title).toBe('분석');
  });

  it('unassignSelf → /me 호출 없이 assignees PUT (agentId 본인 제외)', async () => {
    nock(BASE)
      .matchHeader('x-on-behalf-of', String(AGENT_ID))
      .get(`${PREFIX}/projects/WP/issues/42/assignees`)
      .reply(200, [
        { id: 7, username: 'alice', kind: 'HUMAN' },
        { id: AGENT_ID, username: 'ai-bot', kind: 'AGENT' },
      ]);
    const putScope = nock(BASE)
      .matchHeader('x-on-behalf-of', String(AGENT_ID))
      .put(`${PREFIX}/projects/WP/issues/42/assignees`, { userIds: [7] })
      .reply(200, []);
    await newClient().unassignSelf(AGENT_ID, 'WP-42');
    expect(putScope.isDone()).toBe(true);
  });

  it('getOAuthToken → GET /users/me/oauth-token + 헤더', async () => {
    nock(BASE)
      .matchHeader('authorization', 'Internal tk-internal')
      .matchHeader('x-on-behalf-of', String(AGENT_ID))
      .get(`${PREFIX}/users/me/oauth-token`)
      .reply(200, { token: 'tk-plain', label: 'main' });
    const r = await newClient().getOAuthToken(AGENT_ID);
    expect(r).toEqual({ token: 'tk-plain', label: 'main' });
  });

  it('getOAuthToken → 404 면 throw', async () => {
    nock(BASE)
      .get(`${PREFIX}/users/me/oauth-token`)
      .reply(404, { error: 'not_found' });
    await expect(newClient().getOAuthToken(AGENT_ID)).rejects.toThrow();
  });
});
```

- [ ] **Step 2: 테스트 실행 → FAIL**

Run: `cd apps/workplace-ai-agent && pnpm test src/clients/workplace-api.test.ts`
Expected: 시그니처 불일치로 FAIL.

### Task 3: workplace-api.ts 갱신

**Files:**
- Modify: `apps/workplace-ai-agent/src/clients/workplace-api.ts`

- [ ] **Step 1: 파일 전체 교체**

```ts
// workplace-api 호출 client — INTERNAL_SERVICE_TOKEN 인증 + X-On-Behalf-Of 헤더 (#34).
// 매 메서드의 첫 인자 agentId 는 workplace-api 가 SecurityContext 의 principal 로 설정할
// AGENT user id. 누락 시 TypeScript 가 빌드 차단.
import axios, { AxiosInstance } from 'axios';

import { DEFAULT_API_BASE_URL } from '../constants.js';
import { IssueDetail, issueDetail } from '../types/workplace-api.js';

export interface WorkplaceApiClient {
  addIssueComment(agentId: number, issueKey: string, body: string): Promise<void>;
  updateIssueStatus(agentId: number, issueKey: string, statusKey: string): Promise<void>;
  getIssueDetail(agentId: number, issueKey: string): Promise<IssueDetail>;
  unassignSelf(agentId: number, issueKey: string): Promise<void>;
  getOAuthToken(agentId: number): Promise<{ token: string; label: string | null }>;
}

export function parseIssueKey(issueKey: string): {
  projectKey: string;
  number: number;
} {
  const idx = issueKey.lastIndexOf('-');
  return {
    projectKey: issueKey.slice(0, idx),
    number: Number(issueKey.slice(idx + 1)),
  };
}

export function createWorkplaceApiClient(opts: {
  baseURL?: string;
  internalToken: string;
}): WorkplaceApiClient {
  const http: AxiosInstance = axios.create({
    baseURL: opts.baseURL ?? DEFAULT_API_BASE_URL,
    headers: { Authorization: `Internal ${opts.internalToken}` },
  });

  const onBehalfOf = (agentId: number) => ({
    headers: { 'X-On-Behalf-Of': String(agentId) },
  });

  return {
    async addIssueComment(agentId, issueKey, body) {
      const { projectKey, number } = parseIssueKey(issueKey);
      await http.post(
        `/projects/${projectKey}/issues/${number}/comments`,
        { body },
        onBehalfOf(agentId),
      );
    },

    async updateIssueStatus(agentId, issueKey, statusKey) {
      const { projectKey, number } = parseIssueKey(issueKey);
      await http.patch(
        `/projects/${projectKey}/issues/${number}/status`,
        { status: statusKey },
        onBehalfOf(agentId),
      );
    },

    async getIssueDetail(agentId, issueKey) {
      const { projectKey, number } = parseIssueKey(issueKey);
      const r = await http.get(`/projects/${projectKey}/issues/${number}`, onBehalfOf(agentId));
      const raw = r.data ?? {};
      const normalized = {
        ...raw,
        issueKey: raw.issueKey ?? raw.key ?? issueKey,
      };
      return issueDetail.parse(normalized);
    },

    async unassignSelf(agentId, issueKey) {
      const { projectKey, number } = parseIssueKey(issueKey);
      const r = await http.get(
        `/projects/${projectKey}/issues/${number}/assignees`,
        onBehalfOf(agentId),
      );
      const current: { id: number }[] = Array.isArray(r.data) ? r.data : [];
      const next = current.filter((u) => u.id !== agentId).map((u) => u.id);
      await http.put(
        `/projects/${projectKey}/issues/${number}/assignees`,
        { userIds: next },
        onBehalfOf(agentId),
      );
    },

    async getOAuthToken(agentId) {
      const r = await http.get('/users/me/oauth-token', onBehalfOf(agentId));
      return {
        token: String(r.data?.token ?? ''),
        label: r.data?.label ?? null,
      };
    },
  };
}
```

- [ ] **Step 2: 테스트 PASS**

Run: `cd apps/workplace-ai-agent && pnpm test src/clients/workplace-api.test.ts`
Expected: parseIssueKey 2 + client 6 = 8/8 PASS.

---

## Phase 3 — cli-runner / run-agent / event-handler 시그니처

### Task 4: cli-runner buildChildEnv 3-arg

**Files:**
- Modify: `apps/workplace-ai-agent/src/agent/cli-runner.ts`
- Modify: `apps/workplace-ai-agent/src/agent/cli-runner.test.ts`

- [ ] **Step 1: 테스트 갱신**

`cli-runner.test.ts` 의 `describe('buildChildEnv', ...)` 블록 교체:

```ts
describe('buildChildEnv', () => {
  it('token + agentId 인자 → 둘 다 child env 에 주입', () => {
    const env = buildChildEnv({ FOO: 'bar' }, 'tk-X', 201);
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe('tk-X');
    expect(env.ACTING_AGENT_ID).toBe('201');
    expect(env.FOO).toBe('bar');
  });

  it('parent 의 CLAUDE_CODE_OAUTH_TOKEN 은 인자 token 으로 override', () => {
    const env = buildChildEnv(
      { CLAUDE_CODE_OAUTH_TOKEN: 'parent-stale' },
      'tk-fresh',
      99,
    );
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe('tk-fresh');
    expect(env.ACTING_AGENT_ID).toBe('99');
  });

  it('parent INTERNAL_SERVICE_TOKEN 은 그대로 전달 (MCP child 가 사용)', () => {
    const env = buildChildEnv(
      { INTERNAL_SERVICE_TOKEN: 'srv-tk' },
      'tk-X',
      201,
    );
    expect(env.INTERNAL_SERVICE_TOKEN).toBe('srv-tk');
  });

  it('ANTHROPIC_API_KEY 는 항상 제거', () => {
    const env = buildChildEnv({ ANTHROPIC_API_KEY: 'should-go' }, 'tk-X', 201);
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
  });
});
```

- [ ] **Step 2: 테스트 실행 → FAIL (3-arg 미적용)**

Run: `cd apps/workplace-ai-agent && pnpm test src/agent/cli-runner.test.ts`
Expected: FAIL.

- [ ] **Step 3: `buildChildEnv` 시그니처 변경**

`cli-runner.ts` 의 함수 교체:

```ts
// 구독 모드 강제 + 토큰·agentId 명시 주입. INTERNAL_SERVICE_TOKEN 은 parent 그대로
// 전달돼 MCP server child 가 사용한다.
export function buildChildEnv(
  parent: NodeJS.ProcessEnv,
  token: string,
  agentId: number,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...parent };
  delete env.ANTHROPIC_API_KEY;
  env.CLAUDE_CODE_OAUTH_TOKEN = token;
  env.ACTING_AGENT_ID = String(agentId);
  return env;
}
```

- [ ] **Step 4: PASS**

Run: `cd apps/workplace-ai-agent && pnpm test src/agent/cli-runner.test.ts`
Expected: buildCliArgs 1 + buildChildEnv 4 = 5/5 PASS.

### Task 5: run-agent.ts — pickActingAgentId + getOAuthToken(agentId)

**Files:**
- Modify: `apps/workplace-ai-agent/src/agent/run-agent.ts`
- Modify: `apps/workplace-ai-agent/src/agent/run-agent.test.ts`

- [ ] **Step 1: 테스트 갱신 (실패)**

```ts
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

vi.mock('./cli-runner.js', () => ({
  buildCliArgs: vi.fn(() => ['--print', 'fake-msg']),
  buildChildEnv: vi.fn((p, t, a) => ({ ...p, CLAUDE_CODE_OAUTH_TOKEN: t, ACTING_AGENT_ID: String(a) })),
  runClaudeCli: vi.fn().mockResolvedValue(undefined),
}));

import { runAgent } from './run-agent.js';
import { buildCliArgs, buildChildEnv, runClaudeCli } from './cli-runner.js';
import type { WorkplaceApiClient } from '../clients/workplace-api.js';
import type { IssueEventEnvelope } from '../types/issue-events.js';

function client(token: string | Error): WorkplaceApiClient {
  return {
    addIssueComment: vi.fn().mockResolvedValue(undefined),
    updateIssueStatus: vi.fn().mockResolvedValue(undefined),
    getIssueDetail: vi.fn().mockResolvedValue({} as never),
    unassignSelf: vi.fn().mockResolvedValue(undefined),
    getOAuthToken:
      token instanceof Error
        ? vi.fn().mockRejectedValue(token)
        : vi.fn().mockResolvedValue({ token, label: 'main' }),
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

describe('runAgent', () => {
  beforeEach(() => {
    vi.mocked(buildCliArgs).mockClear();
    vi.mocked(buildChildEnv).mockClear();
    vi.mocked(runClaudeCli).mockClear();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('AGENT assignee 1명 → getOAuthToken(201) + buildChildEnv(_, token, 201)', async () => {
    const c = client('tk-X');
    await runAgent(envWithAgent(), { client: c });
    expect(c.getOAuthToken).toHaveBeenCalledWith(201);
    expect(buildChildEnv).toHaveBeenCalledWith(expect.anything(), 'tk-X', 201);
    expect(runClaudeCli).toHaveBeenCalledOnce();
  });

  it('AGENT 없는 envelope → spawn 생략 + console.warn', async () => {
    const c = client('tk-X');
    await runAgent(envHumanOnly(), { client: c });
    expect(c.getOAuthToken).not.toHaveBeenCalled();
    expect(runClaudeCli).not.toHaveBeenCalled();
  });

  it('token fetch 실패 → spawn 생략', async () => {
    const c = client(new Error('boom'));
    await runAgent(envWithAgent(), { client: c });
    expect(c.getOAuthToken).toHaveBeenCalledOnce();
    expect(runClaudeCli).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 테스트 실행 → FAIL**

Run: `cd apps/workplace-ai-agent && pnpm test src/agent/run-agent.test.ts`
Expected: FAIL.

- [ ] **Step 3: `run-agent.ts` 갱신**

```ts
// envelope → AGENT id 결정 → token fetch → CLI spawn. 모든 호출에 agentId 명시.
import { SYSTEM_PROMPT } from './system-prompt.js';
import { buildUserMessage } from './user-message.js';
import { MCP_CONFIG_PATH } from './mcp-config.js';
import { buildChildEnv, buildCliArgs, runClaudeCli } from './cli-runner.js';
import { pickActingAgentId } from './agent-resolver.js';
import type { IssueEventEnvelope } from '../types/issue-events.js';
import type { WorkplaceApiClient } from '../clients/workplace-api.js';

const DEFAULT_MODEL = 'claude-sonnet-4-6';
const DEFAULT_MAX_TURNS = 10;
const DEFAULT_TIMEOUT_MS = 300_000;

export interface RunAgentDeps {
  client: WorkplaceApiClient;
}

export async function runAgent(
  envelope: IssueEventEnvelope,
  deps: RunAgentDeps,
): Promise<void> {
  const agentId = pickActingAgentId(envelope);
  if (agentId == null) {
    console.warn('[run-agent] assignees 에 AGENT 없음 — spawn 생략', {
      type: envelope.type,
      issueKey: envelope.payload.issueKey,
    });
    return;
  }

  let token: string;
  try {
    const credential = await deps.client.getOAuthToken(agentId);
    token = credential.token;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[run-agent] OAuth 토큰 fetch 실패 — spawn 생략', {
      type: envelope.type,
      issueKey: envelope.payload.issueKey,
      agentId,
      error: msg,
    });
    return;
  }

  const model = process.env.WORKPLACE_AI_MODEL ?? DEFAULT_MODEL;
  const maxTurns = Number(process.env.WORKPLACE_AI_MAX_TURNS ?? DEFAULT_MAX_TURNS);
  const timeoutMs = Number(process.env.WORKPLACE_AI_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);

  const userMessage = buildUserMessage(envelope);
  const args = buildCliArgs({
    userMessage,
    systemPrompt: SYSTEM_PROMPT,
    model,
    maxTurns,
    mcpConfigPath: MCP_CONFIG_PATH,
  });
  const childEnv = buildChildEnv(process.env, token, agentId);
  const logTag = `agent:${envelope.type}:${envelope.payload.issueKey}:${agentId}`;

  await runClaudeCli({ args, env: childEnv, timeoutMs, logTag });
}
```

- [ ] **Step 4: PASS**

Run: `cd apps/workplace-ai-agent && pnpm test src/agent/run-agent.test.ts`
Expected: 3/3 PASS.

### Task 6: event-handler.test.ts mock client 갱신

**Files:**
- Modify: `apps/workplace-ai-agent/src/agent/event-handler.test.ts`

- [ ] **Step 1: client mock 의 `getMyOAuthToken` → `getOAuthToken` 명칭 변경 + `getCachedSelfUserId` 제거**

기존 client mock 객체 정의 부분:

```ts
const client = {
  addIssueComment: vi.fn(),
  updateIssueStatus: vi.fn(),
  getIssueDetail: vi.fn(),
  unassignSelf: vi.fn(),
  getOAuthToken: vi.fn(),
} as unknown as WorkplaceApiClient;
```

(`getCachedSelfUserId`, `getMyOAuthToken` 라인 제거.)

- [ ] **Step 2: 테스트 PASS**

Run: `cd apps/workplace-ai-agent && pnpm test src/agent/event-handler.test.ts`
Expected: 6/6 PASS.

### Task 7: routes/events.test.ts mock client 갱신

**Files:**
- Modify: `apps/workplace-ai-agent/src/routes/events.test.ts`

- [ ] **Step 1: `getMyOAuthToken` → `getOAuthToken` + `getCachedSelfUserId` 제거**

```ts
const client = {
  addIssueComment: vi.fn(),
  updateIssueStatus: vi.fn(),
  getIssueDetail: vi.fn(),
  unassignSelf: vi.fn(),
  getOAuthToken: vi.fn(),
} as unknown as WorkplaceApiClient;
```

- [ ] **Step 2: PASS**

Run: `cd apps/workplace-ai-agent && pnpm test src/routes/events.test.ts`
Expected: 7/7 PASS.

---

## Phase 4 — MCP server child + tools

### Task 8: tools.ts `buildTools(client, agentId)` 시그니처

**Files:**
- Modify: `apps/workplace-ai-agent/src/mcp/tools.ts`
- Modify: `apps/workplace-ai-agent/src/mcp/tools.test.ts`

- [ ] **Step 1: 테스트 갱신**

`tools.test.ts` 전체 교체:

```ts
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
    getOAuthToken: vi.fn(),
  };
}

const AGENT_ID = 201;

describe('buildTools (agentId bound)', () => {
  it('get_issue_detail → client.getIssueDetail(agentId, key)', async () => {
    const c = client();
    const tools = buildTools(c, AGENT_ID);
    const t = tools.find((x) => x.name === 'get_issue_detail')!;
    const out = await t.handler({ issueKey: 'WP-1' });
    expect(c.getIssueDetail).toHaveBeenCalledWith(AGENT_ID, 'WP-1');
    expect(JSON.parse(out)).toMatchObject({ issueKey: 'WP-1' });
  });

  it('add_comment → client.addIssueComment(agentId, key, body)', async () => {
    const c = client();
    const t = buildTools(c, AGENT_ID).find((x) => x.name === 'add_comment')!;
    await t.handler({ issueKey: 'WP-1', body: '안녕' });
    expect(c.addIssueComment).toHaveBeenCalledWith(AGENT_ID, 'WP-1', '안녕');
  });

  it('update_status → client.updateIssueStatus(agentId, key, status)', async () => {
    const c = client();
    const t = buildTools(c, AGENT_ID).find((x) => x.name === 'update_status')!;
    await t.handler({ issueKey: 'WP-1', status: 'DONE' });
    expect(c.updateIssueStatus).toHaveBeenCalledWith(AGENT_ID, 'WP-1', 'DONE');
  });

  it('unassign_self → client.unassignSelf(agentId, key)', async () => {
    const c = client();
    const t = buildTools(c, AGENT_ID).find((x) => x.name === 'unassign_self')!;
    await t.handler({ issueKey: 'WP-1' });
    expect(c.unassignSelf).toHaveBeenCalledWith(AGENT_ID, 'WP-1');
  });

  it('update_status — 잘못된 status 는 zod reject', async () => {
    const c = client();
    const t = buildTools(c, AGENT_ID).find((x) => x.name === 'update_status')!;
    await expect(t.handler({ issueKey: 'WP-1', status: 'WRONG' })).rejects.toThrow();
    expect(c.updateIssueStatus).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 테스트 실행 → FAIL (시그니처 미적용)**

Run: `cd apps/workplace-ai-agent && pnpm test src/mcp/tools.test.ts`
Expected: FAIL.

- [ ] **Step 3: `tools.ts` 갱신**

```ts
// 4 MCP 도구 정의 — 모든 호출에 agentId 가 closure 로 바인딩 (#34).
import { z } from 'zod';

import type { WorkplaceApiClient } from '../clients/workplace-api.js';

export interface McpTool {
  name: string;
  description: string;
  inputSchema: z.ZodTypeAny;
  handler: (args: unknown) => Promise<string>;
}

const issueKey = z.object({ issueKey: z.string().min(1) });
const addCommentInput = z.object({
  issueKey: z.string().min(1),
  body: z.string().min(1),
});
const updateStatusInput = z.object({
  issueKey: z.string().min(1),
  status: z.enum(['TODO', 'IN_PROGRESS', 'DONE', 'CANCELED']),
});

export function buildTools(client: WorkplaceApiClient, agentId: number): McpTool[] {
  return [
    {
      name: 'get_issue_detail',
      description:
        '이슈의 본문·상태·담당자·코멘트 등 전체 컨텍스트를 JSON 으로 반환합니다.',
      inputSchema: issueKey,
      async handler(args) {
        const { issueKey: k } = issueKey.parse(args);
        const detail = await client.getIssueDetail(agentId, k);
        return JSON.stringify(detail);
      },
    },
    {
      name: 'add_comment',
      description: '이슈에 코멘트를 작성합니다. 본문은 마크다운을 지원합니다.',
      inputSchema: addCommentInput,
      async handler(args) {
        const { issueKey: k, body } = addCommentInput.parse(args);
        await client.addIssueComment(agentId, k, body);
        return 'ok';
      },
    },
    {
      name: 'update_status',
      description:
        '이슈의 상태를 변경합니다. 허용값: TODO / IN_PROGRESS / DONE / CANCELED.',
      inputSchema: updateStatusInput,
      async handler(args) {
        const { issueKey: k, status } = updateStatusInput.parse(args);
        await client.updateIssueStatus(agentId, k, status);
        return 'ok';
      },
    },
    {
      name: 'unassign_self',
      description:
        '자기 자신을 이슈 담당자에서 제외합니다. 작업 완료·반려 시 사용합니다.',
      inputSchema: issueKey,
      async handler(args) {
        const { issueKey: k } = issueKey.parse(args);
        await client.unassignSelf(agentId, k);
        return 'ok';
      },
    },
  ];
}
```

- [ ] **Step 4: PASS**

Run: `cd apps/workplace-ai-agent && pnpm test src/mcp/tools.test.ts`
Expected: 5/5 PASS.

### Task 9: workplace-mcp-server.ts 갱신

**Files:**
- Modify: `apps/workplace-ai-agent/src/mcp/workplace-mcp-server.ts`

- [ ] **Step 1: env 검증 + 생성자 갱신**

```ts
// Workplace MCP server — Claude CLI 가 stdio child 로 띄우는 entry point.
// #34: INTERNAL_SERVICE_TOKEN + ACTING_AGENT_ID env 로부터 agentId 를 받아 closure 바인딩.
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

import { createWorkplaceApiClient } from '../clients/workplace-api.js';
import { buildTools } from './tools.js';

async function main(): Promise<void> {
  const baseURL = process.env.WORKPLACE_API_BASE_URL;
  const internalToken = process.env.INTERNAL_SERVICE_TOKEN;
  const actingAgentIdRaw = process.env.ACTING_AGENT_ID;
  const actingAgentId = Number(actingAgentIdRaw);

  if (!baseURL || !internalToken || !Number.isFinite(actingAgentId)) {
    console.error('[workplace-mcp] 환경변수 누락 또는 ACTING_AGENT_ID 형식 오류', {
      hasBaseURL: !!baseURL,
      hasInternalToken: !!internalToken,
      actingAgentIdRaw,
    });
    process.exit(1);
  }

  const client = createWorkplaceApiClient({ baseURL, internalToken });
  const tools = buildTools(client, actingAgentId);

  const server = new Server(
    { name: 'workplace', version: '0.0.1' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: zodToJsonSchema(t.inputSchema as z.ZodTypeAny, {
        $refStrategy: 'none',
      }) as never,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const tool = tools.find((t) => t.name === req.params.name);
    if (!tool) {
      return {
        isError: true,
        content: [{ type: 'text', text: `unknown tool: ${req.params.name}` }],
      };
    }
    try {
      const out = await tool.handler(req.params.arguments ?? {});
      return { content: [{ type: 'text', text: out }] };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { isError: true, content: [{ type: 'text', text: msg }] };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[workplace-mcp] connected via stdio (acting as agent', actingAgentId, ')');
}

main().catch((e) => {
  console.error('[workplace-mcp] fatal:', e);
  process.exit(1);
});
```

> 5c-2 에서 `zodToJsonSchema(...) as never` 캐스트가 zod 4 호환을 위해 들어가 있음 — 그 변환 그대로 유지 (Bundle 2a 의 deviation 참고).

- [ ] **Step 2: build 확인**

Run: `cd apps/workplace-ai-agent && pnpm build`
Expected: `dist/mcp/workplace-mcp-server.js` 재생성.

### Task 10: mcp-config.json 갱신

**Files:**
- Modify: `apps/workplace-ai-agent/mcp-config.json`

- [ ] **Step 1: env block 갱신**

```json
{
  "mcpServers": {
    "workplace": {
      "command": "node",
      "args": ["dist/mcp/workplace-mcp-server.js"],
      "env": {
        "WORKPLACE_API_BASE_URL": "${WORKPLACE_API_BASE_URL}",
        "INTERNAL_SERVICE_TOKEN": "${INTERNAL_SERVICE_TOKEN}",
        "ACTING_AGENT_ID": "${ACTING_AGENT_ID}"
      }
    }
  }
}
```

`WORKPLACE_AGENT_API_KEY` 라인 제거, `ACTING_AGENT_ID` 추가.

---

## Phase 5 — index.ts + 환경변수 + 문서

### Task 11: index.ts REQUIRED_ENV + client 초기화 갱신

**Files:**
- Modify: `apps/workplace-ai-agent/src/index.ts`

- [ ] **Step 1: 파일 전체 교체**

```ts
// Express 부트 — 환경변수 검증 → /health → /events → 전역 에러 핸들러 → graceful shutdown.
// #34: INTERNAL_SERVICE_TOKEN 단일 부트스트랩. WORKPLACE_AGENT_API_KEY 제거.
// 호출 시 X-On-Behalf-Of 헤더로 대행 AGENT 명시.
import express, { type NextFunction, type Request, type Response } from 'express';
import dotenv from 'dotenv';

import { createWorkplaceApiClient } from './clients/workplace-api.js';
import { DEFAULT_PORT } from './constants.js';
import { internalAuth } from './middleware/internal-auth.js';
import { healthRouter } from './routes/health.js';
import { createEventsRouter } from './routes/events.js';

dotenv.config({ path: '.env.local' });
dotenv.config();

const REQUIRED_ENV = [
  'INTERNAL_SERVICE_TOKEN',
  'WORKPLACE_API_BASE_URL',
];
for (const k of REQUIRED_ENV) {
  if (!process.env[k]) {
    console.error(`[ai-agent] ${k} 미설정 — 부트 중단`);
    process.exit(1);
  }
}

// 모든 workplace-api 호출은 Internal 인증 + X-On-Behalf-Of 헤더로 대행 AGENT 명시.
const workplaceApi = createWorkplaceApiClient({
  baseURL: process.env.WORKPLACE_API_BASE_URL,
  internalToken: process.env.INTERNAL_SERVICE_TOKEN ?? '',
});

const app = express();
const PORT = Number(process.env.PORT ?? DEFAULT_PORT);

app.use(express.json());
app.use(healthRouter);
app.use(internalAuth, createEventsRouter({ client: workplaceApi }));

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[ai-agent] unhandled error:', err);
  res.status(500).json({ error: 'internal_error' });
});

process.on('unhandledRejection', (reason: unknown) => {
  const m = reason instanceof Error ? reason.message : String(reason);
  if (m.includes('aborted')) {
    console.warn('[process] suppressed abort rejection:', m);
  } else {
    console.error('[process] unhandled rejection:', reason);
  }
});

const server = app.listen(PORT, () => {
  console.log(`workplace-ai-agent listening on :${PORT}`);
  console.log(`  GET  /health`);
  console.log(`  POST /events`);
});

function shutdown(signal: string) {
  console.log(`[ai-agent] ${signal} received, shutting down...`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
```

- [ ] **Step 2: typecheck**

Run: `cd apps/workplace-ai-agent && pnpm typecheck`
Expected: PASS.

### Task 12: .env.example 갱신

**Files:**
- Modify: `apps/workplace-ai-agent/.env.example`

- [ ] **Step 1: `WORKPLACE_AGENT_API_KEY=` 라인 제거 + 코멘트 갱신**

```bash
# Server
PORT=7070

# 사내 서비스 인증 — workplace-api ↔ ai-agent 양방향 (인바운드 /events + 아웃바운드 호출의 Authorization: Internal).
INTERNAL_SERVICE_TOKEN=changeme-local

# workplace-api URL
WORKPLACE_API_BASE_URL=http://localhost:9090/api/v1

# Claude CLI OAuth 토큰은 workplace-api DB 에 저장됩니다 (#33).
# workplace-web 의 AGENT 관리 화면에서 등록하세요. ai-agent 는 매 LLM 호출 시
# 자기 INTERNAL 인증 + X-On-Behalf-Of 헤더로 그 AGENT 의 토큰을 fetch 합니다 (#34).

# (선택) LLM 모델 / 한 호출당 도구 라운드 / timeout override
# WORKPLACE_AI_MODEL=claude-sonnet-4-6
# WORKPLACE_AI_MAX_TURNS=10
# WORKPLACE_AI_TIMEOUT_MS=300000
```

### Task 13: CLAUDE.md 갱신

**Files:**
- Modify: `apps/workplace-ai-agent/CLAUDE.md`

- [ ] **Step 1: 환경변수 표에서 `WORKPLACE_AGENT_API_KEY` 행 제거**

기존 표:
```
| `INTERNAL_SERVICE_TOKEN` | 인바운드 /events 인증 | 예 |
| `WORKPLACE_API_BASE_URL` | workplace-api URL | 예 |
| `WORKPLACE_AGENT_API_KEY` | AGENT API key | 예 |
| `WORKPLACE_AI_MODEL` / `WORKPLACE_AI_MAX_TURNS` / `WORKPLACE_AI_TIMEOUT_MS` | 선택 override | 아님 |
```

다음으로 교체:
```
| `INTERNAL_SERVICE_TOKEN` | 인바운드 /events + 아웃바운드 호출 (Authorization: Internal) 공용 | 예 |
| `WORKPLACE_API_BASE_URL` | workplace-api URL | 예 |
| `WORKPLACE_AI_MODEL` / `WORKPLACE_AI_MAX_TURNS` / `WORKPLACE_AI_TIMEOUT_MS` | 선택 override | 아님 |
```

기존 "Claude CLI OAuth 토큰" 안내 단락 바로 다음에 추가:
```
**대행 AGENT 식별**: ai-agent 는 이벤트 envelope 의 assignees 중 첫 AGENT 를 대행 (#34).
workplace-api 호출 시 `Authorization: Internal <token>` + `X-On-Behalf-Of: <agentId>` 헤더로
그 AGENT 자격을 부여받는다. 5a 의 AGENT API key 는 ai-agent 부트스트랩과 무관 — 외부 서비스가
AGENT 자격으로 workplace-api 를 직접 호출할 때만 사용.
```

---

## Phase 6 — 전체 회귀 + 단일 commit

### Task 14: 전체 회귀 게이트

- [ ] **Step 1: ai-agent 전체 테스트 + 빌드**

Run:
```
cd apps/workplace-ai-agent
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```
Expected: 전 케이스 PASS (기존 + 신규 agent-resolver 4 + cli-runner buildChildEnv 4 + run-agent 추가 1 케이스 = 한 자릿수 증가). typecheck/lint/build 모두 통과. `dist/mcp/workplace-mcp-server.js` 갱신.

- [ ] **Step 2: 백엔드 회귀**

Run: `cd apps/workplace-api && ./gradlew test`
Expected: BUILD SUCCESSFUL. **0 변경, 모두 PASS** (특히 5a 의 AgentApiKey 흐름 + #30 의 IssueAssigneeServiceAgentTest 5 케이스).

- [ ] **Step 3: workplace-web 회귀**

Run: `cd apps/workplace-web && pnpm typecheck && pnpm build && pnpm test:e2e --grep "oauth"`
Expected: typecheck/build PASS. Playwright `oauth-token.spec.ts` 7 케이스 PASS (#33 회귀).

- [ ] **Step 4: 루트 turbo typecheck**

Run: `cd /Users/bluleo78/git/smart-workplace && pnpm typecheck`
Expected: 모든 패키지 PASS.

### Task 15: 단일 commit

- [ ] **Step 1: 변경 파일 확인**

Run: `git status && git diff --stat`
Expected:
- 신규: `apps/workplace-ai-agent/src/agent/agent-resolver.ts` + test
- 수정: `clients/workplace-api.ts` + test, `cli-runner.ts` + test, `run-agent.ts` + test, `event-handler.test.ts`, `routes/events.test.ts`, `mcp/tools.ts` + test, `mcp/workplace-mcp-server.ts`, `mcp-config.json`, `src/index.ts`, `.env.example`, `CLAUDE.md`

- [ ] **Step 2: stage**

```bash
git add \
  apps/workplace-ai-agent/src \
  apps/workplace-ai-agent/mcp-config.json \
  apps/workplace-ai-agent/.env.example \
  apps/workplace-ai-agent/CLAUDE.md \
  docs/superpowers/plans/2026-05-26-agent-bootstrap-unification.md
```

- [ ] **Step 3: 단일 commit (한국어)**

```bash
git commit -m "$(cat <<'EOF'
refactor(ai-agent): bootstrap 단일화 — INTERNAL + X-On-Behalf-Of 로 다중 AGENT 대행 — #34

- WORKPLACE_AGENT_API_KEY env 완전 제거 — INTERNAL_SERVICE_TOKEN 단일 부트스트랩
- workplace-api 호출: Authorization: Internal + X-On-Behalf-Of: <agentId>
  · workplace-api 변경 0 (JwtAuthenticationFilter 가 이미 지원)
- pickActingAgentId — envelope.assignees 의 첫 AGENT 자동 선택. 없으면 spawn 생략
- client 모든 메서드 시그니처 첫 인자 agentId — TypeScript 가 누락 빌드 차단
- MCP server child: ACTING_AGENT_ID env 로 받아 closure 바인딩 (1 spawn = 1 AGENT)
- mcp-config: WORKPLACE_AGENT_API_KEY 제거, ACTING_AGENT_ID 추가
- 5a 의 AGENT API key 는 외부 호출용으로 유지 (ai-agent 부트스트랩과 분리)

수동 e2e (AGENT 두 명 + 토큰 등록 + 다중 처리) 는 사용자가 별도 수행.
EOF
)"
```

- [ ] **Step 4: commit 검증**

Run: `git log -3 --oneline`
Expected:
```
<new sha>   refactor(ai-agent): bootstrap 단일화 — ... — #34
ce557f1     feat: AGENT OAuth 토큰 DB 저장 + 관리 UI — #33
8eff37b     refactor(ai-agent): OAuth 토큰을 ~/.claude/ 저장 1순위로 — #30 (5c-2 hygiene)
```

push 는 사용자 명시 승인 후 — #33 + #34 두 commit 함께. #33, #34 close 는 수동 e2e 통과 후.

---

## 사후 — 수동 e2e (사용자 수행)

spec §"수동 e2e" 9 단계:

1. workplace-web 에서 AGENT 두 명 (A, B) 생성
2. 각자 OAuth 토큰 등록 (`claude setup-token` 토큰 — 같은 거 써도 무방한 검증용)
3. ai-agent 의 `.env.local` 에서 `WORKPLACE_AGENT_API_KEY` 라인 제거 후 재기동 — 부트 정상 (이전엔 fail-fast 였음)
4. 이슈 1: A 만 담당 → A 응답
5. 이슈 2: B 만 담당 → B 응답 (같은 ai-agent 가 다른 토큰·다른 AGENT)
6. 이슈 3: A, B 모두 담당 → A 만 응답 (첫 번째 AGENT 정책)
7. 이슈 4: HUMAN 만 담당 → ai-agent 로그 `assignees 에 AGENT 없음 — spawn 생략` + 활동 없음
8. AGENT A 가 자율로 unassign_self → 정상 (#30 의 권한 분기 회귀)
9. AGENT A 가 다른 멤버 추가 시도 (curl) → 403 (#30 의 분기)
