# AGENT CLI LLM 응답 + MCP 도구 + 자기-unassign 권한 구현 계획 (Phase 5c-2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ai-agent 가 4 종 envelope 마다 `claude` CLI 를 spawn 해 LLM 응답을 받고, MCP 도구 4 개로 workplace-api 를 조작하며, 백엔드는 AGENT 가 자기 자신만 unassign 하도록 권한을 강제한다.

**Architecture:** Express `/events` 핸들러 → `runAgent()` fire-and-forget → child `claude` CLI (구독 OAuth) → stdio MCP server (별 entry point) → workplace-api. 백엔드 `IssueAssigneeService.replace` 에 AGENT 분기 추가. 단일 commit (`feat: ... — #30 (5c-2)`).

**Tech Stack:** Node 22 + TypeScript NodeNext + Express 4 + Zod 4 + `@modelcontextprotocol/sdk` + Vitest 4 + nock / Spring Boot 3.4 + jOOQ.

**기준 참조:**
- Spec: `docs/superpowers/specs/2026-05-26-agent-llm-mcp-cli-design.md`
- 차용 패턴: `/Users/bluleo78/git/smart-fire-hub/apps/firehub-ai-agent/src/agent/agent-cli.ts`
- 단일 commit 정책 — 한국어, `feat: AGENT CLI LLM 응답 + MCP 도구 + 자기-unassign 권한 — #30 (5c-2)`
- 푸시·#30 close 는 사용자 명시적 승인 후

---

## Phase 0 — 사전 정리

### Task 0: 브랜치/상태 확인

- [ ] **Step 1: 작업 디렉토리·브랜치 확인**

Run: `git status && git branch --show-current`
Expected: 클린 worktree, 브랜치 `main`. 미커밋 변경이 있으면 stop 하고 사용자에게 보고.

- [ ] **Step 2: 5c-1 흔적이 본 plan 가정과 일치하는지 확인**

Run: `git log --oneline -5`
Expected: 가장 위가 `93f8d2e refactor(ai-agent): self-loop defense...` 또는 그 이후. spec commit (`af2caef`) 가 history 에 있어야 함.

---

## Phase 1 — workplace-api: AGENT 자기-unassign 권한 분기 (백엔드 먼저)

ai-agent 의 `unassign_self` 도구가 호출할 종착지를 먼저 만들어 둔다. backend 가 먼저 통과해야 통합 테스트 + 수동 e2e 가 의미 있다.

### Task 1: `IssueAssigneeAgentRestrictionException` 신규

**Files:**
- Create: `apps/workplace-api/src/main/java/com/workplace/issue/exception/IssueAssigneeAgentRestrictionException.java`

- [ ] **Step 1: 예외 클래스 작성**

```java
package com.workplace.issue.exception;

/**
 * AGENT 가 자기 자신을 제외한 assignee 집합을 변경하려 시도 — 403.
 * AGENT 는 본인을 추가하거나 다른 사람을 추가/제거할 수 없고, 본인을 제거하는 것만 허용된다.
 */
public class IssueAssigneeAgentRestrictionException extends RuntimeException {
  public IssueAssigneeAgentRestrictionException() {
    super("AGENT 는 자기 자신만 담당자에서 제외할 수 있습니다");
  }
}
```

- [ ] **Step 2: 컴파일 확인**

Run: `./gradlew :apps:workplace-api:compileJava -q`
Expected: BUILD SUCCESSFUL (참고: 실제 모듈 경로는 `apps/workplace-api` — 루트에서 `cd apps/workplace-api && ./gradlew compileJava -q` 도 가능).

### Task 2: `GlobalExceptionHandler` 에 403 매핑 추가

**Files:**
- Modify: `apps/workplace-api/src/main/java/com/workplace/global/exception/GlobalExceptionHandler.java`

- [ ] **Step 1: import 추가**

기존 `import com.workplace.issue.exception.InvalidAssigneeForProjectException;` 라인 바로 아래에 추가:

```java
import com.workplace.issue.exception.IssueAssigneeAgentRestrictionException;
```

- [ ] **Step 2: 핸들러 메서드 추가**

`handleInvalidAssigneeForProject` 메서드 바로 다음 위치에 추가:

```java
  /** Phase 5c-2 — AGENT 가 자기 외 assignee 변경 시도 → 403. */
  @ExceptionHandler(IssueAssigneeAgentRestrictionException.class)
  public ResponseEntity<ErrorResponse> handleAgentAssigneeRestriction(
      IssueAssigneeAgentRestrictionException ex, HttpServletRequest request) {
    return ResponseEntity.status(HttpStatus.FORBIDDEN)
        .body(buildError(HttpStatus.FORBIDDEN, ex.getMessage(), null, request));
  }
```

- [ ] **Step 3: 컴파일 확인**

Run: `cd apps/workplace-api && ./gradlew compileJava -q`
Expected: BUILD SUCCESSFUL.

### Task 3: `IssueAssigneeServiceTest` 에 AGENT 분기 5 케이스 (실패 상태)

**Files:**
- Modify: `apps/workplace-api/src/test/java/com/workplace/issue/service/IssueAssigneeServiceTest.java`

- [ ] **Step 1: import 추가 (파일 상단)**

```java
import com.workplace.issue.exception.IssueAssigneeAgentRestrictionException;
import com.workplace.user.repository.UserRepository;
```

`@Autowired ProjectService projectService;` 다음 줄에 `@Autowired UserRepository userRepository;` 추가.

- [ ] **Step 2: AGENT 유저 생성 헬퍼 + AGENT 멤버 헬퍼 (클래스 안)**

기존 `private Long createUser(String prefix)` 다음에 추가:

```java
  /** AGENT 유저 생성 (password=NULL, kind='AGENT'). 권한 분기 통합 테스트용. */
  private Long createAgentUser(String prefix) {
    String suffix = UUID.randomUUID().toString().substring(0, 8);
    Long id =
        dsl.insertInto(USER)
            .set(USER.USERNAME, prefix + "-" + suffix)
            .set(USER.NAME, prefix)
            .set(USER.EMAIL, prefix + "-" + suffix + "@example.com")
            .set(USER.KIND, "AGENT")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    Long roleId = dsl.select(ROLE.ID).from(ROLE).where(ROLE.NAME.eq("USER")).fetchOne(ROLE.ID);
    dsl.insertInto(USER_ROLE).set(USER_ROLE.USER_ID, id).set(USER_ROLE.ROLE_ID, roleId).execute();
    return id;
  }
```

- [ ] **Step 3: 5 케이스 테스트 메서드 추가 (클래스 끝)**

```java
  @Test
  void agent_unassigning_only_self_succeeds() {
    Long owner = createUser("ag-owner");
    Long agent = createAgentUser("ag-self");
    ProjectResponse p = newProject(owner, "AGSELF");
    projectService.addMember(owner, p.key(), new AddMemberRequest(agent, "MEMBER"));
    IssueRow issue = issueRepository.insert(p.id(), 1, "t", null, "MID", null, owner);
    service.replace(owner, p.key(), 1, List.of(agent));

    // AGENT 본인이 자기를 빼는 것만 시도 — 빈 목록
    var result = service.replace(agent, p.key(), 1, List.of());

    assertThat(result).isEmpty();
  }

  @Test
  void agent_unassigning_someone_else_throws_403() {
    Long owner = createUser("ag2-owner");
    Long other = createUser("ag2-other");
    Long agent = createAgentUser("ag2-self");
    ProjectResponse p = newProject(owner, "AGOTH");
    projectService.addMember(owner, p.key(), new AddMemberRequest(other, "MEMBER"));
    projectService.addMember(owner, p.key(), new AddMemberRequest(agent, "MEMBER"));
    issueRepository.insert(p.id(), 1, "t", null, "MID", null, owner);
    service.replace(owner, p.key(), 1, List.of(other, agent));

    // AGENT 가 자기는 유지, other 만 제거 시도 → 403
    assertThatThrownBy(() -> service.replace(agent, p.key(), 1, List.of(agent)))
        .isInstanceOf(IssueAssigneeAgentRestrictionException.class);
  }

  @Test
  void agent_adding_new_user_throws_403() {
    Long owner = createUser("ag3-owner");
    Long other = createUser("ag3-other");
    Long agent = createAgentUser("ag3-self");
    ProjectResponse p = newProject(owner, "AGADD");
    projectService.addMember(owner, p.key(), new AddMemberRequest(other, "MEMBER"));
    projectService.addMember(owner, p.key(), new AddMemberRequest(agent, "MEMBER"));
    issueRepository.insert(p.id(), 1, "t", null, "MID", null, owner);
    service.replace(owner, p.key(), 1, List.of(agent));

    // AGENT 가 other 를 추가 시도 → 403
    assertThatThrownBy(() -> service.replace(agent, p.key(), 1, List.of(agent, other)))
        .isInstanceOf(IssueAssigneeAgentRestrictionException.class);
  }

  @Test
  void agent_solo_removing_self_succeeds() {
    Long owner = createUser("ag4-owner");
    Long agent = createAgentUser("ag4-self");
    ProjectResponse p = newProject(owner, "AGSOL");
    projectService.addMember(owner, p.key(), new AddMemberRequest(agent, "MEMBER"));
    issueRepository.insert(p.id(), 1, "t", null, "MID", null, owner);
    service.replace(owner, p.key(), 1, List.of(agent));

    var result = service.replace(agent, p.key(), 1, List.of());

    assertThat(result).isEmpty();
  }

  @Test
  void human_assignee_changes_unaffected_by_agent_branch() {
    Long owner = createUser("ag5-owner");
    Long other = createUser("ag5-other");
    ProjectResponse p = newProject(owner, "AGHUM");
    projectService.addMember(owner, p.key(), new AddMemberRequest(other, "MEMBER"));
    issueRepository.insert(p.id(), 1, "t", null, "MID", null, owner);

    var result = service.replace(owner, p.key(), 1, List.of(other));

    assertThat(result).hasSize(1);
    assertThat(result.get(0).id()).isEqualTo(other);
  }
```

- [ ] **Step 4: 테스트 실행 → 4 케이스 FAIL 예상 (분기 미구현)**

Run: `cd apps/workplace-api && ./gradlew test --tests 'com.workplace.issue.service.IssueAssigneeServiceTest.agent_*' --tests 'com.workplace.issue.service.IssueAssigneeServiceTest.human_assignee_changes_unaffected_by_agent_branch'`
Expected: `agent_unassigning_someone_else_throws_403`, `agent_adding_new_user_throws_403` 는 FAIL (현재는 그냥 통과해버림 — `IssueAssigneeAgentRestrictionException` 미발생). 나머지 3 케이스는 PASS.

> 메모: `_self`, `_solo`, `human_*` 는 분기 추가 후에도 동작이 같아야 회귀 검출. agent_self / agent_solo 가 우연히 통과하더라도 분기 추가 후에도 다시 확인.

### Task 4: `IssueAssigneeService.replace` 에 AGENT 분기 구현

**Files:**
- Modify: `apps/workplace-api/src/main/java/com/workplace/issue/service/IssueAssigneeService.java`

- [ ] **Step 1: import 추가**

```java
import com.workplace.issue.exception.IssueAssigneeAgentRestrictionException;
```

- [ ] **Step 2: diff 계산 직전 (line 69 `// 2) diff 계산` 바로 위) 에 AGENT 분기 삽입**

```java
    // 1-b) AGENT 호출자는 "자기 자신만 제거" 외 변경 금지 (Phase 5c-2)
    var callerUser =
        userRepository
            .findById(callerId)
            .orElseThrow(() -> new IllegalStateException("caller user 없음: " + callerId));
    if ("AGENT".equals(callerUser.kind())) {
      Set<Long> currentSet = new HashSet<>(repo.findUserIdsByIssue(issue.id()));
      Set<Long> targetSet = new HashSet<>(normalized);
      Set<Long> currentMinusSelf = new HashSet<>(currentSet);
      currentMinusSelf.remove(callerId);
      if (!targetSet.equals(currentMinusSelf)) {
        throw new IssueAssigneeAgentRestrictionException();
      }
    }
```

> 주의: 기존 `Set<Long> current = ...` 가 line 70 이지만 본 분기는 그 위에서 `repo.findUserIdsByIssue` 를 한 번 더 호출. 호출 횟수 1회 증가 — 정상 (분기 빈도 낮음, 캐시 불필요).

- [ ] **Step 3: 테스트 재실행 → 5 케이스 PASS 예상**

Run: `cd apps/workplace-api && ./gradlew test --tests 'com.workplace.issue.service.IssueAssigneeServiceTest.agent_*' --tests 'com.workplace.issue.service.IssueAssigneeServiceTest.human_assignee_changes_unaffected_by_agent_branch'`
Expected: 5/5 PASS.

- [ ] **Step 4: 전체 IssueAssigneeServiceTest 회귀**

Run: `cd apps/workplace-api && ./gradlew test --tests 'com.workplace.issue.service.IssueAssigneeServiceTest'`
Expected: 모든 케이스 PASS.

- [ ] **Step 5: spotless 포맷**

Run: `cd apps/workplace-api && ./gradlew spotlessApply -q`
Expected: BUILD SUCCESSFUL.

---

## Phase 2 — ai-agent: 의존성 + workplace-api 클라이언트 확장

### Task 5: `@modelcontextprotocol/sdk` 의존성 추가

**Files:**
- Modify: `apps/workplace-ai-agent/package.json`

- [ ] **Step 1: dependencies 에 추가**

`"@anthropic-ai/claude-agent-sdk"` 라인 다음에:

```json
    "@modelcontextprotocol/sdk": "^1.0.4",
```

- [ ] **Step 2: 설치**

Run: `cd apps/workplace-ai-agent && pnpm install`
Expected: 설치 성공. lockfile 갱신.

- [ ] **Step 3: 빌드 확인**

Run: `cd apps/workplace-ai-agent && pnpm typecheck`
Expected: 통과 (의존성만 추가, 코드 변경 없음).

### Task 6: workplace-api 응답 zod 스키마

**Files:**
- Create: `apps/workplace-ai-agent/src/types/workplace-api.ts`

- [ ] **Step 1: 파일 작성**

```ts
// workplace-api 응답 스키마 — MCP 도구가 LLM 에 전달할 형태로 좁힌 부분 집합.
// 본 스키마는 workplace-api 의 IssueDetailResponse 와 1:1 일치하지 않는다.
// 도구 호출 결과로 LLM 이 읽을 핵심 필드만 포함.
import { z } from 'zod';

export const userSummary = z.object({
  id: z.number(),
  username: z.string(),
  name: z.string().nullable().optional(),
  kind: z.enum(['HUMAN', 'AGENT']),
});

export const issueComment = z.object({
  id: z.number(),
  body: z.string(),
  author: userSummary,
  createdAt: z.string(),
});

export const issueDetail = z.object({
  issueKey: z.string(),
  title: z.string(),
  body: z.string().nullable().optional(),
  status: z.string(),
  priority: z.string(),
  assignees: z.array(userSummary),
  comments: z.array(issueComment).optional(),
});

export type UserSummary = z.infer<typeof userSummary>;
export type IssueDetail = z.infer<typeof issueDetail>;

// /users/me 응답 — 캐시할 self id 만 필요.
export const selfUser = z.object({
  id: z.number(),
  username: z.string(),
  kind: z.enum(['HUMAN', 'AGENT']),
});
export type SelfUser = z.infer<typeof selfUser>;
```

- [ ] **Step 2: 타입 컴파일 확인**

Run: `cd apps/workplace-ai-agent && pnpm typecheck`
Expected: 통과.

### Task 7: `workplace-api.test.ts` — `updateIssueStatus` 실제 PATCH 케이스 (실패 상태)

**Files:**
- Modify: `apps/workplace-ai-agent/src/clients/workplace-api.test.ts`

- [ ] **Step 1: 기존 "updateIssueStatus 는 5c-1 에서 여전히 throw" 케이스를 실제 PATCH 케이스로 교체**

```ts
  it('updateIssueStatus → PATCH /projects/{key}/issues/{number}/status', async () => {
    const scope = nock(BASE)
      .matchHeader('x-api-key', 'k')
      .patch(`${PREFIX}/projects/WP/issues/1/status`, { status: 'DONE' })
      .reply(200, {});

    const c = createWorkplaceApiClient({
      baseURL: `${BASE}${PREFIX}`,
      apiKey: 'k',
    });
    await c.updateIssueStatus('WP-1', 'DONE');

    expect(scope.isDone()).toBe(true);
  });
```

- [ ] **Step 2: `getIssueDetail` 케이스 추가 (describe 안)**

```ts
  it('getIssueDetail → GET /projects/{key}/issues/{number} + 응답 파싱', async () => {
    nock(BASE)
      .matchHeader('x-api-key', 'k')
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

    const c = createWorkplaceApiClient({
      baseURL: `${BASE}${PREFIX}`,
      apiKey: 'k',
    });
    const d = await c.getIssueDetail('WP-42');

    expect(d.issueKey).toBe('WP-42');
    expect(d.title).toBe('분석');
    expect(d.assignees[0].kind).toBe('AGENT');
  });
```

> workplace-api 의 실제 issueKey 필드 이름은 응답 매핑 시 `key` 일 수 있어 client 에서 `issueKey: data.key ?? data.issueKey` 식으로 받음 — Task 8 에서 처리.

- [ ] **Step 3: `unassignSelf` 시퀀스 케이스 추가**

```ts
  it('unassignSelf → /users/me 후 assignees PUT (자기만 제외)', async () => {
    nock(BASE)
      .matchHeader('x-api-key', 'k')
      .get(`${PREFIX}/users/me`)
      .reply(200, { id: 201, username: 'ai-bot', kind: 'AGENT' });
    nock(BASE)
      .matchHeader('x-api-key', 'k')
      .get(`${PREFIX}/projects/WP/issues/42/assignees`)
      .reply(200, [
        { id: 7, username: 'alice', kind: 'HUMAN' },
        { id: 201, username: 'ai-bot', kind: 'AGENT' },
      ]);
    const putScope = nock(BASE)
      .matchHeader('x-api-key', 'k')
      .put(`${PREFIX}/projects/WP/issues/42/assignees`, { userIds: [7] })
      .reply(200, []);

    const c = createWorkplaceApiClient({
      baseURL: `${BASE}${PREFIX}`,
      apiKey: 'k',
    });
    await c.unassignSelf('WP-42');

    expect(putScope.isDone()).toBe(true);
  });

  it('unassignSelf 연속 호출 시 /users/me 는 1회만 (캐시)', async () => {
    nock(BASE).get(`${PREFIX}/users/me`).reply(200, { id: 201, username: 'ai-bot', kind: 'AGENT' });
    nock(BASE)
      .get(`${PREFIX}/projects/WP/issues/1/assignees`)
      .reply(200, [{ id: 201, username: 'ai-bot', kind: 'AGENT' }]);
    nock(BASE).put(`${PREFIX}/projects/WP/issues/1/assignees`, { userIds: [] }).reply(200, []);
    nock(BASE)
      .get(`${PREFIX}/projects/WP/issues/2/assignees`)
      .reply(200, [{ id: 201, username: 'ai-bot', kind: 'AGENT' }]);
    nock(BASE).put(`${PREFIX}/projects/WP/issues/2/assignees`, { userIds: [] }).reply(200, []);

    const c = createWorkplaceApiClient({
      baseURL: `${BASE}${PREFIX}`,
      apiKey: 'k',
    });
    await c.unassignSelf('WP-1');
    await c.unassignSelf('WP-2');

    // /users/me 가 두 번째 호출에서도 발생했다면 nock pending 이 남음
    expect(nock.pendingMocks()).toEqual([]);
  });
```

- [ ] **Step 4: 테스트 실행 → 4 케이스 FAIL 예상 (메서드 미구현)**

Run: `cd apps/workplace-ai-agent && pnpm test src/clients/workplace-api.test.ts`
Expected: `updateIssueStatus`, `getIssueDetail`, `unassignSelf` (2개) FAIL — `c.getIssueDetail is not a function` 등.

### Task 8: `workplace-api.ts` — 4 메서드 본문

**Files:**
- Modify: `apps/workplace-ai-agent/src/clients/workplace-api.ts`

- [ ] **Step 1: 파일 전체 교체**

```ts
// workplace-api 호출용 axios 인스턴스. AGENT API key 인증.
// 5c-2 에서 LLM 도구가 호출할 메서드 추가:
//   - getIssueDetail / updateIssueStatus / unassignSelf
// /users/me 는 프로세스 수명 동안 캐시 (1회만 호출).
import axios, { AxiosInstance } from 'axios';

import { DEFAULT_API_BASE_URL } from '../constants.js';
import {
  IssueDetail,
  SelfUser,
  issueDetail,
  selfUser,
} from '../types/workplace-api.js';

export interface WorkplaceApiClient {
  // 이슈에 코멘트 작성 — AGENT 권한.
  addIssueComment(issueKey: string, body: string): Promise<void>;
  // 이슈 상태 변경.
  updateIssueStatus(issueKey: string, statusKey: string): Promise<void>;
  // 이슈 상세 조회 — LLM 컨텍스트용.
  getIssueDetail(issueKey: string): Promise<IssueDetail>;
  // 자기 자신만 assignee 에서 제거.
  unassignSelf(issueKey: string): Promise<void>;
  // 캐시된 self user id 조회 (테스트 보조).
  getCachedSelfUserId(): Promise<number>;
}

// issueKey("WP-42" / "A-B-7") → workplace-api URL 부품. projectKey 에
// 하이픈이 들어갈 수 있어 lastIndexOf 로 분리.
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
  apiKey: string;
}): WorkplaceApiClient {
  const http: AxiosInstance = axios.create({
    baseURL: opts.baseURL ?? DEFAULT_API_BASE_URL,
    headers: { 'X-Api-Key': opts.apiKey },
  });

  // /users/me 결과는 프로세스 수명 동안 변하지 않으므로 한 번만 호출.
  let selfPromise: Promise<SelfUser> | null = null;
  async function fetchSelf(): Promise<SelfUser> {
    if (!selfPromise) {
      selfPromise = http
        .get('/users/me')
        .then((r) => selfUser.parse(r.data))
        .catch((e) => {
          // 캐시 무효화 — 다음 호출이 다시 시도하도록.
          selfPromise = null;
          throw e;
        });
    }
    return selfPromise;
  }

  return {
    async addIssueComment(issueKey, body) {
      const { projectKey, number } = parseIssueKey(issueKey);
      await http.post(`/projects/${projectKey}/issues/${number}/comments`, {
        body,
      });
    },

    async updateIssueStatus(issueKey, statusKey) {
      const { projectKey, number } = parseIssueKey(issueKey);
      await http.patch(`/projects/${projectKey}/issues/${number}/status`, {
        status: statusKey,
      });
    },

    async getIssueDetail(issueKey) {
      const { projectKey, number } = parseIssueKey(issueKey);
      const r = await http.get(`/projects/${projectKey}/issues/${number}`);
      // workplace-api 의 응답 필드는 `key` — 도구 LLM 노출용으로 `issueKey` 로 정규화.
      const raw = r.data ?? {};
      const normalized = {
        ...raw,
        issueKey: raw.issueKey ?? raw.key ?? issueKey,
      };
      return issueDetail.parse(normalized);
    },

    async unassignSelf(issueKey) {
      const { projectKey, number } = parseIssueKey(issueKey);
      const me = await fetchSelf();
      const r = await http.get(
        `/projects/${projectKey}/issues/${number}/assignees`,
      );
      const current: { id: number }[] = Array.isArray(r.data) ? r.data : [];
      const next = current.filter((u) => u.id !== me.id).map((u) => u.id);
      await http.put(`/projects/${projectKey}/issues/${number}/assignees`, {
        userIds: next,
      });
    },

    async getCachedSelfUserId() {
      const me = await fetchSelf();
      return me.id;
    },
  };
}
```

- [ ] **Step 2: 테스트 재실행 → 신규 케이스 PASS 예상**

Run: `cd apps/workplace-ai-agent && pnpm test src/clients/workplace-api.test.ts`
Expected: 모든 케이스 PASS (parseIssueKey 2 + addIssueComment 1 + updateIssueStatus 1 + getIssueDetail 1 + unassignSelf 2).

---

## Phase 3 — ai-agent: MCP 도구 + MCP server entry point

### Task 9: `mcp/tools.ts` — 4 도구 정의 (실패 테스트 먼저)

**Files:**
- Create: `apps/workplace-ai-agent/src/mcp/tools.ts`
- Create: `apps/workplace-ai-agent/src/mcp/tools.test.ts`

- [ ] **Step 1: 실패 테스트 작성 (tools.test.ts)**

```ts
// 4 도구의 handler 가 client 의 정확한 메서드를 정확한 인자로 호출하는지 검증.
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
    getCachedSelfUserId: vi.fn().mockResolvedValue(201),
  };
}

describe('buildTools', () => {
  it('get_issue_detail 호출 → client.getIssueDetail 호출 후 JSON 문자열 반환', async () => {
    const c = client();
    const tools = buildTools(c);
    const t = tools.find((x) => x.name === 'get_issue_detail')!;
    const out = await t.handler({ issueKey: 'WP-1' });
    expect(c.getIssueDetail).toHaveBeenCalledWith('WP-1');
    expect(JSON.parse(out)).toMatchObject({ issueKey: 'WP-1' });
  });

  it('add_comment → client.addIssueComment(issueKey, body)', async () => {
    const c = client();
    const tools = buildTools(c);
    const t = tools.find((x) => x.name === 'add_comment')!;
    await t.handler({ issueKey: 'WP-1', body: '안녕' });
    expect(c.addIssueComment).toHaveBeenCalledWith('WP-1', '안녕');
  });

  it('update_status → client.updateIssueStatus(issueKey, status)', async () => {
    const c = client();
    const tools = buildTools(c);
    const t = tools.find((x) => x.name === 'update_status')!;
    await t.handler({ issueKey: 'WP-1', status: 'DONE' });
    expect(c.updateIssueStatus).toHaveBeenCalledWith('WP-1', 'DONE');
  });

  it('unassign_self → client.unassignSelf(issueKey)', async () => {
    const c = client();
    const tools = buildTools(c);
    const t = tools.find((x) => x.name === 'unassign_self')!;
    await t.handler({ issueKey: 'WP-1' });
    expect(c.unassignSelf).toHaveBeenCalledWith('WP-1');
  });

  it('update_status — 잘못된 status 는 zod 가 reject', async () => {
    const c = client();
    const tools = buildTools(c);
    const t = tools.find((x) => x.name === 'update_status')!;
    await expect(t.handler({ issueKey: 'WP-1', status: 'WRONG' })).rejects.toThrow();
    expect(c.updateIssueStatus).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 테스트 실행 → 파일 없어 FAIL**

Run: `cd apps/workplace-ai-agent && pnpm test src/mcp/tools.test.ts`
Expected: FAIL — Cannot find module `./tools.js`.

- [ ] **Step 3: `tools.ts` 작성**

```ts
// 4 MCP 도구 정의 — get_issue_detail / add_comment / update_status / unassign_self.
// 각 도구는 zod input schema + handler 쌍. workplace-mcp-server 가 이 목록을 등록한다.
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

export function buildTools(client: WorkplaceApiClient): McpTool[] {
  return [
    {
      name: 'get_issue_detail',
      description:
        '이슈의 본문·상태·담당자·코멘트 등 전체 컨텍스트를 JSON 으로 반환합니다.',
      inputSchema: issueKey,
      async handler(args) {
        const { issueKey: k } = issueKey.parse(args);
        const detail = await client.getIssueDetail(k);
        return JSON.stringify(detail);
      },
    },
    {
      name: 'add_comment',
      description: '이슈에 코멘트를 작성합니다. 본문은 마크다운을 지원합니다.',
      inputSchema: addCommentInput,
      async handler(args) {
        const { issueKey: k, body } = addCommentInput.parse(args);
        await client.addIssueComment(k, body);
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
        await client.updateIssueStatus(k, status);
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
        await client.unassignSelf(k);
        return 'ok';
      },
    },
  ];
}
```

- [ ] **Step 4: 테스트 PASS 확인**

Run: `cd apps/workplace-ai-agent && pnpm test src/mcp/tools.test.ts`
Expected: 5/5 PASS.

### Task 10: `mcp/workplace-mcp-server.ts` — 별 entry point

**Files:**
- Create: `apps/workplace-ai-agent/src/mcp/workplace-mcp-server.ts`

- [ ] **Step 1: 파일 작성**

```ts
// Workplace MCP server — Claude CLI 가 stdio child 로 띄우는 entry point.
// `node dist/mcp/workplace-mcp-server.js` 로 실행. 환경변수에서 workplace-api
// 접속 정보를 읽고 4 도구를 등록한다.
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
  const apiKey = process.env.WORKPLACE_AGENT_API_KEY;
  if (!baseURL || !apiKey) {
    console.error(
      '[workplace-mcp] WORKPLACE_API_BASE_URL / WORKPLACE_AGENT_API_KEY 미설정',
    );
    process.exit(1);
  }

  const client = createWorkplaceApiClient({ baseURL, apiKey });
  const tools = buildTools(client);

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
      }),
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
  console.error('[workplace-mcp] connected via stdio');
}

main().catch((e) => {
  console.error('[workplace-mcp] fatal:', e);
  process.exit(1);
});
```

- [ ] **Step 2: `zod-to-json-schema` 의존성 추가 (없을 시)**

Run: `cd apps/workplace-ai-agent && pnpm add zod-to-json-schema`
Expected: 설치 완료.

- [ ] **Step 3: 빌드 확인 — dist/mcp/workplace-mcp-server.js 생성**

Run: `cd apps/workplace-ai-agent && pnpm build && ls dist/mcp/workplace-mcp-server.js`
Expected: 파일 존재.

> entry point 자동 테스트는 없음 — 수동 e2e 에서 검증 (spec §테스트).

---

## Phase 4 — ai-agent: 시스템 프롬프트 + user message + MCP config

### Task 11: `agent/system-prompt.ts`

**Files:**
- Create: `apps/workplace-ai-agent/src/agent/system-prompt.ts`
- Create: `apps/workplace-ai-agent/src/agent/system-prompt.test.ts`

- [ ] **Step 1: 실패 테스트**

```ts
import { describe, expect, it } from 'vitest';
import { SYSTEM_PROMPT } from './system-prompt.js';

describe('SYSTEM_PROMPT', () => {
  it('필수 키워드 포함 (도구 이름 4개 + 톤·언어)', () => {
    expect(SYSTEM_PROMPT).toContain('get_issue_detail');
    expect(SYSTEM_PROMPT).toContain('add_comment');
    expect(SYSTEM_PROMPT).toContain('update_status');
    expect(SYSTEM_PROMPT).toContain('unassign_self');
    expect(SYSTEM_PROMPT).toContain('한국어');
    expect(SYSTEM_PROMPT).toContain('이모지 금지');
  });
});
```

- [ ] **Step 2: `system-prompt.ts` 작성**

```ts
// LLM 시스템 프롬프트 — 본 파일 1곳에서만 정의. cli-runner 가 --system-prompt 로 전달.
export const SYSTEM_PROMPT = `당신은 Smart Workplace 의 AI 어시스턴트 "AI Bot" 입니다. 이슈 트래커 안에서 사람과 함께 일합니다. 한국어로 응답합니다.

## 역할
- 사용자가 당신을 이슈의 담당자로 지정하면, 이슈를 분석하고 처리합니다.
- 사용자가 당신이 담당한 이슈에 코멘트로 질문/지시를 남기면 응답합니다.
- 상태 변경 알림도 받습니다 — 필요시 상황을 파악합니다.

## 사용 가능한 도구
- get_issue_detail(issueKey): 이슈 본문·코멘트·히스토리 등 전체 컨텍스트 조회
- add_comment(issueKey, body): 코멘트 작성
- update_status(issueKey, status): 상태 변경 (TODO / IN_PROGRESS / DONE / CANCELED)
- unassign_self(issueKey): 자기 자신을 담당자에서 제외 (작업 완료·반려 시)

## 행동 원칙
1. 항상 먼저 컨텍스트 파악: 트리거 payload 만으로 부족하면 get_issue_detail 로 본문·이전 코멘트·히스토리 조회.
2. 코멘트로 진행 상황 전달: 작업 착수·중간·완료 시점에 한국어로 짧게 코멘트.
3. 상태 변경 신중:
   - 착수 시 update_status('IN_PROGRESS')
   - 완료 시 update_status('DONE') + unassign_self
   - 처리 불가능하면 이유를 코멘트로 설명 + unassign_self
4. 자기 자신과 대화 금지: 자기가 남긴 코멘트의 이벤트는 받지 않습니다. 추가 행동 불필요.
5. 무한 루프 방지: 같은 종류 응답 5번 이상 금지.
6. 모를 때 정직하게: 추측 답변보다 "정보 부족 — 본문에 구체 요구사항을 적어주세요" 같은 코멘트가 낫습니다.

## 응답 톤
- 친근하지만 군더더기 없는 문장 ("~합니다", "~하겠습니다")
- 이모지 금지
- 코멘트는 1-3 문장. 긴 분석이 필요하면 마크다운 단락으로.
`;
```

- [ ] **Step 3: 테스트 PASS**

Run: `cd apps/workplace-ai-agent && pnpm test src/agent/system-prompt.test.ts`
Expected: 1/1 PASS.

### Task 12: `agent/user-message.ts` — 4 type 별 빌더

**Files:**
- Create: `apps/workplace-ai-agent/src/agent/user-message.ts`
- Create: `apps/workplace-ai-agent/src/agent/user-message.test.ts`

- [ ] **Step 1: 실패 테스트**

```ts
import { describe, expect, it } from 'vitest';
import { buildUserMessage } from './user-message.js';
import type { IssueEventEnvelope } from '../types/issue-events.js';

const common = {
  projectKey: 'WP',
  issueKey: 'WP-42',
  issueId: 42,
  issueTitle: '분석',
  actor: { id: 7, username: 'alice', kind: 'HUMAN' as const },
  assignees: [{ id: 201, username: 'ai-bot', kind: 'AGENT' as const }],
  occurredAt: '2026-05-25T12:00:00Z',
};

describe('buildUserMessage', () => {
  it('issue.created', () => {
    const m = buildUserMessage({
      type: 'issue.created',
      payload: { ...common, status: 'TODO', priority: 'MID' },
    } as IssueEventEnvelope);
    expect(m).toContain('[이벤트: issue.created]');
    expect(m).toContain('WP-42');
    expect(m).toContain('alice');
  });

  it('issue.assigned', () => {
    const m = buildUserMessage({
      type: 'issue.assigned',
      payload: { ...common, added: common.assignees, removed: [] },
    } as IssueEventEnvelope);
    expect(m).toContain('[이벤트: issue.assigned]');
    expect(m).toContain('update_status');
  });

  it('issue.commented', () => {
    const m = buildUserMessage({
      type: 'issue.commented',
      payload: { ...common, commentId: 1, commentBody: '확인 부탁' },
    } as IssueEventEnvelope);
    expect(m).toContain('[이벤트: issue.commented]');
    expect(m).toContain('"확인 부탁"');
  });

  it('issue.status_changed', () => {
    const m = buildUserMessage({
      type: 'issue.status_changed',
      payload: { ...common, previousStatus: 'TODO', newStatus: 'IN_PROGRESS' },
    } as IssueEventEnvelope);
    expect(m).toContain('TODO → IN_PROGRESS');
  });
});
```

- [ ] **Step 2: 테스트 실행 → FAIL (파일 없음)**

Run: `cd apps/workplace-ai-agent && pnpm test src/agent/user-message.test.ts`
Expected: FAIL.

- [ ] **Step 3: `user-message.ts` 작성**

```ts
// 4 type envelope → Claude CLI 에 넘길 user message 문자열 변환.
// spec §"Type 별 user message" 와 일치.
import type { IssueEventEnvelope } from '../types/issue-events.js';

export function buildUserMessage(env: IssueEventEnvelope): string {
  switch (env.type) {
    case 'issue.created': {
      const p = env.payload;
      return (
        `[이벤트: issue.created]\n` +
        `이슈가 새로 생성됐고 당신이 담당자입니다.\n` +
        `이슈키: ${p.issueKey}\n` +
        `제목: ${p.issueTitle}\n` +
        `생성자: @${p.actor.username}\n\n` +
        `필요시 get_issue_detail 로 본문을 확인하고 작업 방향을 코멘트로 알려주세요.`
      );
    }
    case 'issue.assigned': {
      const p = env.payload;
      return (
        `[이벤트: issue.assigned]\n` +
        `당신이 이 이슈의 담당자로 지정됐습니다.\n` +
        `이슈키: ${p.issueKey}\n` +
        `제목: ${p.issueTitle}\n` +
        `지정자: @${p.actor.username}\n\n` +
        `get_issue_detail 로 컨텍스트 파악 후 작업 시작. update_status('IN_PROGRESS') 와 시작 코멘트.`
      );
    }
    case 'issue.commented': {
      const p = env.payload;
      return (
        `[이벤트: issue.commented]\n` +
        `담당한 이슈에 사용자가 코멘트를 남겼습니다.\n` +
        `이슈키: ${p.issueKey}\n` +
        `작성자: @${p.actor.username} (${p.actor.kind})\n` +
        `코멘트: "${p.commentBody}"\n\n` +
        `적절히 응답. 추가 컨텍스트 필요시 get_issue_detail.`
      );
    }
    case 'issue.status_changed': {
      const p = env.payload;
      return (
        `[이벤트: issue.status_changed]\n` +
        `담당한 이슈의 상태가 변경됐습니다: ${p.previousStatus} → ${p.newStatus} (by @${p.actor.username}).\n` +
        `이슈키: ${p.issueKey}\n\n` +
        `필요한 대응이 있으면 진행. 단순 알림이면 무시.`
      );
    }
  }
}
```

- [ ] **Step 4: 테스트 PASS**

Run: `cd apps/workplace-ai-agent && pnpm test src/agent/user-message.test.ts`
Expected: 4/4 PASS.

### Task 13: `agent/mcp-config.ts` — 정적 MCP config 경로

**Files:**
- Create: `apps/workplace-ai-agent/mcp-config.json`
- Create: `apps/workplace-ai-agent/src/agent/mcp-config.ts`

- [ ] **Step 1: 정적 JSON 작성 (`apps/workplace-ai-agent/mcp-config.json`)**

```json
{
  "mcpServers": {
    "workplace": {
      "command": "node",
      "args": ["dist/mcp/workplace-mcp-server.js"],
      "env": {
        "WORKPLACE_API_BASE_URL": "${WORKPLACE_API_BASE_URL}",
        "WORKPLACE_AGENT_API_KEY": "${WORKPLACE_AGENT_API_KEY}"
      }
    }
  }
}
```

> Claude CLI 는 `${VAR}` 형태의 placeholder 를 parent env 에서 치환한다 (CLI 문서 기준). 별도 치환 코드 불필요.

- [ ] **Step 2: 경로 export — `src/agent/mcp-config.ts`**

```ts
// MCP config 파일 경로 — Claude CLI 에 --mcp-config 로 전달.
// 정적 파일을 프로젝트 루트에 두고 child env 가 ${VAR} 치환을 담당한다.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

// dist/agent/mcp-config.js 기준 → 프로젝트 루트(apps/workplace-ai-agent)
// 의 mcp-config.json 절대 경로.
export const MCP_CONFIG_PATH = path.resolve(here, '..', '..', 'mcp-config.json');
```

- [ ] **Step 3: 컴파일 확인**

Run: `cd apps/workplace-ai-agent && pnpm typecheck`
Expected: 통과.

---

## Phase 5 — ai-agent: CLI runner + runAgent

### Task 14: `agent/cli-runner.ts` — args / env 빌더 + spawn 래퍼

**Files:**
- Create: `apps/workplace-ai-agent/src/agent/cli-runner.ts`
- Create: `apps/workplace-ai-agent/src/agent/cli-runner.test.ts`

- [ ] **Step 1: 실패 테스트 (args + env 빌더만 검증, spawn 미테스트)**

```ts
import { describe, expect, it } from 'vitest';
import { buildCliArgs, buildChildEnv } from './cli-runner.js';

describe('buildCliArgs', () => {
  it('필수 옵션 포함', () => {
    const args = buildCliArgs({
      userMessage: 'hello',
      systemPrompt: 'sys',
      model: 'claude-sonnet-4-6',
      maxTurns: 10,
      mcpConfigPath: '/abs/mcp.json',
    });
    expect(args).toContain('--print');
    expect(args).toContain('hello');
    expect(args).toContain('--system-prompt');
    expect(args).toContain('sys');
    expect(args).toContain('--model');
    expect(args).toContain('claude-sonnet-4-6');
    expect(args).toContain('--max-turns');
    expect(args).toContain('10');
    expect(args).toContain('--allowedTools');
    expect(args).toContain('mcp__workplace__*');
    expect(args).toContain('--mcp-config');
    expect(args).toContain('/abs/mcp.json');
    expect(args).toContain('--output-format');
    expect(args).toContain('stream-json');
    expect(args).toContain('--dangerously-skip-permissions');
  });
});

describe('buildChildEnv', () => {
  it('ANTHROPIC_API_KEY 제거 + CLAUDE_CODE_OAUTH_TOKEN 주입', () => {
    const parent = {
      ANTHROPIC_API_KEY: 'should-be-removed',
      CLAUDE_CODE_OAUTH_TOKEN: 'sub-token',
      WORKPLACE_AGENT_API_KEY: 'k',
      OTHER: 'keep',
    };
    const env = buildChildEnv(parent);
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe('sub-token');
    expect(env.WORKPLACE_AGENT_API_KEY).toBe('k');
    expect(env.OTHER).toBe('keep');
  });

  it('CLAUDE_CODE_OAUTH_TOKEN 누락 시에도 단순 복사 (caller 가 부트에서 검증)', () => {
    const env = buildChildEnv({ FOO: 'bar' });
    expect(env.FOO).toBe('bar');
  });
});
```

- [ ] **Step 2: 테스트 실행 → FAIL**

Run: `cd apps/workplace-ai-agent && pnpm test src/agent/cli-runner.test.ts`
Expected: FAIL — 파일 없음.

- [ ] **Step 3: `cli-runner.ts` 작성**

```ts
// Claude CLI child spawn + stdout JSONL 파싱 + 종료/timeout 처리.
// firehub/apps/firehub-ai-agent/src/agent/agent-cli.ts 패턴 차용.
import { spawn } from 'node:child_process';

export interface CliArgsInput {
  userMessage: string;
  systemPrompt: string;
  model: string;
  maxTurns: number;
  mcpConfigPath: string;
}

export function buildCliArgs(i: CliArgsInput): string[] {
  return [
    '--print',
    i.userMessage,
    '--system-prompt',
    i.systemPrompt,
    '--model',
    i.model,
    '--max-turns',
    String(i.maxTurns),
    '--allowedTools',
    'mcp__workplace__*',
    '--mcp-config',
    i.mcpConfigPath,
    '--output-format',
    'stream-json',
    '--dangerously-skip-permissions',
  ];
}

// 구독 모드 강제: ANTHROPIC_API_KEY 가 있으면 CLI 가 API key 모드로 빠지므로 제거.
// CLAUDE_CODE_OAUTH_TOKEN 은 parent 에서 그대로 전달 (값이 없으면 CLI 가 부재 에러).
export function buildChildEnv(
  parent: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...parent };
  delete env.ANTHROPIC_API_KEY;
  return env;
}

export interface RunCliInput {
  args: string[];
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
  logTag: string;
}

export async function runClaudeCli(i: RunCliInput): Promise<void> {
  return new Promise<void>((resolve) => {
    const child = spawn('claude', i.args, {
      env: i.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let buf = '';
    let killed = false;

    const timer = setTimeout(() => {
      killed = true;
      console.error(`[${i.logTag}] timeout ${i.timeoutMs}ms, SIGTERM`);
      child.kill('SIGTERM');
      setTimeout(() => {
        if (!child.killed) child.kill('SIGKILL');
      }, 5000);
    }, i.timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      buf += chunk.toString('utf8');
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        handleLine(i.logTag, line);
      }
    });

    child.stderr.on('data', (chunk: Buffer) => {
      console.error(`[${i.logTag}] stderr: ${chunk.toString('utf8').trim()}`);
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (killed) {
        console.error(`[${i.logTag}] killed (timeout)`);
      } else if (code !== 0) {
        console.error(`[${i.logTag}] exit ${code}`);
      } else {
        console.log(`[${i.logTag}] done`);
      }
      resolve();
    });

    child.on('error', (e) => {
      clearTimeout(timer);
      console.error(`[${i.logTag}] spawn error:`, e);
      resolve();
    });
  });
}

function handleLine(tag: string, line: string): void {
  try {
    const obj = JSON.parse(line) as { type?: string; subtype?: string };
    if (obj.type === 'system') return;
    if (obj.type === 'assistant') {
      console.log(`[${tag}] assistant message`);
    } else if (obj.type === 'user') {
      console.log(`[${tag}] tool_result`);
    } else if (obj.type === 'result') {
      console.log(`[${tag}] result (${obj.subtype ?? 'ok'})`);
    } else {
      console.log(`[${tag}] line: ${line.slice(0, 200)}`);
    }
  } catch {
    console.log(`[${tag}] non-json: ${line.slice(0, 200)}`);
  }
}
```

- [ ] **Step 4: 테스트 PASS**

Run: `cd apps/workplace-ai-agent && pnpm test src/agent/cli-runner.test.ts`
Expected: 3/3 PASS.

### Task 15: `agent/run-agent.ts` — envelope → CLI 실행

**Files:**
- Create: `apps/workplace-ai-agent/src/agent/run-agent.ts`
- Create: `apps/workplace-ai-agent/src/agent/run-agent.test.ts`

- [ ] **Step 1: 실패 테스트 — runAgent 가 child env / args 빌더에 envelope 을 정확히 전달**

```ts
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// cli-runner 의 spawn 자체를 모킹 — runClaudeCli 를 vi.fn 으로 교체.
vi.mock('./cli-runner.js', () => ({
  buildCliArgs: vi.fn(() => ['--print', 'fake-msg']),
  buildChildEnv: vi.fn((p) => ({ ...p })),
  runClaudeCli: vi.fn().mockResolvedValue(undefined),
}));

import { runAgent } from './run-agent.js';
import { buildCliArgs, runClaudeCli } from './cli-runner.js';

const baseEnv = {
  CLAUDE_CODE_OAUTH_TOKEN: 'sub',
  WORKPLACE_AGENT_API_KEY: 'k',
  WORKPLACE_API_BASE_URL: 'http://x',
};

describe('runAgent', () => {
  beforeEach(() => {
    process.env.CLAUDE_CODE_OAUTH_TOKEN = baseEnv.CLAUDE_CODE_OAUTH_TOKEN;
    process.env.WORKPLACE_AGENT_API_KEY = baseEnv.WORKPLACE_AGENT_API_KEY;
    process.env.WORKPLACE_API_BASE_URL = baseEnv.WORKPLACE_API_BASE_URL;
    vi.mocked(buildCliArgs).mockClear();
    vi.mocked(runClaudeCli).mockClear();
  });
  afterEach(() => {
    delete process.env.WORKPLACE_AI_MODEL;
    delete process.env.WORKPLACE_AI_MAX_TURNS;
    delete process.env.WORKPLACE_AI_TIMEOUT_MS;
  });

  it('runAgent 호출 시 buildCliArgs + runClaudeCli 각 1회', async () => {
    await runAgent({
      type: 'issue.created',
      payload: {
        projectKey: 'WP',
        issueKey: 'WP-1',
        issueId: 1,
        issueTitle: 't',
        actor: { id: 7, username: 'a', kind: 'HUMAN' },
        assignees: [],
        occurredAt: '2026-05-25T12:00:00Z',
        status: 'TODO',
        priority: 'MID',
      },
    });

    expect(buildCliArgs).toHaveBeenCalledOnce();
    expect(runClaudeCli).toHaveBeenCalledOnce();
    const arg = vi.mocked(buildCliArgs).mock.calls[0][0];
    expect(arg.userMessage).toContain('[이벤트: issue.created]');
    expect(arg.systemPrompt).toContain('AI Bot');
    expect(arg.maxTurns).toBe(10);
    expect(arg.model).toBe('claude-sonnet-4-6');
  });

  it('env override 가능 (WORKPLACE_AI_MODEL / MAX_TURNS)', async () => {
    process.env.WORKPLACE_AI_MODEL = 'override-model';
    process.env.WORKPLACE_AI_MAX_TURNS = '3';
    await runAgent({
      type: 'issue.assigned',
      payload: {
        projectKey: 'WP',
        issueKey: 'WP-1',
        issueId: 1,
        issueTitle: 't',
        actor: { id: 7, username: 'a', kind: 'HUMAN' },
        assignees: [],
        occurredAt: '2026-05-25T12:00:00Z',
        added: [],
        removed: [],
      },
    });
    const arg = vi.mocked(buildCliArgs).mock.calls[0][0];
    expect(arg.model).toBe('override-model');
    expect(arg.maxTurns).toBe(3);
  });
});
```

- [ ] **Step 2: 테스트 실행 → FAIL**

Run: `cd apps/workplace-ai-agent && pnpm test src/agent/run-agent.test.ts`
Expected: FAIL.

- [ ] **Step 3: `run-agent.ts` 작성**

```ts
// envelope → CLI 실행 단일 진입점. event-handler 가 fire-and-forget 으로 호출.
import { SYSTEM_PROMPT } from './system-prompt.js';
import { buildUserMessage } from './user-message.js';
import { MCP_CONFIG_PATH } from './mcp-config.js';
import { buildChildEnv, buildCliArgs, runClaudeCli } from './cli-runner.js';
import type { IssueEventEnvelope } from '../types/issue-events.js';

const DEFAULT_MODEL = 'claude-sonnet-4-6';
const DEFAULT_MAX_TURNS = 10;
const DEFAULT_TIMEOUT_MS = 300_000;

export async function runAgent(env: IssueEventEnvelope): Promise<void> {
  const model = process.env.WORKPLACE_AI_MODEL ?? DEFAULT_MODEL;
  const maxTurns = Number(
    process.env.WORKPLACE_AI_MAX_TURNS ?? DEFAULT_MAX_TURNS,
  );
  const timeoutMs = Number(
    process.env.WORKPLACE_AI_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS,
  );

  const userMessage = buildUserMessage(env);
  const args = buildCliArgs({
    userMessage,
    systemPrompt: SYSTEM_PROMPT,
    model,
    maxTurns,
    mcpConfigPath: MCP_CONFIG_PATH,
  });
  const childEnv = buildChildEnv(process.env);
  const logTag = `agent:${env.type}:${env.payload.issueKey}`;

  await runClaudeCli({ args, env: childEnv, timeoutMs, logTag });
}
```

- [ ] **Step 4: 테스트 PASS**

Run: `cd apps/workplace-ai-agent && pnpm test src/agent/run-agent.test.ts`
Expected: 2/2 PASS.

---

## Phase 6 — ai-agent: event-handler / routes 갈아끼우기 + 5c-1 ack 제거

### Task 16: `event-handler.ts` 를 runAgent fire-and-forget 로 교체

**Files:**
- Modify: `apps/workplace-ai-agent/src/agent/event-handler.ts`
- Modify: `apps/workplace-ai-agent/src/agent/event-handler.test.ts`

- [ ] **Step 1: `event-handler.test.ts` 전면 교체 — runAgent 모킹, fire-and-forget 검증**

```ts
// 5c-2: 4 type 핸들러가 runAgent 를 fire-and-forget 으로 호출하는지 검증.
// 5c-1 의 ack 텍스트 코드는 모두 제거됐다.
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('./run-agent.js', () => ({
  runAgent: vi.fn().mockResolvedValue(undefined),
}));

import { handleEvent } from './event-handler.js';
import { runAgent } from './run-agent.js';
import type { IssueEventEnvelope } from '../types/issue-events.js';

const common = {
  projectKey: 'WP',
  issueKey: 'WP-42',
  issueId: 42,
  issueTitle: '분석',
  actor: { id: 7, username: 'alice', kind: 'HUMAN' as const },
  assignees: [{ id: 201, username: 'ai-bot', kind: 'AGENT' as const }],
  occurredAt: '2026-05-25T12:00:00Z',
};

describe('handleEvent', () => {
  beforeEach(() => {
    vi.mocked(runAgent).mockClear();
    vi.mocked(runAgent).mockResolvedValue(undefined);
  });

  it('issue.created → runAgent 1회 호출, 동기 반환', () => {
    const env: IssueEventEnvelope = {
      type: 'issue.created',
      payload: { ...common, status: 'TODO', priority: 'MID' },
    };
    handleEvent(env);
    expect(runAgent).toHaveBeenCalledOnce();
    expect(runAgent).toHaveBeenCalledWith(env);
  });

  it('issue.assigned → runAgent 호출', () => {
    handleEvent({
      type: 'issue.assigned',
      payload: { ...common, added: common.assignees, removed: [] },
    });
    expect(runAgent).toHaveBeenCalledOnce();
  });

  it('issue.commented → AGENT actor 면 self-loop 차단 (runAgent 호출 0)', () => {
    handleEvent({
      type: 'issue.commented',
      payload: {
        ...common,
        actor: { id: 999, username: 'ai', kind: 'AGENT' as const },
        commentId: 1,
        commentBody: '자기 코멘트',
      },
    });
    expect(runAgent).not.toHaveBeenCalled();
  });

  it('issue.commented → HUMAN actor 면 runAgent 호출', () => {
    handleEvent({
      type: 'issue.commented',
      payload: { ...common, commentId: 1, commentBody: '확인' },
    });
    expect(runAgent).toHaveBeenCalledOnce();
  });

  it('issue.status_changed → runAgent 호출', () => {
    handleEvent({
      type: 'issue.status_changed',
      payload: { ...common, previousStatus: 'TODO', newStatus: 'IN_PROGRESS' },
    });
    expect(runAgent).toHaveBeenCalledOnce();
  });

  it('runAgent 가 reject 해도 handleEvent 는 throw 하지 않는다 (fire-and-forget)', async () => {
    vi.mocked(runAgent).mockRejectedValueOnce(new Error('boom'));
    expect(() =>
      handleEvent({
        type: 'issue.created',
        payload: { ...common, status: 'TODO', priority: 'MID' },
      }),
    ).not.toThrow();
    // microtask 비우기
    await new Promise((r) => setImmediate(r));
  });
});
```

- [ ] **Step 2: 테스트 실행 → FAIL (handleEvent / 새 시그니처 미구현)**

Run: `cd apps/workplace-ai-agent && pnpm test src/agent/event-handler.test.ts`
Expected: FAIL.

- [ ] **Step 3: `event-handler.ts` 전체 교체**

```ts
// 5c-2: envelope → runAgent fire-and-forget. 5c-1 의 ack 텍스트 코드는 제거됨.
// AGENT actor 의 issue.commented 는 self-loop 방지를 위해 ai-agent 측에서도 skip.
// (업스트림인 5b-1 이 이미 skip 하지만 defense-in-depth.)
import { runAgent } from './run-agent.js';
import type { IssueEventEnvelope } from '../types/issue-events.js';

export function handleEvent(env: IssueEventEnvelope): void {
  if (env.type === 'issue.commented' && env.payload.actor.kind === 'AGENT') {
    return;
  }
  // fire-and-forget — /events 는 즉시 202 응답.
  runAgent(env).catch((e) => {
    console.error('[event-handler] runAgent 실패', {
      type: env.type,
      issueKey: env.payload.issueKey,
      error: e,
    });
  });
}
```

- [ ] **Step 4: 테스트 PASS**

Run: `cd apps/workplace-ai-agent && pnpm test src/agent/event-handler.test.ts`
Expected: 6/6 PASS.

### Task 17: `routes/events.ts` — 핸들러를 await 하지 않고 handleEvent 단일 호출

**Files:**
- Modify: `apps/workplace-ai-agent/src/routes/events.ts`
- Modify: `apps/workplace-ai-agent/src/routes/events.test.ts`

- [ ] **Step 1: `events.test.ts` 의 5c-1 케이스 갱신 — `client` 의존성 제거, runAgent 모킹**

기존 파일 전체 교체:

```ts
// POST /events — envelope 검증 + payload 재검증 + handleEvent 단일 진입.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../agent/run-agent.js', () => ({
  runAgent: vi.fn().mockResolvedValue(undefined),
}));

import { internalAuth } from '../middleware/internal-auth.js';
import { createEventsRouter } from './events.js';
import { runAgent } from '../agent/run-agent.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(internalAuth, createEventsRouter());
  return app;
}

const VALID = 'test-token-12345';
const AUTH = `Internal ${VALID}`;

const validCreatedPayload = {
  projectKey: 'WP',
  issueKey: 'WP-42',
  issueId: 42,
  issueTitle: '분석',
  actor: { id: 7, username: 'alice', kind: 'HUMAN' },
  assignees: [{ id: 201, username: 'ai-bot', kind: 'AGENT' }],
  occurredAt: '2026-05-25T12:00:00Z',
  status: 'TODO',
  priority: 'MID',
};

describe('POST /events', () => {
  beforeEach(() => {
    process.env.INTERNAL_SERVICE_TOKEN = VALID;
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(runAgent).mockClear();
    vi.mocked(runAgent).mockResolvedValue(undefined);
  });
  afterEach(() => {
    delete process.env.INTERNAL_SERVICE_TOKEN;
    vi.restoreAllMocks();
  });

  it('인증 없음 → 401', async () => {
    const res = await request(buildApp())
      .post('/events')
      .send({ type: 'issue.created', payload: validCreatedPayload });
    expect(res.status).toBe(401);
  });

  it('envelope 누락(type 없음) → 400 invalid_payload', async () => {
    const res = await request(buildApp())
      .post('/events')
      .set('Authorization', AUTH)
      .send({ payload: {} });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('알 수 없는 type → 400 unsupported_event_type', async () => {
    const res = await request(buildApp())
      .post('/events')
      .set('Authorization', AUTH)
      .send({ type: 'wiki.created', payload: { foo: 'bar' } });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: 'unsupported_event_type',
      type: 'wiki.created',
    });
  });

  it('알려진 prefix 의 unknown literal → 400 unsupported_event_type', async () => {
    const res = await request(buildApp())
      .post('/events')
      .set('Authorization', AUTH)
      .send({ type: 'issue.foo', payload: validCreatedPayload });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: 'unsupported_event_type',
      type: 'issue.foo',
    });
  });

  it('issue.assigned payload 의 added 누락 → 400 invalid_payload', async () => {
    const res = await request(buildApp())
      .post('/events')
      .set('Authorization', AUTH)
      .send({
        type: 'issue.assigned',
        payload: {
          ...validCreatedPayload,
          removed: [],
        },
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('issue.created 정상 → 202 + runAgent fire-and-forget 호출', async () => {
    const res = await request(buildApp())
      .post('/events')
      .set('Authorization', AUTH)
      .send({ type: 'issue.created', payload: validCreatedPayload });
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ received: true });
    expect(runAgent).toHaveBeenCalledOnce();
  });

  it('runAgent 가 느려도 즉시 202 응답', async () => {
    let resolveAgent: (() => void) | null = null;
    vi.mocked(runAgent).mockReturnValueOnce(
      new Promise<void>((r) => {
        resolveAgent = r;
      }),
    );
    const res = await request(buildApp())
      .post('/events')
      .set('Authorization', AUTH)
      .send({ type: 'issue.created', payload: validCreatedPayload });
    expect(res.status).toBe(202);
    // 응답 후에야 resolve
    if (resolveAgent) (resolveAgent as () => void)();
  });
});
```

- [ ] **Step 2: 실패 확인 → `createEventsRouter()` 인자 없는 새 시그니처 미구현으로 FAIL**

Run: `cd apps/workplace-ai-agent && pnpm test src/routes/events.test.ts`
Expected: FAIL.

- [ ] **Step 3: `events.ts` 전체 교체**

```ts
// 이벤트 수신 엔드포인트 — workplace-api 가 도메인 이벤트를 푸시한다.
// envelope({type, payload}) 검증 후 handleEvent 단일 진입점으로 분기.
// LLM 실행은 background — /events 는 즉시 202.
import { Router } from 'express';
import { z } from 'zod';

import { handleEvent } from '../agent/event-handler.js';
import {
  KNOWN_ISSUE_TYPES,
  issueEventEnvelope,
} from '../types/issue-events.js';

const envelopeSchema = z.object({
  type: z.string().min(1),
  payload: z.unknown(),
});

export function createEventsRouter(): Router {
  const router = Router();

  router.post('/events', (req, res) => {
    const envelope = envelopeSchema.safeParse(req.body);
    if (!envelope.success) {
      res
        .status(400)
        .json({ error: 'invalid_payload', issues: envelope.error.issues });
      return;
    }

    const { type } = envelope.data;
    const parsed = issueEventEnvelope.safeParse(req.body);
    if (!parsed.success) {
      if (KNOWN_ISSUE_TYPES.has(type)) {
        res
          .status(400)
          .json({ error: 'invalid_payload', issues: parsed.error.issues });
        return;
      }
      res.status(400).json({ error: 'unsupported_event_type', type });
      return;
    }

    // 동기 진입 — handleEvent 내부에서 fire-and-forget.
    handleEvent(parsed.data);
    res.status(202).json({ received: true });
  });

  return router;
}
```

- [ ] **Step 4: 테스트 PASS**

Run: `cd apps/workplace-ai-agent && pnpm test src/routes/events.test.ts`
Expected: 7/7 PASS.

### Task 18: `index.ts` — 환경변수 검증 + unhandledRejection swallow + createEventsRouter() 호출 갱신

**Files:**
- Modify: `apps/workplace-ai-agent/src/index.ts`

- [ ] **Step 1: 파일 전체 교체**

```ts
// Express 부트 — 환경변수 검증 → /health → /events → 전역 에러 핸들러 → graceful shutdown.
// 5c-2: CLI + 구독 토큰 모드. CLAUDE_CODE_OAUTH_TOKEN 미설정 시 부트 실패.
import express, { type NextFunction, type Request, type Response } from 'express';
import dotenv from 'dotenv';

import { DEFAULT_PORT } from './constants.js';
import { internalAuth } from './middleware/internal-auth.js';
import { healthRouter } from './routes/health.js';
import { createEventsRouter } from './routes/events.js';

dotenv.config({ path: '.env.local' });
dotenv.config();

// 필수 환경변수 검증 — 누락 시 fail-fast.
const REQUIRED_ENV = [
  'CLAUDE_CODE_OAUTH_TOKEN',
  'INTERNAL_SERVICE_TOKEN',
  'WORKPLACE_AGENT_API_KEY',
];
for (const k of REQUIRED_ENV) {
  if (!process.env[k]) {
    console.error(`[ai-agent] ${k} 미설정 — 부트 중단`);
    process.exit(1);
  }
}

const app = express();
const PORT = Number(process.env.PORT ?? DEFAULT_PORT);

app.use(express.json());

// /health 는 인증 없이 노출.
app.use(healthRouter);
// /events 는 사내 서비스 인증 필수.
app.use(internalAuth, createEventsRouter());

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[ai-agent] unhandled error:', err);
  res.status(500).json({ error: 'internal_error' });
});

// Claude CLI / MCP child 가 abort 시 던지는 rejection 은 swallow — firehub 패턴.
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

- [ ] **Step 2: 컴파일 확인**

Run: `cd apps/workplace-ai-agent && pnpm typecheck`
Expected: 통과. `WorkplaceApiClient` import 가 index 에서는 사라졌지만 mcp 서버에서 사용 → 미사용 import 경고 없음.

> ai-agent 메인 프로세스는 더 이상 `WorkplaceApiClient` 인스턴스를 만들지 않는다. workplace-api 호출은 모두 MCP server child 에서 발생한다.

---

## Phase 7 — 환경변수 / 빌드 / 문서

### Task 19: `.env.example` 갱신

**Files:**
- Modify: `apps/workplace-ai-agent/.env.example`

- [ ] **Step 1: 파일 전체 교체**

```bash
# Server
PORT=7070

# 사내 서비스 인증 — workplace-api 가 이벤트를 푸시할 때 사용
INTERNAL_SERVICE_TOKEN=changeme-local

# workplace-api 호출용 (AGENT API key — Phase 5a 에서 발급)
WORKPLACE_API_BASE_URL=http://localhost:9090/api/v1
WORKPLACE_AGENT_API_KEY=changeme-local

# Claude Code CLI — 구독 OAuth 토큰 (`claude setup-token` 으로 발급)
# 이 토큰이 있으면 Anthropic API key 종량 청구와 무관하게 Pro/Max 구독으로 실행됩니다.
CLAUDE_CODE_OAUTH_TOKEN=

# (선택) LLM 모델 / 한 호출당 도구 라운드 / timeout override
# WORKPLACE_AI_MODEL=claude-sonnet-4-6
# WORKPLACE_AI_MAX_TURNS=10
# WORKPLACE_AI_TIMEOUT_MS=300000
```

### Task 20: `apps/workplace-ai-agent/CLAUDE.md` 갱신

**Files:**
- Modify: `apps/workplace-ai-agent/CLAUDE.md`

- [ ] **Step 1: 다음 섹션 교체**

"## 이 앱의 목적" 단락의 "현재는 스캐폴딩 단계 — ..." 문장을 다음으로:

```
Phase 5c-2 부터 Claude CLI + 구독 OAuth 토큰으로 LLM 응답을 수행한다. 4 종 이슈 이벤트 envelope 을 받아 `claude` CLI 를 child process 로 spawn 하고, MCP 서버 (별 entry point `dist/mcp/workplace-mcp-server.js`) 가 workplace-api 호출 도구 4 개를 노출한다.
```

"## Stack" 섹션을 다음으로 교체:

```
Node.js 22 + TypeScript (ES2022, NodeNext), Express 4, Zod 4, axios, dotenv, `@modelcontextprotocol/sdk`, `@anthropic-ai/claude-agent-sdk` (의존성만 유지 — 향후 SDK 모드 추가 시 사용), Vitest 4 + supertest + nock. 외부 의존: 시스템에 설치된 `claude` CLI (`@anthropic-ai/claude-code`) + `CLAUDE_CODE_OAUTH_TOKEN` 구독 토큰.
```

"## Layered Structure" 트리에 다음 추가 (`agent/` 줄 아래):

```
  agent/
    event-handler         # envelope → runAgent fire-and-forget
    run-agent             # CLI spawn 엔트리
    cli-runner            # claude CLI 인자/env 빌더 + spawn
    system-prompt         # LLM 시스템 프롬프트 상수
    user-message          # 4 type 별 user message 빌더
    mcp-config            # MCP config 파일 경로 export
  mcp/
    workplace-mcp-server  # 별 entry point — stdio MCP 서버
    tools                 # 4 도구 정의 (get_issue_detail / add_comment / update_status / unassign_self)
```

"## 환경변수" 섹션 아래에 추가:

```
| 변수 | 의미 | 필수 |
|---|---|---|
| `CLAUDE_CODE_OAUTH_TOKEN` | Claude 구독 OAuth 토큰 (`claude setup-token`) | 예 (부트 fail-fast) |
| `INTERNAL_SERVICE_TOKEN` | 인바운드 /events 인증 | 예 |
| `WORKPLACE_API_BASE_URL` | workplace-api URL | 예 |
| `WORKPLACE_AGENT_API_KEY` | AGENT API key | 예 |
| `WORKPLACE_AI_MODEL` / `WORKPLACE_AI_MAX_TURNS` / `WORKPLACE_AI_TIMEOUT_MS` | 선택 override | 아님 |
```

### Task 21: build 산출물 확인 + 루트 typecheck/lint

- [ ] **Step 1: ai-agent 빌드 검증**

Run: `cd apps/workplace-ai-agent && pnpm build && ls dist/mcp/workplace-mcp-server.js dist/agent/run-agent.js`
Expected: 두 파일 모두 존재.

- [ ] **Step 2: ai-agent 전체 테스트**

Run: `cd apps/workplace-ai-agent && pnpm test`
Expected: 전 케이스 PASS.

- [ ] **Step 3: ai-agent lint**

Run: `cd apps/workplace-ai-agent && pnpm lint`
Expected: 통과 (warning 0).

- [ ] **Step 4: workplace-api 전체 테스트**

Run: `cd apps/workplace-api && ./gradlew test -q`
Expected: BUILD SUCCESSFUL.

- [ ] **Step 5: 루트 turbo typecheck (회귀 방어)**

Run: `pnpm typecheck`
Expected: 모든 패키지 통과.

---

## Phase 8 — 단일 commit

### Task 22: 변경 사항 stage + commit

- [ ] **Step 1: 변경 파일 확인**

Run: `git status && git diff --stat`
Expected (대략):
- 신규: `apps/workplace-ai-agent/src/mcp/...`, `src/agent/system-prompt.ts`, `src/agent/user-message.ts`, `src/agent/mcp-config.ts`, `src/agent/cli-runner.ts`, `src/agent/run-agent.ts`, `src/types/workplace-api.ts`, `mcp-config.json`, `apps/workplace-api/.../IssueAssigneeAgentRestrictionException.java`
- 수정: `event-handler.ts`, `routes/events.ts`, `index.ts`, `clients/workplace-api.ts`, `.env.example`, `package.json`, `pnpm-lock.yaml`, `CLAUDE.md`, `IssueAssigneeService.java`, `GlobalExceptionHandler.java`, `IssueAssigneeServiceTest.java`, `event-handler.test.ts`, `routes/events.test.ts`, `clients/workplace-api.test.ts`

- [ ] **Step 2: 변경 파일 stage (`git add -A` 금지 — 명시적으로 추가)**

```bash
git add \
  apps/workplace-ai-agent/src \
  apps/workplace-ai-agent/mcp-config.json \
  apps/workplace-ai-agent/.env.example \
  apps/workplace-ai-agent/package.json \
  apps/workplace-ai-agent/CLAUDE.md \
  apps/workplace-api/src \
  pnpm-lock.yaml
```

- [ ] **Step 3: 단일 commit — 한국어**

```bash
git commit -m "$(cat <<'EOF'
feat: AGENT CLI LLM 응답 + MCP 도구 + 자기-unassign 권한 — #30 (5c-2)

- ai-agent: 4 종 envelope 마다 claude CLI 를 spawn 해 LLM 응답
  · CLI + CLAUDE_CODE_OAUTH_TOKEN (구독) 단일 모드
  · MCP 별 entry point + 4 도구 (get_issue_detail / add_comment / update_status / unassign_self)
  · runAgent fire-and-forget — /events 즉시 202
  · 5c-1 의 ack 텍스트 코드 완전 제거
- workplace-api: IssueAssigneeService 에 AGENT 권한 분기
  · AGENT 호출자는 자기 자신만 제거 가능, 그 외 변경은 403
  · IssueAssigneeAgentRestrictionException 신규 + GlobalExceptionHandler 매핑

수동 e2e (claude setup-token + 실 LLM) 는 사용자가 별도 수행.
EOF
)"
```

- [ ] **Step 4: commit 결과 확인**

Run: `git log -1 --stat`
Expected: 모든 의도한 파일이 한 commit 에 묶임. 메시지 한국어.

- [ ] **Step 5: push 는 사용자 명시 승인 후. 본 plan 은 여기서 종료.**

사용자에게 보고: "단일 commit 완료. push / #30 코멘트는 명시 승인 시점에 진행."

---

## 사후 — 수동 e2e (사용자 수행)

spec §"수동 e2e" 7 단계 그대로:

1. 로컬에서 `claude setup-token` → `apps/workplace-ai-agent/.env.local` 의 `CLAUDE_CODE_OAUTH_TOKEN` 에 붙여넣기
2. workplace-api 9090 + ai-agent 7070 기동 (AGENT API key 발급 + 환경변수)
3. workplace-web 에서 AGENT 를 assignee 로 한 이슈 생성 (본문에 명확한 요구사항)
4. 이슈 상세에서 LLM 응답 코멘트 가시 — `_(자동 응답)_` 접미사 없음
5. 사용자가 추가 코멘트로 질문 → AGENT 가 응답
6. AGENT 가 작업 완료 → `update_status('DONE')` + `unassign_self` 실행 → 활동 타임라인 변화 노출
7. AGENT 가 다른 멤버 추가 시도 (직접 curl) → 백엔드 403 확인

수동 검증 결과는 #30 코멘트에 기록. 통과 시 5c-3 진행 결정.
