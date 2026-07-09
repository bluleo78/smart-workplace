# 이슈 의존성 add/remove 도구(MCP + AI Agent) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `add_issue_dependency`/`remove_issue_dependency` 2개 도구를 `apps/workplace-mcp`(외부 PAT 게이트웨이)와 `apps/workplace-ai-agent`(인-프로세스 SDK MCP)에 대칭으로 추가해, 이미 존재하는 백엔드 이슈 의존성(블로킹) API를 챗/AI 경로에서도 쓸 수 있게 한다.

**Architecture:** 백엔드 변경 없음(`POST`/`DELETE /api/v1/projects/{key}/issues/{number}/dependencies` 그대로 재사용). 각 앱의 클라이언트에 `addIssueDependency`/`removeIssueDependency` 메서드를 추가하고, 도구 핸들러가 `issueKey`/`otherIssueKey`를 각각 `parseIssueKey`로 분해해 동일 프로젝트인지 클라이언트측에서 먼저 검증한 뒤 API를 호출한다.

**Tech Stack:** TypeScript, Vitest + nock(HTTP mock), Zod(입력 스키마), axios.

## Global Constraints

- 백엔드(workplace-api) 코드/스키마 변경 없음 — 기존 `IssueDependencyController` 엔드포인트만 재사용.
- 조회 도구는 추가하지 않음 — `get_issue_detail`이 이미 `summary.blockedBy`/`summary.blocks`/`summary.blocked`를 반환.
- 도구 파라미터: `issueKey`(기준 이슈, 예 "WP-12"), `otherIssueKey`(대상 이슈, 예 "WP-15"), `direction`("blocks"|"blockedBy").
- 두 키의 프로젝트가 다르면 API 호출 전에 클라이언트측에서 `Error('동일 프로젝트 이슈 간에만 의존성을 설정할 수 있습니다.')`를 던진다.
- 백엔드 에러(`InvalidDependencyException` 400, `DependencyCycleException` 409)는 catch하지 않고 그대로 throw — 기존 `update_issue`/`edit_comment`와 동일 컨벤션.
- ai-agent 쪽은 `issue`와 `assistant` 프로필 양쪽에 노출(다른 프로필은 이슈 CRUD 대상 아님).

---

## Task 1: workplace-mcp 클라이언트 메서드

**Files:**
- Modify: `apps/workplace-mcp/src/clients/workplace-api.ts:44` 근처(`PatApiClient` 인터페이스, `setIssueParent` 다음), `:140` 근처(구현부, `setIssueParent` 구현 다음)
- Modify: `apps/workplace-mcp/src/tools/test-support.ts` (`mockPatApiClient()`에 두 메서드 추가)
- Test: `apps/workplace-mcp/src/clients/workplace-api.test.ts`

**Interfaces:**
- Produces: `PatApiClient.addIssueDependency(projectKey: string, number: number, otherNumber: number, direction: 'blocks' | 'blockedBy'): Promise<unknown>` — POST 성공 시 백엔드가 반환하는 갱신된 이슈 상세 JSON을 그대로 반환.
- Produces: `PatApiClient.removeIssueDependency(projectKey: string, number: number, otherNumber: number, direction: 'blocks' | 'blockedBy'): Promise<void>`.

- [ ] **Step 1: 실패하는 테스트 작성**

`apps/workplace-mcp/src/clients/workplace-api.test.ts` 파일 끝(마지막 `describe` 블록 다음)에 추가:

```ts
describe('addIssueDependency', () => {
  it('POST /projects/{key}/issues/{number}/dependencies 를 호출하고 응답 body 를 반환한다', async () => {
    const scope = nock(BASE)
      .post('/projects/WP/issues/12/dependencies', { otherNumber: 7, direction: 'blocks' })
      .reply(200, { summary: { id: 1, blocks: [{ number: 7 }] } });
    const client = createPatApiClient({ baseURL: BASE, token: 'swp_abc' });
    const out = await client.addIssueDependency('WP', 12, 7, 'blocks');
    expect(scope.isDone()).toBe(true);
    expect(out).toEqual({ summary: { id: 1, blocks: [{ number: 7 }] } });
  });
});

describe('removeIssueDependency', () => {
  it('DELETE /projects/{key}/issues/{number}/dependencies 를 쿼리파라미터와 함께 호출한다', async () => {
    const scope = nock(BASE)
      .delete('/projects/WP/issues/12/dependencies')
      .query({ otherNumber: '7', direction: 'blocks' })
      .reply(204);
    const client = createPatApiClient({ baseURL: BASE, token: 'swp_abc' });
    await client.removeIssueDependency('WP', 12, 7, 'blocks');
    expect(scope.isDone()).toBe(true);
  });
});
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

Run: `pnpm --filter workplace-mcp test workplace-api.test.ts`
Expected: FAIL — `client.addIssueDependency is not a function` (타입 에러 또는 런타임 에러)

- [ ] **Step 3: `PatApiClient` 인터페이스에 시그니처 추가**

`apps/workplace-mcp/src/clients/workplace-api.ts`에서 `setIssueParent` 다음 줄에 추가:

```ts
  addIssueDependency(
    projectKey: string,
    number: number,
    otherNumber: number,
    direction: 'blocks' | 'blockedBy',
  ): Promise<unknown>;
  removeIssueDependency(
    projectKey: string,
    number: number,
    otherNumber: number,
    direction: 'blocks' | 'blockedBy',
  ): Promise<void>;
```

- [ ] **Step 4: 구현 추가**

`createPatApiClient` 반환 객체 안, `setIssueParent` 구현 다음에 추가:

```ts
    async addIssueDependency(projectKey, number, otherNumber, direction) {
      return (
        await http.post(
          `/projects/${encodeURIComponent(projectKey)}/issues/${number}/dependencies`,
          { otherNumber, direction },
        )
      ).data;
    },
    async removeIssueDependency(projectKey, number, otherNumber, direction) {
      await http.delete(
        `/projects/${encodeURIComponent(projectKey)}/issues/${number}/dependencies`,
        { params: { otherNumber, direction } },
      );
    },
```

- [ ] **Step 5: `mockPatApiClient()`에 mock 추가**

`apps/workplace-mcp/src/tools/test-support.ts`의 `editIssueComment: vi.fn(),` 다음 줄에 추가:

```ts
    addIssueDependency: vi.fn(),
    removeIssueDependency: vi.fn(),
```

- [ ] **Step 6: 테스트 실행 → 통과 확인**

Run: `pnpm --filter workplace-mcp test workplace-api.test.ts`
Expected: PASS

- [ ] **Step 7: typecheck**

Run: `pnpm --filter workplace-mcp typecheck`
Expected: 에러 없음

- [ ] **Step 8: Commit**

```bash
git add apps/workplace-mcp/src/clients/workplace-api.ts apps/workplace-mcp/src/clients/workplace-api.test.ts apps/workplace-mcp/src/tools/test-support.ts
git commit -m "feat(mcp): 이슈 의존성 add/remove 클라이언트 메서드 추가"
```

---

## Task 2: workplace-mcp 도구(`add_issue_dependency`/`remove_issue_dependency`)

**Files:**
- Modify: `apps/workplace-mcp/src/tools/issue.ts`
- Test: `apps/workplace-mcp/src/tools/issue.test.ts`

**Interfaces:**
- Consumes: `PatApiClient.addIssueDependency`/`removeIssueDependency` (Task 1), `parseIssueKey(issueKey: string): { projectKey: string; number: number }` (기존, 같은 파일 L10-16).
- Produces: `McpTool` 이름 `add_issue_dependency`, `remove_issue_dependency` — `buildIssueTools()` 반환 배열에 포함, 도구 개수 8→10.

- [ ] **Step 1: 실패하는 테스트 작성**

`apps/workplace-mcp/src/tools/issue.test.ts`의 `mockClient()` 함수에 두 줄 추가(`updateIssueStatus` mock 다음):

```ts
  (client.addIssueDependency as ReturnType<typeof vi.fn>).mockResolvedValue({
    summary: { id: 42, blocks: [{ number: 7 }] },
  });
  (client.removeIssueDependency as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
```

파일 끝에 새 `describe` 블록 추가:

```ts
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
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

Run: `pnpm --filter workplace-mcp test issue.test.ts`
Expected: FAIL — `Cannot read properties of undefined (reading 'handler')` (도구가 아직 없음)

- [ ] **Step 3: 입력 스키마 추가**

`apps/workplace-mcp/src/tools/issue.ts`에서 `updateIssueInput` 정의 다음에 추가:

```ts
  const dependencyInput = z.object({
    issueKey: z.string().min(1),
    otherIssueKey: z.string().min(1),
    direction: z.enum(['blocks', 'blockedBy']),
  });
```

- [ ] **Step 4: 도구 2개 추가**

`edit_comment` 도구 블록 다음(반환 배열 마지막 항목 뒤)에 추가:

```ts
    {
      name: 'add_issue_dependency',
      description:
        '이슈 간 의존성(차단 관계)을 추가합니다. direction="blocks" 면 issueKey 이슈가 ' +
        'otherIssueKey 이슈를 차단하고, "blockedBy" 면 반대로 otherIssueKey 에 의해 차단됩니다. ' +
        '두 이슈는 같은 프로젝트여야 합니다. 순환 관계가 되면 에러가 발생합니다.',
      inputSchema: dependencyInput,
      async handler(args) {
        const { issueKey, otherIssueKey, direction } = dependencyInput.parse(args);
        const { projectKey, number } = parseIssueKey(issueKey);
        const { projectKey: otherProjectKey, number: otherNumber } = parseIssueKey(otherIssueKey);
        if (otherProjectKey !== projectKey) {
          throw new Error('동일 프로젝트 이슈 간에만 의존성을 설정할 수 있습니다.');
        }
        return JSON.stringify(
          await client.addIssueDependency(projectKey, number, otherNumber, direction),
        );
      },
    },
    {
      name: 'remove_issue_dependency',
      description: '이슈 간 의존성을 제거합니다. 존재하지 않아도 에러 없이 성공합니다(멱등).',
      inputSchema: dependencyInput,
      async handler(args) {
        const { issueKey, otherIssueKey, direction } = dependencyInput.parse(args);
        const { projectKey, number } = parseIssueKey(issueKey);
        const { projectKey: otherProjectKey, number: otherNumber } = parseIssueKey(otherIssueKey);
        if (otherProjectKey !== projectKey) {
          throw new Error('동일 프로젝트 이슈 간에만 의존성을 설정할 수 있습니다.');
        }
        await client.removeIssueDependency(projectKey, number, otherNumber, direction);
        return 'ok';
      },
    },
```

파일 상단 도구 개수 주석(`buildIssueTools` 바로 위, "이슈 도메인 도구 8종(...)")을 10종으로, 나열된 이름 목록에 `add_issue_dependency`/`remove_issue_dependency`를 추가해 갱신한다.

- [ ] **Step 5: 테스트 실행 → 통과 확인**

Run: `pnpm --filter workplace-mcp test issue.test.ts`
Expected: PASS

- [ ] **Step 6: `src/tools/index.ts` 주석 갱신**

`apps/workplace-mcp/src/tools/index.ts`의 총 도구 개수 주석("이슈 8 + ... = 총 23종")을 실제 총합에 맞춰 갱신(이슈 8→10, 총합 +2).

- [ ] **Step 7: typecheck + lint**

Run: `pnpm --filter workplace-mcp typecheck && pnpm --filter workplace-mcp lint`
Expected: 에러 없음

- [ ] **Step 8: Commit**

```bash
git add apps/workplace-mcp/src/tools/issue.ts apps/workplace-mcp/src/tools/issue.test.ts apps/workplace-mcp/src/tools/index.ts
git commit -m "feat(mcp): add_issue_dependency/remove_issue_dependency 도구 추가"
```

---

## Task 3: workplace-ai-agent 클라이언트 메서드

**Files:**
- Modify: `apps/workplace-ai-agent/src/clients/workplace-api.ts:238` 근처(`WorkplaceApiClient` 인터페이스, `replaceIssueLabels` 다음), `:448` 근처(구현부, `replaceIssueLabels` 구현 다음)
- Modify: `apps/workplace-ai-agent/src/mcp/tools.test.ts` (`client()` 헬퍼에 두 메서드 mock 추가 — Task 4에서 도구 테스트가 이 파일을 쓰므로 여기서 같이 해도 되지만, 클라이언트 자체 테스트만 이 Task 범위. `client()` 헬퍼 갱신은 Task 4 Step 1에서 수행)
- Test: `apps/workplace-ai-agent/src/clients/workplace-api.test.ts`

**Interfaces:**
- Produces: `WorkplaceApiClient.addIssueDependency(agentId: number, issueKey: string, otherNumber: number, direction: 'blocks' | 'blockedBy'): Promise<unknown>`.
- Produces: `WorkplaceApiClient.removeIssueDependency(agentId: number, issueKey: string, otherNumber: number, direction: 'blocks' | 'blockedBy'): Promise<void>`.
- Consumes: 같은 파일의 `parseIssueKey(issueKey: string): { projectKey: string; number: number }`(기존, L346-355), `onBehalfOf(agentId: number)`(기존, L368).

- [ ] **Step 1: 실패하는 테스트 작성**

`apps/workplace-ai-agent/src/clients/workplace-api.test.ts`에서 `replaceIssueAssignees`의 `describe` 블록 다음에 추가:

```ts
  describe('addIssueDependency', () => {
    it('의존성을 추가하고 응답 body 를 반환한다', async () => {
      nock(BASE)
        .post(`${PREFIX}/projects/ABC/issues/5/dependencies`, { otherNumber: 7, direction: 'blocks' })
        .reply(200, { summary: { id: 1, blocks: [{ number: 7 }] } });
      const out = await newClient().addIssueDependency(7, 'ABC-5', 7, 'blocks');
      expect(out).toEqual({ summary: { id: 1, blocks: [{ number: 7 }] } });
    });
  });

  describe('removeIssueDependency', () => {
    it('의존성을 제거한다', async () => {
      nock(BASE)
        .delete(`${PREFIX}/projects/ABC/issues/5/dependencies`)
        .query({ otherNumber: '7', direction: 'blocks' })
        .reply(204);
      await newClient().removeIssueDependency(7, 'ABC-5', 7, 'blocks');
    });
  });
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

Run: `pnpm --filter workplace-ai-agent test workplace-api.test.ts`
Expected: FAIL — `newClient(...).addIssueDependency is not a function`

- [ ] **Step 3: `WorkplaceApiClient` 인터페이스에 시그니처 추가**

`apps/workplace-ai-agent/src/clients/workplace-api.ts`에서 `replaceIssueLabels` 시그니처 다음에 추가:

```ts
  addIssueDependency(
    agentId: number,
    issueKey: string,
    otherNumber: number,
    direction: 'blocks' | 'blockedBy',
  ): Promise<unknown>;
  removeIssueDependency(
    agentId: number,
    issueKey: string,
    otherNumber: number,
    direction: 'blocks' | 'blockedBy',
  ): Promise<void>;
```

- [ ] **Step 4: 구현 추가**

`createWorkplaceApiClient` 반환 객체 안, `replaceIssueLabels` 구현 다음(`updateIssueStatus` 앞)에 추가:

```ts
    async addIssueDependency(agentId, issueKey, otherNumber, direction) {
      const { projectKey, number } = parseIssueKey(issueKey);
      return (
        await http.post(
          `/projects/${projectKey}/issues/${number}/dependencies`,
          { otherNumber, direction },
          onBehalfOf(agentId),
        )
      ).data;
    },
    async removeIssueDependency(agentId, issueKey, otherNumber, direction) {
      const { projectKey, number } = parseIssueKey(issueKey);
      await http.delete(`/projects/${projectKey}/issues/${number}/dependencies`, {
        params: { otherNumber, direction },
        ...onBehalfOf(agentId),
      });
    },
```

- [ ] **Step 5: 테스트 실행 → 통과 확인**

Run: `pnpm --filter workplace-ai-agent test workplace-api.test.ts`
Expected: PASS (단, `client()` 헬퍼를 쓰는 `tools.test.ts`는 아직 이 시점에 컴파일 실패할 수 있음 — Task 4 Step 1에서 해결)

- [ ] **Step 6: Commit**

```bash
git add apps/workplace-ai-agent/src/clients/workplace-api.ts apps/workplace-ai-agent/src/clients/workplace-api.test.ts
git commit -m "feat(ai-agent): 이슈 의존성 add/remove 클라이언트 메서드 추가"
```

---

## Task 4: workplace-ai-agent 도구(`add_issue_dependency`/`remove_issue_dependency`)

**Files:**
- Modify: `apps/workplace-ai-agent/src/mcp/tools.ts`
- Modify/Test: `apps/workplace-ai-agent/src/mcp/tools.test.ts`

**Interfaces:**
- Consumes: `WorkplaceApiClient.addIssueDependency`/`removeIssueDependency`(Task 3), `parseIssueKey`(import from `../clients/workplace-api.js`, 이미 이 파일에서 `updateIssueTool` 핸들러가 사용 중).
- Produces: `McpTool` 이름 `add_issue_dependency`, `remove_issue_dependency` — `issue`와 `assistant` 프로필 반환 배열(`unassignSelfTool` 다음)에 포함.

- [ ] **Step 1: `client()` 테스트 헬퍼에 mock 추가 (선행 필요)**

`apps/workplace-ai-agent/src/mcp/tools.test.ts`의 `client()` 함수 안, `replaceIssueLabels: vi.fn().mockResolvedValue({}),` 다음 줄에 추가:

```ts
    addIssueDependency: vi.fn().mockResolvedValue({}),
    removeIssueDependency: vi.fn().mockResolvedValue(undefined),
```

- [ ] **Step 2: 실패하는 테스트 작성**

같은 파일의 `issue 프로필(기본)` 이름 목록 테스트(L260-274)를 갱신:

```ts
  it('issue 프로필(기본): 기존 4개 + 위키 읽기 도구', () => {
    const names = buildTools(client(), AGENT_ID, 'issue').map((t) => t.name).sort();
    expect(names).toEqual([
      'add_comment',
      'add_issue_dependency',
      'create_issue',
      'edit_comment',
      'get_issue_detail',
      'get_wiki_page',
      'list_wiki_spaces',
      'remove_issue_dependency',
      'search_wiki',
      'unassign_self',
      'update_issue',
      'update_status',
    ]);
  });
```

그 아래에 새 `describe` 블록 추가:

```ts
describe('add_issue_dependency / remove_issue_dependency', () => {
  it('add_issue_dependency → client.addIssueDependency(agentId, issueKey, otherNumber, direction)', async () => {
    const c = client();
    const t = buildTools(c, AGENT_ID, 'issue').find((x) => x.name === 'add_issue_dependency')!;
    const out = await t.handler({ issueKey: 'WP-12', otherIssueKey: 'WP-7', direction: 'blocks' });
    expect(c.addIssueDependency).toHaveBeenCalledWith(AGENT_ID, 'WP-12', 7, 'blocks');
    expect(out).toBe(JSON.stringify({}));
  });

  it('프로젝트가 다르면 API 호출 없이 에러를 던진다', async () => {
    const c = client();
    const t = buildTools(c, AGENT_ID, 'issue').find((x) => x.name === 'add_issue_dependency')!;
    await expect(
      t.handler({ issueKey: 'WP-12', otherIssueKey: 'OTHER-7', direction: 'blocks' }),
    ).rejects.toThrow('동일 프로젝트 이슈 간에만 의존성을 설정할 수 있습니다.');
    expect(c.addIssueDependency).not.toHaveBeenCalled();
  });

  it('remove_issue_dependency → client.removeIssueDependency(agentId, issueKey, otherNumber, direction)', async () => {
    const c = client();
    const t = buildTools(c, AGENT_ID, 'issue').find((x) => x.name === 'remove_issue_dependency')!;
    const out = await t.handler({ issueKey: 'WP-12', otherIssueKey: 'WP-7', direction: 'blockedBy' });
    expect(c.removeIssueDependency).toHaveBeenCalledWith(AGENT_ID, 'WP-12', 7, 'blockedBy');
    expect(out).toBe('ok');
  });

  it('assistant 프로필에도 노출된다', () => {
    const names = buildTools(client(), AGENT_ID, 'assistant').map((t) => t.name);
    expect(names).toContain('add_issue_dependency');
    expect(names).toContain('remove_issue_dependency');
  });
});
```

- [ ] **Step 3: 테스트 실행 → 실패 확인**

Run: `pnpm --filter workplace-ai-agent test tools.test.ts`
Expected: FAIL — 이름 목록 불일치 + `Cannot read properties of undefined (reading 'handler')`

- [ ] **Step 4: 입력 스키마 추가**

`apps/workplace-ai-agent/src/mcp/tools.ts`에서 `updateIssueInput` 정의(L48-62) 다음에 추가:

```ts
// 이슈 간 의존성(차단 관계) add/remove 공용 입력.
const dependencyInput = z.object({
  issueKey: z.string().min(1),
  otherIssueKey: z.string().min(1),
  direction: z.enum(['blocks', 'blockedBy']),
});
```

- [ ] **Step 5: 도구 2개 정의**

`updateIssueTool` 정의 다음, `unassignSelfTool` 정의 앞(L713-763과 L771 사이)에 추가:

```ts
  const addDependencyTool: McpTool = {
    name: 'add_issue_dependency',
    description:
      '이슈 간 의존성(차단 관계)을 추가합니다. direction="blocks" 면 issueKey 이슈가 ' +
      'otherIssueKey 이슈를 차단하고, "blockedBy" 면 반대로 차단됩니다. ' +
      '두 이슈는 같은 프로젝트여야 하며, 순환 관계가 되면 에러가 발생합니다.',
    inputSchema: dependencyInput,
    async handler(args) {
      const { issueKey: k, otherIssueKey, direction } = dependencyInput.parse(args);
      const { projectKey } = parseIssueKey(k);
      const { projectKey: otherProjectKey, number: otherNumber } = parseIssueKey(otherIssueKey);
      if (otherProjectKey !== projectKey) {
        throw new Error('동일 프로젝트 이슈 간에만 의존성을 설정할 수 있습니다.');
      }
      return JSON.stringify(await client.addIssueDependency(agentId, k, otherNumber, direction));
    },
  };
  const removeDependencyTool: McpTool = {
    name: 'remove_issue_dependency',
    description: '이슈 간 의존성을 제거합니다. 존재하지 않아도 에러 없이 성공합니다(멱등).',
    inputSchema: dependencyInput,
    async handler(args) {
      const { issueKey: k, otherIssueKey, direction } = dependencyInput.parse(args);
      const { projectKey } = parseIssueKey(k);
      const { projectKey: otherProjectKey, number: otherNumber } = parseIssueKey(otherIssueKey);
      if (otherProjectKey !== projectKey) {
        throw new Error('동일 프로젝트 이슈 간에만 의존성을 설정할 수 있습니다.');
      }
      await client.removeIssueDependency(agentId, k, otherNumber, direction);
      return 'ok';
    },
  };
```

- [ ] **Step 6: `issue`/`assistant` 프로필 배열에 등록**

`issue` 프로필 반환 배열(L1322-1333)의 `unassignSelfTool,` 다음에 추가:

```ts
    addDependencyTool,
    removeDependencyTool,
```

`assistant` 프로필 반환 배열(L1270-1318)의 `unassignSelfTool,`(L1283) 다음에 동일하게 추가:

```ts
      addDependencyTool,
      removeDependencyTool,
```

- [ ] **Step 7: 테스트 실행 → 통과 확인**

Run: `pnpm --filter workplace-ai-agent test tools.test.ts`
Expected: PASS

- [ ] **Step 8: typecheck + 전체 테스트**

Run: `pnpm --filter workplace-ai-agent typecheck && pnpm --filter workplace-ai-agent test`
Expected: 에러 없음, 전체 PASS

- [ ] **Step 9: Commit**

```bash
git add apps/workplace-ai-agent/src/mcp/tools.ts apps/workplace-ai-agent/src/mcp/tools.test.ts
git commit -m "feat(ai-agent): add_issue_dependency/remove_issue_dependency 도구 추가"
```

---

## Task 5: 라이브 검증 (필수, 목 테스트로 대체 불가)

스펙 §8.1 근거: 과거 AGENT On-Behalf-Of 신원이 특정 필드에서 사람과 다른 403 규칙에 걸린 전례(`ai-agent-issue-access-gap` #418, `assignees` 필드)가 있어, mock 테스트만으로는 이 리스크를 잡지 못한다.

**Files:** 없음(코드 변경 아님, 로컬 실행으로 검증)

- [ ] **Step 1: 로컬 서버 기동**

```bash
pnpm db:up   # 아직 안 떠 있다면
# workplace-api: apps/workplace-api 에서 ./gradlew bootRun --args='--spring.profiles.active=local' (port 6060)
# workplace-ai-agent: apps/workplace-ai-agent 에서 pnpm dev (port 6070)
```

- [ ] **Step 2: AGENT On-Behalf-Of 헤더로 add 직접 호출**

같은 프로젝트 내 AGENT가 배정된 이슈 2건(예: 로컬 dev DB의 `EX-1`, `EX-2`)에 대해:

```bash
curl -X POST http://localhost:6060/api/v1/projects/EX/issues/1/dependencies \
  -H "Authorization: Internal <INTERNAL_SERVICE_TOKEN>" \
  -H "X-On-Behalf-Of: <agentId>" \
  -H "Content-Type: application/json" \
  -d '{"otherNumber": 2, "direction": "blocks"}'
```

Expected: `200` + 갱신된 이슈 상세(403이 아님). 403이면 §7 에러 매핑 전제가 깨진 것 — 백엔드 권한 로직(`IssueDependencyController`/`IssueDependencyService`)에 AGENT 전용 제약이 있는지 확인 후 별도 이슈로 등록.

- [ ] **Step 3: 사이클 케이스 확인**

바로 이어서 반대 방향을 추가 시도:

```bash
curl -X POST http://localhost:6060/api/v1/projects/EX/issues/2/dependencies \
  -H "Authorization: Internal <INTERNAL_SERVICE_TOKEN>" \
  -H "X-On-Behalf-Of: <agentId>" \
  -H "Content-Type: application/json" \
  -d '{"otherNumber": 1, "direction": "blocks"}'
```

Expected: `409` + "의존성 사이클이 발생합니다" 메시지.

- [ ] **Step 4: remove 멱등성 확인**

```bash
curl -X DELETE "http://localhost:6060/api/v1/projects/EX/issues/1/dependencies?otherNumber=2&direction=blocks" \
  -H "Authorization: Internal <INTERNAL_SERVICE_TOKEN>" \
  -H "X-On-Behalf-Of: <agentId>"
# 같은 요청 두 번 반복
```

Expected: 두 번 모두 `204`.

- [ ] **Step 5: 결과를 스펙 문서에 기록**

`docs/superpowers/specs/2026-07-09-issue-dependency-tools-design.md`의 §8.1 아래에 라이브 검증 결과(날짜, 사용 계정/프로젝트, PASS/FAIL 목록)를 추가하고 커밋:

```bash
git add -f docs/superpowers/specs/2026-07-09-issue-dependency-tools-design.md
git commit -m "docs(spec): 이슈 의존성 도구 라이브 검증 결과 기록"
```
