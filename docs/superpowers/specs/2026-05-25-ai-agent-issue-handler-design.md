# ai-agent 이벤트 핸들러 + workplace-api 코멘트 응답 — 설계 (Phase 5c-1)

> issue: #30 (분할 — 5c-1 만 다룸)
> 작성일: 2026-05-25

## 배경

Phase 5b-1 에서 workplace-api 는 이슈 도메인 변경을 `POST /events` 로 ai-agent
에 발사한다. 그러나 ai-agent 는 envelope 을 받아 로그만 찍을 뿐 응답하지 않는다.
5c-1 은 그 수신 측에 type 별 핸들러를 채우고, workplace-api 의 코멘트 endpoint
로 acknowledgment 코멘트를 작성해 **양방향 통합 골격을 닫는다**.

LLM 실호출은 5c-2 영역이라 본 epic 은 단순 텍스트 acknowledgment 만 작성한다.

## 분할 — 5c-1 / 5c-2 / 5c-3

#30 본문은 (a) ai-agent 측 처리, (b) workplace-api 의 AGENT 권한 미세 조정,
(c) 프론트엔드 AGENT 시각 구분 까지 묶여있다. 다음과 같이 분할한다.

- **5c-1 (본 spec):** ai-agent 의 type 별 핸들러 + workplace-api client 본문
  (코멘트 추가). LLM 없음. acknowledgment 텍스트 응답. workplace-api · 프론트엔드
  변경 없음.
- **5c-2:** Claude Agent SDK 호출 + MCP 도구 + `updateIssueStatus` client +
  AGENT 자기-unassign 권한. 실제 AI 응답.
- **5c-3:** 프론트엔드 AGENT 시각 구분 (코멘트 스타일 + 타임라인 강조).

## 목표

- ai-agent 가 4종 envelope (`issue.created` / `issue.assigned` /
  `issue.commented` / `issue.status_changed`) 을 type 별 핸들러로 분기
- 각 핸들러가 자기 type 에 맞는 한국어 acknowledgment 텍스트를 빌드
- `workplace-api client` 의 `addIssueComment(issueKey, body)` 본문 구현 —
  AGENT API key 로 인증된 POST 호출
- 5b-1 의 self-loop 필터(actor.kind==AGENT) 가 AGENT 의 코멘트로 인한 추가
  발사를 차단함을 실측 확인

## 비목표 (YAGNI / 5c-1 외)

- LLM / Claude Agent SDK / MCP 도구 → 5c-2
- `updateIssueStatus` client 본문 → 5c-2 (현재 throw 유지)
- AGENT 자기-unassign 권한 / workplace-api 권한 분기 변경 → 5c-2
- 프론트엔드 AGENT 시각 구분 → 5c-3
- Multi-AGENT 키 라우팅 (assignee 별 다른 키) → 후속
- ai-agent 측 재시도 / 큐 / DLQ → 후속
- 메트릭 / Prometheus → 후속

## 아키텍처

```
[workplace-api]
    │  POST /events {type, payload}  (5b-1, AFTER_COMMIT + @Async)
    ▼
[workplace-ai-agent  POST /events]
    │  envelope-only 검증 (스캐폴딩에서 완료)
    │  payload zod (discriminatedUnion 4 type) 재검증 ← 5c-1 신규
    │  type switch:
    │    case "issue.created":        handleIssueCreated(payload)
    │    case "issue.assigned":       handleIssueAssigned(payload)
    │    case "issue.commented":      handleIssueCommented(payload)
    │    case "issue.status_changed": handleIssueStatusChanged(payload)
    │  → 202 { received: true }
    ▼
[event-handler.ts — type 별 acknowledgment 텍스트 빌드]
    │  workplaceApi.addIssueComment(issueKey, ackText)
    ▼
[workplace-api client.addIssueComment]  ← 스캐폴딩 stub 의 본문 채움
    │  parseIssueKey(issueKey) → { projectKey, number }
    │  POST /api/v1/projects/{projectKey}/issues/{number}/comments
    │  X-Api-Key: {WORKPLACE_AGENT_API_KEY}
    │  body: { "body": "<ack 텍스트>" }
    ▼
[workplace-api  ApiKeyAuthenticationFilter → AGENT 권한 → IssueCommentService.create]
    │  코멘트 INSERT → IssueCommentedEvent 발행
    │  5b-1 dispatcher: actor.kind==AGENT → self-loop skip ✅
    ▼
[loop 차단됨 — 추가 발사 0]
```

## 의사결정 요약

| 결정 | 선택 | 이유 |
|---|---|---|
| 응답 종류 | 4종 envelope 모두에 acknowledgment 코멘트 | #30 본문 + 사용자 결정 |
| 응답 형태 | 단순 한국어 텍스트, 끝에 ` _(자동 응답)_` 접미사 | 5c-2 LLM 도입 시 접미사 제거 — 단계 식별 가능 |
| LLM | 없음 | 5c-2 로 분리 |
| workplace-api 변경 | **없음** | Phase 5a 의 ApiKeyAuthenticationFilter + 기존 endpoint 로 충분 |
| Self-loop 차단 | 5b-1 의 `actor.kind == AGENT` 필터로 이미 보장 | 추가 코드 없음 |
| HTTP 클라이언트 | 기존 axios instance 재사용 (스캐폴딩에서 생성) | 일관성 |
| 재시도 | 없음 | 5b-1 이 발사 재시도. 본 단계는 1회 시도, 실패는 로그만 |
| 인증 | `X-Api-Key: {WORKPLACE_AGENT_API_KEY}` (환경변수 단일 키) | Phase 5a 방식. Multi-AGENT 는 후속 |

## Type 별 acknowledgment 메시지

| Type | 메시지 |
|---|---|
| `issue.created` | `새 이슈 생성을 확인했습니다 — {issueKey} "{issueTitle}" _(자동 응답)_` |
| `issue.assigned` | `작업을 맡았습니다 — {issueKey}. 곧 진행하겠습니다. _(자동 응답)_` |
| `issue.commented` | `코멘트 확인했습니다 (by @{actor.username}): "{commentBody 처음 80자}" _(자동 응답)_` |
| `issue.status_changed` | `상태 변경 확인 — {previousStatus} → {newStatus} _(자동 응답)_` |

commentBody 가 80자를 초과하면 81자부터 `…` 으로 치환.

## 신규/수정 파일

### 신규

| 파일 | 책임 |
|---|---|
| `src/types/issue-events.ts` | 4 type 의 payload zod 스키마 + `issueEventEnvelope` discriminatedUnion + TS 타입 export |
| `src/agent/event-handler.ts` | 4 핸들러 함수 (`handleIssueCreated/Assigned/Commented/StatusChanged`). workplace-api client 를 인자로 받음 (DI) |
| `src/agent/event-handler.test.ts` | 4 type 의 ack 텍스트 + workplace-api 호출 검증 + commentBody truncate 검증 |
| `src/clients/workplace-api.test.ts` | nock 으로 POST 검증 (헤더·URL·body). updateIssueStatus 는 여전히 throw 검증. parseIssueKey 단위 검증 |

### 수정

| 파일 | 변경 |
|---|---|
| `src/routes/events.ts` | `envelopeSchema` 통과 후 `issueEventEnvelope.safeParse` 재검증. switch 의 4 case 추가, default → 400 unsupported_event_type |
| `src/clients/workplace-api.ts` | `addIssueComment` 본문 구현. `parseIssueKey` 헬퍼 export. `updateIssueStatus` 는 throw 유지 |
| `src/index.ts` | `createWorkplaceApiClient` 인스턴스 생성 → 라우터에 주입 |
| `src/routes/events.test.ts` | 기존 "알 수 없는 type" 케이스의 type 명을 `wiki.created` 등으로 교체 (이제 `issue.*` 는 지원됨). 신규 정상 케이스 추가 |

## Payload 검증 (zod discriminatedUnion)

`src/types/issue-events.ts`:

```ts
import { z } from 'zod';

const userSummary = z.object({
  id: z.number(),
  username: z.string(),
  kind: z.enum(['HUMAN', 'AGENT']),
});

const common = {
  projectKey: z.string(),
  issueKey: z.string(),
  issueId: z.number(),
  issueTitle: z.string(),
  actor: userSummary,
  assignees: z.array(userSummary),
  occurredAt: z.string(),
};

export const issueCreatedPayload = z.object({
  ...common,
  status: z.string(),
  priority: z.string(),
});

export const issueAssignedPayload = z.object({
  ...common,
  added: z.array(userSummary),
  removed: z.array(userSummary),
});

export const issueCommentedPayload = z.object({
  ...common,
  commentId: z.number(),
  commentBody: z.string(),
});

export const issueStatusChangedPayload = z.object({
  ...common,
  previousStatus: z.string(),
  newStatus: z.string(),
});

export const issueEventEnvelope = z.discriminatedUnion('type', [
  z.object({ type: z.literal('issue.created'),        payload: issueCreatedPayload }),
  z.object({ type: z.literal('issue.assigned'),       payload: issueAssignedPayload }),
  z.object({ type: z.literal('issue.commented'),      payload: issueCommentedPayload }),
  z.object({ type: z.literal('issue.status_changed'), payload: issueStatusChangedPayload }),
]);
```

`events.ts` 흐름:
1. envelope-only schema (`{type, payload: unknown}`) 통과 → type 추출
2. `issueEventEnvelope.safeParse` 시도
   - 통과: type 별 핸들러 호출 → 202
   - 실패 + type 이 `issue.*` 면: 400 `invalid_payload`
   - 실패 + type 이 unknown: 400 `unsupported_event_type`

## 이슈 식별 — `parseIssueKey`

`src/clients/workplace-api.ts` 에 헬퍼 export:

```ts
export function parseIssueKey(issueKey: string): { projectKey: string; number: number } {
  const idx = issueKey.lastIndexOf('-');
  const projectKey = issueKey.slice(0, idx);
  const number = Number(issueKey.slice(idx + 1));
  return { projectKey, number };
}
```

`lastIndexOf` 사용 — projectKey 자체에 하이픈이 있는 경우(`A-B-7` → `A-B`/7) 대응.

## `addIssueComment` 본문

```ts
async addIssueComment(issueKey, body) {
  const { projectKey, number } = parseIssueKey(issueKey);
  await http.post(
    `/projects/${projectKey}/issues/${number}/comments`,
    { body },
  );
}
```

axios instance 의 default header 에 이미 `X-Api-Key: {apiKey}` 설정. baseURL 은
`WORKPLACE_API_BASE_URL` (예: `http://localhost:9090/api/v1`).

## 에러 처리

- envelope schema 거부 → 400
- payload schema 거부 (알려진 type) → 400 `invalid_payload`
- 알 수 없는 type → 400 `unsupported_event_type`
- 핸들러 내 workplace-api 호출 실패 (4xx/5xx/network) → `console.error`,
  요청 자체는 202 `{ received: true }` 유지 (이벤트는 받았음)
- 핸들러 내 그 외 예외 → 전역 에러 핸들러 500

5c-1 단계에서 ai-agent 측 재시도는 추가하지 않는다 — workplace-api 가
즉시 응답한다는 전제. 진짜 실패는 운영자가 로그를 보고 처리.

## 환경변수

스캐폴딩에서 이미 정의된 변수를 사용. 추가 없음.

- `WORKPLACE_API_BASE_URL` (기본 `http://localhost:9090/api/v1`)
- `WORKPLACE_AGENT_API_KEY` (Phase 5a 에서 발급)
- `INTERNAL_SERVICE_TOKEN` (envelope 인증)

로컬에서 `WORKPLACE_AGENT_API_KEY` 는 admin UI 에서 AGENT 유저를 만들고 키를
발급해 받은 평문 (`ak_*`) 을 `.env.local` 에 넣는다.

## 테스트

### 1. `src/agent/event-handler.test.ts` (단위)

`workplace-api client` 를 `vi.fn` 으로 mock.

| # | 시나리오 | 기대 |
|---|---|---|
| 1 | `handleIssueCreated` → 코멘트 body 가 `새 이슈 생성을 확인했습니다 — WP-42 "분석"` 으로 시작 + 자동 응답 접미사 | addIssueComment 1회, issueKey=WP-42 |
| 2 | `handleIssueAssigned` → 코멘트 body 가 `작업을 맡았습니다 — WP-42` 시작 | addIssueComment 1회 |
| 3 | `handleIssueCommented` → 코멘트 body 에 actor.username + commentBody 앞 80자 포함 | addIssueComment 1회 |
| 4 | `handleIssueCommented` 의 commentBody 가 100자 → 80자 + `…` | substring 검증 |
| 5 | `handleIssueStatusChanged` → `TODO → IN_PROGRESS` 포함 | addIssueComment 1회 |

총 5 cases.

### 2. `src/clients/workplace-api.test.ts` (clients, nock)

| # | 시나리오 | 기대 |
|---|---|---|
| 1 | `addIssueComment('WP-42', '안녕')` → POST `/api/v1/projects/WP/issues/42/comments` body `{body:"안녕"}` + `X-Api-Key: <key>` 헤더 | nock 일치 |
| 2 | `updateIssueStatus` 호출 → 여전히 throw `not implemented` | rejects |
| 3 | `parseIssueKey('WP-42')` → `{projectKey: 'WP', number: 42}` | 직접 검증 |
| 4 | `parseIssueKey('A-B-7')` → `{projectKey: 'A-B', number: 7}` | lastIndexOf 정책 |

총 4 cases.

### 3. `src/routes/events.test.ts` (기존 갱신 + 추가)

기존 "알 수 없는 type → 400" 의 type 명을 `wiki.created` 로 교체 (이제 `issue.*` 는 지원됨).

추가:
| # | 시나리오 | 기대 |
|---|---|---|
| 6 | `issue.created` 정상 envelope → 202 + handler 1회 호출 | event-handler 모킹 |
| 7 | `issue.assigned` payload 의 `added` 누락 → 400 `invalid_payload` | discriminatedUnion 거부 |

총 갱신 1 + 신규 2 = 5 cases (기존 events 5개 중 4개 그대로 + 1개 갱신 + 2개 추가).

### 4. 통합 (수동)

workplace-api 변경 0이라 자동화 통합 추가 X. 대신 DoD 의 end-to-end 수동 단계로 검증.

## 완료 기준 (DoD)

- 신규 파일 4개, 수정 파일 4개 (위 표)
- vitest 통과:
  - 스캐폴딩 단계 10 (auth 5 + health 1 + events 4) 유지 — events 1개 갱신
  - 신규 event-handler 5 + workplace-api client 4 + events 추가 2 = 11
  - 총 약 21 PASS (정확한 수는 implementer 가 보고)
- `pnpm --filter @smart-workplace/workplace-ai-agent lint typecheck test build` 모두 통과
- workplace-api 회귀 없음 (`./gradlew test` 통과)
- 루트 `pnpm test` (turbo) 통과
- 수동 end-to-end:
  1. workplace-api 9090 기동, AGENT 유저 + API key 발급
  2. workplace-ai-agent 7070 기동 (`WORKPLACE_AGENT_API_KEY=<발급한 키>`)
  3. workplace-web 에서 AGENT 를 assignee 로 한 이슈 생성
  4. 이슈 상세 새로고침 → AGENT 가 단 acknowledgment 코멘트 가시
  5. 사용자가 코멘트 추가 → AGENT 의 응답 코멘트 또 보임
  6. self-loop 차단: AGENT 코멘트로 추가 코멘트 발생 안 함

## 영향 범위

- 추가: ai-agent 의 types/issue-events + agent/event-handler + 2 신규 테스트
- 수정: ai-agent 의 events.ts / workplace-api.ts / index.ts / events.test.ts
- workplace-api: **변경 없음**
- workplace-web: **변경 없음**
- DB 마이그레이션: **없음**

## 의존성

- Phase 5a (AGENT 유저 + API key) — 완료
- workplace-ai-agent 스캐폴딩 (envelope 수신 + client stub) — 완료
- Phase 5b-1 (이슈 이벤트 발사) — 완료. 본 epic 이 그 수신 측을 채움

## 후속

- **Phase 5c-2**: Claude Agent SDK + MCP 도구 + 실제 LLM 응답 + status 변경 + 자기-unassign
- **Phase 5c-3**: 프론트엔드 AGENT 시각 구분 (코멘트 / 타임라인)

## 커밋

단일 commit, 한국어 메시지:
```
feat(ai-agent): 이슈 이벤트 핸들러 + workplace-api 코멘트 응답 — #30 (5c-1)
```

push 는 사용자 명시적 승인 후. #30 close 는 5c-2/5c-3 완료 시점에 결정 — 본 epic 만으로는 #30 의 의도가 미완성이라 그대로 open 유지.
