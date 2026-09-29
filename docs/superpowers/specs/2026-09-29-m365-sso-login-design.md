# M365 SSO 로그인 설계 (WP-48)

- 이슈: WP-48 "사용자로서 사전 등록된 M365 계정으로 SSO 로그인해 서비스를 이용하고 싶다" (상위 에픽 WP-46)
- 참고 구현: `../iacloud_eis` — `docs/superpowers/specs/2026-09-28-sso-oidc-design.md`, `apps/eis-api/.../auth/sso/`
- 작성일: 2026-09-29

## 1. 목표와 범위

회사 M365(Entra ID) 계정을 쓰는 사용자가 **사전 등록된 경우에 한해** "Microsoft 계정으로 로그인"으로 별도 가입 없이 서비스에 진입한다.

### 인수 조건 (이슈 본문)
- 로그인 화면에 "Microsoft 계정으로 로그인" 버튼이 노출된다.
- 사전 등록된 사용자가 M365 로 인증하면 가입 폼 없이 진입한다.
- 인증된 계정이 등록 계정과 매칭되면 로그인, 없으면 거부한다(자동 생성 없음).
- 관리자가 사용자 계정을 수동으로 사전 등록할 수 있다.
- 로그아웃 시 세션이 정상 종료된다.

### 범위 밖 (향후 과제)
- JIT 프로비저닝, SCIM, 디렉터리 동기화
- 워크스페이스별 허용 Entra 테넌트 제한, SSO 강제(비밀번호 로그인 차단)
- 관리자의 비밀번호 설정/초기화, SSO 연결 해제 UI
- Microsoft 측 로그아웃(front-channel/end_session), 그룹→역할 매핑, SAML, 다중 IdP

## 2. 핵심 결정

| # | 결정 | 이유 |
|---|------|------|
| D1 | **전역 멀티테넌트 Entra 앱 1개**(`organizations` authority)를 운영자가 env 로 등록한다. 워크스페이스별 앱 등록/시크릿 없음 | 사용자 계정은 전역(여러 워크스페이스 소속)이다. 워크스페이스 관리자가 IdP 를 지정하면 그 관리자가 전역 계정의 신원을 보증하게 되어 워크스페이스 간 계정 탈취가 가능해진다. 신원 보증 주체를 Microsoft 로 두면 세션 고정·워크스페이스 입력이 필요 없다 |
| D2 | 로그인 앱은 메일/캘린더용 `M365_*` 앱과 **분리**(`SSO_M365_*`) | 메일 앱은 단일 테넌트(`M365_TENANT_ID`)·Graph 권한. 로그인은 `openid profile email` 만 필요하고 동의 범위를 분리한다 |
| D3 | 흐름은 eis 처럼 **직접 구현한 OIDC Authorization Code + PKCE**, 트랜잭션 상태는 HMAC 서명 쿠키(무상태) | `oauth2Login()` 은 서버 세션 전제로 현재 stateless JWT 구조와 맞지 않음. 기존 `OAuthStateStore`(인메모리)는 다중 인스턴스 불가 |
| D4 | 계정 연결 키는 `(tid, oid)`. 최초 연결 매칭은 **`username` 과만** 비교(대소문자 무시). Microsoft 쪽 후보값은 **도메인 소유가 검증된 값만**: `xms_edov=true` 인 `email`, `#EXT#` 가 없는 `upn` | `email` 클레임은 임의 Entra 테넌트에서 위조 가능(nOAuth). `user.email` 은 관리자가 자유 입력하는 보조 정보라 매칭 키로 쓰지 않는다 |
| D5 | JIT 없음 — 매칭 실패·비활성·AGENT·SSO 켜진 워크스페이스 소속 없음 → 거부 | 이슈 전제(사전 등록 사용자만) |
| D6 | 워크스페이스 관리자는 **SSO 로그인 사용 켜기/끄기**(기본 꺼짐) + **관리자 동의 링크** 복사만 한다 | 워크스페이스 단위 통제 최소치. 꺼진 워크스페이스는 SSO 세션으로 접근 불가 |
| D7 | SSO 로 발급된 세션은 `amr=sso` 클레임을 가지며, 워크스페이스 선택/전환/refresh 시 **SSO 켜진 워크스페이스만** 허용 | D6 의 켜기/끄기를 실제로 강제. 관리자가 끄면 다음 refresh 때 차단 |
| D8 | 구성원 추가에 **"SSO 전용(비밀번호 없음)"** 옵션 | 쓰지 않을 비밀번호 생성과 우회 경로 제거 |
| D9 | SSO 전용 계정은 **본인이 프로필에서 비밀번호를 설정**할 수 있다(현재 비밀번호 불요). 관리자 설정은 하지 않음 | 관리자 설정은 전역 계정 특성상 타 워크스페이스 탈취 경로가 된다 |
| D10 | 용어: 로그인 화면은 "Microsoft 계정으로 로그인", 관리자 화면(설정·구성원 추가)은 "SSO". 코드/데이터 이름은 공급자 중립(`sso_enabled`, `/auth/sso/*`), Microsoft 명칭은 env·내부 구현 클래스에만 | 사용자는 어떤 계정인지 알아야 하고, 관리 개념은 공급자 중립이 확장에 유리 |
| D11 | 로그아웃은 기존 동작(사용자 refresh 토큰 전부 폐기 + 쿠키 삭제) 유지, Microsoft 세션은 건드리지 않음 | 인수 조건 충족, eis 와 동일 |

## 3. 구성

### 3.1 설정 (env)

`application.yml`:

```yaml
workplace:
  auth:
    sso:
      m365:
        client-id: ${SSO_M365_CLIENT_ID:}          # 비어 있으면 SSO 기능 전체 비활성
        client-secret: ${SSO_M365_CLIENT_SECRET:}
        # 웹 오리진 경유(vite /api 프록시·운영 리버스 프록시) — callback 이후 상대경로 302 가 웹으로 가도록
        redirect-uri: ${SSO_M365_REDIRECT_URI:http://localhost:6173/api/v1/auth/sso/callback}
        authority-base-url: ${SSO_M365_AUTHORITY:https://login.microsoftonline.com}  # 테스트에서 가짜 IdP 로 교체
```

- `client-id` 가 있는데 `client-secret`/`redirect-uri` 가 없으면 부팅 실패(설정 오류 조기 발견).
- `redirect-uri` 는 설정값으로 고정(Host 헤더로 만들지 않음). https 필수, localhost 만 http 허용.
- 반영 위치: `.env.example`, `docker-compose.prod.yml`, 레포 밖 Helm 차트(`~/k8s/smart-workplace`) values.

### 3.2 데이터 (Flyway V137~)

```sql
-- 워크스페이스별 SSO 켜기/끄기. tenant 는 RLS 없는 전역 테이블이라 로그인 전 단계에서도 읽힌다.
ALTER TABLE tenant ADD COLUMN sso_enabled BOOLEAN NOT NULL DEFAULT false;

-- 전역 계정 ↔ 외부 IdP 신원 연결 (RLS 없음, 전역)
CREATE TABLE user_external_identity (
  id           BIGSERIAL PRIMARY KEY,
  user_id      BIGINT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  provider     VARCHAR(20) NOT NULL,          -- 'M365'
  issuer_tenant VARCHAR(64) NOT NULL,         -- Entra tid
  subject      VARCHAR(128) NOT NULL,         -- Entra oid
  created_at   TIMESTAMP NOT NULL DEFAULT now(),
  UNIQUE (provider, issuer_tenant, subject),
  UNIQUE (user_id, provider)
);

-- 권한 sso:manage — 기존 ADMIN 시스템 역할에 부여(V132 패턴, tenant_id 는 role 에서)
INSERT INTO permission (code, description, category) VALUES ('sso:manage', 'SSO 설정 관리', 'user')
ON CONFLICT (code) DO NOTHING;
-- + role_permission INSERT ... WHERE r.name = 'ADMIN' AND r.is_system
```

- 신규 테넌트는 `TenantProvisioningService` 가 ADMIN 에 전체 권한(`grantAllPermissions`)을 주므로 자동 포함.
- 런타임 롤(`app_tenant`)이 두 테이블에 접근 가능한 GRANT 확인.

### 3.3 백엔드 컴포넌트 (`com.workplace.auth.sso`)

| 컴포넌트 | 책임 |
|---|---|
| `SsoProperties` | env 바인딩, `isAvailable()` (client-id 존재) |
| `SsoTransactionCookie` | `{state, nonce, codeVerifier, returnTo, exp}` 를 `base64url(json).base64url(HMAC-SHA256)` 로 서명. 키는 `JWT_SECRET` 에서 라벨 `"swp-sso-tx-v1"` 로 파생. 10분, HttpOnly, SameSite=Lax, Path=`/api/v1/auth/sso`, Secure=`app.cookie.secure` |
| `ReturnToSanitizer` | same-origin 상대경로만 허용(`/` 시작, `//`·`\`·스킴 거부), 아니면 `/` |
| `M365OidcClient` | 인가 URL 생성, 토큰 교환(`client_secret_post` + `code_verifier`, 5초 타임아웃), id_token 검증(Nimbus `NimbusJwtDecoder` + JWKS 캐시) |
| `OidcErrorClassifier` | 토큰/인가 오류 → `retry` / `consent` / `config` 분류 |
| `SsoUserResolver` | id_token 클레임 → 사용자 결정(4.3) + 최초 연결 저장 |
| `SsoLoginService` | start/callback 오케스트레이션, 감사 로그, 세션 발급 위임 |
| `SsoAuthController` | `/api/v1/auth/sso/{status,start,callback}` |
| `SsoAdminController` | `/api/v1/admin/sso` (워크스페이스 설정) |

의존성: `spring-security-oauth2-jose` 추가(Nimbus JWT 검증 용도만, `oauth2Login()` 미사용).

## 4. 로그인 흐름

### 4.1 API

| 메서드 | 경로 | 인증 | 설명 |
|---|---|---|---|
| GET | `/api/v1/auth/sso/status` | 공개 | `{ m365: boolean }` — 로그인 버튼 노출 여부 |
| GET | `/api/v1/auth/sso/start?returnTo=` | 공개 | 트랜잭션 쿠키 설정 후 Microsoft 인가 엔드포인트로 302 |
| GET | `/api/v1/auth/sso/callback?code&state&error&error_description` | 공개 | 처리 후 웹으로 302 (성공: `/login/sso/complete?returnTo=`, 실패: `/login?sso_error=`) |

SecurityConfig: `GET /api/v1/auth/sso/**` 만 permitAll 추가. (`apps/workplace-api/CLAUDE.md` 의 "공개 엔드포인트: /api/v1/auth/**" 구버전 서술도 실제 목록으로 정정)

### 4.2 start

인가 요청: `{authority}/organizations/oauth2/v2.0/authorize` 에 `client_id`, `response_type=code`, `redirect_uri`, `response_mode=query`, `scope=openid profile email`, `state`, `nonce`, `code_challenge`(S256), `code_challenge_method=S256`. 사용 불가(env 없음)면 `/login?sso_error=unavailable` 로 302.

### 4.3 callback — 처리 순서 (순서 자체가 규칙)

1. SSO 사용 가능 여부 확인. `admin_consent` 파라미터가 있으면(관리자 동의 완료 복귀 — state 쿠키 없음) state 검사 전에 분기: `admin_consent=True` → `/login?sso_notice=consented`, 오류 → `/login?sso_error=consent`. 토큰 교환은 하지 않는다.
2. 트랜잭션 쿠키 서명·만료 검증, `state` 일치, `code` 존재 확인. **실패 시 Microsoft 를 호출하지 않고** `retry`. IdP 가 `error` 를 돌려주면 분류(동의 필요 → `consent`, 그 외 → `retry`).
3. 토큰 교환 → id_token 검증:
   - 서명: JWKS(`{authority}/common/discovery/v2.0/keys`), RS256
   - `tid` 가 GUID, 개인 MSA 테넌트(`9188040d-6c67-4c5b-b112-36a304b66dad`) 거부
   - `iss == {authority}/{tid}/v2.0` (정확히 일치)
   - `aud` 에 `client-id` 포함, `exp`/`nbf`, `nonce` == 쿠키 nonce
4. 사용자 결정 (`SsoUserResolver`):
   1. `(M365, tid, oid)` 연결이 있으면 그 사용자.
   2. 없으면 후보값 = [`email` if `xms_edov == true`] + [`upn` if `#EXT#` 미포함] (trim·소문자). 후보가 없으면 거부(`unverified`).
   3. 각 후보로 `username` 을 대소문자 무시 조회. 한 후보가 여러 행에 매칭(대소문자만 다른 username 공존)되거나 후보들이 서로 다른 사용자를 가리키면 거부(`conflict`), 하나도 없으면 거부(`not_registered`).
   4. 그 사용자가 이미 다른 `(tid, oid)` 로 M365 연결돼 있으면 거부(`conflict`).
   5. 진입 검사: HUMAN, `is_active`, **SSO 켜진 ACTIVE 테넌트에 ACTIVE 멤버십 ≥1** — 아니면 거부(`inactive` / `no_workspace`). (연결 저장 전에 검사 — 거부된 로그인은 연결을 남기지 않는다. 기존 연결 사용자도 이 검사를 매번 통과해야 한다)
   6. 최초 연결이면 INSERT (유니크 충돌 시 재조회로 경합 처리). 감사 `USER_SSO_LINK`.
5. 세션 발급: `AuthService` 에 `issueSsoSession(user)` 추가 — SSO 허용 멤버십이 1개면 자동 선택, refresh 토큰(`amr=sso`) 저장·쿠키 설정, 감사 `LOGIN`(method=sso). access 토큰은 버리고 웹이 refresh 로 받는다.
6. 모든 거부는 웹에 `denied` 만 노출, 상세 사유는 감사 `LOGIN_FAILED` 에만 기록. 트랜잭션 쿠키는 항상 삭제.

`sso_error` 코드: `denied`(미등록·거부), `consent`(관리자 동의 필요, AADSTS65001/90094 등), `retry`(state/토큰/검증 실패 등), `unavailable`(SSO 미설정). `config`(시크릿 만료·무효 AADSTS7000222/7000215)는 운영 로그 ERROR 로 남기고 웹에는 `retry`.

### 4.4 SSO 세션 제약 (`amr=sso`)

- `JwtTokenProvider`: access/refresh 토큰에 선택 클레임 `amr`(`"sso"`) 추가 + `getAuthMethodFromToken()`. 비밀번호 로그인은 기존과 동일(클레임 없음).
- 보안 컨텍스트 전달: principal 은 기존대로 `Long userId` 를 유지(수많은 컨트롤러의 `(Long) getPrincipal()` 캐스팅 보존)하고, `JwtAuthenticationFilter` 가 `authentication.setDetails(new AuthDetails(authMethod))` 로 `amr` 을 싣는다. `AuthController.selectTenant`/`memberships` 가 details 에서 `authMethod` 를 꺼내 `AuthService.selectTenant(userId, tenantId, authMethod)`/`membershipsOf(userId, authMethod)` 로 넘긴다. PAT(`swp_`)·API 키·`Internal` 인증은 details 없음 = 비-SSO 로 취급(이 경로들은 select-tenant 를 쓰지 않는다).
- `AuthService.selectTenant`: `amr=sso` 면 대상 테넌트 `sso_enabled` 필수, 아니면 `TenantAccessDeniedException`. 새로 발급하는 토큰에도 `amr` 유지.
- `AuthService.refresh`: `amr=sso` 이고 토큰의 테넌트가 `sso_enabled=false` 가 되었으면 거부(재로그인 유도). `amr` 은 회전 시 유지.
- `GET /auth/memberships`: `amr=sso` 면 SSO 켜진 워크스페이스만 반환.

### 4.5 기존 비밀번호 로그인과의 공존

- `password` 가 NULL 인 HUMAN(SSO 전용)의 비밀번호 로그인은 일반 실패 메시지(`아이디 또는 비밀번호가 올바르지 않습니다.`) + 실패 카운트. 현재 `findPasswordByUsername` 이 빈 Optional 을 돌려주는 경로를 테스트로 고정한다.

## 5. 워크스페이스 SSO 설정

| 메서드 | 경로 | 권한 | 설명 |
|---|---|---|---|
| GET | `/api/v1/admin/sso` | `sso:manage` | `{ available, enabled, adminConsentUrl, passwordlessMemberCount }` — `available`=env 설정 여부, `passwordlessMemberCount`=이 워크스페이스 ACTIVE 구성원 중 비밀번호 없는 HUMAN 수 |
| PUT | `/api/v1/admin/sso/enabled` | `sso:manage` | `{ enabled }` — `available=false` 면 409. 감사 `SSO_SETTING_CHANGED` |

- 대상은 현재 테넌트(`TenantContext`).
- `adminConsentUrl` = `{authority}/organizations/v2.0/adminconsent?client_id={clientId}&scope=openid%20profile%20email&redirect_uri={redirectUri}`. 동의 완료 후 callback 으로 돌아오는 `admin_consent=True` 요청은 state 쿠키가 없으므로 별도로 `/login?sso_notice=consented` 로 보낸다.
- 끄면 해당 워크스페이스의 SSO 세션은 다음 refresh(최대 access 만료 30분) 때 차단된다.
- 알려진 한계: SSO 사용자가 발급한 PAT(`swp_`)는 워크스페이스 SSO 를 꺼도 계속 유효하다(PAT 는 인증 수단과 무관하게 멤버십만 검사).

## 6. SSO 전용 사전 등록과 비밀번호 설정

### 6.1 구성원 추가 (`POST /api/v1/users`)
- `CreateMemberRequest.password` 선택값으로 변경.
- `password` 없음 → 조건: 현재 테넌트 `sso_enabled=true`(아니면 409 `SSO_REQUIRED`), `username` 이 이메일 형식(아니면 400). `username` 을 소문자로 정규화하고 대소문자 무시 중복 검사(409) 후 `password=NULL` 로 계정 생성.
- `password` 있음 → 기존과 동일.
- 감사 `MEMBER_CREATED` 에 `loginMethod: SSO|PASSWORD` 추가.

### 6.2 본인 비밀번호 설정
- `GET /auth/me`(또는 `/users/me`) 응답에 `hasPassword: boolean` 추가.
- `PUT /api/v1/users/me/password`: 저장된 비밀번호가 NULL 이면 `currentPassword` 없이 `newPassword` 만으로 설정(비밀번호 규칙 동일). 단 **현재 세션이 `amr=sso` 일 때만** 허용 — PAT(`swp_`)·Internal 인증으로는 400(유출된 PAT 가 영구 비밀번호 로그인이 되는 경로 차단). 있으면 기존대로 현재 비밀번호 검증. 현재 NULL 에서 발생하는 404 는 이 분기로 해소. 감사 `PASSWORD_SET`.

## 7. 프론트엔드 (workplace-web)

1. **LoginPage**: `GET /auth/sso/status` 가 `m365=true` 일 때만 로그인 버튼 아래 "또는" 구분선 + Microsoft 로고 "Microsoft 계정으로 로그인" 버튼(`<a href="/api/v1/auth/sso/start?returnTo=…">` 전체 이동). `sso_error` 배너: `denied` "등록되지 않은 Microsoft 계정입니다. 관리자에게 등록을 요청하세요.", `consent` "조직 관리자의 앱 승인이 필요합니다.", `retry` "로그인 처리 중 문제가 발생했습니다. 다시 시도해 주세요.", `unavailable` 은 표시하지 않음. `sso_notice=consented` 는 "관리자 승인이 완료되었습니다." 안내.
2. **`/login/sso/complete`** (ProtectedRoute 밖): `hasSession` 플래그 설정 → `/auth/refresh` → 테넌트가 정해졌으면 `returnTo`(클라이언트에서도 same-origin 재검증)로, 아니면 `/auth/memberships` 로 `WorkspaceSelectCard` 표시, 0개면 "접속 가능한 워크스페이스가 없습니다" 안내.
3. **설정 › SSO** (`/settings/sso`, AdminRoute, 사이드바 "워크스페이스 관리"에서 "역할"과 "감사 로그" 사이): "SSO 로그인 사용" 토글 카드 + "관리자 동의 링크" 복사 카드. `available=false` 면 토글 비활성 + "SSO 를 사용하려면 운영자 설정이 필요합니다". 끌 때 `passwordlessMemberCount > 0` 이면 확인 다이얼로그 "비밀번호가 없는 SSO 전용 구성원 N명이 로그인할 수 없게 됩니다. 계속하시겠습니까?" 후 적용(0명이면 바로 적용).
4. **AddMemberDialog**: 워크스페이스 SSO 가 켜져 있을 때만 맨 위 "로그인 방식" 라디오(SSO 전용 (비밀번호 없음) / 비밀번호, 기본 SSO 전용). SSO 전용이면 "초기 비밀번호" 숨김 + 아이디 안내 "회사 SSO 계정 주소(이메일)와 같게 입력하세요" + 이메일 형식 검증.
5. **ProfileSettingsPage**: `hasPassword=false` 면 "비밀번호 변경" 카드 대신 "비밀번호 설정" 카드(새 비밀번호·확인). 설명 "이 계정은 SSO 로만 로그인합니다. 비밀번호를 설정하면 아이디/비밀번호로도 로그인할 수 있습니다."

## 8. 테스트

### 8.1 백엔드 (JUnit 통합, `IntegrationTestBase` 상속)
- `FakeEntraProvider`: eis `FakeOidcProvider` 를 이식·확장한 JDK HttpServer. `/{tid}/...` issuer 로 서명, `/common/discovery/v2.0/keys`, `/organizations/oauth2/v2.0/token` 제공. 클레임 교체·토큰 엔드포인트 오류·키 회전·미공개 키 서명 지원. `workplace.auth.sso.m365.authority-base-url` 로 주입.
- `SsoLoginFlowTest`: start(PKCE·쿠키), 최초 연결(email+xms_edov / upn), 재로그인(연결), 거부(미등록·비활성·AGENT·SSO 켜진 소속 없음·xms_edov false 만·`#EXT#` upn·email/upn 서로 다른 계정·다른 oid 로 이미 연결), state 불일치/쿠키 변조 시 토큰 교환 미호출, nonce·iss/tid 불일치·aud 불일치·MSA 테넌트, `invalid_grant`→retry, 동의 필요→consent, returnTo 정제, 감사 로그.
- `SsoSessionConstraintTest`: `amr=sso` select-tenant 는 SSO 켜진 테넌트만, 끈 뒤 refresh 차단, memberships 필터, 비밀번호 세션은 영향 없음.
- `SsoAdminControllerTest`: 권한, 토글, `available=false` 409, `passwordlessMemberCount`(타 워크스페이스·AGENT·비활성 제외).
- `CreateMemberSsoOnlyTest`: SSO 전용 생성, SSO 꺼짐 409, username 비이메일 400, SSO 전용 계정 비밀번호 로그인 실패.
- `SetPasswordTest`: NULL 계정은 현재 비밀번호 없이 설정, 기존 계정은 현재 비밀번호 필요.
- 단위: `SsoTransactionCookieTest`, `ReturnToSanitizerTest`, `OidcErrorClassifierTest`, `SsoUserResolverConcurrencyTest`(동시 최초 연결).

### 8.2 프론트엔드 (Playwright, `page.route` 모킹)
- `login-sso.spec.ts`: 버튼 노출/숨김, 오류 배너 3종 + 동의 완료 안내.
- `sso-complete.spec.ts`: 자동 진입, 워크스페이스 선택, 0개 안내, returnTo 정제.
- `settings/sso.spec.ts`: 토글, `available=false` 비활성, 동의 링크 복사, 끌 때 SSO 전용 구성원 수 확인 다이얼로그(0명이면 생략).
- `admin/member-add.spec.ts` 확장: SSO 전용 옵션(SSO 꺼짐 시 숨김).
- `settings/profile-password.spec.ts`: 비밀번호 설정 폼.

### 8.3 수동 검증 (실 Entra)
Entra 앱 등록 절차를 `docs/` 에 문서화하고 실제 테넌트로 확인: 지원 계정 유형 "모든 조직 디렉터리(멀티테넌트)", 플랫폼 "Web" + redirect URI, client secret, 토큰 구성 선택 클레임 `email`·`xms_edov`·`upn`, API 권한 `openid profile email`(위임).

**구현 착수 전 확인(TASK 1)**: Microsoft 문서로 `xms_edov`·`upn` 이 멀티테넌트 앱의 v2 ID 토큰 선택 클레임으로 제공되는지 검증한다. `upn` 을 신뢰할 수 없으면 후보값을 `email`+`xms_edov=true` 로만 좁힌다(설계 변경 시 이 문서 갱신).

## 9. 작업 분할 (WP-48 하위 TASK)

1. SSO 기반 — env/`SsoProperties`, 마이그레이션(`tenant.sso_enabled`, `user_external_identity`, `sso:manage`), 트랜잭션 쿠키, `M365OidcClient`, `FakeEntraProvider`
2. SSO 로그인 흐름 — start/callback, `SsoUserResolver`, `amr=sso` 세션 제약, 오류 처리, 감사
3. 워크스페이스 SSO 설정 — 관리자 API + 설정 › SSO 화면
4. SSO 전용 사전 등록과 비밀번호 설정 — 구성원 추가 확장, 본인 비밀번호 설정, `hasPassword`
5. 로그인 화면 — Microsoft 버튼, `/login/sso/complete`, 오류 배너, E2E, 배포 env 반영·Entra 등록 문서
