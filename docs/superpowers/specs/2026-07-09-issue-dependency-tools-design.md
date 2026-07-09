# 이슈 의존성 add/remove 도구 설계 (MCP + AI Agent)

- 작성일: 2026-07-09
- 대상: `apps/workplace-mcp`(외부 PAT 게이트웨이), `apps/workplace-ai-agent`(인-프로세스 SDK MCP 도구)
- 목표: 백엔드에 이미 존재하는 이슈 의존성(블로킹) 기능을 MCP/AI Agent 도구로 노출한다. 백엔드 변경 없음.

## 1. 배경

`issue_dependency` 테이블(V12)과 `IssueDependencyController`(`POST`/`DELETE /api/v1/projects/{key}/issues/{number}/dependencies`)는 이미 있고, 웹 UI(`IssueDependenciesSection`)도 사람이 직접 조작한다. 그런데 MCP(`apps/workplace-mcp/src/tools/issue.ts`)와 ai-agent(`apps/workplace-ai-agent/src/mcp/tools.ts`) 어느 쪽에도 관련 도구가 없어, 챗/AI 경로로는 의존성을 생성·해제할 수 없다.

## 2. 범위

**포함**: `add_issue_dependency`, `remove_issue_dependency` 2종을 MCP·ai-agent 양쪽에 대칭 추가.

**제외**:
- 조회 도구는 추가하지 않음 — `get_issue_detail` 응답(`summary.blockedBy`/`summary.blocks`/`summary.blocked`)이 이미 현재 의존성 상태를 담고 있어 중복.
- `IssueDependencyEdgesController`(프로젝트 전체 엣지, 타임라인용)는 대상 아님 — AI/챗 시나리오와 무관.
- 백엔드(workplace-api) 변경 없음.

## 3. 파라미터 / 동작

```
issueKey: string        // 예: "WP-12" — 기준 이슈
otherIssueKey: string   // 예: "WP-15" — 대상 이슈
direction: "blocks" | "blockedBy"   // issueKey 가 otherIssueKey 를 막는지(blocks), 막히는지(blockedBy)
```

- API는 동일 프로젝트 내 이슈만 허용(`otherNumber`, 프로젝트 접두어 없음). 도구는 사용성을 위해 두 이슈 모두 전체 key(`issueKey`/`otherIssueKey`)로 받되, `parseIssueKey`로 각각의 `projectKey`를 비교해 **다르면 API 호출 전에 클라이언트 측에서 즉시 에러**를 던진다: `"동일 프로젝트 이슈 간에만 의존성을 설정할 수 있습니다"`. 백엔드의 `InvalidDependencyException`(프로젝트 경계 위반 시 400)보다 먼저 걸러 더 명확한 메시지를 준다.
- 통과하면 `otherIssueKey`의 number만 추출해 API의 `otherNumber`로 전달.

### 3.1 `add_issue_dependency`
- `client.addIssueDependency(projectKey, number, otherNumber, direction)` → `POST .../dependencies` 호출.
- 응답: 백엔드가 갱신된 `IssueDetailResponse`를 반환하므로 그대로 JSON 문자열화해 반환(별도 재조회 없음) — `add_comment`가 아니라 `update_issue`류 응답 패턴을 따른다.

### 3.2 `remove_issue_dependency`
- `client.removeIssueDependency(projectKey, number, otherNumber, direction)` → `DELETE .../dependencies?otherNumber=&direction=`.
- 멱등(존재하지 않아도 204) — 성공 문자열 `'ok'` 반환(`add_comment`/`edit_comment`와 동일 관례).

## 4. 에러 매핑

| 백엔드 예외 | HTTP | 도구 동작 |
|---|---|---|
| 클라이언트측 프로젝트 불일치 체크 | - | catch 없이 즉시 throw (그대로 `isError` 래핑) |
| `InvalidDependencyException`(자기참조/대상 이슈 없음) | 400 | catch 없이 그대로 throw — axios 에러 메시지가 이미 사람이 읽을 수 있는 한국어(`update_issue`/`edit_comment`와 동일 컨벤션) |
| `DependencyCycleException`("의존성 사이클이 발생합니다") | 409 | catch 없이 그대로 throw — 메시지 자체로 충분히 명확해 재가공 불필요 |

기존 `create_issue`/`update_issue`/`edit_comment`도 백엔드 에러를 잡지 않고 상위(SDK/MCP 러너)에 전파하는 컨벤션이므로 그대로 따른다. 별도의 에러 재작성 로직은 추가하지 않는다.

## 5. 클라이언트 메서드 추가

양쪽 클라이언트(`apps/workplace-mcp/src/clients/workplace-api.ts`의 `PatApiClient`, `apps/workplace-ai-agent/src/clients/workplace-api.ts`의 `WorkplaceApiClient`)에 동일 패턴으로 추가:

```ts
addIssueDependency(projectKey, number, otherNumber, direction) // POST .../dependencies, body {otherNumber, direction} → 응답 body 그대로 반환
removeIssueDependency(projectKey, number, otherNumber, direction) // DELETE .../dependencies?otherNumber=&direction=
```

ai-agent 쪽은 기존 관례대로 모든 메서드 첫 인자에 `agentId`(On-Behalf-Of) 추가.

## 6. 등록 위치

- `apps/workplace-mcp/src/tools/issue.ts`의 `buildIssueTools()` 반환 배열에 `update_issue` 다음, `add_comment` 이전에 2개 추가(파일 상단 도구 개수 주석 8→10 갱신).
- `apps/workplace-ai-agent/src/mcp/tools.ts`의 `buildTools()`에 `issue`/`assistant` 프로필로 동일 스펙 추가.

## 7. 즉시실행 판단

기존 이슈 필드 수정(`update_issue`)과 같은 리스크군 — 이미 존재하는 이슈 간 관계를 되돌리기 쉬운 방식으로 바꾸는 것뿐이라 위임자 승인(propose_*)이 필요한 새 엔티티 생성/외부효과가 아니다. 즉시 실행으로 둔다.

## 8. 테스트

- `apps/workplace-mcp/src/tools/issue.test.ts` — add 성공(응답 JSON 통과), remove 성공, cross-project 클라이언트측 거부, 백엔드 409/400 그대로 propagate 확인.
- `apps/workplace-ai-agent/src/mcp/tools.test.ts` — 동일 케이스.
- `apps/workplace-mcp/src/clients/workplace-api.test.ts`, ai-agent 쪽 동등 파일 — 신규 클라이언트 메서드 2종의 요청 URL/바디 검증.
- 백엔드 엔드포인트는 기존 것 재사용이므로 workplace-api 신규 테스트는 없음.

### 8.1 라이브 검증 (필수)

`proj-mcp-issue-tools-expansion`/`ai-agent-issue-tools-parity` 선례에서 AGENT 신원이 특정 필드(예: assignees)에서 사람과 다른 403 규칙에 걸린 적이 있다(`ai-agent-issue-access-gap` #418). 구현 후 로컬(api 6060, ai-agent 6070)에서 AGENT On-Behalf-Of 헤더로 다음을 실제 호출해 확인한다:

1. AGENT가 배정된 프로젝트 내 두 이슈 간 `add`가 403 없이 통과하는지.
2. `DependencyCycleException`(409)이 실제로 사이클 케이스에서 발생하는지(예: A→B blocks 후 B→A blocks 시도).
3. `remove`가 멱등하게 204를 반환하는지.
