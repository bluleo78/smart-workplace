# 이슈 도구 공유화(핸들러 통합) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 두 앱(workplace-mcp/workplace-ai-agent)에 중복된 이슈 MCP 도구의 정의+핸들러를 `@smart-workplace/issue-tools-shared` 로 1벌화한다.

**Architecture:** 공유 패키지에 `McpTool` 타입·`parseIssueKey`/`errText`·입력 zod 스키마·`normalizeIssueDetail`·`IssueToolClient` 인터페이스·`buildSharedIssueTools()` 를 둔다. 각 앱은 자기 API 클라이언트를 `IssueToolClient`(issueKey 기준)로 어댑팅하고, `buildSharedIssueTools(adapter)` 가 반환한 7종을 자기 조립부(mcp=flat, ai-agent=profile)에 spread 한다. 기존 `ProjectMetaClient`+`buildProjectMetaAdapter` 공유 패턴의 확장.

**Tech Stack:** TypeScript(ES2022/NodeNext, ESM), Zod 4, Vitest 4, nock, pnpm workspaces + Turborepo.

## Global Constraints

- **한국어 주석 필수** — 클래스·함수·주요 로직에 무엇을·왜 (루트 코딩 컨벤션).
- **ESM**: import 시 `.js` 확장자 명시.
- **커밋/배포는 사용자 명시 승인 후에만** — 각 Task 의 커밋 스텝은 실행하되, main 머지/푸시는 별도.
- **공유 패키지 변경 후 반드시 빌드**: 앱은 `@smart-workplace/issue-tools-shared` 의 `dist/index.js`(package.json `main`)를 import 하므로, 공유 패키지 소스 변경 후 `pnpm --filter @smart-workplace/issue-tools-shared build` 를 실행해야 앱 typecheck/test 가 변경을 본다.
- **parseIssueKey 시맨틱**: 정규식 `/^(.+)-(\d+)$/` + 실패 시 throw (mcp 기존본 채택). ai-agent 의 `lastIndexOf` silent-NaN 은 폐기.
- **cross-project 가드 문구(정확히)**: `동일 프로젝트 이슈 간에만 의존성을 설정할 수 있습니다.`
- **에러 전파 컨벤션**: 핸들러는 백엔드 에러를 catch 하지 않고 그대로 throw(서버 레이어가 isError 래핑). update_issue 의 fan-out 만 `run()` 으로 개별 `failed: ...` 수집.
- **동작 변경 vs 불변 (스펙 §7)**:
  - **불변(byte-identical)**: add_comment→`'ok'`, edit_comment→`'ok'`, remove_issue_dependency→`'ok'`, create_issue→생성응답 raw stringify, update_issue→`{ok,results}`, add_issue_dependency→갱신상세 raw stringify.
  - **의도적 변경**: get_issue_detail → `normalizeIssueDetail(raw)` (mcp: raw→superset, ai-agent: flat→superset). **양쪽 동일 출력**.
- **공유 7종**: get_issue_detail, create_issue, update_issue, add_comment, edit_comment, add_issue_dependency, remove_issue_dependency.
- **공유 제외(각 앱 유지)**: list_issues, update_status, unassign_self, list_projects, get_project.

---

## File Structure

**신규 (packages/issue-tools-shared/src/):**
- `mcp-tool.ts` — `McpTool` 타입(`inputSchema: z.ZodTypeAny`).
- `parse.ts` — `parseIssueKey`, `errText`.
- `schemas.ts` — 입력 zod 스키마 6종.
- `issue-detail.ts` — `userSummary`/`issueComment`/`issueLink`/`issueDetail` zod + `normalizeIssueDetail`.
- `issue-client.ts` — `IssueToolClient` 인터페이스.
- `issue-tools.ts` — `buildSharedIssueTools`.
- 각 `.test.ts` (parse/issue-detail/issue-tools).
- `index.ts` — 위 전부 재수출(수정).
- `package.json` — `dependencies.zod` 추가(수정).

**수정 (apps/workplace-mcp/src/):**
- `tools/issue.ts` — `buildIssueToolClient(client)` 어댑터 추가, 공유 7종 spread, 전용 3종 유지, 로컬 parseIssueKey/errText/스키마 제거.
- `tools/types.ts` — `McpTool` 을 공유본 재수출로 교체.
- `mcp/server.ts` — `t.inputSchema.shape` → `(t.inputSchema as z.ZodObject<z.ZodRawShape>).shape` 캐스트.
- `tools/issue.test.ts`, `tools/index.test.ts`, `tools/test-support.ts` — 갱신.

**수정 (apps/workplace-ai-agent/src/):**
- `mcp/tools.ts` — `buildIssueToolClient(client, agentId)` 어댑터 추가, 공유 7종을 issue/assistant 프로필에 spread, 로컬 7종 정의/McpTool/parseIssueKey import/스키마/errText 제거.
- `clients/workplace-api.ts` — `getIssueDetail` 을 raw 반환으로 변경(정규화 제거), 로컬 `parseIssueKey` 는 공유본으로 교체.
- `mcp/tools.test.ts`, `agent/run-agent.test.ts`, `clients/workplace-api.test.ts` — 갱신.

---

## Task 1: 공유 — McpTool 타입 + parseIssueKey/errText

**Files:**
- Modify: `packages/issue-tools-shared/package.json` (add zod dep)
- Create: `packages/issue-tools-shared/src/mcp-tool.ts`
- Create: `packages/issue-tools-shared/src/parse.ts`
- Create: `packages/issue-tools-shared/src/parse.test.ts`
- Modify: `packages/issue-tools-shared/src/index.ts`

**Interfaces:**
- Produces: `type McpTool = { name: string; description: string; inputSchema: z.ZodTypeAny; handler: (args: unknown) => Promise<string> }`; `parseIssueKey(issueKey: string): { projectKey: string; number: number }` (실패 시 throw); `errText(e: unknown): string`.

- [ ] **Step 1: zod 의존성 추가**

`packages/issue-tools-shared/package.json` 에 `dependencies` 블록을 추가한다(현재 devDependencies 만 있음, zod 없음). `main`/`scripts` 등은 그대로:

```json
  "dependencies": {
    "zod": "^4.4.3"
  },
```

그리고 루트에서 설치:

Run: `pnpm install`
Expected: issue-tools-shared 에 zod 링크됨(에러 없음).

- [ ] **Step 2: 실패하는 테스트 작성** — `packages/issue-tools-shared/src/parse.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { parseIssueKey, errText } from './parse.js';

describe('parseIssueKey', () => {
  it('WP-12 → {projectKey:"WP", number:12}', () => {
    expect(parseIssueKey('WP-12')).toEqual({ projectKey: 'WP', number: 12 });
  });
  it('프로젝트 키에 하이픈이 있어도 마지막 -숫자 로 분리', () => {
    expect(parseIssueKey('MY-PROJ-7')).toEqual({ projectKey: 'MY-PROJ', number: 7 });
  });
  it('형식이 틀리면 throw (하이픈 없음)', () => {
    expect(() => parseIssueKey('WP12')).toThrow('issueKey 형식이 올바르지 않습니다: WP12');
  });
  it('형식이 틀리면 throw (숫자 아님)', () => {
    expect(() => parseIssueKey('WP-x')).toThrow('issueKey 형식이 올바르지 않습니다: WP-x');
  });
});

describe('errText', () => {
  it('axios 응답 본문(문자열) 우선', () => {
    expect(errText({ response: { data: '이슈를 찾을 수 없습니다' } })).toBe('이슈를 찾을 수 없습니다');
  });
  it('응답 본문(객체)은 JSON 화', () => {
    expect(errText({ response: { data: { message: 'x' } } })).toBe('{"message":"x"}');
  });
  it('응답 없으면 message', () => {
    expect(errText({ message: 'boom' })).toBe('boom');
  });
});
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `pnpm --filter @smart-workplace/issue-tools-shared test`
Expected: FAIL — `Cannot find module './parse.js'`.

- [ ] **Step 4: 구현** — `packages/issue-tools-shared/src/parse.ts`

```ts
// src/parse.ts — issueKey 파싱과 에러 메시지 추출. 두 앱이 공유(기존 중복 제거).

/** 'WP-12' → { projectKey:'WP', number:12 } (마지막 '-숫자' 기준 분리).
 * 형식이 맞지 않으면(하이픈 없음/숫자 아님) 명확한 에러를 던진다 — 도구 레이어가 isError 로 래핑. */
export function parseIssueKey(issueKey: string): { projectKey: string; number: number } {
  const m = /^(.+)-(\d+)$/.exec(issueKey);
  if (!m) {
    throw new Error(`issueKey 형식이 올바르지 않습니다: ${issueKey}`);
  }
  return { projectKey: m[1], number: Number(m[2]) };
}

/** 팬아웃 단계 실패 메시지를 짧게 뽑는다 — axios 응답 본문 우선, 없으면 message. */
export function errText(e: unknown): string {
  const anyE = e as { response?: { data?: unknown }; message?: string };
  if (anyE?.response?.data !== undefined) {
    return typeof anyE.response.data === 'string'
      ? anyE.response.data
      : JSON.stringify(anyE.response.data);
  }
  return anyE?.message ?? String(e);
}
```

그리고 `packages/issue-tools-shared/src/mcp-tool.ts`:

```ts
// src/mcp-tool.ts — MCP 도구 정의 타입. 두 앱 공유.
// inputSchema 는 z.ZodTypeAny — ai-agent 의 중첩 래퍼 스키마(show_* 의 {params,layout})까지 포용하는 상위집합.
// 핸들러는 문자열(주로 JSON)을 반환하고, SDK 응답 변환·에러 래핑은 각 앱 서버 레이어가 담당한다.
import type { z } from 'zod';

export interface McpTool {
  name: string;
  description: string;
  inputSchema: z.ZodTypeAny;
  handler: (args: unknown) => Promise<string>;
}
```

- [ ] **Step 5: index 재수출** — `packages/issue-tools-shared/src/index.ts` 에 추가

```ts
export { parseIssueKey, errText } from './parse.js';
export type { McpTool } from './mcp-tool.js';
```

(기존 resolve 수출은 유지.)

- [ ] **Step 6: 테스트 통과 확인**

Run: `pnpm --filter @smart-workplace/issue-tools-shared test`
Expected: PASS (parse.test.ts + 기존 resolve.test.ts).

- [ ] **Step 7: 커밋**

```bash
git add packages/issue-tools-shared
git commit -m "feat(shared): McpTool 타입 + parseIssueKey/errText 공유화"
```

---

## Task 2: 공유 — 입력 zod 스키마 6종

**Files:**
- Create: `packages/issue-tools-shared/src/schemas.ts`
- Modify: `packages/issue-tools-shared/src/index.ts`

**Interfaces:**
- Produces: `issueKeyInput`, `createIssueInput`, `updateIssueInput`, `addCommentInput`, `editCommentInput`, `dependencyInput` (모두 `z.ZodObject`). 필드는 두 앱 기존본과 동일.

- [ ] **Step 1: 구현** — `packages/issue-tools-shared/src/schemas.ts`

두 앱의 기존 스키마를 그대로 이관(필드/검증 동일):

```ts
// src/schemas.ts — 이슈 도구 입력 zod 스키마. 두 앱 공유(기존 중복 제거).
import { z } from 'zod';

/** issueKey 만 받는 최소 입력. */
export const issueKeyInput = z.object({ issueKey: z.string().min(1) });

/** 이슈 생성 입력 — projectKey 필수(위임 컨텍스트 없이 대상 프로젝트 명시). */
export const createIssueInput = z.object({
  projectKey: z.string().min(1),
  title: z.string().min(1).max(200),
  body: z.string().max(10000).optional(),
  priority: z.enum(['LOW', 'MID', 'HIGH']).optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  type: z.string().optional(), // 유형 이름(예: BUG) → typeId 리졸브
  assignees: z.array(z.string()).optional(), // username[] → assigneeIds 리졸브
  parent: z.number().int().positive().optional(), // 부모 이슈 번호(SUBTASK)
});

/** 이슈 부분 수정 입력 — 전달 필드만 변경. */
export const updateIssueInput = z.object({
  issueKey: z.string().min(1),
  title: z.string().max(200).optional(),
  body: z.string().max(10000).optional(),
  priority: z.enum(['LOW', 'MID', 'HIGH']).optional(),
  status: z.enum(['TODO', 'IN_PROGRESS', 'DONE', 'CANCELED']).optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  clearDueDate: z.boolean().optional(),
  clearStartDate: z.boolean().optional(),
  type: z.string().optional(), // 유형 이름 → typeId
  parent: z.number().int().positive().nullable().optional(), // 번호=설정, null=해제, 생략=변경없음
  assignees: z.array(z.string()).optional(), // username[] → 집합 교체
  labels: z.array(z.string()).optional(), // 라벨명[] → 집합 교체
});

/** 코멘트 작성 입력. */
export const addCommentInput = z.object({ issueKey: z.string().min(1), body: z.string().min(1) });

/** 코멘트 수정 입력. */
export const editCommentInput = z.object({
  issueKey: z.string().min(1),
  commentId: z.number().int().positive(),
  body: z.string().min(1),
});

/** 의존성 add/remove 공용 입력. */
export const dependencyInput = z.object({
  issueKey: z.string().min(1),
  otherIssueKey: z.string().min(1),
  direction: z.enum(['blocks', 'blockedBy']),
});
```

- [ ] **Step 2: index 재수출** — `index.ts` 에 추가

```ts
export {
  issueKeyInput,
  createIssueInput,
  updateIssueInput,
  addCommentInput,
  editCommentInput,
  dependencyInput,
} from './schemas.js';
```

- [ ] **Step 3: 타입/빌드 확인** (스키마는 다음 Task 에서 소비되므로 별도 테스트 없이 typecheck 로 검증)

Run: `pnpm --filter @smart-workplace/issue-tools-shared typecheck`
Expected: PASS.

- [ ] **Step 4: 커밋**

```bash
git add packages/issue-tools-shared
git commit -m "feat(shared): 이슈 도구 입력 스키마 6종 공유화"
```

---

## Task 3: 공유 — get_issue_detail 정규화(superset)

**Files:**
- Create: `packages/issue-tools-shared/src/issue-detail.ts`
- Create: `packages/issue-tools-shared/src/issue-detail.test.ts`
- Modify: `packages/issue-tools-shared/src/index.ts`

**Interfaces:**
- Produces: `type IssueDetail`; `normalizeIssueDetail(raw: unknown): IssueDetail`. 백엔드 `IssueDetailResponse`(`{summary:IssueResponse, body, comments[], ...}`) 의 raw JSON 을 LLM 노출용 flat superset 으로 정규화. 의존성 필드는 `summary.{blockedBy,blocks,blocked}` 에서 top-level 로 lift.

- [ ] **Step 1: 실패하는 테스트 작성** — `packages/issue-tools-shared/src/issue-detail.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { normalizeIssueDetail } from './issue-detail.js';

// 백엔드 IssueDetailResponse 형태(요약은 summary 중첩, comment 는 flat author 필드).
const raw = {
  issueKey: 'WP-12',
  summary: {
    id: 100,
    title: '로그인 버그',
    status: 'IN_PROGRESS',
    priority: 'HIGH',
    assignees: [{ id: 10, username: 'alice', name: 'Alice', kind: 'HUMAN' }],
    blockedBy: [{ number: 11, title: '선행작업', status: 'TODO', type: { id: 1, name: 'TASK' } }],
    blocks: [{ number: 13, title: '후속작업', status: 'TODO', type: null }],
    blocked: true,
  },
  body: '재현 절차...',
  comments: [
    { id: 1, body: '확인함', createdAt: '2026-07-10T00:00:00Z', authorId: 10, authorName: 'alice', authorKind: 'HUMAN' },
  ],
  history: [],
  attachments: [],
};

describe('normalizeIssueDetail', () => {
  it('summary 를 flatten 하고 issueKey/title/status/priority/assignees 를 top-level 로', () => {
    const d = normalizeIssueDetail(raw);
    expect(d.issueKey).toBe('WP-12');
    expect(d.title).toBe('로그인 버그');
    expect(d.status).toBe('IN_PROGRESS');
    expect(d.priority).toBe('HIGH');
    expect(d.body).toBe('재현 절차...');
    expect(d.assignees).toEqual([{ id: 10, username: 'alice', name: 'Alice', kind: 'HUMAN' }]);
  });

  it('의존성 필드를 summary 에서 top-level 로 lift', () => {
    const d = normalizeIssueDetail(raw);
    expect(d.blocked).toBe(true);
    expect(d.blockedBy).toEqual([{ number: 11, title: '선행작업', status: 'TODO' }]);
    expect(d.blocks).toEqual([{ number: 13, title: '후속작업', status: 'TODO' }]);
  });

  it('comment 의 flat author 필드를 nested author 로 변환', () => {
    const d = normalizeIssueDetail(raw);
    expect(d.comments).toEqual([
      {
        id: 1,
        body: '확인함',
        createdAt: '2026-07-10T00:00:00Z',
        author: { id: 10, username: 'alice', name: 'alice', kind: 'HUMAN' },
      },
    ]);
  });

  it('의존성/코멘트 누락 시 기본값(빈 배열/false)', () => {
    const d = normalizeIssueDetail({ issueKey: 'WP-1', summary: { title: 't', status: 'TODO', priority: 'MID', assignees: [] } });
    expect(d.blockedBy).toEqual([]);
    expect(d.blocks).toEqual([]);
    expect(d.blocked).toBe(false);
    expect(d.comments).toEqual([]);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm --filter @smart-workplace/issue-tools-shared test issue-detail`
Expected: FAIL — `Cannot find module './issue-detail.js'`.

- [ ] **Step 3: 구현** — `packages/issue-tools-shared/src/issue-detail.ts`

```ts
// src/issue-detail.ts — get_issue_detail 응답을 LLM 노출용 flat superset 으로 정규화.
// 백엔드 IssueDetailResponse = { summary: IssueResponse, body, comments[], history[], attachments[], ... }.
// 의존성 필드(blockedBy/blocks/blocked)는 summary 중첩이므로 top-level 로 lift 한다(Phase 4b 가시성 보존).
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

/** 의존성 링크 요약 — 백엔드 IssueLinkSummary(number,title,status,type) 중 LLM 필요분만. */
export const issueLink = z.object({
  number: z.number(),
  title: z.string(),
  status: z.string(),
});

export const issueDetail = z.object({
  issueKey: z.string(),
  title: z.string(),
  body: z.string().nullable().optional(),
  status: z.string(),
  priority: z.string(),
  assignees: z.array(userSummary),
  comments: z.array(issueComment).default([]),
  blockedBy: z.array(issueLink).default([]),
  blocks: z.array(issueLink).default([]),
  blocked: z.boolean().default(false),
});

export type IssueDetail = z.infer<typeof issueDetail>;

/** summary 중첩을 풀고, comment 의 flat author 필드를 nested 로 변환하며, 의존성을 top-level 로 lift. */
export function normalizeIssueDetail(raw: unknown): IssueDetail {
  const r = (raw ?? {}) as Record<string, any>;
  const summary = (r.summary ?? {}) as Record<string, any>;
  const links = (arr: any): { number: number; title: string; status: string }[] =>
    (arr ?? []).map((l: Record<string, any>) => ({
      number: l.number,
      title: l.title,
      status: l.status,
    }));
  const normalized = {
    issueKey: r.issueKey ?? r.key ?? summary.projectKey && `${summary.projectKey}-${summary.number}`,
    title: summary.title ?? r.title ?? '',
    body: r.body ?? summary.body ?? null,
    status: summary.status ?? r.status ?? '',
    priority: summary.priority ?? r.priority ?? '',
    assignees: summary.assignees ?? r.assignees ?? [],
    comments: (r.comments ?? []).map((c: Record<string, any>) => ({
      id: c.id,
      body: c.body,
      createdAt: c.createdAt,
      author: { id: c.authorId, username: c.authorName, name: c.authorName, kind: c.authorKind },
    })),
    blockedBy: links(summary.blockedBy),
    blocks: links(summary.blocks),
    blocked: summary.blocked ?? false,
  };
  return issueDetail.parse(normalized);
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm --filter @smart-workplace/issue-tools-shared test issue-detail`
Expected: PASS (4개 케이스).

- [ ] **Step 5: index 재수출** — `index.ts` 에 추가

```ts
export { normalizeIssueDetail, issueDetail, type IssueDetail } from './issue-detail.js';
```

- [ ] **Step 6: 커밋**

```bash
git add packages/issue-tools-shared
git commit -m "feat(shared): get_issue_detail superset 정규화(normalizeIssueDetail)"
```

---

## Task 4: 공유 — IssueToolClient + buildSharedIssueTools(7종)

**Files:**
- Create: `packages/issue-tools-shared/src/issue-client.ts`
- Create: `packages/issue-tools-shared/src/issue-tools.ts`
- Create: `packages/issue-tools-shared/src/issue-tools.test.ts`
- Modify: `packages/issue-tools-shared/src/index.ts`

**Interfaces:**
- Consumes: `McpTool`, `parseIssueKey`, `errText`, 입력 스키마 6종, `normalizeIssueDetail`, `resolveTypeId/resolveAssigneeIds/resolveLabelIds`, `ProjectMetaClient`.
- Produces: `interface IssueToolClient extends ProjectMetaClient { ... }` (아래 14메서드); `buildSharedIssueTools(client: IssueToolClient): McpTool[]` → 7종.

- [ ] **Step 1: IssueToolClient 인터페이스** — `packages/issue-tools-shared/src/issue-client.ts`

update_issue 가 content/type/parent/assignees/labels 5개 엔드포인트로 fan-out 하므로 각 연산을 인터페이스에 노출한다. 모든 이슈 연산은 `issueKey`(string) 기준 — 각 앱 어댑터가 자기 클라이언트로 매핑.

```ts
// src/issue-client.ts — 공유 이슈 도구가 호출하는 구조적 클라이언트 인터페이스.
// issueKey(string) 기준. mcp(PatApiClient)/ai-agent(WorkplaceApiClient) 어댑터가 이 시그니처를 만족시킨다.
import type { ProjectMetaClient } from './resolve.js';

export interface IssueToolClient extends ProjectMetaClient {
  /** 이슈 상세 — 백엔드 raw JSON 반환(정규화는 도구 핸들러가 normalizeIssueDetail 로 수행). */
  getIssueDetail(issueKey: string): Promise<unknown>;
  /** 이슈 생성 — 생성 응답 raw 반환. */
  createIssue(projectKey: string, body: Record<string, unknown>): Promise<unknown>;
  /** 내용/상태/우선순위/날짜 PATCH. */
  updateIssueContent(issueKey: string, body: Record<string, unknown>): Promise<unknown>;
  setIssueType(issueKey: string, typeId: number): Promise<unknown>;
  setIssueParent(issueKey: string, parentNumber: number | null): Promise<unknown>;
  replaceIssueAssignees(issueKey: string, assigneeIds: number[]): Promise<unknown>;
  replaceIssueLabels(issueKey: string, labelIds: number[]): Promise<unknown>;
  addComment(issueKey: string, body: string): Promise<void>;
  editComment(issueKey: string, commentId: number, body: string): Promise<void>;
  /** 갱신된 상세 raw 반환. */
  addIssueDependency(issueKey: string, otherNumber: number, direction: 'blocks' | 'blockedBy'): Promise<unknown>;
  removeIssueDependency(issueKey: string, otherNumber: number, direction: 'blocks' | 'blockedBy'): Promise<void>;
}
```

- [ ] **Step 2: 실패하는 테스트 작성** — `packages/issue-tools-shared/src/issue-tools.test.ts`

```ts
import { describe, expect, it, vi } from 'vitest';
import { buildSharedIssueTools } from './issue-tools.js';
import type { IssueToolClient } from './issue-client.js';

/** 전 메서드 vi.fn() 인 mock. 개별 테스트에서 필요한 것만 재설정. */
function mockClient(): IssueToolClient {
  return {
    getProjectTypes: vi.fn().mockResolvedValue([{ id: 2, name: 'BUG' }]),
    getProjectMembers: vi.fn().mockResolvedValue([{ userId: 10, username: 'alice' }]),
    getProjectLabels: vi.fn().mockResolvedValue([{ id: 100, name: 'urgent' }]),
    getIssueDetail: vi.fn(),
    createIssue: vi.fn().mockResolvedValue({ ok: true }),
    updateIssueContent: vi.fn().mockResolvedValue({}),
    setIssueType: vi.fn().mockResolvedValue({}),
    setIssueParent: vi.fn().mockResolvedValue({}),
    replaceIssueAssignees: vi.fn().mockResolvedValue({}),
    replaceIssueLabels: vi.fn().mockResolvedValue({}),
    addComment: vi.fn().mockResolvedValue(undefined),
    editComment: vi.fn().mockResolvedValue(undefined),
    addIssueDependency: vi.fn().mockResolvedValue({ summary: { title: 't', status: 'TODO', priority: 'MID', assignees: [] } }),
    removeIssueDependency: vi.fn().mockResolvedValue(undefined),
  };
}

function tool(name: string) {
  const t = buildSharedIssueTools(mockClient()).find((x) => x.name === name);
  if (!t) throw new Error(`no tool ${name}`);
  return t;
}

describe('buildSharedIssueTools', () => {
  it('정확히 7종을 반환한다', () => {
    const names = buildSharedIssueTools(mockClient()).map((t) => t.name).sort();
    expect(names).toEqual(
      ['add_comment', 'add_issue_dependency', 'create_issue', 'edit_comment', 'get_issue_detail', 'remove_issue_dependency', 'update_issue'].sort(),
    );
  });

  it('get_issue_detail 은 normalizeIssueDetail 출력(superset)을 반환', async () => {
    const c = mockClient();
    (c.getIssueDetail as any).mockResolvedValue({
      issueKey: 'WP-12',
      summary: { title: 'T', status: 'TODO', priority: 'MID', assignees: [], blockedBy: [{ number: 5, title: 'x', status: 'TODO' }], blocks: [], blocked: true },
      body: 'b',
      comments: [],
    });
    const out = JSON.parse(await buildSharedIssueTools(c).find((t) => t.name === 'get_issue_detail')!.handler({ issueKey: 'WP-12' }));
    expect(out).toMatchObject({ issueKey: 'WP-12', title: 'T', blocked: true, blockedBy: [{ number: 5, title: 'x', status: 'TODO' }] });
    expect(c.getIssueDetail).toHaveBeenCalledWith('WP-12');
  });

  it('add_comment 은 client.addComment 호출 후 "ok"', async () => {
    const c = mockClient();
    const t = buildSharedIssueTools(c).find((x) => x.name === 'add_comment')!;
    await expect(t.handler({ issueKey: 'WP-12', body: '안녕' })).resolves.toBe('ok');
    expect(c.addComment).toHaveBeenCalledWith('WP-12', '안녕');
  });

  it('create_issue 는 type/assignees 를 리졸브 후 createIssue 호출', async () => {
    const c = mockClient();
    const t = buildSharedIssueTools(c).find((x) => x.name === 'create_issue')!;
    await t.handler({ projectKey: 'WP', title: '새 이슈', type: 'BUG', assignees: ['alice'] });
    expect(c.createIssue).toHaveBeenCalledWith('WP', expect.objectContaining({ title: '새 이슈', typeId: 2, assigneeIds: [10] }));
  });

  it('update_issue 는 fan-out 후 {ok,results}', async () => {
    const c = mockClient();
    const t = buildSharedIssueTools(c).find((x) => x.name === 'update_issue')!;
    const out = JSON.parse(await t.handler({ issueKey: 'WP-12', title: '수정', assignees: ['alice'] }));
    expect(out.ok).toBe(true);
    expect(out.results).toEqual({ content: 'ok', assignees: 'ok' });
    expect(c.updateIssueContent).toHaveBeenCalledWith('WP-12', { title: '수정' });
    expect(c.replaceIssueAssignees).toHaveBeenCalledWith('WP-12', [10]);
  });

  it('add_issue_dependency 는 다른 프로젝트면 클라이언트측 거부', async () => {
    const c = mockClient();
    const t = buildSharedIssueTools(c).find((x) => x.name === 'add_issue_dependency')!;
    await expect(t.handler({ issueKey: 'WP-1', otherIssueKey: 'AB-2', direction: 'blocks' })).rejects.toThrow(
      '동일 프로젝트 이슈 간에만 의존성을 설정할 수 있습니다.',
    );
    expect(c.addIssueDependency).not.toHaveBeenCalled();
  });

  it('add_issue_dependency 는 같은 프로젝트면 otherNumber 로 호출', async () => {
    const c = mockClient();
    const t = buildSharedIssueTools(c).find((x) => x.name === 'add_issue_dependency')!;
    await t.handler({ issueKey: 'WP-1', otherIssueKey: 'WP-2', direction: 'blocks' });
    expect(c.addIssueDependency).toHaveBeenCalledWith('WP-1', 2, 'blocks');
  });

  it('remove_issue_dependency 는 "ok"', async () => {
    const c = mockClient();
    const t = buildSharedIssueTools(c).find((x) => x.name === 'remove_issue_dependency')!;
    await expect(t.handler({ issueKey: 'WP-1', otherIssueKey: 'WP-2', direction: 'blockedBy' })).resolves.toBe('ok');
    expect(c.removeIssueDependency).toHaveBeenCalledWith('WP-1', 2, 'blockedBy');
  });
});
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `pnpm --filter @smart-workplace/issue-tools-shared test issue-tools`
Expected: FAIL — `Cannot find module './issue-tools.js'`.

- [ ] **Step 4: 구현** — `packages/issue-tools-shared/src/issue-tools.ts`

두 앱의 기존 핸들러 로직을 1벌로 이관(클라이언트 호출을 `IssueToolClient` 시그니처로). 설명 문구는 mcp 기존본 채택.

```ts
// src/issue-tools.ts — 두 앱 공유 이슈 도구 7종. 핸들러는 IssueToolClient(issueKey 기준)만 호출.
import { errText, parseIssueKey } from './parse.js';
import type { McpTool } from './mcp-tool.js';
import { normalizeIssueDetail } from './issue-detail.js';
import { resolveAssigneeIds, resolveLabelIds, resolveTypeId } from './resolve.js';
import {
  addCommentInput,
  createIssueInput,
  dependencyInput,
  editCommentInput,
  issueKeyInput,
  updateIssueInput,
} from './schemas.js';
import type { IssueToolClient } from './issue-client.js';

/** 공유 이슈 도구 7종 구성. 각 앱은 자기 클라이언트를 IssueToolClient 로 어댑팅해 넘긴다. */
export function buildSharedIssueTools(client: IssueToolClient): McpTool[] {
  return [
    {
      name: 'get_issue_detail',
      description:
        '이슈의 본문·상태·담당자·코멘트·의존성 등 전체 컨텍스트를 JSON 으로 반환합니다. issueKey 예: WP-12',
      inputSchema: issueKeyInput,
      async handler(args) {
        const { issueKey } = issueKeyInput.parse(args);
        return JSON.stringify(normalizeIssueDetail(await client.getIssueDetail(issueKey)));
      },
    },
    {
      name: 'create_issue',
      description:
        '프로젝트에 새 이슈를 등록합니다. type 은 유형 이름(예: BUG), assignees 는 username 배열, ' +
        'parent 는 부모 이슈 번호입니다. type/assignees 이름이 유효하지 않으면 오류에 사용 가능한 값 목록이 포함됩니다.',
      inputSchema: createIssueInput,
      async handler(args) {
        const { projectKey, type, assignees, parent, ...rest } = createIssueInput.parse(args);
        // 리졸브(이름→ID)를 create 이전에 수행 — 실패 시 이슈를 만들지 않고 throw.
        const body: {
          title: string;
          body?: string;
          priority?: string;
          dueDate?: string;
          startDate?: string;
          assigneeIds?: number[];
          typeId?: number;
          parentNumber?: number;
        } = { ...rest };
        if (type) body.typeId = await resolveTypeId(client, projectKey, type);
        if (assignees) body.assigneeIds = await resolveAssigneeIds(client, projectKey, assignees);
        if (parent != null) body.parentNumber = parent;
        return JSON.stringify(await client.createIssue(projectKey, body));
      },
    },
    {
      name: 'update_issue',
      description:
        '이슈를 부분 수정합니다. 전달한 필드만 변경됩니다. status/priority 는 enum, type 은 유형 이름, ' +
        'assignees 는 username 배열(집합 교체), labels 는 라벨명 배열(집합 교체), parent 는 부모 이슈 번호(null=해제)입니다. ' +
        'clearDueDate/clearStartDate 로 날짜를 비웁니다. 각 항목은 독립 저장되며 결과를 { ok, results } 로 보고합니다.',
      inputSchema: updateIssueInput,
      async handler(args) {
        const { issueKey, type, parent, assignees, labels, ...rest } = updateIssueInput.parse(args);
        const { projectKey } = parseIssueKey(issueKey);

        // 1) 리졸브를 쓰기 이전에 모두 수행 — 하나라도 실패하면 아무것도 쓰지 않고 throw.
        const typeId = type ? await resolveTypeId(client, projectKey, type) : undefined;
        const assigneeIds = assignees
          ? await resolveAssigneeIds(client, projectKey, assignees)
          : undefined;
        const labelIds = labels ? await resolveLabelIds(client, projectKey, labels) : undefined;

        // 2) 필드별 팬아웃 — 각 단계 독립 저장, 성공/실패 구조화.
        const results: Record<string, string> = {};
        const run = async (key: string, fn: () => Promise<unknown>) => {
          try {
            await fn();
            results[key] = 'ok';
          } catch (e) {
            results[key] = `failed: ${errText(e)}`;
          }
        };

        const content: Record<string, unknown> = { ...rest };
        if (Object.keys(content).length > 0) {
          await run('content', () => client.updateIssueContent(issueKey, content));
        }
        if (typeId !== undefined) await run('type', () => client.setIssueType(issueKey, typeId));
        if (parent !== undefined) await run('parent', () => client.setIssueParent(issueKey, parent));
        if (assigneeIds !== undefined) {
          await run('assignees', () => client.replaceIssueAssignees(issueKey, assigneeIds));
        }
        if (labelIds !== undefined) {
          await run('labels', () => client.replaceIssueLabels(issueKey, labelIds));
        }

        const ok = Object.values(results).every((v) => v === 'ok');
        return JSON.stringify({ ok, results });
      },
    },
    {
      name: 'add_comment',
      description: '이슈에 코멘트를 작성합니다. 본문은 마크다운을 지원합니다.',
      inputSchema: addCommentInput,
      async handler(args) {
        const { issueKey, body } = addCommentInput.parse(args);
        await client.addComment(issueKey, body);
        return 'ok';
      },
    },
    {
      name: 'edit_comment',
      description:
        '이슈의 기존 코멘트를 수정합니다. commentId 는 get_issue_detail 의 comments 에서 확인하세요.',
      inputSchema: editCommentInput,
      async handler(args) {
        const { issueKey, commentId, body } = editCommentInput.parse(args);
        await client.editComment(issueKey, commentId, body);
        return 'ok';
      },
    },
    {
      name: 'add_issue_dependency',
      description:
        '이슈 간 의존성(차단 관계)을 추가합니다. direction="blocks" 면 issueKey 이슈가 ' +
        'otherIssueKey 이슈를 차단하고, "blockedBy" 면 반대로 otherIssueKey 에 의해 차단됩니다. ' +
        '두 이슈는 같은 프로젝트여야 합니다. 순환 관계가 되면 에러가 발생합니다.',
      inputSchema: dependencyInput,
      async handler(args) {
        const { issueKey, otherIssueKey, direction } = dependencyInput.parse(args);
        const { projectKey } = parseIssueKey(issueKey);
        const { projectKey: otherProjectKey, number: otherNumber } = parseIssueKey(otherIssueKey);
        if (otherProjectKey !== projectKey) {
          throw new Error('동일 프로젝트 이슈 간에만 의존성을 설정할 수 있습니다.');
        }
        return JSON.stringify(await client.addIssueDependency(issueKey, otherNumber, direction));
      },
    },
    {
      name: 'remove_issue_dependency',
      description: '이슈 간 의존성을 제거합니다. 존재하지 않아도 에러 없이 성공합니다(멱등).',
      inputSchema: dependencyInput,
      async handler(args) {
        const { issueKey, otherIssueKey, direction } = dependencyInput.parse(args);
        const { projectKey } = parseIssueKey(issueKey);
        const { projectKey: otherProjectKey, number: otherNumber } = parseIssueKey(otherIssueKey);
        if (otherProjectKey !== projectKey) {
          throw new Error('동일 프로젝트 이슈 간에만 의존성을 설정할 수 있습니다.');
        }
        await client.removeIssueDependency(issueKey, otherNumber, direction);
        return 'ok';
      },
    },
  ];
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `pnpm --filter @smart-workplace/issue-tools-shared test issue-tools`
Expected: PASS (8개 케이스).

- [ ] **Step 6: index 재수출 + 전체 테스트/빌드** — `index.ts` 에 추가

```ts
export { buildSharedIssueTools } from './issue-tools.js';
export type { IssueToolClient } from './issue-client.js';
```

Run: `pnpm --filter @smart-workplace/issue-tools-shared test && pnpm --filter @smart-workplace/issue-tools-shared build`
Expected: 전체 PASS + dist 생성.

- [ ] **Step 7: 커밋**

```bash
git add packages/issue-tools-shared
git commit -m "feat(shared): IssueToolClient + buildSharedIssueTools 7종"
```

---

## Task 5: workplace-mcp 리와이어

**Files:**
- Modify: `apps/workplace-mcp/src/tools/issue.ts`
- Modify: `apps/workplace-mcp/src/tools/types.ts`
- Modify: `apps/workplace-mcp/src/mcp/server.ts`
- Modify: `apps/workplace-mcp/src/tools/issue.test.ts`
- Modify: `apps/workplace-mcp/src/tools/index.test.ts` (개수/이름 불변 확인)

**Interfaces:**
- Consumes: `buildSharedIssueTools`, `IssueToolClient`, `McpTool`, `parseIssueKey` (모두 `@smart-workplace/issue-tools-shared`).
- Produces: `buildIssueTools(client: PatApiClient): McpTool[]` — 반환 개수·이름 불변(10종: 공유 7 + list_projects/get_project/list_issues).

- [ ] **Step 1: 공유 패키지 빌드(선행)**

Run: `pnpm --filter @smart-workplace/issue-tools-shared build`
Expected: dist 최신화(Task 1~4 반영).

- [ ] **Step 2: types.ts 를 공유 McpTool 재수출로 교체** — `apps/workplace-mcp/src/tools/types.ts` 전체를:

```ts
// src/tools/types.ts — MCP 도구 정의 타입. 공유 패키지 McpTool 을 재수출한다(두 앱 단일 정의).
export type { McpTool } from '@smart-workplace/issue-tools-shared';
```

(기존 로컬 interface 삭제. 6개 build*Tools 파일은 `./types.js` 에서 import 하므로 변경 불필요.)

- [ ] **Step 3: server.ts 캐스트** — `apps/workplace-mcp/src/mcp/server.ts:17` 수정

`inputSchema: t.inputSchema.shape` → 공유 타입이 `z.ZodTypeAny` 라 `.shape` 직접 접근 불가. ai-agent 와 동일하게 캐스트:

```ts
import { z } from 'zod'; // 파일 상단에 없으면 추가
// ...
      { description: t.description, inputSchema: (t.inputSchema as z.ZodObject<z.ZodRawShape>).shape },
```

- [ ] **Step 4: issue.ts 리와이어** — `apps/workplace-mcp/src/tools/issue.ts`

로컬 `parseIssueKey`/`errText`/이관된 스키마/공유 7종 정의를 제거하고, 어댑터 + 공유 spread + 전용 3종만 남긴다. 파일 전체를 아래로 교체:

```ts
// src/tools/issue.ts — 이슈 도메인 도구. 사용자 본인 권한으로 직접 실행된다.
// 공유 7종(get_issue_detail/create_issue/update_issue/add_comment/edit_comment/add·remove_issue_dependency)은
// @smart-workplace/issue-tools-shared 의 buildSharedIssueTools 를 쓰고, PAT 전용 3종(list_projects/get_project/
// list_issues)만 여기서 정의한다.
import { z } from 'zod';
import type { PatApiClient } from '../clients/workplace-api.js';
import {
  buildSharedIssueTools,
  parseIssueKey,
  type IssueToolClient,
  type McpTool,
} from '@smart-workplace/issue-tools-shared';

/** PatApiClient(projectKey/number 기준, PAT 신원)를 공유 IssueToolClient(issueKey 기준)로 어댑팅.
 * add/edit_comment 의 코멘트 id 해석(getIssueDetail→summary.id)도 여기서 흡수한다. */
function buildIssueToolClient(client: PatApiClient): IssueToolClient {
  return {
    getProjectTypes: (key) => client.getProjectTypes(key),
    getProjectMembers: (key) => client.getProjectMembers(key),
    getProjectLabels: (key) => client.getProjectLabels(key),
    getIssueDetail: (issueKey) => {
      const { projectKey, number } = parseIssueKey(issueKey);
      return client.getIssueDetail(projectKey, number);
    },
    createIssue: (projectKey, body) => client.createIssue(projectKey, body),
    updateIssueContent: (issueKey, body) => {
      const { projectKey, number } = parseIssueKey(issueKey);
      return client.updateIssue(projectKey, number, body);
    },
    setIssueType: (issueKey, typeId) => {
      const { projectKey, number } = parseIssueKey(issueKey);
      return client.setIssueType(projectKey, number, typeId);
    },
    setIssueParent: (issueKey, parentNumber) => {
      const { projectKey, number } = parseIssueKey(issueKey);
      return client.setIssueParent(projectKey, number, parentNumber);
    },
    replaceIssueAssignees: (issueKey, ids) => {
      const { projectKey, number } = parseIssueKey(issueKey);
      return client.replaceIssueAssignees(projectKey, number, ids);
    },
    replaceIssueLabels: (issueKey, ids) => {
      const { projectKey, number } = parseIssueKey(issueKey);
      return client.replaceIssueLabels(projectKey, number, ids);
    },
    addComment: async (issueKey, body) => {
      const { projectKey, number } = parseIssueKey(issueKey);
      const detail = await client.getIssueDetail(projectKey, number);
      await client.addIssueComment(detail.summary.id, body);
    },
    editComment: async (issueKey, commentId, body) => {
      const { projectKey, number } = parseIssueKey(issueKey);
      const detail = await client.getIssueDetail(projectKey, number);
      await client.editIssueComment(detail.summary.id, commentId, body);
    },
    addIssueDependency: (issueKey, otherNumber, direction) => {
      const { projectKey, number } = parseIssueKey(issueKey);
      return client.addIssueDependency(projectKey, number, otherNumber, direction);
    },
    removeIssueDependency: (issueKey, otherNumber, direction) => {
      const { projectKey, number } = parseIssueKey(issueKey);
      return client.removeIssueDependency(projectKey, number, otherNumber, direction);
    },
  };
}

/** 이슈 도메인 도구 10종을 구성한다(공유 7 + PAT 전용 list_projects/get_project/list_issues). */
export function buildIssueTools(client: PatApiClient): McpTool[] {
  const listProjectsInput = z.object({});
  const getProjectInput = z.object({ projectKey: z.string().min(1) });
  const listMyIssuesInput = z.object({
    projectKey: z.string().optional(),
    status: z.string().optional(),
    q: z.string().optional(),
    size: z.number().int().min(1).max(100).optional(),
  });

  return [
    {
      name: 'list_projects',
      description: '접근 가능한 프로젝트 목록을 JSON 으로 반환합니다.',
      inputSchema: listProjectsInput,
      async handler() {
        return JSON.stringify(await client.listProjects());
      },
    },
    {
      name: 'get_project',
      description:
        '프로젝트 단건 정보(키·이름·설명·유형)와 함께 이슈 생성/수정에 쓰는 ' +
        'types(유형)·labels(라벨)·members(멤버 username)를 동봉해 반환합니다. ' +
        'create_issue/update_issue 의 type·labels·assignees 값은 여기 이름/username 을 사용하세요.',
      inputSchema: getProjectInput,
      async handler(args) {
        const { projectKey } = getProjectInput.parse(args);
        const [project, types, labels, members] = await Promise.all([
          client.getProject(projectKey),
          client.getProjectTypes(projectKey),
          client.getProjectLabels(projectKey),
          client.getProjectMembers(projectKey),
        ]);
        return JSON.stringify({ ...(project as Record<string, unknown>), types, labels, members });
      },
    },
    {
      name: 'list_issues',
      description:
        '내(토큰 소유자)게 할당된 이슈 목록을 조회합니다. status/q(검색어)로 필터링할 수 있습니다. ' +
        'projectKey 는 서버가 지원하지 않아 클라이언트에서 issueKey 접두어로 후처리 필터링합니다. ' +
        '후처리 특성상 조회된 size 범위 안에서만 걸러지므로, 결과가 비면 size 를 늘려 재시도하세요.',
      inputSchema: listMyIssuesInput,
      async handler(args) {
        const { projectKey, ...p } = listMyIssuesInput.parse(args);
        const items = (await client.listMyIssues({
          ...p,
          assignee: 'me',
          size: p.size ?? 30,
        })) as Array<{ issueKey?: string }>;
        const filtered = projectKey
          ? items.filter((item) => {
              if (!item.issueKey) return false;
              const idx = item.issueKey.lastIndexOf('-');
              return idx > 0 && item.issueKey.slice(0, idx) === projectKey;
            })
          : items;
        return JSON.stringify(filtered);
      },
    },
    ...buildSharedIssueTools(buildIssueToolClient(client)),
  ];
}
```

**주의:** 다른 파일이 `import { parseIssueKey } from './issue.js'` 하는지 확인하고, 있으면 공유본으로 교체.

Run: `grep -rn "from './issue.js'\|from '../tools/issue" apps/workplace-mcp/src | grep -v issue.test`
Expected: 소비처 확인 후 필요 시 import 교체.

- [ ] **Step 5: 타입체크**

Run: `pnpm --filter workplace-mcp typecheck`
Expected: PASS. (실패 시 어댑터 시그니처/누락 메서드 수정.)

- [ ] **Step 6: issue.test.ts 갱신**

기존 테스트에서 로컬 `parseIssueKey` import 를 공유본으로 바꾸고, **get_issue_detail 단언을 새 superset 형태로** 갱신(§7.2). 나머지 도구(add_comment→'ok', create/update/dependency)의 기존 단언은 그대로 유지(§7.1 불변). get_issue_detail 테스트가 raw 를 기대했다면, mock `getIssueDetail` 이 `{summary:{...}, body, comments}` 를 반환하도록 하고 출력이 normalize 됨을 단언:

```ts
// 예시: get_issue_detail 이 이제 정규화된 superset 을 반환
it('get_issue_detail 은 정규화된 superset 을 반환', async () => {
  const client = mockPatApiClient();
  (client.getIssueDetail as any).mockResolvedValue({
    issueKey: 'WP-12',
    summary: { id: 1, title: 'T', status: 'TODO', priority: 'MID', assignees: [], blockedBy: [], blocks: [], blocked: false },
    body: 'b',
    comments: [],
  });
  const t = buildIssueTools(client).find((x) => x.name === 'get_issue_detail')!;
  const out = JSON.parse(await t.handler({ issueKey: 'WP-12' }));
  expect(out).toMatchObject({ issueKey: 'WP-12', title: 'T', blocked: false });
});
```

- [ ] **Step 7: 테스트 실행**

Run: `pnpm --filter workplace-mcp test`
Expected: PASS. index.test.ts 의 총 도구 개수(26) 불변, issue 이름 목록 불변.

- [ ] **Step 8: 커밋**

```bash
git add apps/workplace-mcp
git commit -m "refactor(mcp): 이슈 도구를 issue-tools-shared 공유본으로 리와이어"
```

---

## Task 6: workplace-ai-agent 리와이어

**Files:**
- Modify: `apps/workplace-ai-agent/src/mcp/tools.ts`
- Modify: `apps/workplace-ai-agent/src/clients/workplace-api.ts`
- Modify: `apps/workplace-ai-agent/src/mcp/tools.test.ts`
- Modify: `apps/workplace-ai-agent/src/agent/run-agent.test.ts` (WorkplaceApiClient mock 정합)
- Modify: `apps/workplace-ai-agent/src/clients/workplace-api.test.ts` (getIssueDetail raw 반환)

**Interfaces:**
- Consumes: `buildSharedIssueTools`, `IssueToolClient`, `McpTool`, `parseIssueKey`, `errText` (shared).
- Produces: `buildTools(...)` 반환 — issue/assistant 프로필의 도구 이름 목록 불변. `WorkplaceApiClient.getIssueDetail(agentId, issueKey): Promise<unknown>` (raw).

- [ ] **Step 1: 공유 패키지 빌드 확인**

Run: `pnpm --filter @smart-workplace/issue-tools-shared build`
Expected: 최신 dist.

- [ ] **Step 2: 클라이언트 getIssueDetail 을 raw 로** — `apps/workplace-ai-agent/src/clients/workplace-api.ts`

인터페이스 선언(252행 부근)을 `getIssueDetail(agentId: number, issueKey: string): Promise<unknown>;` 로 변경. 구현(497~527행)에서 정규화(`normalized`/`issueDetail.parse`)를 제거하고 raw 를 반환:

```ts
    async getIssueDetail(agentId, issueKey) {
      const { projectKey, number } = parseIssueKey(issueKey);
      const r = await http.get(`/projects/${projectKey}/issues/${number}`, onBehalfOf(agentId));
      // 정규화는 공유 도구 핸들러(normalizeIssueDetail)가 수행 — 여기선 raw 를 그대로 반환.
      // run-ai-chat 의 filterIssueDetailWidgets 는 존재확인(throw/no-throw)만 쓰므로 형태 변화 무영향.
      return r.data ?? {};
    },
```

로컬 `parseIssueKey`(358~367행)는 삭제하고 상단 import 를 공유본으로:

```ts
import { parseIssueKey } from '@smart-workplace/issue-tools-shared';
```

그리고 이 파일에서 `parseIssueKey` 를 **export** 하던 것(다른 모듈이 import 할 수 있음)을 확인. tools.ts 가 `import { parseIssueKey } from '../clients/workplace-api.js'` 하므로(11행), Step 4 에서 tools.ts 를 공유본 import 로 바꾼다. 그 외 소비처가 있으면 함께 교체:

Run: `grep -rn "parseIssueKey" apps/workplace-ai-agent/src | grep -v test`
Expected: 소비처 목록 — 전부 공유본 import 로 통일. `IssueDetail`/`issueDetail` 가 client 에서만 쓰였다면 unused import 제거(다른 소비처 있으면 유지).

- [ ] **Step 3: tools.ts 리와이어** — `apps/workplace-ai-agent/src/mcp/tools.ts`

(a) 상단 import 정리 — 로컬 `McpTool` interface(13~18행) 삭제하고 공유본 import. **주의: 공유 7종이 빠지면 `resolveTypeId/resolveAssigneeIds/resolveLabelIds`·`errText`·기존 `buildProjectMetaAdapter` 가 tools.ts 에서 미사용이 될 수 있다** — 리팩터 후 lint/tsc(noUnusedLocals) 가 플래그하는 항목만 import 목록/코드에서 제거한다. 최종적으로 tools.ts 에 남는 shared import 는 대략:

```ts
import {
  buildSharedIssueTools,
  parseIssueKey,
  addCommentInput,
  createIssueInput,
  dependencyInput,
  editCommentInput,
  updateIssueInput,
  type IssueToolClient,
  type McpTool,
} from '@smart-workplace/issue-tools-shared';
import type { WorkplaceApiClient } from '../clients/workplace-api.js';
```

(`resolve*`/`errText`/`ProjectMetaClient` 는 공유 도구가 흡수하므로 tools.ts 에 남는 다른 사용처가 없으면 import 하지 않는다. `parseIssueKey` 는 남는 전용 도구가 쓰면 유지, 아니면 제거. 로컬 `updateStatusInput`·`issueKey`(=issueKeyInput) 등 공유 안 하는 스키마는 그대로 두고, 공유하는 create/update/addComment/editComment/dependency 로컬 정의는 삭제.)

(b) `buildProjectMetaAdapter`(360~369행)를 공유 IssueToolClient 어댑터로 확장:

```ts
/** agentId 를 클로저로 감싸 WorkplaceApiClient 를 공유 IssueToolClient(issueKey 기준)로 어댑팅.
 * 기존 buildProjectMetaAdapter 역할 포함(create/update 리졸브가 ProjectMetaClient 를 필요로 함). */
function buildIssueToolClient(client: WorkplaceApiClient, agentId: number): IssueToolClient {
  return {
    getProjectTypes: (key) => client.getProjectTypes(agentId, key),
    getProjectMembers: (key) => client.listProjectMembers(agentId, key),
    getProjectLabels: (key) => client.getProjectLabels(agentId, key),
    getIssueDetail: (issueKey) => client.getIssueDetail(agentId, issueKey),
    createIssue: (projectKey, body) => client.createIssue(agentId, projectKey, body),
    updateIssueContent: (issueKey, body) => client.updateIssueContent(agentId, issueKey, body),
    setIssueType: (issueKey, typeId) => client.setIssueType(agentId, issueKey, typeId),
    setIssueParent: (issueKey, parent) => client.setIssueParent(agentId, issueKey, parent),
    replaceIssueAssignees: (issueKey, ids) => client.replaceIssueAssignees(agentId, issueKey, ids),
    replaceIssueLabels: (issueKey, ids) => client.replaceIssueLabels(agentId, issueKey, ids),
    addComment: (issueKey, body) => client.addIssueComment(agentId, issueKey, body),
    editComment: (issueKey, commentId, body) => client.editIssueComment(agentId, issueKey, commentId, body),
    addIssueDependency: (issueKey, otherNumber, direction) =>
      client.addIssueDependency(agentId, issueKey, otherNumber, direction),
    removeIssueDependency: (issueKey, otherNumber, direction) =>
      client.removeIssueDependency(agentId, issueKey, otherNumber, direction),
  };
}
```

기존 `buildProjectMetaAdapter` 를 쓰던 곳(createIssueTool/updateIssueTool 리졸브)은 공유 도구로 대체되므로 함께 사라진다. `buildProjectMetaAdapter` 가 다른 곳에서도 쓰이면 유지, 아니면 삭제.

(c) 공유 7종 정의 삭제 + `sharedIssueTools` 로 치환: `getIssueDetailTool`(384~393), `addCommentTool`(663~672), `editCommentTool`(673~682), `createIssueTool`(693~718), `updateIssueTool`(719~769), `addDependencyTool`(770~786), `removeDependencyTool`(787~801) 정의를 제거. `buildTools` 본문 초입에 한 번 생성:

```ts
  // 공유 이슈 도구 7종 — issue/assistant 프로필이 spread 로 소비.
  const shared = buildSharedIssueTools(buildIssueToolClient(client, agentId));
  const sharedTool = (name: string): McpTool => shared.find((t) => t.name === name)!;
```

(d) 프로필 배열에서 개별 도구를 `sharedTool('...')` 로 교체. **이름 목록·순서·개수 불변** 유지가 목표.

- `issue` 프로필(1362~1375행):

```ts
  return [
    sharedTool('get_issue_detail'),
    listWikiSpacesTool,
    searchWikiTool,
    getWikiPageTool,
    sharedTool('add_comment'),
    sharedTool('edit_comment'),
    updateStatusTool,
    sharedTool('create_issue'),
    sharedTool('update_issue'),
    unassignSelfTool,
    sharedTool('add_issue_dependency'),
    sharedTool('remove_issue_dependency'),
  ];
```

- `assistant` 프로필(1308~1323행 해당 항목): `getIssueDetailTool`→`sharedTool('get_issue_detail')`, `addCommentTool`→`sharedTool('add_comment')`, `editCommentTool`→`sharedTool('edit_comment')`, `createIssueTool`→`sharedTool('create_issue')`, `updateIssueTool`→`sharedTool('update_issue')`, `addDependencyTool`→`sharedTool('add_issue_dependency')`, `removeDependencyTool`→`sharedTool('remove_issue_dependency')`. `listIssuesTool`/`updateStatusTool`/`unassignSelfTool` 등 전용은 그대로.

- `chat` 프로필(448행)의 `getIssueDetailTool` → `sharedTool('get_issue_detail')`.

(e) 파일 하단 로컬 `errText`(1378~1385행) 삭제 — 공유 도구가 흡수하므로 tools.ts 에 사용처가 없다(공유본을 import 할 필요도 없음).

- [ ] **Step 4: parseIssueKey 소비처 정리**

tools.ts 11행 `import { parseIssueKey } from '../clients/workplace-api.js'` 는 Step 3(a) 에서 공유 import 로 이동했으므로 제거. client 파일이 여전히 `parseIssueKey` 를 내부에서 쓰면(getIssueDetail 등) 공유 import 사용.

- [ ] **Step 5: 타입체크**

Run: `pnpm --filter workplace-ai-agent typecheck`
Expected: PASS. (getIssueDetail 반환 타입 변경으로 인한 소비처 에러가 있으면 수정 — run-ai-chat 은 반환값 미사용이라 무영향 예상.)

- [ ] **Step 6: 테스트 갱신**

- `clients/workplace-api.test.ts`: `getIssueDetail` 이 정규화된 `IssueDetail` 을 반환한다고 단언하던 케이스를 **raw 반환**으로 변경(nock mock 응답 그대로 반환됨을 단언).
- `mcp/tools.test.ts`: 공유 도구 mock 은 `client()` 헬퍼(WorkplaceApiClient mock)에 이미 있는 메서드로 동작. get_issue_detail 단언을 정규화 superset 으로 갱신. 프로필 이름 목록/개수 불변 단언 유지. add/remove_dependency 호출 인자 단언 유지(`client.addIssueDependency(agentId, issueKey, otherNumber, direction)`).
- `agent/run-agent.test.ts`: WorkplaceApiClient object-literal mock 이 완전해야 typecheck 통과 — 인터페이스 변경(getIssueDetail 반환 타입) 반영.

Run: `pnpm --filter workplace-ai-agent test`
Expected: PASS(전 스위트).

- [ ] **Step 7: 커밋**

```bash
git add apps/workplace-ai-agent
git commit -m "refactor(ai-agent): 이슈 도구를 issue-tools-shared 공유본으로 리와이어"
```

---

## Task 7: 전체 회귀 + 라이브 스모크

**Files:** (없음 — 검증 전용. 필요 시 미세 수정 후 커밋)

**Interfaces:** 없음.

- [ ] **Step 1: 전체 빌드/타입체크/테스트**

Run:
```
pnpm --filter @smart-workplace/issue-tools-shared build
pnpm --filter @smart-workplace/issue-tools-shared test
pnpm --filter workplace-mcp typecheck && pnpm --filter workplace-mcp test
pnpm --filter workplace-ai-agent typecheck && pnpm --filter workplace-ai-agent test
```
Expected: 전부 PASS. mcp 도구 26종, ai-agent 프로필 도구 목록 리팩터 전과 동일.

- [ ] **Step 2: lint**

Run: `pnpm --filter @smart-workplace/issue-tools-shared lint && pnpm --filter workplace-mcp lint && pnpm --filter workplace-ai-agent lint`
Expected: PASS.

- [ ] **Step 3: 라이브 스모크 (의존성 경로가 새 어댑터로 바뀌었으므로 필수 재검증)**

로컬 workplace-api(6060)를 메인 체크아웃에서 기동(generateJooq 선행). AGENT On-Behalf-Of 로 **양쪽 앱의 새 어댑터를 통해** add/remove 를 실제 호출:

- **ai-agent 경로**: ai-agent(6070) 기동 후, 또는 `buildIssueToolClient` 어댑터를 직접 노드 스크립트로 태워 `add_issue_dependency`(같은 프로젝트 2 이슈, 예: EX-2 blocks EX-3) → 200 + get_issue_detail 이 `blocks/blocked` 를 superset 으로 노출하는지, 반대방향 사이클 → 409, remove 2회 → 멱등 성공.
- **mcp 경로**: PAT 로 `POST /mcp` 의 `add_issue_dependency`/`get_issue_detail`/`remove_issue_dependency` 를 호출해 동일 확인. get_issue_detail 출력이 정규화 superset(의존성 필드 포함)인지 확인.

Expected: add→정규화 상세(blocks 반영), cycle→409 "의존성 사이클이 발생합니다", remove→멱등. 403 없음.

- [ ] **Step 4: 스펙에 라이브 결과 append + 커밋**

`docs/superpowers/specs/2026-07-09-issue-tools-consolidation-design.md` §8 하단에 라이브 검증 결과(양쪽 경로 PASS)를 기록.

```bash
git add docs/superpowers/specs/2026-07-09-issue-tools-consolidation-design.md
git commit -m "docs(spec): 이슈 도구 공유화 라이브 검증 결과 기록"
```

---

## Self-Review (작성자 체크)

**Spec coverage:**
- §3.1 타입/유틸 → Task 1 ✓
- §3.2 입력 스키마 → Task 2 ✓
- §3.3 정규화 → Task 3 ✓
- §3.4 IssueToolClient + §3.5 buildSharedIssueTools → Task 4 ✓ (인터페이스는 update_issue fan-out 때문에 스펙 스케치 7메서드 → 실제 14메서드로 확장 — 스펙 의도 유지)
- §4.1 ai-agent 어댑터 + getIssueDetail raw → Task 6 ✓
- §4.2 mcp 어댑터 + 코멘트 id 이동 → Task 5 ✓
- §5 조립(각 앱) → Task 5/6 ✓
- §6 공유 제외 유지 → Task 5(list_projects/get_project/list_issues)/6(update_status/unassign_self/list_issues) ✓
- §7 동작 변경/불변 분할 → Task 5/6 테스트 스텝에 명시 ✓
- §8 테스트 + 라이브 스모크 → Task 4(단위)/5/6(앱)/7(스모크) ✓

**Type consistency:** `IssueToolClient` 메서드명이 Task 4 정의와 Task 5/6 어댑터 구현에서 일치(getIssueDetail/createIssue/updateIssueContent/setIssueType/setIssueParent/replaceIssueAssignees/replaceIssueLabels/addComment/editComment/addIssueDependency/removeIssueDependency + ProjectMetaClient 3종). `buildSharedIssueTools`/`normalizeIssueDetail`/`parseIssueKey` 이름 전 Task 일관.

**Placeholder scan:** 코드 스텝 전부 실제 코드 포함. TBD/TODO 없음.
