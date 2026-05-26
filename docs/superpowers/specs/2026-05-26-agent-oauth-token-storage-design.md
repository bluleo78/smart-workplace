# AGENT OAuth 토큰 DB 저장 + 관리 UI — 설계 (#33)

> issue: #33
> 작성일: 2026-05-26
> 의존: #30 (5c-2) — Claude CLI + 구독 토큰 흐름 완료

## 배경

5c-2 에서 ai-agent 는 `claude` CLI 가 호스트의 `~/.claude/credentials.json` (또는 OS 키체인) 에서 토큰을 자동으로 읽는 방식을 채택했다. 이 모델의 한계:

- **호스트 환경 의존**: Docker / CI 에서 `~/.claude/` 가 비어있으면 동작 불가
- **multi-AGENT 분리 불가**: 모든 AGENT 가 같은 호스트 토큰 공유
- **관리·로테이션이 호스트 명령으로만**: 운영 화면 외부 절차
- **표준 자격증명 관리와 분리**: workplace-api 의 다른 비밀 (encryption master key 등) 과 일관성 없음

## 목표

AGENT 별 OAuth 토큰을 workplace-api DB 에 암호화 저장한다. workplace-web UI 로 관리자가 등록·회수한다. ai-agent 는 매 LLM spawn 시 workplace-api 에 자기 API key 로 자기 토큰을 fetch 해 `claude` child env 에 주입한다.

## 비목표 (YAGNI)

- 토큰 expiry 추적 / 자동 갱신 (Anthropic CLI 토큰은 무기한)
- 다중 active 토큰 / rolling (AGENT 당 1개로 단순화)
- ai-agent 측 캐시 (부하 측정 후 후속)
- UI 에서 "test now" 검증 버튼
- 환경변수 override 경로 (`CLAUDE_CODE_OAUTH_TOKEN` env var) — DB 가 단일 진실
- 호스트 `~/.claude/` fallback — 본 epic 에서 제거 (단일 진실 원칙)
- API key 같이 SHA-256 hash 저장 (CLI 가 평문을 받아야 해서 복호화 필요)

## 의사결정 요약

| 결정 | 선택 | 이유 |
|---|---|---|
| 저장 위치 | 신규 `ai_agent_credential` 테이블 | multi-token 유연 (rolling 등 후속). `agent_api_key` 와 같은 라이프사이클 컬럼 패턴 차용 |
| Active 정책 | AGENT 당 active 1개 (partial unique index) | 단순. DB 는 history 유지 (revoke 이력) |
| 암호화 | 기존 `EncryptionService` (AES-256-GCM) | `app.encryption.master-key` 재사용 |
| 권한 | `agent:manage` (5a 의 키 발급 권한) | 토큰 관리도 AGENT 관리 일부 |
| fetch endpoint | `GET /api/v1/users/me/oauth-token` (AGENT 본인 API key) | 권한 최소. ai-agent 가 admin 권한 불필요 |
| ai-agent 호출 시점 | 매 spawn 마다 1회 fetch | 즉시 반영, 단순. 캐시는 후속 |
| `~/.claude/` fallback | 본 epic 안에서 완전 제거 | 자격증명 단일 진실. env var 우회 경로도 폐기 |
| label 필드 | nullable VARCHAR(80) | `agent_api_key` 와 일관 |

## 데이터 모델

### V15 마이그레이션 (`V15__agent_oauth_credential.sql`)

```sql
-- Phase 5c-2 후속(#33): AGENT 의 Claude CLI OAuth 토큰 암호화 저장.
-- agent_api_key 와 같은 라이프사이클 (label / created_by / revoked_at / last_used_at)
-- 을 따르되, 인증용이 아니라 복호화해서 child process 에 넘기는 자격증명이라
-- key_hash 대신 encrypted_token 을 둔다.

CREATE TABLE ai_agent_credential (
  id               BIGSERIAL PRIMARY KEY,
  user_id          BIGINT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  encrypted_token  TEXT   NOT NULL,                     -- 'iv:ciphertext' (EncryptionService)
  label            VARCHAR(80),
  created_by       BIGINT NOT NULL REFERENCES "user"(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at     TIMESTAMPTZ,
  revoked_at       TIMESTAMPTZ
);

CREATE INDEX idx_aac_user ON ai_agent_credential(user_id);

-- 한 AGENT 당 active(=revoked_at IS NULL) 행은 최대 1 개
CREATE UNIQUE INDEX uq_aac_active
  ON ai_agent_credential(user_id) WHERE revoked_at IS NULL;
```

DB 측 제약으로 active 1개 보장 — application 분기 실수가 데이터 정합성을 깨지 않게.

## 백엔드 (workplace-api)

### 신규 도메인

| 파일 | 책임 |
|---|---|
| `AiAgentCredentialRow.java` (record) | jOOQ DTO — `id, userId, encryptedToken, label, createdBy, createdAt, lastUsedAt, revokedAt` |
| `AiAgentCredentialRepository.java` | jOOQ — `findActive(userId)`, `insert(userId, encrypted, label, createdBy)`, `revokeActive(userId)`, `touchLastUsed(id, now)` |
| `AiAgentCredentialService.java` | `register(adminId, agentUserId, plaintext, label)` — AGENT 검증 + revoke 기존 + encrypt + insert. `revoke(adminId, agentUserId)`. `findActiveMeta(agentUserId)` — 메타만. `redeemSelf(agentUserId)` — 복호화 + touch + 반환 |
| `OAuthTokenRegisterRequest.java` (dto) | `{token: String, label: String?}` |
| `OAuthTokenMetaResponse.java` (dto) | `{label: String?, createdAt: Instant, lastUsedAt: Instant?}` |
| `OAuthTokenRedeemResponse.java` (dto) | `{token: String, label: String?}` |
| `OAuthTokenNotFoundException.java` | active 토큰 없음 → 404 |
| `AdminOAuthTokenController.java` | `@RequirePermission("agent:manage")`. POST/DELETE/GET 3개 |
| `MyOAuthTokenController.java` | API key 인증. AGENT 본인 GET 1개 |

### Endpoint 명세

| 메서드 | 경로 | 권한 | 요청 | 응답 |
|---|---|---|---|---|
| POST | `/api/v1/admin/users/{agentId}/oauth-token` | `agent:manage` | `{token, label?}` | 201 `OAuthTokenMetaResponse`. 기존 active 자동 revoke |
| DELETE | `/api/v1/admin/users/{agentId}/oauth-token` | `agent:manage` | — | 204. 없으면 204 (idempotent) |
| GET | `/api/v1/admin/users/{agentId}/oauth-token` | `agent:manage` | — | 200 `OAuthTokenMetaResponse` 또는 404. 평문 토큰 절대 미반환 |
| GET | `/api/v1/users/me/oauth-token` | API key (AGENT 본인) | — | 200 `OAuthTokenRedeemResponse` (평문 포함) 또는 404 |

### 예외 매핑

| 예외 | 상태 | 비고 |
|---|---|---|
| `KeyTargetMustBeAgentException` (기존 5a 재사용) | 400 | admin endpoint 의 `agentId` 가 HUMAN |
| `OAuthTokenNotFoundException` (신규) | 404 | active 토큰 없음. admin GET / `/users/me/oauth-token` 둘 다 |
| `UserNotFoundException` (기존) | 404 | `agentId` 가 존재하지 않는 user |

`/users/me/oauth-token` 의 caller 가 HUMAN 이면 — 의도적으로 404 (HUMAN 은 토큰 없음, 권한 누설 회피).

### 비밀 처리 규칙

- 평문 토큰은 (a) POST body, (b) `EncryptionService.encrypt` 입력, (c) `redeemSelf` 의 응답 — 그 외 어디에도 노출 금지
- 로그·예외 메시지에 토큰 일부도 포함 금지 (`token.substring(0,8)` 같은 prefix log 도 금지)
- access log / metrics 에 응답 본문 미포함 (Spring 기본 동작 — 확인만)
- 컨트롤러 인자는 `@JsonIgnore` 가 아니라 — request body 는 short-lived, 처리 후 GC
- `OAuthTokenMetaResponse` 의 toString() 은 안전 (token 없음)

### 토큰 형식 검증

POST 의 `token` 필드:
- `@NotBlank`
- 최소 길이 32 (Anthropic OAuth 토큰은 길지만 정확한 prefix/format 은 미공개 — 길이로만 sanity)
- 최대 길이 2048 (잘못 붙여넣기 방지)
- 추가 prefix 검증 (`sk-ant-` 등) 은 비목표 — 형식 바뀌면 깨짐

## ai-agent

### 신규

| 파일 | 책임 |
|---|---|
| (없음) | 기존 `clients/workplace-api.ts` 에 메서드 추가 + `agent/run-agent.ts` 갈아끼움 |

### 수정

| 파일 | 변경 |
|---|---|
| `src/clients/workplace-api.ts` | `getMyOAuthToken(): Promise<{token: string, label: string|null}>` 추가. interface 에도 추가. nock 테스트 동반 |
| `src/agent/cli-runner.ts` | `buildChildEnv(parent, token: string)` — token 인자 필수. `child.env.CLAUDE_CODE_OAUTH_TOKEN = token` 명시 주입. 호스트 env 의 `CLAUDE_CODE_OAUTH_TOKEN` 은 `delete` (1순위 단일화) |
| `src/agent/run-agent.ts` | spawn 직전 `client.getMyOAuthToken()` 호출 → 실패 시 `console.error` + return (envelope drop). 성공 시 token 을 `buildChildEnv` 에 넘김 |
| `src/agent/run-agent.test.ts` | client mock 추가, fetch 실패 시 spawn 안 함 케이스, 성공 시 token 이 env 로 전달되는 케이스 |
| `src/agent/cli-runner.test.ts` | `buildChildEnv` 시그니처 변경 반영. token 주입 + 호스트 env 무시 검증 |
| `.env.example` | `CLAUDE_CODE_OAUTH_TOKEN` 라인 완전 제거. 코멘트만 "DB 에 등록됨" 안내 |
| `CLAUDE.md` | 환경변수 표에서 `CLAUDE_CODE_OAUTH_TOKEN` 행 삭제. "토큰은 workplace-web 의 AGENT 관리 화면에서 등록" 으로 갱신 |

`run-agent.ts` 의 핵심 흐름:
```ts
export async function runAgent(env: IssueEventEnvelope, deps: { client: WorkplaceApiClient }): Promise<void> {
  let token: string;
  try {
    const credential = await deps.client.getMyOAuthToken();
    token = credential.token;
  } catch (e) {
    console.error('[run-agent] OAuth 토큰 fetch 실패 — spawn 생략', {
      type: env.type, issueKey: env.payload.issueKey, error: msgOf(e),
    });
    return;
  }
  // ... 기존 buildCliArgs / buildChildEnv(process.env, token) / runClaudeCli
}
```

`event-handler.ts` 는 `runAgent(env, { client })` 시그니처로 호출 — index.ts 에서 client 주입.

### index.ts

- `WORKPLACE_AGENT_API_KEY` 는 그대로 REQUIRED (workplace-api 호출에 필수)
- `client = createWorkplaceApiClient(...)` 가 다시 main process 에 등장 — 5c-2 에서 mcp child 로 옮겼지만, run-agent 가 fetch 하려면 main 에도 client 가 필요. mcp child 는 자기 client 별도 인스턴스 (격리 유지)

## 프론트엔드 (workplace-web)

### 수정

| 파일 | 변경 |
|---|---|
| `src/api/agents.ts` | `getAgentOAuthTokenMeta`, `registerAgentOAuthToken`, `revokeAgentOAuthToken` 3 함수 |
| `src/hooks/queries/useAgentOAuthToken.ts` (신규) | TanStack Query `useQuery` (meta) + `useMutation` (register / revoke) |
| `src/types/agentKey.ts` 또는 신규 `agentOAuthToken.ts` | `OAuthTokenMeta` 타입 |
| `src/pages/admin/AgentManagementPage.tsx` | 선택된 AGENT 상세 패널에 "Claude CLI OAuth 토큰" 섹션 추가 |
| `src/pages/admin/components/OAuthTokenDialog.tsx` (신규) | 등록 모달. token (textarea, masked-after-paste) + label (input) + 안내문구 |

UI 영역 형태 (텍스트 mockup):
```
┌─ Claude CLI OAuth 토큰 ─────────────────────────┐
│ 등록됨:  2026-05-26 11:23 (label: "main")        │
│ 최근 사용: 2026-05-26 11:34                       │
│                                                  │
│ [재발급]  [회수]                                  │
└──────────────────────────────────────────────────┘
```

미등록 상태:
```
┌─ Claude CLI OAuth 토큰 ─────────────────────────┐
│ 등록된 토큰 없음. AGENT 는 LLM 호출 불가.        │
│                                                  │
│ [등록]                                            │
└──────────────────────────────────────────────────┘
```

Dialog:
- 안내문구: "호스트에서 `claude setup-token` 으로 발급한 토큰을 붙여넣으세요. 이 토큰은 저장 후 다시 표시되지 않습니다."
- token textarea (모노스페이스, autoComplete=off, spellCheck=false)
- label 입력란 (선택)
- 버튼: 취소 / 등록
- 등록 후 토스트 "OAuth 토큰이 저장되었습니다."

### 권한

- 관리자 (`agent:manage` 권한) 만 화면 접근 — 기존 `AgentManagementPage` 의 권한 가드 그대로 적용
- 평문 토큰은 등록 직후 1회 입력 → 응답에 반환 안 됨 → 화면에서도 재표시 불가

## 테스트

### 백엔드 (필수)

- `AiAgentCredentialServiceTest` (통합):
  1. AGENT 에 신규 등록 → DB 1행 active
  2. 같은 AGENT 에 재등록 → 기존 revoked, 신규 active (active 행 1개)
  3. HUMAN 에 등록 시도 → `KeyTargetMustBeAgentException`
  4. revoke → active 0
  5. revoke 후 또 revoke (idempotent) → 예외 없음, active 0
  6. `redeemSelf` 평문 복호화 정확 + `last_used_at` 갱신
- `AdminOAuthTokenControllerTest`:
  1. 권한 없는 사용자 → 403
  2. POST 200 + DB row + 응답에 평문 토큰 없음
  3. GET admin → 메타만 (토큰 없음)
  4. DELETE → 204 + DB revoked
- `MyOAuthTokenControllerTest`:
  1. HUMAN API key → 404
  2. 토큰 등록 안 한 AGENT → 404
  3. 등록한 AGENT → 200 + 평문 토큰 일치 + `last_used_at` 갱신

### ai-agent

- `clients/workplace-api.test.ts` — `getMyOAuthToken` nock 케이스 1개 (정상) + 404 케이스 1개 (throw 검증)
- `agent/cli-runner.test.ts` — `buildChildEnv(parent, 'tk-X')` 가 (a) `CLAUDE_CODE_OAUTH_TOKEN=tk-X`, (b) parent 의 같은 키는 무시, (c) `ANTHROPIC_API_KEY` 제거 확인
- `agent/run-agent.test.ts` — client mock 으로 (a) token fetch 성공 시 spawn 호출, (b) fetch 실패 시 spawn 미호출 + 에러 로그

### 프론트엔드

- `OAuthTokenDialog.test.tsx` — 입력·제출·에러 토스트 케이스
- `AgentManagementPage.test.tsx` 의 OAuth 섹션 영역 — 등록/미등록 분기 렌더, revoke 동작
- 시각 회귀 / playwright 는 본 epic 비목표 (감수성 ↓)

### 수동 e2e (필수)

1. 호스트에서 `claude setup-token` → 토큰 텍스트 복사
2. workplace-web 관리 화면 → AGENT 선택 → OAuth 토큰 등록 → 토스트 확인
3. 메타 영역에 created_at / label 노출, 평문 미노출 확인
4. workplace-web 에서 AGENT 를 담당자로 한 이슈 생성
5. ai-agent 로그에서 fetch 1회 + spawn 1회 확인 (`[run-agent]` prefix)
6. 이슈 상세에 LLM 응답 코멘트 노출
7. UI 에서 토큰 회수 → 이후 이벤트는 ai-agent 로그 "fetch 실패 — spawn 생략"
8. 회수 후 같은 토큰으로 재등록 → 정상 동작 복귀

## 위험

| # | 위험 | 완화 |
|---|---|---|
| 1 | 매 spawn 마다 fetch — workplace-api 부하 | 이벤트 빈도 낮음. 캐시 추가는 후속 epic |
| 2 | 토큰 평문이 ai-agent 메모리에 거주 | spawn 직후 변수 nullify. 일반 자격증명 위험과 동일 |
| 3 | revoke 후 in-flight LLM 호출 | child 는 자기 환경 토큰으로 끝까지 진행. 다음 spawn 부터 fetch 단계에서 차단 |
| 4 | 잘못 붙여넣기 (공백 trailing 등) | `token.trim()` 서버 측 적용 + 길이 검증 |
| 5 | 5c-2 push 후 호스트 `~/.claude/` 사용 중인 환경의 회귀 | 본 epic 작업 전엔 동작, 본 epic 머지 후 토큰 미등록 AGENT 는 동작 불가 — UI 등록 절차 안내 |
| 6 | `agent_api_key` 와 lifecycle 비대칭 (해시 vs 암호화) | DB 레벨에서는 컬럼 1개 차이뿐, application 에서 명확히 분리 |
| 7 | 다른 환경의 EncryptionService master key 불일치 → 복호화 실패 | 기존 비밀과 같은 위험. 운영 절차 동일 |

## 완료 기준 (DoD)

- V15 마이그레이션 + 신규 도메인·controller·dto·exception 모두 통합 테스트 통과
- workplace-web AGENT 관리 화면에서 등록·회수·재발급 UX 동작
- ai-agent 가 `~/.claude/` 의존 없이 매 spawn 시 workplace-api 에서 fetch 해 동작 (env var override 불가)
- `pnpm test` (workplace-ai-agent + workplace-web) + `./gradlew test` (workplace-api) 통과
- 수동 e2e 8 단계 통과
- 5c-2 의 `CLAUDE_CODE_OAUTH_TOKEN` 환경변수 / `~/.claude/` 의존 코드 모두 제거 (코드 + 문서)

## 영향 범위

- workplace-api: V15 + auth/agent 모듈에 OAuth 토큰 도메인 추가 (controller/service/repository/dto/exception)
- workplace-ai-agent: client 확장 + run-agent / cli-runner 시그니처 변경 + index 의 client 다시 main process 에 + 환경변수·문서 정리
- workplace-web: AgentManagementPage 의 OAuth 섹션 + Dialog + api/hook
- DB: 1개 신규 테이블
- Dockerfile: 변경 없음 (`~/.claude/` 마운트도 불필요해짐)

## 의존성

- #30 (5c-2) ✅ — Claude CLI + 구독 토큰 흐름 완료
- 5a (AGENT 유저 + API key 발급) ✅

## 후속

- ai-agent 토큰 캐시 (TTL 또는 부트 1회)
- 토큰 expiry / 자동 갱신 (Anthropic 정책 변경 시)
- AGENT 별 다중 token (rolling 또는 staging/prod 분리)
- UI "토큰 검증" 버튼 (LLM 핑)

## 커밋

본 epic 은 백엔드 + ai-agent + 프론트 3 면 변경. 가능하면 단일 commit:
```
feat: AGENT OAuth 토큰 DB 저장 + 관리 UI — #33
```

크기가 크면 (가능성 있음) 백엔드 / ai-agent / 프론트 3 commit 분할 허용. 단 동일 PR.

push 는 사용자 명시적 승인 후. #33 close 는 수동 e2e 통과 후.
