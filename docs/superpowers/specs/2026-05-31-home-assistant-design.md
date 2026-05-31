# 홈 AI 비서(Assistant) 지정 방식 재설계

> **상태:** 설계 승인됨 (브레인스토밍 완료) — 구현 플랜은 별도 작성.
> **배경 이슈:** #50 후속. 홈 compose 의 LLM 인증 AGENT 를 ai-agent 환경변수
> `WORKPLACE_HOME_COMPOSER_AGENT_ID` 로 박던 방식이 브리틀(배포 환경마다 수동 설정,
> 코드/DB 결합)하여 폐기하고, 데이터로 관리되는 "비서" 개념으로 재설계한다.

---

## 1. 문제와 목표

### 현재 (문제)
홈 화면 compose(할 일·조언·위젯 구성)는 Claude LLM 을 호출하며, 이때 인증에 쓸
OAuth 토큰을 가진 AGENT 를 ai-agent 가 **환경변수**
`WORKPLACE_HOME_COMPOSER_AGENT_ID=<db agent user id>` 로 지정받는다.

- 배포 환경마다 DB 의 agent id 를 수동으로 env 에 박아야 함 (운영 브리틀).
- "어떤 AI 가 홈을 담당하는가"가 코드/배포 설정에 묻혀 있어 가시성·변경성이 없음.
- 사용자가 자신의 AI(자신의 Claude 토큰)를 홈 비서로 쓰고 싶어도 불가능.
- 모델·생각의 깊이 같은 튜닝도 전역 env(`WORKPLACE_AI_MODEL` 등) 로만 가능 — 전사 1세트.

### 목표
홈을 담당하는 AI를 **"비서(Assistant)"** 라는 1급 개념으로 끌어올린다.

- **공용 비서(Workspace Assistant):** 워크스페이스에 1개. 관리자가 설정으로 지정. 기본값.
- **개인 비서(Personal Assistant):** 사용자별 선택. 본인 Claude 토큰(BYO)으로 동작.
  개인 비서가 있으면 그 사용자의 홈은 공용 대신 개인 비서가 담당.
- 두 비서 모두 **모델·생각의 깊이** 등 튜닝 설정을 가짐 (디폴트 존재, 비서별 override).
- ai-agent 의 `WORKPLACE_HOME_COMPOSER_AGENT_ID` env 제거.

---

## 2. 핵심 개념 모델

**비서(Assistant) = 어떤 AGENT 에 부여된 "홈을 총괄하는 역할"** + 그 AGENT의 튜닝 설정.

- 비서는 단순 컴포저가 아니라 홈의 할 일/조언/위젯을 총괄하는 역할 → 용어를
  `composer` → **`assistant`/비서** 로 통일.
- 공용·개인 비서 **둘 다 AGENT 개념**. 따라서 "지정(누가 비서냐)"과 "튜닝(어떻게
  동작하냐)"을 모두 *agent_user_id* 기준으로 일관되게 다룬다.

### 해석 우선순위 (caller = 홈을 요청한 사람)
```
1. 개인 비서  : caller 에게 personal_assistant_agent_id 가 있고, 그 AGENT 에 active 토큰이 있으면 → 사용
2. 공용 비서  : 아니면, workspace_assistant 가 지정돼 있고 그 AGENT 에 active 토큰이 있으면 → 사용
3. 명확 에러  : 둘 다 없으면 → "홈 비서가 아직 설정되지 않았어요…" (제네릭 500/502 금지)
```

---

## 3. 데이터 모델 (마이그레이션 V18)

기존 패턴(V14 user.kind / V15 ai_agent_credential)을 그대로 따른다.

### 3.1 공용 비서 지정 — `workspace_assistant` (단일 행)
```sql
CREATE TABLE workspace_assistant (
  id              SMALLINT     PRIMARY KEY DEFAULT 1,
  agent_user_id   BIGINT       NOT NULL REFERENCES "user"(id),
  updated_by      BIGINT       NOT NULL REFERENCES "user"(id),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT workspace_assistant_singleton CHECK (id = 1)
);
```
- 워크스페이스에 1개만 존재(싱글톤). 관리자가 AGENT 를 지정/변경.
- `agent_user_id` 는 kind='AGENT' 여야 함 (application 에서 검증).

### 3.2 개인 비서 지정 — `user.personal_assistant_agent_id`
```sql
ALTER TABLE "user"
  ADD COLUMN personal_assistant_agent_id BIGINT REFERENCES "user"(id);
```
- NULL 이면 개인 비서 없음(→ 공용으로 폴백).
- 가리키는 대상은 그 사용자 전용으로 **자동 생성된 개인 AGENT** (3.4 참조).

### 3.3 비서 튜닝 — `assistant_config` (agent 단위, 공용·개인 공통)
```sql
CREATE TABLE assistant_config (
  agent_user_id   BIGINT       PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  model           VARCHAR(64),                 -- NULL = 시스템 디폴트(claude-sonnet-4-6)
  thinking_depth  VARCHAR(16),                 -- NULL = 'NORMAL'. 'NONE'|'NORMAL'|'DEEP'
  max_turns       INT,                         -- NULL = 디폴트(8). v1 UI 미노출(확장 여지)
  timeout_ms      INT,                         -- NULL = 디폴트(60000). v1 UI 미노출
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT assistant_config_thinking_depth_check
    CHECK (thinking_depth IS NULL OR thinking_depth IN ('NONE','NORMAL','DEEP'))
);
```
- 공용·개인 비서 모두 결국 *agent_user_id* 를 가리키므로 **한 테이블로 둘 다 커버**.
- 모든 컬럼 nullable → NULL 은 "시스템 디폴트 사용". 부분 override 허용.
- **생각의 깊이(thinking_depth)** 3단계: `NONE`(없음) / `NORMAL`(보통, 기본) / `DEEP`(깊게).
  ai-agent 에서 Claude 확장 사고(thinking) 예산으로 매핑(4.3).

### 3.4 개인 AGENT 자동 프로비저닝
사용자가 개인 비서를 처음 설정(토큰 등록)할 때:
1. 그 사용자 전용 개인 AGENT user 1개 생성 (kind='AGENT', 로그인 불가, password NULL).
   - 식별 가능한 라벨(예: `{사용자명}의 개인 비서`).
2. `user.personal_assistant_agent_id` 를 그 AGENT 로 설정.
3. 등록한 토큰을 그 AGENT 의 `ai_agent_credential` (active 1개) 로 저장.
- 이후 토큰 교체/모델/생각의 깊이 변경은 같은 개인 AGENT 에 대해 수행.
- 개인 비서 해제 시: 토큰 revoke + `personal_assistant_agent_id` NULL (개인 AGENT row 는
  보존 — 재설정 시 재사용, 감사 추적 유지).

---

## 4. 백엔드 (workplace-api)

### 4.1 AssistantResolver — 해석기
신규 `home`(또는 `ai`) 모듈 서비스. caller 기준으로 어떤 비서가 홈을 담당할지 해석.

```
AssistantSpec resolve(long callerId):
  1. caller.personal_assistant_agent_id 가 있고, 그 AGENT 에 active credential 있으면 → 개인
  2. 아니면 workspace_assistant.agent_user_id 에 active credential 있으면 → 공용
  3. 아니면 throw HomeAssistantNotConfiguredException("홈 비서가 아직 설정되지 않았어요. 관리자에게 문의해주세요.")

AssistantSpec = {
  agentUserId : long,          // ai-agent 가 이 AGENT 의 토큰을 X-On-Behalf-Of 로 가져감
  model       : String,        // assistant_config.model ?? DEFAULT_MODEL
  thinkingDepth : enum,        // assistant_config.thinking_depth ?? NORMAL
  maxTurns    : int,           // ?? 8
  timeoutMs   : int,           // ?? 60000
}
```
- 디폴트 상수는 api 측에 1곳(예: `AssistantDefaults`)에 둔다 (ai-agent 디폴트와 일치 유지).

### 4.2 compose 요청 확장
`ComposeMessages.ComposeRequest` 에 비서 지정·튜닝을 실어 보낸다.

```
ComposeRequest(
  query: String,
  recentContext: List<ContextMessage>,
  assistantAgentId: long,      // 신규 — ai-agent 가 토큰 조회에 사용
  model: String,               // 신규
  thinkingDepth: String,       // 신규 ('NONE'|'NORMAL'|'DEEP')
  maxTurns: int,               // 신규
  timeoutMs: int               // 신규
)
```
- `HomeComposeService.compose()` 흐름: 세션 ensure → recentContext →
  **`assistantResolver.resolve(callerId)` → AssistantSpec** → USER 영속 →
  `composeClient.compose(request with spec)` → ASSISTANT 영속.
- `HomeAssistantNotConfiguredException` 은 GlobalExceptionHandler 에서 503 + 명확 메시지
  (기존 `HomeComposeUnavailableException` 과 동일 정책 — #50 에서 셋업된 핸들러 재사용/확장).

### 4.3 개인 비서 self-service 엔드포인트 (사용자 본인)
프로필에서 본인이 개인 비서를 관리. 인증 = 일반 JWT(본인).

| 메서드 | 경로 | 동작 |
|--------|------|------|
| `GET`    | `/api/v1/users/me/assistant`        | 개인 비서 상태(있음/없음, 토큰 라벨·마지막사용, model, thinking_depth) 조회 |
| `PUT`    | `/api/v1/users/me/assistant/token`  | 토큰 등록/교체 (없으면 개인 AGENT 자동 프로비저닝). **토큰 평문은 본인이 입력 — Claude 가 대신 입력 금지** |
| `PUT`    | `/api/v1/users/me/assistant/settings` | model / thinking_depth 변경 (assistant_config upsert) |
| `DELETE` | `/api/v1/users/me/assistant`        | 개인 비서 해제 (토큰 revoke + personal_assistant_agent_id NULL) |

- 토큰 저장은 `EncryptionService` + `ai_agent_credential` (active 1개 unique 인덱스).
- 응답에 토큰 평문/암호문 절대 미포함 (라벨·메타만).

### 4.4 공용 비서 admin 엔드포인트 (관리자)
기존 admin/agent 권한 체계(`@RequirePermission`) 사용.

| 메서드 | 경로 | 동작 |
|--------|------|------|
| `GET`  | `/api/v1/admin/workspace-assistant`          | 공용 비서(지정 AGENT, model, thinking_depth) 조회 |
| `PUT`  | `/api/v1/admin/workspace-assistant`          | 공용 비서 AGENT 지정/변경 (kind='AGENT' 검증, active 토큰 권장 경고) |
| `PUT`  | `/api/v1/admin/workspace-assistant/settings` | model / thinking_depth 변경 |

---

## 5. ai-agent (workplace-ai-agent)

### 5.1 env 제거
`run-home-compose.ts` 의 `process.env.WORKPLACE_HOME_COMPOSER_AGENT_ID` 읽기 제거.
전역 `WORKPLACE_AI_MODEL` / `MAX_TURNS` / `TIMEOUT_MS` override 도 제거(비서 설정으로 대체).
`HomeComposerNotConfiguredError`(503) 분기는 제거 — api 가 미설정을 책임지므로 도달 불가.

### 5.2 요청에서 비서 받기
`routes/home.ts` 의 `composeSchema` 에 신규 필드 추가:
```
assistantAgentId: z.number().int().positive(),
model: z.string().min(1),
thinkingDepth: z.enum(['NONE','NORMAL','DEEP']),
maxTurns: z.number().int().positive(),
timeoutMs: z.number().int().positive(),
```
- 토큰 조회: 기존 흐름대로 api `/users/me/oauth-token` 를 `X-On-Behalf-Of: {assistantAgentId}`
  헤더로 호출해 그 AGENT 의 OAuth 토큰을 받아 child `claude` CLI 인증에 사용.

### 5.3 생각의 깊이 → CLI thinking 예산 매핑
`cli-runner` 에 thinking 예산 인자 추가. (정확한 CLI 플래그/SDK 옵션은 구현 시 확정;
없으면 모델 선택과 max_turns 로만 근사.)
```
NONE   → 확장 사고 비활성 (또는 최소)
NORMAL → 중간 thinking 예산 (기본)
DEEP   → 높은 thinking 예산
```
- 디폴트 상수는 ai-agent 에도 두되, api 가 항상 채워 보내므로 실제로는 fallback.

### 5.4 네이밍
`compose`(홈 위젯 구성) 동작 자체는 유지하되, "composer = 홈 담당 AI" 라는 의미의
식별자·주석·로그는 `assistant`/비서 로 정리. (compose 라우트 경로 `/home/compose` 는
동작명이므로 유지 — 호환성.)

---

## 6. 프론트엔드 (workplace-web)

### 6.1 개인 비서 — 프로필(`/profile`)
"개인 비서" 섹션 추가:
- 상태: 미설정 / 설정됨(토큰 라벨·마지막 사용 시각).
- 토큰 등록/교체 다이얼로그 (기존 admin `OAuthTokenDialog` 패턴 참고). **사용자 본인 입력.**
- 모델 선택(드롭다운, 디폴트 표시) + 생각의 깊이(없음/보통/깊게, 디폴트 표시).
- 해제 버튼.
- 안내 문구: "개인 비서를 설정하면 홈을 공용 비서 대신 내 비서가 담당해요."

### 6.2 공용 비서 — admin(`/admin/agents` 또는 신규 설정 화면)
- 공용 비서로 쓸 AGENT 선택 + 모델/생각의 깊이 설정.
- 지정 AGENT 에 active 토큰이 없으면 경고 표시.

### 6.3 홈 동작
홈 compose 흐름 자체는 변경 없음(요청/응답 스키마는 api 내부 처리). 단, 비서 미설정 시
api 503 → 기존 #50 에러 UX(명확 토스트) 가 그대로 노출됨.

---

## 7. 에러 처리

| 상황 | 응답 | 사용자 메시지 |
|------|------|---------------|
| 개인·공용 둘 다 미설정 | 503 | "홈 비서가 아직 설정되지 않았어요. 관리자에게 문의해주세요." |
| 지정 AGENT 에 active 토큰 없음 | (resolve 단계에서 폴백/미설정 취급) | 위와 동일 |
| 토큰 등록 시 평문 누락·형식 오류 | 400 | 입력 검증 메시지 |
| 공용 비서로 HUMAN 지정 시도 | 400 | "AGENT 만 비서로 지정할 수 있어요." |
| ai-agent 호출 실패(IO/5xx) | 502 | 기존 `AiAgentComposeException` 메시지 (#50) |

---

## 8. 테스트

### 백엔드 (JUnit 통합 — IntegrationTestBase)
- `AssistantResolver`: 개인 우선 / 개인 토큰 없으면 공용 폴백 / 둘 다 없으면 예외 / 공용도 토큰 없으면 예외.
- 개인 비서 self-service: 최초 등록 시 개인 AGENT 자동 생성 + credential active 1개,
  토큰 교체 시 이전 revoke·신규 active, settings upsert, 해제 시 revoke+FK NULL.
- 공용 비서 admin: AGENT 지정/변경, HUMAN 지정 거부, settings 변경.
- compose 통합: resolve 결과가 ComposeRequest 에 실려 ai-agent 로 전달되는지(MockRest).
- 예외 → GlobalExceptionHandler 503/400 매핑.

### ai-agent (기존 테스트 프레임워크)
- composeSchema 신규 필드 검증(누락 시 400).
- thinkingDepth → cli-runner 인자 매핑.
- env 제거 후 정상 동작(요청 필드 기반).

### 프론트엔드 (Playwright E2E — page.route 모킹)
- 프로필 개인 비서: 미설정→등록→설정됨, settings 변경, 해제.
- admin 공용 비서: 지정/변경, 토큰 없음 경고.
- (백엔드 불필요 — 라우트 모킹)

---

## 9. 마이그레이션·롤아웃 순서

1. **V18** (`workspace_assistant`, `user.personal_assistant_agent_id`, `assistant_config`) +
   `generateJooq`.
2. 기존 운영의 `WORKPLACE_HOME_COMPOSER_AGENT_ID` 값(현재 agent id=5)을 **공용 비서로 시드**
   (마이그레이션 또는 1회 admin 설정). 그래야 env 제거 후에도 무중단.
3. api: AssistantResolver + compose 확장 + self-service/admin 엔드포인트.
4. ai-agent: env 제거 + 요청 필드 기반 동작 + thinking 매핑.
5. web: 프로필 개인 비서 + admin 공용 비서 UI.
6. ai-agent `.env.local`/배포 env 에서 `WORKPLACE_HOME_COMPOSER_AGENT_ID` 제거.

> 2 → 4 순서 보장이 핵심: 공용 비서를 DB 에 시드한 뒤에 env 를 떼야 홈이 끊기지 않는다.

---

## 10. 비범위 (YAGNI)

- 비서 페르소나/톤/시스템 프롬프트 커스터마이즈 — 후속.
- 워크스페이스 다중 공용 비서 / 부서별 비서 — 후속(현재 싱글톤).
- max_turns / timeout_ms UI 노출 — 스키마에는 두되 v1 UI 미노출.
- 개인 비서의 데이터 접근 권한 분리 — 홈 compose 토큰은 LLM 인증용이며 데이터 권한과 무관
  (기존 주석 정책 유지).
