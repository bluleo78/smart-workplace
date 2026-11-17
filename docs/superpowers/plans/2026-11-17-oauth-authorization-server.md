# Claude 앱 커넥터용 OAuth 인가 서버(서버 쪽) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Claude 앱 커스텀 커넥터가 `https://<웹>/mcp` 주소만으로 OAuth 2.1(PKCE S256·CIMD·DCR)로 연결되도록 API 에 인가 서버를, MCP 에 401 안내·보호 리소스 메타데이터를, helm 인그레스에 `/.well-known` 경로를 더한다(WP-1685).

**Architecture:** API 패키지 `com.workplace.auth.oauth`(controller/service/repository/dto) 아래 새 전역 표 4개(V299, RLS 없음)와 서비스·컨트롤러. `swo_` 인증은 PAT 필터에서 뺀 공통 `HumanTokenAuthenticator` 를 함께 쓰는 새 필터. MCP 는 패스스루 그대로 두고 `swo_` 허용·`WWW-Authenticate`·`/.well-known/oauth-protected-resource/...` 라우트만 더한다.

**Tech Stack:** Spring Boot + jOOQ + Flyway(Testcontainers 통합 테스트, JUnit), workplace-mcp Express 4 + vitest/supertest, helm 템플릿 + `node --test`.

**Spec:** `docs/superpowers/specs/2026-11-17-oauth-authorization-server-design.md` — 엔드포인트·필드·오류 코드·수명은 스펙이 기준이다. 이 계획은 나눔과 이름·시그니처·테스트를 정한다.

## Global Constraints

- 한국어 주석 필수(클래스·메서드·주요 로직: 무엇을·왜). `./gradlew spotlessApply` 통과. 셸 명령은 단순하게(한 줄 함수 정의·`${…:-{…}}`·긴 `;`/`&&` 체인 금지 — 복잡하면 스크립트 파일). 포트 6060/6070/6080/6090/6095/6173/6174/5434 를 쓰거나 건드리지 않는다. `pnpm dev`·`pnpm db:*`·`--no-verify`·`git stash` 금지.
- 마이그레이션 번호 **V299**(V298 은 다른 이슈가 씀). 파일 `V299__oauth_authorization_server.sql`, 머리 주석에 WP-1685, 컬럼·표 추가만(롤링 배포 호환). 표 4개 모두 RLS 없음(V117 `user_api_token` 본보기). 만든 뒤 `./gradlew generateJooq` 결과를 커밋한다.
- 토큰 접두어: access `swo_`, refresh `swr_`, DCR client_id `swc_`. 생성 = 접두어 + base62(32바이트 SecureRandom)(PAT 생성과 같은 방식 — `CapabilityTokens.generate(prefix)` 가 그 모양이면 그것). code = `CapabilityTokens.generateUrlSafe(32)`. 저장은 `CapabilityTokens.sha256Hex` 해시만, `token_prefix` 는 앞 12자.
- 수명: access 3600초, refresh 30일(회전 때 새 30일), code 10분. CIMD 캐시 1시간, 가져오기 실패 시 24시간까지 캐시 사용. CIMD 문서 최대 5KB(5120바이트), `application/json` 만.
- 경로: `GET /.well-known/oauth-authorization-server`, `POST /api/v1/oauth/register`, `GET /api/v1/oauth/authorize/validate`, `POST /api/v1/oauth/authorize`, `POST /api/v1/oauth/token`, `GET /api/v1/users/me/oauth-connections`, `DELETE /api/v1/users/me/oauth-connections/{id}`. 메타데이터의 `authorization_endpoint` = `{issuer}/oauth/authorize`.
- issuer = `workplace.public-base-url` 를 `CapabilityTokens.normalizeBaseUrl` 로 정규화한 값. 메타데이터의 모든 URL 은 issuer 로만 만든다.
- 토큰 엔드포인트 오류 본문은 RFC 6749 §5.2 snake_case `{"error":..., "error_description":...}` — 값은 `invalid_request`·`invalid_client`·`invalid_grant`·`unsupported_grant_type` 만. DCR 오류는 `invalid_redirect_uri`·`invalid_client_metadata`(RFC 7591). validate/authorize 오류 본문은 camelCase `{error, errorDescription, errorRedirectUrl?}`, `error` 값은 `invalid_client`·`invalid_redirect_uri`·`invalid_request`·`unsupported_response_type`.
- 토큰 응답·오류에는 `Cache-Control: no-store`.
- 감사 액션: `OAUTH_CONNECTION_CREATED`, `OAUTH_CONNECTION_REVOKED`, `OAUTH_REFRESH_REUSE_DETECTED`(code 재사용은 같은 액션에 metadata `grant=authorization_code`). 리소스 `oauth_connection`. 연결의 테넌트로 기록(`AuditLogService.logInTenant`).
- 속도 제한 정책: `OAUTH_REGISTER`(기본 분당 10, 속성 `app.rate-limit.oauth-register-per-minute`), `OAUTH_TOKEN`(기본 분당 60, 속성 `app.rate-limit.oauth-token-per-minute`).
- MCP: 401 헤더는 정확히 `Bearer resource_metadata="<공개 원점>/.well-known/oauth-protected-resource<MCP 경로>"`. 새 환경 변수 `WORKPLACE_OAUTH_ISSUER`. MCP 는 비밀값 없는 패스스루 유지.
- 하지 않음: 동의 화면(웹), 새 연결 알림, scope, AI 계정 OAuth, resource 로 경로 막기, 로컬 vite 프록시 변경.

## Review Focus

1. redirect_uri 가 등록값과 끝 `/`·대소문자·쿼리만 다른 경우 → 거절(정확히 같아야 함). 루프백 http 는 포트만 달라도 통과, https 는 포트가 다르면 거절 — Task 3 `RedirectUrisTest`.
2. 같은 refresh 를 동시에 두 번 보냄 → 하나만 성공, 다른 하나는 `invalid_grant` + 연결 토큰 폐기(원자적 UPDATE) — Task 5 `refreshConcurrentUse_onlyOneSucceeds`.
3. 토큰 엔드포인트에 JSON 본문·빈 본문·`grant_type` 없음 → HTML/500 이 아니라 400 `invalid_request`(no-store) — Task 5 `token_jsonBody_isInvalidRequest`.
4. 끊긴 연결에 남아 있던 code·refresh 로 토큰 교환 → `invalid_grant` — Task 6 `revokedConnection_codeAndRefreshRejected`.
5. 만료된 access(`expires_at` 과거)·폐기 연결의 access → 401, 그리고 `swo_` 로 OAuth 승인·PAT 발급 같은 웹 세션 전용 API 는 막힘 — Task 2 `expiredAccess_is401`, `swoCannotIssuePat`.

---

### Task 1: 스키마(V299)·jOOQ·저장소

**Files:**
- Create: `apps/workplace-api/src/main/resources/db/migration/V299__oauth_authorization_server.sql`
- Create: `apps/workplace-api/src/main/java/com/workplace/auth/oauth/repository/{OAuthClientRepository,OAuthConnectionRepository,OAuthCodeRepository,OAuthTokenRepository}.java`
- Modify: `apps/workplace-api/src/main/generated/**`(generateJooq)
- Test: `apps/workplace-api/src/test/java/com/workplace/auth/oauth/repository/OAuthRepositoriesTest.java`

**Interfaces:**
- Produces(표·열 — 스펙 「DB」 그대로): `oauth_client(id, client_id unique, kind, client_name, redirect_uris text[], logo_uri, client_uri, fetched_at, created_at)`, `oauth_connection(id, user_id, tenant_id, client_pk, created_at, last_used_at, revoked_at)` + 부분 unique `(user_id, tenant_id, client_pk) WHERE revoked_at IS NULL`, `oauth_authorization_code(id, code_hash unique, connection_id, redirect_uri, code_challenge, resource, expires_at, used_at, created_at)`, `oauth_token(id, connection_id, kind, token_hash unique, token_prefix, resource, expires_at, created_at, used_at, revoked_at)` + 인덱스 `token_hash WHERE revoked_at IS NULL`. FK 는 모두 `ON DELETE CASCADE`. `kind` 에는 CHECK 제약(`'CIMD','DCR'` / `'ACCESS','REFRESH'`).
- Produces(저장소 — 레코드 이름은 그대로):
  - `OAuthClientRepository`: `record ClientRow(long id, String clientId, String kind, String clientName, List<String> redirectUris, String logoUri, String clientUri, OffsetDateTime fetchedAt, OffsetDateTime createdAt)`; `Optional<ClientRow> findByClientId(String clientId)`; `ClientRow insertDcr(String clientId, String clientName, List<String> redirectUris)`; `ClientRow upsertCimd(String clientId, String clientName, List<String> redirectUris, String logoUri, String clientUri, OffsetDateTime fetchedAt)`; `int deleteUnusedDcrOlderThan(OffsetDateTime cutoff)`(연결이 한 번도 없는 DCR).
  - `OAuthConnectionRepository`: `record ConnectionRow(long id, long userId, long tenantId, long clientPk, OffsetDateTime createdAt, OffsetDateTime lastUsedAt, OffsetDateTime revokedAt)`; `record Created(ConnectionRow row, boolean created)`; `Created findOrCreateActive(long userId, long tenantId, long clientPk)`(동시에 와도 하나 — `ON CONFLICT` 또는 잠금); `Optional<ConnectionRow> findActive(long id)`; `boolean revoke(long id, long userId)`(내 것·살아 있을 때만 true); `void touchLastUsed(long id)`; `record ListedConnection(long id, String clientName, String clientKind, List<String> redirectUris, long tenantId, String tenantName, OffsetDateTime createdAt, OffsetDateTime lastUsedAt)`; `List<ListedConnection> listActiveByUser(long userId)`.
  - `OAuthCodeRepository`: `record CodeRow(long id, long connectionId, String redirectUri, String codeChallenge, String resource, OffsetDateTime expiresAt, OffsetDateTime usedAt)`; `void insert(String codeHash, long connectionId, String redirectUri, String codeChallenge, String resource, OffsetDateTime expiresAt)`; `Optional<CodeRow> findByHash(String codeHash)`; `boolean markUsed(long id)`(`used_at IS NULL` 일 때만 true); `int deleteExpiredBefore(OffsetDateTime cutoff)`.
  - `OAuthTokenRepository`: `record ActiveAccess(long tokenId, long connectionId, long userId, long tenantId)`; `Optional<ActiveAccess> findActiveAccess(String tokenHash, OffsetDateTime now)`(ACCESS·미폐기·미만료·연결 미폐기); `record RefreshRow(long id, long connectionId, String resource, OffsetDateTime expiresAt, OffsetDateTime usedAt, OffsetDateTime revokedAt)`; `Optional<RefreshRow> findRefresh(String tokenHash)`; `boolean markRefreshUsed(long id)`(`used_at IS NULL AND revoked_at IS NULL` 일 때만 true); `void insert(long connectionId, String kind, String tokenHash, String tokenPrefix, String resource, OffsetDateTime expiresAt)`; `int revokeAllForConnection(long connectionId)`; `int deleteExpiredBefore(OffsetDateTime cutoff)`.

- [ ] **Step 1:** 마이그레이션을 쓰고 `./gradlew generateJooq` 를 돌린다(Docker 데몬 필요 — Testcontainers).
- [ ] **Step 2: 실패하는 테스트** `OAuthRepositoriesTest`(IntegrationTestBase, 시드는 `TestFixtures.createHuman`·테넌트 1):
  - `findOrCreateActive_reusesActiveConnection` — 같은 (user, tenant, client)로 두 번 → 두 번째 `created=false`, 같은 id. 다른 tenant → 새 id.
  - `findOrCreateActive_afterRevoke_createsNew` — revoke 뒤 다시 → `created=true`, 새 id.
  - `markRefreshUsed_onlyOnce` — 첫 호출 true, 두 번째 false.
  - `markUsed_codeOnlyOnce` — 같은 모양.
  - `findActiveAccess_excludesExpiredRevokedAndRevokedConnection` — 만료(과거 expires_at)·revoked 토큰·연결 revoke 뒤 각각 empty.
  - `revokeAllForConnection_revokesBothKinds` — ACCESS·REFRESH 둘 다 revoked_at 이 찍힘(반환 2).
  - `deleteUnusedDcrOlderThan_keepsClientsWithConnections`.
- [ ] **Step 3:** 저장소 구현(jOOQ `DSLContext`, `@Repository @RequiredArgsConstructor`, `OffsetDateTime`). 실패 → 통과 확인: `./gradlew test --tests "com.workplace.auth.oauth.repository.*"`.
- [ ] **Step 4:** spotlessApply, 커밋 `feat: OAuth 인가 서버 표·저장소를 더한다 (WP-1685)`.

### Task 2: `swo_` 인증 필터(PAT 필터와 공통 함수)

**Files:**
- Create: `apps/workplace-api/src/main/java/com/workplace/global/security/HumanTokenAuthenticator.java`
- Create: `apps/workplace-api/src/main/java/com/workplace/global/security/OAuthAccessTokenAuthenticationFilter.java`
- Modify: `apps/workplace-api/src/main/java/com/workplace/global/security/UserTokenAuthenticationFilter.java`(공통 함수 사용으로 줄임), `apps/workplace-api/src/main/java/com/workplace/global/config/SecurityConfig.java`(필터 등록 — `addFilterBefore(oauthAccessTokenAuthenticationFilter, JwtAuthenticationFilter.class)`)
- Test: `apps/workplace-api/src/test/java/com/workplace/global/security/OAuthAccessTokenAuthenticationFilterTest.java`

**Interfaces:**
- Consumes: Task 1 `OAuthTokenRepository.findActiveAccess`, `OAuthConnectionRepository.touchLastUsed`.
- Produces: `@Component HumanTokenAuthenticator` 의 `boolean authenticate(HttpServletRequest request, long userId, long tenantId)` — 사람(비 AGENT)·`findActiveByUser` 에 tenant 포함·`TenantStatusChecker.isActive` 를 모두 만족하면 `TenantContext.set(tenantId)` → 권한 → `UsernamePasswordAuthenticationToken(userId, null, authorities)` 를 SecurityContext 에 넣고 `AgentToolContext` 를 채운 뒤 true, 아니면 아무것도 바꾸지 않고 false. 정리(`TenantContext.clear`·`AgentToolContext.clear`)는 지금처럼 각 필터의 finally. (패키지 의존 방향 때문에 `global` 이 `auth.oauth` 저장소를 쓰게 되면 — PAT 필터가 이미 `auth.repository` 를 쓰는 것과 같은 모양이라 허용. ArchUnit 이 막으면 필터를 `auth.oauth` 패키지로 옮긴다.)
- PAT 필터의 동작은 바뀌지 않는다(`touchLastUsed(tok.id())` 는 성공 때만).

- [ ] **Step 1: 실패하는 테스트**(`UserTokenAuthenticationFilterTest` 본보기 — 실제 HTTP `RestTemplate`, 커밋된 시드, 끝에 정리). 토큰은 저장소로 직접 넣는다(연결 + ACCESS 행):
  - `swoAccess_authenticatesAsUserAndTenant` — `GET /api/v1/auth/me` 200, id 가 그 사용자. 연결 `last_used_at` 이 채워짐.
  - `membershipSuspended_is401` — `TestFixtures.suspendMember` 뒤 401(완료 기준 4).
  - `revokedConnection_is401`(완료 기준 10, 저장소 revoke 로).
  - `expiredAccess_is401`.
  - `refreshTokenAsBearer_is401` — `swr_…` 행을 넣고 Bearer 로 → 401(완료 기준 6).
  - `agentUserToken_is401` — AGENT 사용자로 만든 연결 → 401.
  - `swoCannotIssuePat` — `POST /api/v1/users/me/api-tokens` 가 PAT 로 막히는 것과 같은 상태 코드.
  - `patStillWorks` — 기존 PAT `swp_` 로 `/auth/me` 200(완료 기준 9 — 기존 `UserTokenAuthenticationFilterTest`·AI 키 테스트가 그대로 통과하는 것도 Step 4 에서 확인).
- [ ] **Step 2:** 실패 확인.
- [ ] **Step 3:** `HumanTokenAuthenticator` 추출 → PAT 필터가 쓰게 바꿈 → 새 필터(`swo_` 만, `findActiveAccess(sha256Hex, now)` → `authenticate` 성공 시 `touchLastUsed(connectionId)`).
- [ ] **Step 4:** `./gradlew test --tests "com.workplace.global.security.*" --tests "com.workplace.auth.*"` 통과.
- [ ] **Step 5:** 커밋 `feat: OAuth access 토큰(swo_)으로 API 를 인증한다 (WP-1685)`.

### Task 3: 클라이언트(redirect 규칙·DCR·CIMD)·인가 서버 메타데이터·속도 제한·공개 CORS

**Files:**
- Create: `apps/workplace-api/src/main/java/com/workplace/auth/oauth/service/RedirectUris.java`(순수 함수), `.../service/OAuthClientService.java`, `.../service/OAuthIssuer.java`, `.../controller/OAuthMetadataController.java`, `.../controller/OAuthRegistrationController.java`, `.../dto/*`
- Modify: `global/security/ratelimit/PublicRateLimitFilter.java`, `RateLimitProperties.java`, `global/config/SecurityConfig.java`(permitAll: `/api/v1/oauth/register`, `/api/v1/oauth/token`; CORS: `/.well-known/oauth-authorization-server`·`/api/v1/oauth/register`·`/api/v1/oauth/token` 에 `*`·자격 증명 없음, GET/POST/OPTIONS)
- Modify(test): `apps/workplace-api/src/test/java/com/workplace/support/FixtureHttpFetcherConfig.java` — CIMD 고정 문서 추가
- Test: `.../auth/oauth/service/RedirectUrisTest.java`(순수), `.../auth/oauth/OAuthClientAndMetadataTest.java`(통합), `.../global/security/ratelimit/` 기존 테스트 파일에 정책 케이스

**Interfaces:**
- Produces:
  - `final class RedirectUris`: `static Optional<String> validateForRegistration(List<String> uris)`(문제 있으면 이유 문자열, 규칙은 스펙 「redirect_uri 규칙」), `static boolean matches(String registered, String requested)`(정확히 같음, 루프백 http 는 포트만 무시).
  - `@Component OAuthIssuer`: `String issuer()`, `String tokenEndpoint()`, `String registrationEndpoint()`, `String authorizationEndpoint()`.
  - `@Service OAuthClientService`: `record ResolvedClient(long id, String clientId, String kind, String clientName, List<String> redirectUris, String clientUri)`; `ResolvedClient resolve(String clientId)` — DCR(`swc_`)은 표에서, https URL 은 CIMD(캐시 규칙), 그 밖·실패는 `OAuthClientException(String error, String description)`(error = `invalid_client`); `RegisteredClient register(RegisterClientRequest req)`.
  - CIMD SSRF: `resolve` 는 가져오기 전에 host 를 `InetAddress.getAllByName` 으로 풀어 하나라도 `InternalAddresses.isInternal` 이면 `invalid_client`(가져오기 호출 없음). IP 리터럴도 같다. 그다음 `SafeHttpFetcher.fetch(url, "application/json", mime -> mime 이 application/json, 5120)`.
- 메타데이터 응답 필드는 스펙 그대로(`authorization_response_iss_parameter_supported:true` 포함).

- [ ] **Step 1: 실패하는 테스트**
  - `RedirectUrisTest`: `https://a.example/cb` vs `https://a.example/cb/`·`https://A.example/cb`·`https://a.example/cb?x=1`·`https://a.example:8443/cb` → false; `http://localhost:1234/cb` vs `http://localhost:5678/cb` → true; `http://127.0.0.1:1/cb` vs `http://127.0.0.1:2/cb` → true; `http://localhost:1/cb` vs `http://localhost:1/other` → false; 등록 검사 — 빈 목록·11개·`http://evil.example/cb`·`https://a/cb#frag`·2001자 → 이유 있음, `https://a.example/cb`·`http://[::1]:9/cb` → empty.
  - `OAuthClientAndMetadataTest`:
    - `metadata_hasS256CimdRegistrationAndPublicUrls` — 모든 URL 이 `workplace.public-base-url` 정규화 값으로 시작, `code_challenge_methods_supported==["S256"]`, `client_id_metadata_document_supported==true`, `token_endpoint_auth_methods_supported` 에 `none`(완료 기준 2).
    - `register_dcr_returnsSwcClientId` — 201, `client_id` 가 `swc_` 로 시작, 표에 kind DCR.
    - `register_rejectsHttpNonLoopbackRedirect` — 400 `invalid_redirect_uri`.
    - `register_rejectsClientSecretAuthMethod` — `token_endpoint_auth_method:"client_secret_basic"` → 400 `invalid_client_metadata`.
    - `cimd_fetchesAndCaches` — 고정 문서 URL 로 `resolve` 두 번 → 가져오기는 한 번(테스트에서 fetcher 호출 수를 셀 수 있게 픽스처에 카운터 추가), 이름·redirect 가 문서 값.
    - `cimd_clientIdMismatch_rejected`, `cimd_privateAddress_rejected`(`https://10.0.0.1/client.json` → `invalid_client`, 가져오기 0번 — 완료 기준 8), `cimd_httpUrl_rejected`.
  - 속도 제한: `/api/v1/oauth/register` 가 `OAUTH_REGISTER`, `/api/v1/oauth/token` 이 `OAUTH_TOKEN` 정책으로 분류되는지(기존 정책 테스트 모양 따라).
- [ ] **Step 2:** 실패 확인 → 구현 → `./gradlew test --tests "com.workplace.auth.oauth.*" --tests "com.workplace.global.security.ratelimit.*"` 통과.
- [ ] **Step 3:** 커밋 `feat: OAuth 클라이언트 등록·CIMD·인가 서버 메타데이터를 더한다 (WP-1685)`.

### Task 4: 인가 요청 검증·승인 API

**Files:**
- Create: `.../auth/oauth/service/OAuthAuthorizationService.java`, `.../controller/OAuthAuthorizeController.java`, `.../dto/{AuthorizeValidateResponse,AuthorizeDecisionRequest,AuthorizeRedirectResponse,OAuthAuthorizeError}.java`
- Test: `.../auth/oauth/OAuthAuthorizeTest.java`

**Interfaces:**
- Consumes: Task 3 `OAuthClientService.resolve`, `RedirectUris.matches`, `OAuthIssuer`; Task 1 `findOrCreateActive`, `OAuthCodeRepository.insert`; `MembershipRepository.findActiveByUser`, `TenantStatusChecker`, `AuditLogService.logInTenant`, `AuthDetails`(웹 세션 판정 — `MyApiTokenController.issue` 와 같은 방법).
- Produces: `OAuthAuthorizationService.validate(long userId, AuthorizeParams p) -> AuthorizeValidateResponse`, `decide(long userId, AuthorizeParams p, Long tenantId, String decision) -> AuthorizeRedirectResponse(String redirectUrl)`, 오류는 `OAuthAuthorizeException(int status, String error, String description, String errorRedirectUrl)`(errorRedirectUrl 은 client·redirect 검증을 통과한 뒤의 오류에서만 non-null). `record AuthorizeParams(String responseType, String clientId, String redirectUri, String codeChallenge, String codeChallengeMethod, String state, String resource)`.
- redirect URL 조립: redirect_uri 에 기존 쿼리가 있으면 `&` 로 잇는다. 파라미터 `code`, `state`(있을 때만), `iss`; 거부는 `error=access_denied`, `state`, `iss`. URL 인코딩은 `UriComponentsBuilder`.
- 웹 세션이 아니거나(PAT·`swo_`·AI 키) AGENT 사용자면 403.

- [ ] **Step 1: 실패하는 테스트**(MockMvc + `WebSessionAuth.of(...)` 로 웹 세션 인증 — 픽스처는 DCR 클라이언트를 저장소로 직접 넣는다):
  - `validate_ok_returnsClientAndWorkspaces` — `unverified=true`(DCR), `redirectHost`, `workspaces` 에 테넌트 1.
  - `validate_unknownClient_noRedirect` — 400 `invalid_client`, `errorRedirectUrl` 없음.
  - `validate_unregisteredRedirect_noRedirect` — 400 `invalid_redirect_uri`, `errorRedirectUrl` 없음(완료 기준 7 앞부분).
  - `validate_missingPkce_hasErrorRedirect` — 400 `invalid_request`, `errorRedirectUrl` 이 redirect_uri 로 시작하고 `error=invalid_request`·`state` 포함.
  - `validate_plainChallengeMethod_rejected`, `validate_responseTypeToken_unsupported`.
  - `authorize_allow_returnsCodeRedirectAndCreatesConnection` — `redirectUrl` 에 `code`·`state`·`iss`, 연결 1개, 감사 `OAUTH_CONNECTION_CREATED` 1건. 같은 요청 한 번 더 → 연결 그대로 1개, 감사 추가 없음.
  - `authorize_deny_returnsAccessDenied` — 연결·code 없음.
  - `authorize_tenantNotMember_400NoRedirect`.
  - `authorize_withPatAuth_isForbidden` — PAT 인증(웹 세션 아님) → 403.
- [ ] **Step 2:** 실패 확인 → 구현 → `./gradlew test --tests "com.workplace.auth.oauth.*"` 통과.
- [ ] **Step 3:** 커밋 `feat: OAuth 인가 요청 검증·승인 API 를 더한다 (WP-1685)`.

### Task 5: 토큰 엔드포인트(code 교환·refresh 회전·재사용 탐지)

**Files:**
- Create: `.../auth/oauth/service/OAuthTokenService.java`, `.../service/Pkce.java`(순수), `.../controller/OAuthTokenController.java`, `.../dto/{TokenResponse,TokenError}.java`
- Test: `.../auth/oauth/service/PkceTest.java`, `.../auth/oauth/OAuthTokenEndpointTest.java`

**Interfaces:**
- Consumes: Task 1 저장소, Task 4 가 만든 code(테스트에서는 Task 4 API 로 받거나 저장소로 직접 넣는다), `MembershipRepository`·`TenantStatusChecker`(발급 때 다시 확인), `AuditLogService.logInTenant`.
- Produces: `Pkce.verifyS256(String verifier, String challenge) -> boolean`(verifier 43~128자 `[A-Za-z0-9-._~]`, BASE64URL(SHA256) 비교, 상수 시간); `OAuthTokenService.exchangeCode(...)`, `refresh(...)` → `TokenResponse(access_token, token_type, expires_in, refresh_token)`; 오류는 `OAuthTokenException(String error, String description)`.
- code 교환 순서: 해시로 찾기(없음 → `invalid_grant`) → 이미 used → 재사용 처리(연결 토큰 폐기 + 감사, **오류 응답과 별도 트랜잭션으로 먼저 커밋**) 후 `invalid_grant` → `markUsed` 실패(동시) → 같은 재사용 처리 → 만료 → `invalid_grant` → client_id·redirect_uri·PKCE 불일치 → `invalid_grant` → 연결이 끊김·멤버십/테넌트 비활성 → `invalid_grant` → 토큰 둘 발급.
- refresh 순서: 찾기(없음·만료·revoked → `invalid_grant`) → 연결의 client_id 와 요청 `client_id` 다르면 `invalid_grant` → `markRefreshUsed` 가 false 면 재사용 처리(위와 같음) → 연결·멤버십 확인 → 새 둘 발급(resource 는 이전 값 유지).
- 컨트롤러: `consumes` 를 제한하지 말고 폼 파라미터를 읽어 `grant_type` 이 없거나 본문이 폼이 아니면 400 `invalid_request`(415·500 이 아니게). 응답 헤더 `Cache-Control: no-store`, `Pragma: no-cache`.

- [ ] **Step 1: 실패하는 테스트**
  - `PkceTest`: RFC 7636 부록 B 값(verifier `dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk` → challenge `E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM`) true, 한 글자 다르면 false, 42자 verifier false.
  - `OAuthTokenEndpointTest`(실제 HTTP, `application/x-www-form-urlencoded`):
    - `codeExchange_returnsSwoAndSwr_andSwoWorks` — 응답 `token_type=Bearer`, `expires_in=3600`, 접두어 확인, `Cache-Control: no-store`; 받은 `swo_` 로 `GET /api/v1/auth/me` 200 그 사용자, 그 워크스페이스의 이슈 목록 API 200(완료 기준 3).
    - `codeReuse_isInvalidGrant_andRevokesTokens` — 두 번째 교환 `invalid_grant`, 첫 교환의 `swo_` 401(완료 기준 7).
    - `codeExpired_isInvalidGrant` — expires_at 을 과거로 넣은 code.
    - `codeWrongVerifier_isInvalidGrant`, `codeWrongRedirectUri_isInvalidGrant`, `codeWrongClientId_isInvalidGrant`.
    - `refresh_rotates` — 새 `swo_`·`swr_`, 옛 access 는 여전히 통함(만료까지), 새 access 통함.
    - `refreshReuse_isInvalidGrant_andRevokesAll` — 회전 뒤 옛 `swr_` 다시 → `invalid_grant`, 새로 받은 `swo_`·`swr_` 모두 401/`invalid_grant`, 감사 `OAUTH_REFRESH_REUSE_DETECTED` 1건(완료 기준 5).
    - `refreshConcurrentUse_onlyOneSucceeds` — 두 스레드가 같은 `swr_` 로 동시에 → 성공 정확히 1(Review Focus 2).
    - `token_jsonBody_isInvalidRequest`, `token_missingGrantType_isInvalidRequest`, `token_passwordGrant_isUnsupportedGrantType`.
    - `token_afterMembershipSuspended_isInvalidGrant` — refresh 로.
- [ ] **Step 2:** 실패 확인 → 구현 → `./gradlew test --tests "com.workplace.auth.oauth.*"` 통과.
- [ ] **Step 3:** 커밋 `feat: OAuth 토큰 엔드포인트(PKCE·refresh 회전·재사용 탐지)를 더한다 (WP-1685)`.

### Task 6: 내 연결 목록·끊기 API·정리 작업

**Files:**
- Create: `.../auth/oauth/controller/MyOAuthConnectionController.java`, `.../service/OAuthConnectionService.java`, `.../service/OAuthCleanupScheduler.java`, `.../dto/OAuthConnectionResponse.java`
- Test: `.../auth/oauth/OAuthConnectionApiTest.java`, `.../auth/oauth/OAuthCleanupSchedulerTest.java`

**Interfaces:**
- Consumes: Task 1 `listActiveByUser`, `revoke`, `revokeAllForConnection`, 삭제 메서드들.
- Produces: `OAuthConnectionResponse(long id, String clientName, boolean unverified, String redirectHost, long tenantId, String tenantName, OffsetDateTime createdAt, OffsetDateTime lastUsedAt)` — `redirectHost` 는 첫 redirect_uri 의 host. `OAuthCleanupScheduler.cleanup()`(공개 메서드 — 테스트가 직접 부름): 만료 24시간 지난 code·토큰 삭제, 연결 없는 DCR 클라이언트 7일 뒤 삭제. `@ConditionalOnProperty(name="app.oauth.cleanup.enabled", havingValue="true", matchIfMissing=true)`, `@Scheduled(initialDelay=60_000, fixedDelay=3_600_000)` + `@SchedulerLock(name="OAuthCleanupScheduler.cleanup")`(`LoginAttemptCleanupScheduler` 본보기).
- 끊기: 연결 revoke + 토큰 모두 폐기 + 감사 `OAUTH_CONNECTION_REVOKED` 를 한 트랜잭션. 남의 것·없는 것·이미 끊긴 것은 404.

- [ ] **Step 1: 실패하는 테스트**
  - `list_returnsMyActiveConnectionsAcrossTenants` — 다른 사용자의 연결은 안 보임, 끊긴 것 안 보임, 필드 값.
  - `delete_revokesAndSwoIs401` — 204, 그 연결의 `swo_` 로 `/auth/me` 401(완료 기준 10), 감사 1건.
  - `delete_othersConnection_404`.
  - `revokedConnection_codeAndRefreshRejected` — 끊은 뒤 남은 code 교환·refresh → `invalid_grant`(Review Focus 4).
  - `cleanup_deletesExpiredAndUnusedDcr` — 25시간 전 만료 code·토큰 삭제, 23시간 전 만료는 남음, 8일 된 연결 없는 DCR 삭제, 연결 있는 DCR·6일 된 DCR 남음.
- [ ] **Step 2:** 실패 확인 → 구현 → `./gradlew test --tests "com.workplace.auth.oauth.*"` 통과.
- [ ] **Step 3:** 커밋 `feat: 내 OAuth 연결 목록·끊기 API 와 정리 작업을 더한다 (WP-1685)`.

### Task 7: MCP 401 안내·보호 리소스 메타데이터·helm 인그레스

**Files:**
- Create: `apps/workplace-mcp/src/routes/oauthMetadata.ts`, `apps/workplace-mcp/src/routes/oauthMetadata.test.ts`
- Modify: `apps/workplace-mcp/src/mcp/server.ts`(`TOKEN_PREFIX` 에 `swo_`, 401 두 곳에 헤더), `apps/workplace-mcp/src/index.ts`(라우트 등록, `app.set('trust proxy', true)`), `apps/workplace-mcp/src/mcp/server.test.ts`(또는 401 을 보는 기존 테스트 파일)
- Modify: `deploy/helm/templates/ingress.yaml`, `deploy/helm/templates/mcp-deployment.yaml`(`WORKPLACE_OAUTH_ISSUER` = `.Values.config.webBaseUrl`), `deploy/helm/tests/chart.test.mjs`
- Modify: `apps/workplace-mcp` 의 README·CLAUDE.md 가 환경 변수를 나열하면 한 줄 추가

**Interfaces:**
- Produces: `function protectedResourceMetadataUrl(req: Request, mcpPath: string): string` 과 `function publicOrigin(req: Request): string`(`req.protocol` + `req.get('host')` — trust proxy 로 forwarded 값 반영). 라우트 `GET /.well-known/oauth-protected-resource/mcp`, `/mcp/readonly`, `/mcp/x/:apps`, `/mcp/x/:apps/readonly` → `{resource, authorization_servers:[issuer], bearer_methods_supported:["header"]}`; issuer = `process.env.WORKPLACE_OAUTH_ISSUER` 정규화(끝 `/` 제거), 없으면 `publicOrigin(req)`. `:apps` 검증은 `resolveScope` 와 같은 규칙(잘못되면 404).
- 401 은 지금의 JSON-RPC 본문 그대로 + 헤더만 더한다. 토큰 없음·접두어 불일치·API 401 세 경우 모두.

- [ ] **Step 1: 실패하는 테스트**(vitest + supertest):
  - `GET /.well-known/oauth-protected-resource/mcp` 에 `X-Forwarded-Proto: https`, `X-Forwarded-Host: genia-works.iacloud.kr` → `resource == "https://genia-works.iacloud.kr/mcp"`, `authorization_servers == [WORKPLACE_OAUTH_ISSUER]`.
  - `/mcp/readonly`·`/mcp/x/issues`(유효한 앱 이름은 `resolveScope` 가 받는 것 중 하나)도 경로별 resource. 잘못된 앱 → 404.
  - `POST /mcp` 토큰 없음 → 401, `www-authenticate == 'Bearer resource_metadata="https://genia-works.iacloud.kr/.well-known/oauth-protected-resource/mcp"'`(forwarded 헤더 함께)(완료 기준 1). `/mcp/readonly` 면 그 경로의 메타데이터 URL.
  - API 가 401 을 주는 `swo_` 토큰(nock) → 401 + 같은 헤더.
  - `swo_` 토큰이 API 200 이면 401 이 아니다(접두어 허용).
  - `swp_`·`ak_` 기존 테스트 그대로 통과.
  - helm `chart.test.mjs`: prod values 렌더에서 webHost 에 `/.well-known/oauth-authorization-server` → 서비스 `api` 포트 9090, `/.well-known/oauth-protected-resource` → `mcp`; mcpHost 에도 둘 다; `mcpPathOnWeb=false` 면 webHost 에 protected-resource 는 없고 authorization-server 는 있음; mcp 컨테이너 env `WORKPLACE_OAUTH_ISSUER` = webBaseUrl.
- [ ] **Step 2:** 실패 확인 → 구현 → `pnpm --filter @smart-workplace/workplace-mcp test`, `pnpm --filter @smart-workplace/workplace-mcp typecheck`(스크립트가 있으면), `node --test deploy/helm/tests/*.test.mjs` 통과.
- [ ] **Step 3:** 커밋 `feat: MCP 가 OAuth 연결을 안내하고 인그레스에 well-known 경로를 연다 (WP-1685)`.
