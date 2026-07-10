# 이슈 도구 공유화(핸들러 통합) 설계

- 작성일: 2026-07-09
- 대상: `packages/issue-tools-shared`(공유), `apps/workplace-mcp`(외부 PAT 게이트웨이), `apps/workplace-ai-agent`(인-프로세스 SDK)
- 목표: 두 앱에 중복 정의된 이슈 MCP 도구의 **정의(zod 스키마·설명) + 핸들러 로직**을 `issue-tools-shared` 로 1벌화한다. 백엔드(workplace-api) 변경 없음.

## 1. 배경

`resolveTypeId/resolveAssigneeIds/resolveLabelIds`(이름→ID)는 이미 `@smart-workplace/issue-tools-shared` 로 공유돼 있고, 구조적 인터페이스 `ProjectMetaClient` + 앱별 어댑터(`buildProjectMetaAdapter`)라는 검증된 패턴이 있다. 그러나 이슈 도구의 **입력 스키마·설명·핸들러**, `McpTool` 타입, `parseIssueKey`, `errText` 는 여전히 두 앱에 중복돼 있어 드리프트(도구 개수 주석 오류, 스키마 불일치 등)가 반복됐다. 본 작업은 그 공유 패턴을 이슈 연산 전체로 확장한다.

## 2. 접근(승인된 방향 B)

핸들러까지 공유한다. 클라이언트 시그니처가 근본적으로 다르므로(mcp=`(projectKey, number)` PAT, ai-agent=`agentId`+`issueKey`+On-Behalf-Of) **`issueKey`(string) 기준의 공유 클라이언트 인터페이스**를 정의하고, 각 앱이 자기 클라이언트를 그 인터페이스로 어댑팅한다.

## 3. 공유 패키지에 추가할 것

`packages/issue-tools-shared/src` 에 다음을 추가한다.

### 3.1 타입/유틸
- `McpTool` — `{ name, description, inputSchema: z.ZodTypeAny, handler: (args: unknown) => Promise<string> }`. 두 앱의 기존 타입 중 `z.ZodTypeAny`(ai-agent 쪽, 상위집합) 채택. 두 앱은 자기 `McpTool` 정의를 삭제하고 이걸 re-export/import.
- `parseIssueKey(issueKey) => { projectKey, number }` — **mcp 의 정규식+throw 시맨틱 채택**(`/^(.+)-(\d+)$/`, 실패 시 throw). ai-agent 의 `lastIndexOf` silent-NaN 은 버그에 가까워 폐기. ai-agent 클라이언트도 이 공유본을 쓰도록 교체.
- `errText(e) => string` — 두 앱 verbatim 동일본을 그대로 이관.

### 3.2 입력 스키마(zod)
`issueKeyInput`, `createIssueInput`, `updateIssueInput`, `addCommentInput`, `editCommentInput`, `dependencyInput` — 두 앱에서 이미 거의 동일. 공유본으로 이관하고 두 앱은 import.

### 3.3 정규화 스키마 + 함수 (**get_issue_detail 전용**)
백엔드 `IssueDetailResponse` = `{ summary: IssueResponse, body, comments[], history[], attachments[], aiContext, viewerCan* }`. 의존성 필드는 `summary.blockedBy`/`summary.blocks`/`summary.blocked` 로 **nested**.

LLM 노출용 **flat superset** 타겟 형태를 확정한다(기존 ai-agent 필드 + 의존성 3필드 lift):

```ts
export const issueDetail = z.object({
  issueKey: z.string(),
  title: z.string(),
  body: z.string().nullable().optional(),
  status: z.string(),
  priority: z.string(),
  assignees: z.array(userSummary),
  comments: z.array(issueComment).optional(),
  // summary.* 에서 top-level 로 lift (Phase 4b 의존성 가시성 보존)
  blockedBy: z.array(issueLink).default([]),
  blocks: z.array(issueLink).default([]),
  blocked: z.boolean().default(false),
});
// issueLink = { number, title, status } — 백엔드 IssueLinkSummary(number,title,status,type) 중 LLM 필요분만.
```

`normalizeIssueDetail(raw): IssueDetail` — `raw.summary.{blockedBy,blocks,blocked}` 를 top-level 로 끌어올리고, comments 의 flat author 필드(`authorId/authorName/authorKind`)를 nested `author` 로 변환(기존 ai-agent 매핑 이관). `userSummary`/`issueComment`/`issueLink` zod 도 함께 이관.

### 3.4 공유 클라이언트 인터페이스
```ts
export interface IssueToolClient extends ProjectMetaClient {
  getIssueDetail(issueKey: string): Promise<unknown>;          // raw 백엔드 JSON 반환(정규화는 핸들러가)
  createIssue(projectKey: string, body: Record<string, unknown>): Promise<unknown>;
  updateIssue(issueKey: string, body: Record<string, unknown>): Promise<unknown>;
  addComment(issueKey: string, body: string): Promise<void>;
  editComment(issueKey: string, commentId: number, body: string): Promise<void>;
  addIssueDependency(issueKey: string, otherNumber: number, direction: 'blocks' | 'blockedBy'): Promise<unknown>;
  removeIssueDependency(issueKey: string, otherNumber: number, direction: 'blocks' | 'blockedBy'): Promise<void>;
}
```

### 3.5 공유 도구 빌더
`buildSharedIssueTools(client: IssueToolClient): McpTool[]` → **7종** 반환: `get_issue_detail`, `create_issue`, `update_issue`, `add_comment`, `edit_comment`, `add_issue_dependency`, `remove_issue_dependency`. 각 도구의 설명·스키마·핸들러(리졸브→fan-out→errText, cross-project 가드 등)를 여기에 1벌 정의.

## 4. 각 앱 어댑터

### 4.1 ai-agent
`agentId` 를 클로저로 바인딩해 기존 `WorkplaceApiClient` 로 위임하는 `buildIssueToolClient(client, agentId): IssueToolClient` 작성(거의 패스스루). 단 **`getIssueDetail` 은 raw 를 반환하도록** — 현재 클라이언트가 클라이언트 내부에서 정규화하는 것을 공유 핸들러 정규화로 이동. `run-ai-chat.ts` 의 `getIssueDetail` 호출은 존재확인(throw/no-throw)만 쓰므로 형태 변화 무영향(확인 완료).

### 4.2 mcp
`buildIssueToolClient(client): IssueToolClient` 작성:
- `issueKey → parseIssueKey → (projectKey, number)` 매핑으로 PAT 클라이언트 호출.
- `addComment`/`editComment` 의 **코멘트 id 해석**(현재 도구 핸들러의 `getIssueDetail→summary.id` 2단계)을 이 어댑터 안으로 이동.

## 5. 각 앱 조립

- **mcp `buildIssueTools`**: `buildSharedIssueTools(adapter)` 7종 + 전용 도구(`list_projects`, `get_project` 번들형, `list_issues`) spread. 도구 개수/이름 불변.
- **ai-agent `buildTools`**: 공유 7종을 기존 각 프로필(`issue`/`assistant` 등)에 spread + 전용 도구(`update_status`, `unassign_self`, `list_issues`, `propose_*`, `show_*`) 유지. 프로필별 도구 목록 불변.

## 6. 공유 제외(각 앱 유지)
- `list_issues` — mcp(클라이언트측 prefix 필터, 4필드) vs ai-agent(서버측, 12필드)로 구조적 상이. 억지 통합 시 조건분기 과다 → 각 앱 유지.
- `update_status`, `unassign_self` — ai-agent 전용(mcp CLAUDE.md 가 노출 금지).
- `list_projects`, `get_project`(번들형) — mcp 전용 형태.

## 7. 동작 변경 vs 불변 (명시적 분할)

리팩터지만 일부 출력은 **의도적으로 변경**한다. 테스트에서 이 둘을 반드시 구분한다.

### 7.1 불변(behavior-preserving) — 리팩터 전후 **byte-identical**
- `add_comment` → `'ok'`
- `edit_comment` → `'ok'`
- `remove_issue_dependency` → `'ok'`
- `create_issue` → 백엔드 생성 응답 raw stringify (현재 두 앱 동일)
- `update_issue` → `{ ok, results }` fan-out 결과 (현재 두 앱 동일)
- `add_issue_dependency` → 갱신된 상세 raw stringify (현재 두 앱 동일)

**리팩터 전 현재 출력을 golden fixture 로 캡처한 뒤, 리팩터 후 동일함을 단언.**

### 7.2 의도적 변경 — 새 형태에 대해 단언
- `get_issue_detail` → `normalizeIssueDetail(raw)` = §3.3 flat superset.
  - **mcp**: raw 백엔드 JSON → superset 정규화(외부 출력 형태 변경). mcp 는 신설 게이트웨이라 외부 소비자 리스크 낮음. 의존성 필드는 보존됨.
  - **ai-agent**: 기존 flat 정규화 → superset(= `blocks/blockedBy/blocked` 획득). 개선.
  - **양쪽이 동일한 superset JSON 을 출력**함을 단언(통합의 핵심 이득).

### 7.3 create/update/dependency-add 응답 정규화 결정
§7.1 대로 **raw 유지**(정규화하지 않음). 근거: (1) 현재 두 앱 모두 raw 라 변경 0 → 회귀 위험 최소, (2) create/update 가 get 과 다른 DTO 를 반환할 가능성에 대한 노출 차단, (3) 쓰기 응답은 확인용이며 LLM 이 깨끗한 뷰가 필요하면 `get_issue_detail` 을 호출하면 됨. get_issue_detail 만 정규화하는 것이 최소 blast-radius 의 일관된 선택.

## 8. 테스트

- **공유 패키지**: 가짜 `IssueToolClient` 로 `buildSharedIssueTools` 7종 단위 테스트 — 스키마 파싱, 핸들러 호출 인자, cross-project 가드, `normalizeIssueDetail`(nested→flat lift, 의존성 필드, comment author 변환) 명세 테스트.
- **각 앱**: 어댑터 계약 테스트(issueKey 매핑, agentId 바인딩, 코멘트 id 해석). 기존 도구 테스트는 §7.1 golden 은 assert-unchanged, §7.2 get_issue_detail 은 새 형태로 갱신.
- **회귀 불변**: 리팩터 후 각 앱의 도구 개수·이름 목록·프로필 구성 불변 단언.
- **라이브 스모크(필수)**: 의존성 도구의 코드 경로가 **새 어댑터 매핑으로 바뀌므로 이전 라이브 검증은 이전(transfer)되지 않는다.** add/remove 를 **양쪽 앱의 새 어댑터를 통해** 실제 백엔드에 1회씩 태워 add→200/정규화 출력, cycle→409, remove→멱등 204 재확인.

## 9. 리스크/비용

- 간접화 1겹 추가(공유 인터페이스 + 어댑터 2개). 대신 create/update/dependency 핸들러의 fan-out·errText·resolve·cross-project 가드가 완전 1벌화.
- mcp `get_issue_detail` 외부 출력 형태 변경(신설 게이트웨이라 저위험, 오히려 narrowed 개선).
- 두 앱의 향후 권한/프로필이 더 벌어지면 어댑터가 흡수 지점이 됨(현재 구조로 충분).

## 10. 라이브 검증 결과 (2026-07-10, 구현 완료 후)

방법: 로컬 dev DB/api 6060 직접 기동(`SPRING_PROFILES_ACTIVE=local`). §8의 지시대로 **새 어댑터 코드를 실제로 태우기 위해** 각 앱의 실제 소스(`buildIssueTools`/`buildTools`)를 tsx 로 직접 import 해 백엔드에 호출(HTTP mock 없음). mcp 는 실제 PAT(`swp_...`, 로그인 후 `/users/me/api-tokens` 로 발급) 로, ai-agent 는 `Authorization: Internal changeme-local` + `X-On-Behalf-Of: 3`(AGENT `ai@ai`, EX 프로젝트 멤버)로 각각 인증. 프로젝트 `EX`, 이슈 EX-2/EX-3(둘 다 무관 데이터, soft-delete 없음).

**[mcp 경로]**
- `add_issue_dependency`(EX-2 blocks EX-3): ✅ PASS — 어댑터가 `issueKey→(projectKey,number)` 매핑 후 raw JSON 반환(§7.1 불변 확인).
- 사이클(EX-3 blocks EX-2, 반대방향): ✅ PASS — `409 "의존성 사이클이 발생합니다"`.
- `get_issue_detail`(EX-2): ✅ PASS — 정규화 superset 반환, `blocks:[{number:3,title:"...",status:"IN_PROGRESS"}]`, `blocked:true` 확인(§7.2).
- `remove_issue_dependency` 동일 요청 2회: ✅ PASS — 둘 다 `'ok'`(멱등).

**[ai-agent 경로]**
- `issue` 프로필 도구 목록: 리팩터 전과 동일한 12종(get_issue_detail, list_wiki_spaces, search_wiki, get_wiki_page, add_comment, edit_comment, update_status, create_issue, update_issue, unassign_self, add_issue_dependency, remove_issue_dependency) — 순서·개수 불변 확인.
- `add_issue_dependency`(EX-2 blocks EX-3, On-Behalf-Of AGENT): ✅ PASS — AGENT 403 갭 없음(#418 계열 우려 해소).
- 사이클(EX-3 blocks EX-2): ✅ PASS — `409 "의존성 사이클이 발생합니다"`.
- `get_issue_detail`(EX-2): ✅ PASS — **mcp 와 완전히 동일한 정규화 superset JSON**(`blocks`/`blockedBy`/`blocked` 포함) — 통합의 핵심 목표(양쪽 앱 동일 출력) 실증.
- `remove_issue_dependency` 동일 요청 2회: ✅ PASS — 둘 다 `'ok'`.

**결론**: §7의 동작 변경/불변 분할이 새 어댑터 경로에서도 모두 성립. mcp/ai-agent 가 이제 `get_issue_detail`에 대해 동일한 정규화 출력을 낸다는 것을 실측으로 확인. 사후 정리: 스모크용 PAT(`sdd-smoke-test`, id=7) 발급 즉시 폐기, DB 의존성 잔존 없음 확인, 로컬 api 프로세스 종료 확인.
