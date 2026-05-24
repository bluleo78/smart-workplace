# Phase 5a — AGENT 유저 타입 + API 키 인증 설계

> 관련 이슈: bluleo78/smart-workplace#28
> 의존성: Phase 1 (#16) User/Auth 모듈
> 후속: #29 (Phase 5b 이벤트/webhook), #30 (Phase 5c AGENT 응답 수신)

## 1. 목표 / 범위

AI(또는 외부 자동화) 를 1급 협업자로 등록. AGENT 유저는 비밀번호 없이 발급된 API 키로 우리 백엔드를 호출한다.

- `user.kind` enum (HUMAN | AGENT) 도입, AGENT 는 password NULL
- `agent_api_key` 테이블 + ADMIN 발급/revoke
- `ApiKeyAuthenticationFilter` — `Authorization: Bearer ak_…` 헤더 해석
- AGENT 의 행위 권한은 일반 멤버 수준 — 코멘트/이슈 변경/라벨 등 기존 메커니즘 그대로 사용
- 프론트 시각 구분: AgentBadge

**Out of Scope** (Phase 5b/5c)
- 이슈 변경 이벤트 발행 + outbound webhook
- 워커 자체 (workplace-ai-agent)
- Claude/Gemini provider 키 저장 (워커 측 책임)
- API 키 만료 정책
- 키 사용 통계 대시보드

## 2. 아키텍처

신규 모듈 없음. `auth`/`user` 모듈 내부에 추가:
- `AgentApiKeyRepository` / `AgentApiKeyService` / `AgentApiKeyController` (auth 모듈)
- `UserService.createAgent(...)` (user 모듈)
- `AuthService.login(...)` 에 kind 가드
- `ApiKeyAuthenticationFilter` (global/security)

`Claude/Gemini key 는 우리 시스템에 절대 들어오지 않는다` — 워커가 보관.

## 3. 데이터 모델 — Flyway V14

```sql
-- V14__agent_users.sql

-- 1) user.kind 추가 (HUMAN | AGENT)
ALTER TABLE "user" ADD COLUMN kind VARCHAR(16) NOT NULL DEFAULT 'HUMAN';
ALTER TABLE "user" ADD CONSTRAINT user_kind_check
  CHECK (kind IN ('HUMAN', 'AGENT'));
CREATE INDEX idx_user_kind ON "user"(kind);

-- 2) AGENT 는 password NULL 허용 (서비스 가드가 HUMAN NOT NULL 강제)
ALTER TABLE "user" ALTER COLUMN password DROP NOT NULL;

-- 3) API 키 테이블
CREATE TABLE agent_api_key (
  id            BIGSERIAL PRIMARY KEY,
  user_id       BIGINT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  key_prefix    VARCHAR(16) NOT NULL,
  key_hash      VARCHAR(128) NOT NULL,
  label         VARCHAR(80),
  created_by    BIGINT NOT NULL REFERENCES "user"(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at  TIMESTAMPTZ,
  revoked_at    TIMESTAMPTZ
);
CREATE INDEX idx_agent_api_key_user ON agent_api_key(user_id);
CREATE INDEX idx_agent_api_key_hash ON agent_api_key(key_hash) WHERE revoked_at IS NULL;
```

### 불변식

- AGENT 유저는 password NULL 허용, 로그인 (`/auth/login`) 시도 시 무조건 401 `AGENT_CANNOT_LOGIN`
- HUMAN 유저는 키 발급 불가 (kind 검증, 400 `KEY_TARGET_MUST_BE_AGENT`)
- 키 평문은 발급 시 응답에 1회만 포함, DB 에는 SHA-256 hash 만 저장
- revoked_at IS NULL 인 키만 인증에 사용
- HUMAN ↔ AGENT 전환 미지원
- 모든 키 발급/revoke / AGENT 생성·삭제는 audit_log 기록

## 4. 백엔드 API

### 4.1 AGENT 유저 CRUD (ADMIN)

```
GET    /api/v1/admin/agents                   # AGENT 유저 목록
POST   /api/v1/admin/agents
       Body: { username, name, email }        # password 없음
       → UserResponse (kind="AGENT")
DELETE /api/v1/admin/agents/{userId}          # AGENT 삭제 (기존 user 삭제 정책 따름)
```

권한: ADMIN (`@RequirePermission("user:manage")` 재사용).
- username/email UNIQUE (기존 user 테이블 제약)
- 생성 시 `kind='AGENT'`, `password=NULL`

### 4.2 키 발급 / 관리

```
GET    /api/v1/admin/agents/{userId}/keys
       → [{ id, keyPrefix, label, createdBy, createdAt, lastUsedAt, revokedAt }]
       # key_hash 와 평문 모두 노출 X

POST   /api/v1/admin/agents/{userId}/keys
       Body: { label?: "production worker" }
       → { id, plaintextKey, keyPrefix, label, createdAt }
       # plaintextKey 는 1회만 — 이후 어떤 GET 도 노출 X

DELETE /api/v1/admin/agents/{userId}/keys/{keyId}
       → 204 (soft — revoked_at 설정)
```

- 권한: ADMIN
- userId 가 AGENT 가 아니면 400 `KEY_TARGET_MUST_BE_AGENT`
- AGENT 당 키 개수 제한 없음
- revoke 후 같은 keyId 재발급 불가 (새 POST 로 다른 keyId)

### 4.3 키 형식 + 해시

```
plaintext = "ak_" + base62(SecureRandom 32 bytes)  // 약 46자
key_hash  = SHA-256(plaintext) → hex 64자
key_prefix = plaintext.substring(0, 12)            // 식별 표시
```

평문 분실 시 영영 모름. 새 키 발급 후 기존 키 revoke 가 정석.

### 4.4 ApiKeyAuthenticationFilter

```java
@Component
public class ApiKeyAuthenticationFilter extends OncePerRequestFilter {
  @Override
  protected void doFilterInternal(HttpServletRequest req, HttpServletResponse res, FilterChain chain) {
    String auth = req.getHeader("Authorization");
    if (auth != null && auth.startsWith("Bearer ak_")) {
      String plaintext = auth.substring("Bearer ".length());
      String hash = sha256Hex(plaintext);
      agentApiKeyRepository.findActiveByHash(hash).ifPresent(key -> {
        userRepository.findById(key.userId()).ifPresent(user -> {
          if ("AGENT".equals(user.kind())) {
            var authentication = new UsernamePasswordAuthenticationToken(
                user.id(), null, agentAuthorities());
            SecurityContextHolder.getContext().setAuthentication(authentication);
            agentApiKeyRepository.touchLastUsed(key.id());  // async
          }
        });
      });
    }
    chain.doFilter(req, res);
  }
}
```

SecurityConfig 에 `JwtAuthenticationFilter` 와 같은 위치 등록 — `Bearer ak_` 면 이 필터가 처리, `Bearer eyJ…` (JWT) 면 JwtAuthenticationFilter 가 처리.

last_used_at 갱신은 `@Async` 또는 별도 풀 — 인증 hot path 차단 X.

### 4.5 AGENT 로그인 거부

`AuthService.login(...)`:
```java
var user = userRepository.findByUsername(username).orElseThrow(...);
if ("AGENT".equals(user.kind())) {
  throw new AgentCannotLoginException();  // 401
}
// 기존 비밀번호 검증
```

AGENT 로그인 시도는 차단 카운터 미증가 (정상 거부).

### 4.6 audit_log 통합

신규 action 값:
- `AGENT_CREATED` — actor=ADMIN, subject=agent userId
- `AGENT_KEY_ISSUED` — actor=ADMIN, subject=agent userId, meta={keyId, keyPrefix, label}
- `AGENT_KEY_REVOKED` — actor=ADMIN, subject=agent userId, meta={keyId}

`AGENT_KEY_USED` 는 audit_log 폭주 회피 위해 별도 기록 안 함 — `last_used_at` 으로 대체.

### 4.7 응답에 kind 노출

- `UserResponse` (기존) 에 `kind: String` 필드 추가 — 모든 user 응답 (목록/단건/me 등)
- `UserSummary` (Phase 3c, 이슈 응답 내부 embed) 에도 `kind` 추가
- 프론트엔드 AssigneePicker / IssueDetail / IssueCommentList / IssueActivityTimeline 등에서 kind 로 AGENT 시각 구분

### 4.8 에러 매핑

| 상황 | 응답 |
|---|---|
| HUMAN userId 에 키 발급 시도 | 400 `KEY_TARGET_MUST_BE_AGENT` |
| AGENT 로그인 시도 | 401 `AGENT_CANNOT_LOGIN` |
| ADMIN 아님 (CRUD) | 403 |
| AGENT 유저 없음 | 404 `USER_NOT_FOUND` (기존 매핑 재사용) |
| 키 없음 (revoke) | 404 `KEY_NOT_FOUND` |
| 잘못된/revoked 키 호출 | 401 (인증 미설정 → 보호 엔드포인트 차단) |

## 5. 프론트엔드

### 5.1 파일 구조

```
src/types/user.ts                                       # UserKind, User/UserSummary 에 kind
src/types/agentKey.ts                                   # AgentApiKey, IssueResponse 등
src/api/agents.ts                                       # AGENT CRUD + key CRUD
src/hooks/queries/useAgents.ts                          # 목록 + CRUD
src/hooks/queries/useAgentKeys.ts                       # 목록 + 발급 + revoke
src/components/users/AgentBadge.tsx                     # 🤖 + AGENT 텍스트
src/pages/admin/AgentManagementPage.tsx                 # ADMIN 페이지
src/pages/admin/components/AgentKeyIssueDialog.tsx      # 평문 1회 표시 dialog
src/pages/admin/components/NewAgentDialog.tsx           # username/name/email 입력
```

### 5.2 라우트

- `/admin/agents` 신규 — `AdminRoute` 가드
- AppLayout 의 관리자 메뉴에 "AGENT" NavLink 추가

### 5.3 AgentManagementPage

좌측 — AGENT 목록 + "+ 신규 AGENT" 버튼
- 행: 이름 + username + AgentBadge + 활성 키 개수 + 최근 사용 시간
- 클릭 → 우측 패널에 키 관리

우측 — 선택 AGENT 의 키 영역
- 신규 발급 폼 (label 입력 + "발급")
- 키 목록 표 (prefix / label / createdAt / lastUsedAt / revoked / revoke 버튼)
- revoke 시 confirm

신규 발급 → `AgentKeyIssueDialog` 모달:
- 평문 키 monospace 큰 글씨
- 복사 버튼 (clipboard)
- 빨간 경고: `이 키는 다시 표시되지 않습니다. 안전한 곳에 저장하세요.`

### 5.4 AgentBadge

```tsx
import { Bot } from 'lucide-react'

export function AgentBadge({ size = 'sm' }: { size?: 'sm'|'xs' }) {
  const padding = size === 'xs' ? 'px-1 py-0 text-[10px]' : 'px-1.5 py-0.5 text-xs'
  return (
    <span className={`inline-flex items-center gap-1 rounded ${padding} bg-purple-200 text-purple-900 dark:bg-purple-900 dark:text-purple-100`}
          data-testid="agent-badge">
      <Bot className="h-3 w-3" /> AGENT
    </span>
  )
}
```

### 5.5 AGENT 시각 구분 통합 지점

- `AssigneePickerPopover` — 멤버 옵션의 이름 옆 AgentBadge
- `IssueDetailPage` 우측 메타 담당자 칩 옆
- `IssueCommentList` — 코멘트 작성자 이름 옆
- `IssueActivityTimeline` — actor 이름 옆
- 관리자 UserListPage — kind 컬럼 + 배지

`UserAvatar` 자체는 변경 안 함 (결정적 색상 매핑 유지). 배지가 구분 담당.

### 5.6 카피

- 페이지 타이틀: `AGENT 관리`
- 버튼: `+ 신규 AGENT`, `키 발급`, `회수`
- 발급 다이얼로그: `새 API 키` / `이 키는 다시 표시되지 않습니다. 안전한 곳에 저장하세요.`
- 토스트: `AGENT 를 추가했습니다`, `키를 발급했습니다`, `키를 회수했습니다`, `AGENT 를 삭제했습니다`

## 6. 테스트

### 6.1 백엔드 (JUnit)

`AgentUserServiceTest`
- ADMIN AGENT 생성 → kind=AGENT, password=NULL
- HUMAN 생성에 password 누락 시도 → 400 (기존 가드 강화)
- AGENT 생성 권한 비ADMIN → 403

`AgentApiKeyServiceTest`
- ADMIN 키 발급 → 응답에 평문 1회 + DB 에 hash
- HUMAN userId 발급 시도 → 400 `KEY_TARGET_MUST_BE_AGENT`
- GET keys → 평문/hash 미노출 + prefix/label/timestamps 만
- revoke → revoked_at 설정, 이후 인증 실패
- ADMIN 아닌 사용자 → 403
- 없는 user → 404
- 없는 key revoke → 404
- audit_log: 발급/revoke 기록

`AgentLoginRejectTest`
- AGENT username 로 `/auth/login` → 401 `AGENT_CANNOT_LOGIN`
- 로그인 실패 카운터 미증가

`ApiKeyAuthenticationFilterTest`
- valid ak_ 키 → AGENT user 로 인증
- 잘못된 ak_ → 인증 미설정 → 보호 endpoint 401
- revoked 키 → 401
- ak_ 가 아닌 Bearer (JWT) → JwtAuthenticationFilter 가 처리
- AGENT 인증 후 일반 이슈 코멘트 API 호출 → created_by 가 AGENT user_id
- last_used_at 갱신

### 6.2 V14 검증 (수동)

```sql
SELECT kind, COUNT(*) FROM "user" GROUP BY kind;
\d "user"
\d agent_api_key
```

### 6.3 프론트엔드 E2E

`e2e/pages/admin/agents.spec.ts`
- **@smoke**: ADMIN 로그인 → /admin/agents → 신규 AGENT "Claude 봇" → 키 발급 → 다이얼로그 평문 노출 → 복사 → 닫기 → 키 목록 prefix 표시 → revoke → revoked_at 표시
- AGENT 시각 구분: 이슈 상세에 AGENT 가 assignee 인 경우 AgentBadge 노출 (mock)

### 6.4 회귀 영향

- `password NOT NULL` 제거 — HUMAN 생성 서비스 가드 강화 필요
- 모든 `UserResponse` JSON 에 `kind` 추가 (호환 — 기존 클라이언트 무시)
- `UserSummary` 도 `kind` 추가 — 이슈 응답 영향
- e2e factory `createUser` default `kind: 'HUMAN'`
- husky `WEB_DOMAINS_RE='admin|projects|me'` 그대로

## 7. 결정 로그

- user.kind enum 단일 테이블 (별도 agent 테이블 X)
- AGENT password NULL, 로그인 차단
- 키 형식 `ak_<32바이트 base62>`, SHA-256 hash 저장
- 인증 방식: 헤더 직접 `Bearer ak_…` (옵션 1)
- 키 발급/검증 권한: ADMIN
- AGENT 행위 권한: 일반 멤버 (프로젝트 멤버로 추가 시)
- revoke: soft (revoked_at)
- audit_log: 생성/발급/revoke (사용은 last_used_at)
- 평문 키는 응답 1회만
- AGENT 작성 코멘트/이력: created_by = AGENT user_id, kind 로 분기
- 프론트: AgentBadge 컴포넌트
- LLM provider key (Claude/Gemini) 는 우리 시스템에 절대 없음 — 워커 책임
