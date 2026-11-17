# Claude 앱 커넥터용 OAuth 인가 서버(서버 쪽) 설계 (WP-1685)

부모 WP-1669(기획 확정 — 방안 A, AI 팀장 승인 이슈챗 11408, dh.yang 확정 11422). 뒤: WP-1686(동의 화면 `/oauth/authorize` 웹), WP-1687(연결된 앱 화면), WP-1688(Cowork). 무인 work-loop 세션 — 설계 승인은 스스로 함.

## 의도
Claude 앱(데스크톱·웹·모바일·Cowork)의 커스텀 커넥터는 MCP 주소만 받고 표준 OAuth(RFC 9728 → RFC 8414 → PKCE S256, 클라이언트는 CIMD 또는 DCR)로 로그인한다. 지금 MCP 는 PAT(`swp_`)·AI 키(`ak_`) 헤더만 받아 연결할 수 없다. 이 이슈는 그 흐름의 **서버 쪽**: API 에 인가 서버(메타데이터·클라이언트·code·토큰·폐기)를, MCP 에 401 안내와 보호 리소스 메타데이터를, 운영 인그레스에 `/.well-known` 경로를 더한다. 동의 화면(웹)은 WP-1686 이 이 이슈의 API 위에 그린다.

## 목표 / 하지 않음 / 실패로 보는 것
- 목표: 이슈 본문 「범위」 전부, 아래 완료 기준 1~10 을 통합 테스트로 지킨다(이슈 본문 그대로).
  1. 토큰 없이 `/mcp` 를 부르면 401 과 `WWW-Authenticate: Bearer resource_metadata="…"` 가 오고, 그 메타데이터의 `resource` 가 요청 URL 과 같다.
  2. 인가 서버 메타데이터에 S256·CIMD 지원·등록 엔드포인트가 있고, issuer·모든 엔드포인트가 공개 주소다.
  3. PKCE 로 받은 code 를 토큰으로 바꾸면 `swo_`·`swr_` 를 받고, `swo_` 로 API·MCP 도구가 그 사용자·워크스페이스로 동작한다.
  4. 멤버십을 해지하면 그 워크스페이스로 발급된 `swo_` 가 바로 401 이다.
  5. 이미 쓴 refresh 를 다시 쓰면 `invalid_grant` 이고 그 연결의 토큰이 모두 무효가 된다.
  6. `swr_` 를 Bearer 로 넣은 API 호출은 401 이다.
  7. 등록되지 않은 redirect_uri 로 validate 하면 오류이고 redirect URL 을 돌려주지 않는다. 쓴 code 를 다시 쓰거나 10분 뒤 쓰면 `invalid_grant` 다.
  8. 사설 주소(예: `https://10.0.0.1/…`)를 client_id 로 준 CIMD 요청은 거절된다.
  9. 기존 PAT(`swp_`)·AI 키(`ak_`) 연결이 그대로 동작한다.
  10. 연결을 끊으면 그 연결의 `swo_` 가 바로 401 이다.
- 하지 않음: 동의 화면·새 연결 알림(WP-1686), 연결된 앱 화면(WP-1687), Cowork(WP-1688), scope 고르기, AI 계정 OAuth, `resource` 로 경로 막기(첫 판은 기록만).
- 실패로 보는 것: 검증 안 된 redirect_uri 로 code·오류를 보냄, 끊거나 멤버십을 해지한 뒤에도 `swo_` 가 API 에서 통함, `swr_` 가 인증으로 통함, refresh 재사용이 탐지되지 않음, 사설 주소로 CIMD 요청이 나감, 메타데이터에 내부 주소가 나옴, 기존 PAT·AI 키·runner 인증이 깨짐.

## 방식
- 정해진 것(기획 방안 A): API 에 인가 서버를 둔다. B(M365 위임)·C(static_headers)는 기획에서 버림.
- 이 이슈 안의 선택
  - A1. **새 테이블 + 새 `swo_` 필터, PAT 필터와 공통 함수 공유 — 고름.** 기획이 접두어·공통 함수를 정했고, PAT 표(`user_api_token`)에 넣으면 사용자당 20개 상한·목록·이름 규칙이 섞이고 연결 단위 폐기·refresh 회전을 담을 열이 없다.
  - A2. OAuth 토큰을 `swp_` 행으로 발급(필터 재사용) — 버림: 위 이유, 그리고 기획의 `swo_`/`swr_` 구분과 「`swr_` 는 인증으로 받지 않음」을 지키기 어렵다.
  - A3. Spring Authorization Server 도입 — 버림: JWT/세션 기반 동의·폼 로그인을 전제로 해 우리 SPA(메모리 JWT) 동의 흐름·테넌트 고르기·해시 저장 토큰과 맞추는 비용이 직접 구현보다 크고, 필요한 엔드포인트가 작다(authorize 검증·승인·token·register).

## 설계 (내가 정한 것)

### DB (V299 — V298 은 같은 개발자의 WP-1655 가 기차에 실어 둠)
모두 **RLS 없는 전역 표**(V117 처럼 — 인증 경로·토큰 엔드포인트가 테넌트를 알기 전에 찾는다). 토큰·code 는 SHA-256 해시만 저장(`CapabilityTokens.sha256Hex`).
- `oauth_client`: `id`, `client_id`(text unique — CIMD 는 그 URL, DCR 은 `swc_…`), `kind`('CIMD'|'DCR'), `client_name`, `redirect_uris text[]`, `logo_uri`/`client_uri`(있으면, 표시용), `fetched_at`(CIMD 캐시 시각), `created_at`.
- `oauth_connection`: `id`, `user_id` FK user cascade, `tenant_id` FK tenant cascade, `client_pk` FK oauth_client cascade, `created_at`, `last_used_at`, `revoked_at`. 같은 (사용자·워크스페이스·클라이언트)의 살아 있는 연결은 하나(부분 unique 인덱스) — 다시 허용하면 그 연결을 다시 쓴다. 다른 워크스페이스는 따로.
- `oauth_authorization_code`: `id`, `code_hash` unique, `connection_id` FK cascade, `redirect_uri`, `code_challenge`, `resource`, `expires_at`(10분), `used_at`, `created_at`.
- `oauth_token`: `id`, `connection_id` FK cascade, `kind`('ACCESS'|'REFRESH'), `token_hash` unique, `token_prefix`(앞 12자, 표시·로그용), `resource`, `expires_at`, `created_at`, `used_at`(refresh 회전 표시), `revoked_at`. 인증 hot path 의 해시 조회는 `token_hash` UNIQUE 인덱스를 탄다(같은 열의 부분 인덱스는 중복이라 두지 않음 — 리뷰 F7).

### 토큰
- 형식: `swo_` + base62(32바이트)(access), `swr_` + 같은 길이(refresh), code 는 `CapabilityTokens.generateUrlSafe(32)`.
- 수명: access 1시간, refresh 30일 — refresh 를 쓰면 그 refresh 는 `used_at` 이 찍히고 새 access·refresh(새 30일)를 준다. 이미 `used_at` 이 있는 refresh 를 또 쓰면 `invalid_grant` + 그 연결의 살아 있는 토큰 모두 `revoked_at`(연결은 남김 — 다시 허용하면 이어 씀) + 감사 `OAUTH_REFRESH_REUSE_DETECTED`.
- 회전은 엄격하게 한다(유예 없음 — OAuth 2.1·보안 BCP 권고): `used_at IS NULL` 조건의 원자적 UPDATE 로 한 번만 성공하고, 동시에 두 번 온 요청 중 늦은 쪽은 재사용으로 본다(남은 위험 — 클라이언트 재시도가 연결 토큰을 폐기할 수 있음, 다시 허용하면 이어 씀).
- 재사용·code 재사용 때의 폐기와 감사는 오류 응답과 따로 **먼저 커밋**한다(예외로 롤백되지 않게 — 별도 트랜잭션, 빌더 재량).
- 이미 쓴 code 를 또 쓰면 `invalid_grant` + 그 연결의 토큰 모두 폐기(RFC 6749 §4.1.2 권고). 10분 지난 code 는 `invalid_grant`.
- 연결 단위 직렬화(리뷰 D5.1): 발급 트랜잭션(code 교환·refresh 회전)과 재사용 처리 트랜잭션은 첫머리에서 `oauth_connection` 행을 `SELECT … FOR UPDATE` 로 잠그고, 잠근 뒤 다시 읽은 값(연결 미폐기, refresh 의 `used_at`·`revoked_at`)으로 판정한다 — 재사용 처리의 폐기가 동시에 발급되던 토큰을 놓치지 않는다. 재사용 처리는 늘 발급 트랜잭션이 끝나 잠금이 풀린 뒤에 연다. 쓰지 않았는데 폐기된 refresh 는 재사용이 아니라 평범한 `invalid_grant`(감사 없음).
- 받아들인 위험(리뷰 D5.5):
  - (a) 이미 쓴 code 가 다시 오면 요청의 `client_id` 와 상관없이 그 연결의 토큰을 폐기한다 — code 는 256비트 무작위라 남이 추측할 수 없고, code 를 가진 쪽은 이미 탈취 경로에 있다고 본다.
  - (b) 엄격 회전이라, 클라이언트가 응답을 못 받고 같은 refresh 로 다시 시도하면 그 연결의 토큰이 모두 폐기된다(다시 허용하면 이어 씀).
- 비밀번호를 바꾸면 그 사용자의 살아 있는 OAuth 연결을 모두 끊는다(연결·토큰 폐기, 연결 워크스페이스마다 감사 `OAUTH_CONNECTION_REVOKED` metadata `reason=password_change`) — 웹 refresh 세션을 모두 끊는 WP-566 과 같은 이유(리뷰 F5). PAT 는 그대로 둔다.

### API 엔드포인트
issuer = `workplace.public-base-url`(정규화, 끝 `/` 없음). 모든 메타데이터 URL 은 이 값으로만 만든다.
- `GET /.well-known/oauth-authorization-server` (공개): `issuer`, `authorization_endpoint` = `{issuer}/oauth/authorize`(웹 화면, WP-1686), `token_endpoint` = `{issuer}/api/v1/oauth/token`, `registration_endpoint` = `{issuer}/api/v1/oauth/register`, `response_types_supported:["code"]`, `grant_types_supported:["authorization_code","refresh_token"]`, `code_challenge_methods_supported:["S256"]`, `authorization_response_iss_parameter_supported:true`(RFC 9207 — redirect 에 `iss` 를 붙인다), `token_endpoint_auth_methods_supported:["none"]`, `client_id_metadata_document_supported:true`, `scopes_supported:[]` 대신 생략.
- `POST /api/v1/oauth/register` (공개, DCR, RFC 7591): JSON `redirect_uris`(필수, 1~10개, 규칙은 아래 「redirect_uri 규칙」), `client_name`(≤100자, 없으면 「이름 없는 앱」), `token_endpoint_auth_method` 는 `none` 만(다른 값은 `invalid_client_metadata`). 201 + `client_id`(`swc_…`)·`client_id_issued_at`·받은 메타데이터. 속도 제한 정책 `OAUTH_REGISTER`(기본 분당 10).
- `GET /api/v1/oauth/authorize/validate` (로그인 JWT·웹 세션·사람만): 쿼리 `response_type`, `client_id`, `redirect_uri`, `code_challenge`, `code_challenge_method`, `state`, `resource`, `scope`(무시).
  - 같은 파라미터가 두 번 오면 `invalid_request`(RFC 6749 §3.1, 리뷰 D4.1) — `client_id`·`redirect_uri` 가 겹치면 redirect 없이, 그 밖은 클라이언트·redirect_uri 확인 뒤 `errorRedirectUrl` 과 함께(겹친 `state` 는 싣지 않음). 승인 본문(JSON, camelCase 만 — 별칭 없음)도 같은 필드가 두 번 오면 같은 규칙, `tenantId`·`decision` 이 겹치면 redirect 없이.
  - 워크스페이스 목록은 로그인과 같다 — SSO 로그인 세션이면 SSO 를 켠 워크스페이스만(WP-48, `AuthService.membershipsOf`).
  - client_id 를 찾거나(CIMD 면 가져와) redirect_uri 가 등록 목록과 **정확히 같은지** 먼저 본다. 실패면 400 `{error:"invalid_client"|"invalid_redirect_uri", errorDescription}` — redirect URL 을 돌려주지 않는다.
  - 그 뒤의 오류(`response_type≠code`, PKCE 없음·S256 아님, `resource` 형식 오류)는 400 `{error, errorDescription, errorRedirectUrl}` — `errorRedirectUrl` = redirect_uri + `error`·`state`(웹이 그 주소로 보냄, RFC 6749 §4.1.2.1).
  - 성공 200 `{clientName, clientUri, redirectHost, unverified(DCR 이면 true), workspaces:[{tenantId,name,slug}], currentTenantId}`.
- `POST /api/v1/oauth/authorize` (같은 인증): JSON 위 파라미터 + `tenantId` + `decision`('ALLOW'|'DENY'). 검증을 다시 하고(검증 실패 응답은 validate 와 같다), DENY → 200 `{redirectUrl: redirect_uri?error=access_denied&state=…}`. ALLOW → 그 워크스페이스의 ACTIVE 멤버·ACTIVE 테넌트인지, SSO 세션이면 SSO 를 켠 워크스페이스인지 보고(로그인 세션과 같은 `AuthService.isTenantUsable`, 아니면 400 `invalid_request`, redirect 없음), 연결을 만들거나 다시 쓰고 code 를 만들어 `{redirectUrl: redirect_uri?code=…&state=…&iss=<issuer>}`. 새 연결이면 감사 `OAUTH_CONNECTION_CREATED`(그 테넌트).
- `POST /api/v1/oauth/token` (공개, `application/x-www-form-urlencoded`, 속도 제한 `OAUTH_TOKEN` 기본 분당 60, 응답 `Cache-Control: no-store`):
  - `grant_type=authorization_code` + `code`, `redirect_uri`(code 의 값과 같아야), `client_id`(code 의 연결 클라이언트와 같아야), `code_verifier`(S256 이 code_challenge 와 같아야), `resource`(있으면 기록 — 다르면 code 의 값을 씀).
  - `grant_type=refresh_token` + `refresh_token`, `client_id`.
  - grant 파라미터(`grant_type`·`code`·`code_verifier`·`redirect_uri`·`client_id`·`refresh_token`)가 쿼리 문자열에 있으면 `invalid_request`(폼 본문으로만 받는다 — 리뷰 D5.3).
  - 성공 200 `{access_token, token_type:"Bearer", expires_in:3600, refresh_token}`. 실패 400 `{error:"invalid_grant"|"invalid_request"|"unsupported_grant_type"|"invalid_client", error_description}`(RFC 6749 §5.2 — snake_case).
  - 토큰을 줄 때도 멤버십·테넌트 상태를 본다(해지됐으면 `invalid_grant`). SSO 규칙은 보지 않는다 — **받아들인 결정**(리뷰 F1): SSO 규칙(SSO 세션은 SSO 켠 워크스페이스만)은 연결을 승인할 때 지키고, 토큰 발급(code 교환·refresh)은 PAT 와 같은 기준(멤버십·테넌트 상태)만 본다. PAT 도 발급 때만 세션을 보고 사용 때는 SSO 를 보지 않는 것과 같다.
- `GET /api/v1/users/me/oauth-connections` (로그인 — PAT 목록 `/api/v1/users/me/api-tokens` 와 같은 자리·같은 인증 규칙): 내 살아 있는 연결 — `id, clientName, unverified, redirectHost, tenantId, tenantName, createdAt, lastUsedAt`. 모든 워크스페이스 것을 함께(사람 한 명의 연결 목록).
- `DELETE /api/v1/users/me/oauth-connections/{id}` (로그인 — PAT 폐기처럼 웹 세션을 요구하지 않는다): 내 것이 아니면 404. `revoked_at` + 그 연결 토큰 모두 폐기 + 감사 `OAUTH_CONNECTION_REVOKED`. 204.

### redirect_uri 규칙 (DCR·CIMD 같음)
- 등록할 때: 1~10개, 각 2000자 이하, 프래그먼트 없음. `https` 이거나 루프백 `http://localhost`·`http://127.0.0.1`·`http://[::1]` 만.
- 비교할 때: 문자열이 정확히 같아야 한다. 예외는 루프백 http 하나 — RFC 8252 §7.3 대로 포트만 무시하고 나머지(scheme·host·path·query)는 정확히 같아야 한다(Claude Code 같은 네이티브 클라이언트가 임의 포트를 쓴다).

### CIMD (client_id 가 https URL)
- `https` 만, 경로가 있어야 함(RFC 초안 — 루트만인 URL 거절), 프래그먼트·자격 증명 없는 URL. `SafeHttpFetcher`(80/443, 모든 IP 를 `InternalAddresses` 로 검사, 리다이렉트 재검사, 5초)로 가져오고 크기 상한 5KB, `application/json` 만.
- 문서의 `client_id` 가 URL 과 같아야 하고 `redirect_uris` 가 있어야 한다. `client_name`·`logo_uri`·`client_uri` 를 저장.
- 캐시: `oauth_client` 행이 있고 `fetched_at` 이 1시간 안이면 다시 가져오지 않는다. 가져오기 실패면 캐시가 24시간 안이면 그대로 쓰고, 아니면 `invalid_client`.

### `swo_` 인증
- `UserTokenAuthenticationFilter` 의 사람 전용 → `findActiveByUser` 에 tenant 포함 → `TenantStatusChecker.isActive` → `TenantContext.set` → 권한 → `UsernamePasswordAuthenticationToken(userId, null, authorities)` 를 공통 컴포넌트(`HumanTokenAuthenticator`)로 빼고 PAT 필터와 새 `OAuthAccessTokenAuthenticationFilter` 가 함께 쓴다. 새 필터는 AI 키·PAT·runner 필터처럼 `JwtAuthenticationFilter` 앞. `swo_` 만 다루고 해시로 살아 있는(미폐기·미만료) ACCESS 토큰 + 연결 미폐기를 찾는다. 성공 때 연결 `last_used_at` 을 갱신하되 1분에 한 번만 쓴다(`last_used_at IS NULL OR last_used_at < now() - interval '1 minute'` 조건 UPDATE — 요청마다 같은 행을 덮어쓰지 않게, 리뷰 F6).
- 테넌트 단위 정책: 사용(인증) 때는 PAT 와 같은 기준(멤버십·테넌트 상태)만 쓴다. SSO 규칙은 연결 승인 때 지킨다(위 「API 엔드포인트」).
- `swr_` 는 어떤 필터도 받지 않는다 → JWT 검증 실패 → 401.
- 웹 세션이 아니므로(`AuthDetails` 없음) PAT 처럼 토큰 발급·OAuth 승인 같은 웹 세션 전용 API 는 막힌다.

### MCP (`apps/workplace-mcp`)
- `bearerToken()` 이 `swo_` 도 받는다.
- 토큰이 없거나 API 가 401 을 주면 401 응답에 `WWW-Authenticate: Bearer resource_metadata="<그 경로의 보호 리소스 메타데이터 URL>"`. 본문 안내 문구는 PAT·AI 키와 Claude 앱 커넥터 OAuth 연결(`swo_`)을 함께 말한다(리뷰 F10).
- 공개 원점의 호스트는 `[A-Za-z0-9.\-:\[\]]` 만 받는다(리뷰 D7.1) — 아니면 401 안내는 `WORKPLACE_OAUTH_ISSUER` 의 원점으로 바꿔 달고, 그것도 없으면 `WWW-Authenticate: Bearer`(resource_metadata 없음). 메타데이터 경로는 400.
- `GET /.well-known/oauth-protected-resource/mcp`(그리고 `/mcp/readonly`, `/mcp/x/<앱>`, `/mcp/x/<앱>/readonly`): `{resource:"<공개 원점><MCP 경로>", authorization_servers:["<issuer>"], bearer_methods_supported:["header"]}`. 공개 원점은 요청의 `X-Forwarded-Proto`/`X-Forwarded-Host`(없으면 Host)로 만든다(Express `trust proxy`) — 사용자가 입력한 주소와 정확히 같게(webHost·mcpHost 어느 쪽이든). issuer 는 새 환경 변수 `WORKPLACE_OAUTH_ISSUER`(helm: `config.webBaseUrl`), 없으면 공개 원점.
- 패스스루 유지(비밀값 없음). 인증 캐시 60초는 그대로(남은 위험).

### 인그레스·로컬
- `deploy/helm/templates/ingress.yaml`: `/.well-known/oauth-authorization-server` Prefix → 서비스 `api`(9090, 이미 있음)를 webHost·mcpHost 둘 다에 **늘** 둔다(issuer 는 늘 webBaseUrl). `/.well-known/oauth-protected-resource` Prefix → mcp 는 mcpHost 에 늘, webHost 에는 `mcpPathOnWeb` 일 때만(지금 `/mcp` 와 같은 조건).
- 로컬 개발(vite 프록시)은 이 이슈에서 바꾸지 않는다 — 동의 화면(WP-1686)이 필요해지면 그때.

### CORS
- 메타데이터·`/api/v1/oauth/token`·`/api/v1/oauth/register` 는 브라우저 기반 MCP 클라이언트도 부르므로 `*` 원점·자격 증명 없음 CORS 를 따로 둔다(쿠키·세션을 쓰지 않는 공개 엔드포인트라 안전). 기존 `/api/**` CORS 는 그대로.

### 정리 작업
- `OAuthCleanupScheduler`(ShedLock, 1시간마다): 만료 24시간 지난 code·토큰 행 삭제, 연결이 하나도 생기지 않은 DCR 클라이언트는 만든 지 7일 뒤 삭제.

### 감사 로그
- `OAUTH_CONNECTION_CREATED`, `OAUTH_CONNECTION_REVOKED`, `OAUTH_REFRESH_REUSE_DETECTED`(code 재사용도 같은 이름에 metadata `grant`) — 연결의 테넌트로 `logInTenant`.

## 테스트
- API 통합(실제 HTTP — `UserTokenAuthenticationFilterTest` 본보기): 완료 기준 2~10 + DCR 검증, CIMD(가짜 fetcher로 정상·client_id 불일치·사설 주소 거절), validate 의 redirect 없는 오류와 `errorRedirectUrl`, DENY, 토큰 엔드포인트의 PKCE 불일치·redirect_uri 불일치·client 불일치, 정리 작업, 속도 제한 정책.
- MCP vitest: 401 + `WWW-Authenticate`(토큰 없음·API 401), 보호 리소스 메타데이터(경로별 resource, forwarded 헤더), `swo_` 통과.
- 완료 기준 1 은 MCP 테스트로, 3 의 「MCP 도구가 그 사용자로」는 MCP 가 패스스루라 API 로 `swo_` 를 넣어 `/auth/me`·이슈 목록이 그 사용자·워크스페이스로 나오는 것으로 지킨다.

## 빌더에게 남김
- 클래스 나눔(패키지 `com.workplace.oauth` 아래 controller/service/repository/dto), 테스트 파일 나눔, 오류 응답 DTO 모양(위 필드 이름은 지킨다).
