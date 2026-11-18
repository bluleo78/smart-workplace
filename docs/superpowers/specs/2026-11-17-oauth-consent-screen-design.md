# OAuth 동의 화면(웹) 설계 — WP-1686

부모 WP-1669(기획 확정 — 방안 A, 시안 그림 3·4). 앞: WP-1685(서버, 이 브랜치의 바탕 커밋 d73ac6102 — spec `2026-11-17-oauth-authorization-server-design.md`). 뒤: WP-1687(연결된 앱 목록·끊기), WP-1688(Cowork). 무인 work-loop 세션 — 설계 승인은 스스로 하고, 시안이 정하지 않은 UI/UX 는 끝의 「시안이 정하지 않은 UI/UX — 정한 것」(옛 열린 질문 Q1–Q5)에 결정으로 남긴다. 구현 계획: `docs/superpowers/plans/2026-11-17-oauth-consent-screen.md`.

## 왜

Claude 앱(데스크톱·웹·모바일)의 커스텀 커넥터는 MCP 주소만 받고 표준 OAuth 로 로그인한다. WP-1685 가 인가 서버(메타데이터·클라이언트 등록·검증/승인 API·토큰)를 만들었지만, 메타데이터가 가리키는 인가 엔드포인트 `{issuer}/oauth/authorize` 는 **웹 화면**이라 아직 없다. 사람이 로그인하고, 연결할 워크스페이스를 고르고, 「허용」을 누를 화면이 없으면 연결이 끝나지 않는다. 또 모르는 연결을 알아챌 수 있게 새 연결이 생기면 본인에게 알린다.

## 목표 / 하지 않음

- 목표
  - 웹 `/oauth/authorize`: 로그인(비밀번호·SSO) 뒤 같은 주소로 돌아오고, 쿼리를 서버 검증에 넘겨 결과만 그린다. 「허용」·「거부」는 서버 승인 API 를 부르고 돌려받은 주소로 이동만 한다.
  - 상태: 확인 중, 동의 카드(워크스페이스 1개·여러 개, 「확인되지 않은 앱」), AI 계정 막음, redirect 없는 오류, 클라이언트로 돌려보내는 오류, 보내는 중, 이동 중, 다른 화면 안(iframe)에서 열림.
  - 동의 경로만 `frame-ancestors 'none'`(web nginx).
  - 새 연결 알림 「새 앱 연결 — <앱 이름>」(본인, 인박스·푸시).
  - 매뉴얼 12장에 「Claude 앱에 연결한다」 절.
  - 로컬에서 끝까지(curl + 브라우저, 가능하면 Claude Code) 연결해 본다.
- 하지 않음
  - 설정 › API 토큰 「연결된 앱」 목록·끊기, 연결 안내 절의 커넥터 주소 복사(WP-1687).
  - Cowork 마켓플레이스(WP-1688).
  - scope 고르기, AI 계정 OAuth, 앱 로고 표시, 외부 앱 개발자용 등록 화면.
  - 서버 검증·승인 규칙 변경(WP-1685 그대로 쓴다 — 알림 이벤트 발행만 더한다).
- 실패로 보는 것: 검증되지 않은 redirect_uri 로 브라우저가 이동함, 「허용」 한 번에 code 가 두 번 발급됨, 미로그인 사용자가 로그인 뒤 홈에 떨어져 연결이 끊김, 동의 화면이 다른 화면 안에서 눌림, 같은 연결을 다시 허용할 때마다 알림이 쌓임, 390px 에서 가로 스크롤.

## 제약

- 서버 계약(WP-1685, `auth/oauth/controller/OAuthAuthorizeController.java`)
  - `GET /api/v1/oauth/authorize/validate?<OAuth 쿼리 그대로>` — 웹 세션 JWT 만(`@RequireWebSession`). 같은 파라미터가 두 번 오면 서버가 거절하므로 **쿼리를 손대지 않고 그대로 넘긴다**.
    - 200 `{clientName, clientUri|null, redirectHost, unverified, workspaces:[{tenantId,name,slug}], currentTenantId|null}` — 계정 이름·이메일은 없다(화면은 `useAuth().user` 에서 읽는다).
    - 400 `{error, errorDescription, errorRedirectUrl?}` — `errorRedirectUrl` 은 client·redirect_uri 를 믿을 수 있게 된 뒤의 오류에만 있다.
    - 403 `ErrorResponse{status,error,message}` — AI 계정(「AI 계정은 앱을 연결할 수 없습니다.」) 또는 웹 세션이 아님.
  - `POST /api/v1/oauth/authorize` JSON camelCase `{responseType, clientId, redirectUri, codeChallenge, codeChallengeMethod, state, resource, tenantId, decision:'ALLOW'|'DENY'}` → 200 `{redirectUrl}`. 오류 모양은 validate 와 같고, ALLOW 의 tenantId 없음·쓸 수 없는 워크스페이스는 redirect 없는 400.
  - 응답은 `no-store`. code 는 1회용·10분 — 「허용」 한 번에 POST 한 번이어야 한다.
- 웹: 메모리 JWT(`api/client.ts`) — 401 이면 refresh 1회, 거절이면 `/login` 으로 전체 이동(대기 목적지를 남기지 않는다). 전역 오류 토스트는 없다.
- 로그인 복귀 장치는 이미 있다 — sessionStorage `pendingPushTarget`(`lib/push/openTarget.ts`)을 `ProtectedRoute` 가 정해진 접두 경로에서만 남기고, 로그인 뒤 `AppLayout` 이 한 번 꺼내 이동한다. 다중 소속(`selectTenant` 전체 리로드)·SSO(Microsoft 왕복 뒤 `/login/sso/complete` → `/`)도 같은 탭이라 그대로 산다.
- 디자인 시스템: 시맨틱 토큰만(hex 금지), shadcn primitives 수동 편집 금지. 비로그인 화면 카드 제목은 `AuthCardTitle`(h1) + `main` 랜드마크(WP-1429).
- 테스트 판정(apps/workplace-web/CLAUDE.md): 기본 vitest, E2E 는 태그 이유가 있을 때만. 매뉴얼 동반 수정(WP-1198) — `manual:check`·`manual:prose` 통과.
- AI 계정(AGENT)은 비밀번호가 없어 웹 로그인을 하지 못한다(`UserRepository` L613). 「사람 계정 전용」은 서버 403 에 맞춘 방어 화면이다.

## 접근 방안

- **A. ProtectedRoute 안·AppLayout 밖 라우트 + 기존 로그인 복귀 장치 — 고름.**
  `<Route element={<ProtectedRoute />}>` 바로 아래(메일 작성 새 창 WP-1535 와 같은 자리)에 `oauth/authorize` 를 두고, `ProtectedRoute.LOGIN_RETURN_PREFIXES` 에 `/oauth/authorize` 를 더한다. 확인 중·연결 오류(WP-859 다시 시도)·미로그인 → 로그인 → 복귀를 새 코드 없이 물려받는다. 기획의 「공개 라우트」는 「앱 셸 밖의 독립 화면」으로 읽는다 — 로그인 없이는 아무것도 그리지 않으므로 보호 라우트가 맞다. 복귀 대상으로 남겨도 안전한 이유: 화면이 계정을 보이고 사용자가 「허용」을 눌러야만 무엇이 생긴다(ProtectedRoute 주석의 「다른 계정으로 로그인했을 때 이전 사용자 화면으로 튐」 걱정은 여기선 화면이 계정을 밝히는 것으로 풀린다).
- B. 공개 라우트에서 화면이 스스로 인증을 판정(ShareLinkPage 처럼 `useAuth` 로 보고 `savePendingPushTarget` + `/login`) — 버림: ProtectedRoute 의 로딩·연결 오류·로그인 이동을 화면에 다시 쓰게 되고, 두 곳이 어긋나기 쉽다. 얻는 것이 없다.
- C. 로그인 화면이 `returnTo` 쿼리를 받게 바꿔 동의 화면이 `/login?returnTo=…` 로 보냄 — 버림: LoginPage·WorkspaceSelectCard·SSO 버튼·selectTenant 를 모두 고쳐야 하고, 이미 같은 일을 하는 sessionStorage 장치와 두 갈래가 된다. 쿼리가 긴 OAuth 주소를 주소창에 한 번 더 싣는 것도 이득이 없다.

## 화면 상태 (내가 정한 것)

화면은 한 장의 카드다. 바깥은 `main`(가운데 정렬, `min-h-svh`, 좌우 `px-4`), 카드는 `w-full max-w-md` (시안 데스크톱 약 448px, 모바일 390 에서 좌우 16px). 상태마다 카드 안만 바뀐다.

1. **세션 확인 중** — ProtectedRoute 가 그린다(「Loading...」). 바꾸지 않는다.
2. **로그인으로** — 미로그인이면 ProtectedRoute 가 `{tenantId:null, url:'/oauth/authorize?<원래 쿼리>'}` 를 남기고 `/login`. 로그인(다중 소속이면 워크스페이스 선택, SSO 면 Microsoft 왕복) → `/` → AppLayout 이 남긴 주소로 이동 → 동의 화면. 쿼리는 `safeTarget` 이 같은 출처 상대 경로로만 통과시킨다.
3. **요청 확인 중** — validate 를 기다리는 동안 카드 뼈대(Skeleton) + `role="status"` 「연결 요청을 확인하는 중…」.
4. **동의 카드** (시안 그림 3·4)
   - 머리: 앱 머리글자 타일(`clientName` 첫 글자, `bg-muted`) ↔ `BrandMark`, 제목(h1) 「{clientName} 연결」, 그 아래 `redirectHost`(muted). 로고 주소는 서버가 주지 않고, 사용자 브라우저가 임의 주소의 그림을 가져오게 하지 않는다.
   - 「확인되지 않은 앱」(`unverified`=DCR): 제목 옆 배지(`bg-warning-subtle text-warning-text`) + 머리 아래 한 줄 「Gen:iA Works 가 확인하지 않은 앱입니다. 위 주소가 연결하려던 앱이 맞는지 확인하세요.」 — DCR 은 아무나 이름을 「Claude」로 등록할 수 있어 호스트를 보게 한다. (`redirectHost` 는 이 줄 **위**, 제목 바로 아래에 있으므로 「위 주소」 — 계획 단계에서 「아래 주소」를 고쳤다.)
   - 정보 상자(`dl`): **계정** 이름(굵게)·이메일(없으면 아이디) / **워크스페이스** / **권한** 「내 권한 그대로 · 읽기·쓰기」 + 작은 줄 「이슈·노트·드라이브·메일·채널·캘린더·연락처」(시안 문구 그대로).
   - 워크스페이스: 하나면 이름만. 여럿이면 셀렉트(shadcn Select, 라벨 「워크스페이스」) — 기본은 `currentTenantId`, 없으면 목록 첫 항목. 0개(SSO 세션인데 SSO 켠 곳이 없음 등)면 「연결할 수 있는 워크스페이스가 없습니다」를 보이고 「허용」을 끈다(「거부」는 된다).
   - 단추: 「거부」(outline) · 「허용」(primary), 같은 폭 두 칸. 「허용」에 자동 포커스를 주지 않는다 — 열자마자 Enter 로 승인되지 않게.
   - 맨 아래 muted 글자 「연결 끊기: 설정 › API 토큰 › 연결된 앱」 — 링크가 아닌 글자(동의 도중 다른 화면으로 새지 않게).
5. **보내는 중** — 누른 단추에 `Loader2`, 두 단추 모두 비활성. 같은 틱의 두 번 클릭도 POST 한 번(진행 중 표시를 ref 로도 막는다).
6. **이동 중** — 200 `{redirectUrl}` 을 받으면 카드 대신 `role="status"` 「앱으로 돌아가는 중…」 + `window.location.replace(redirectUrl)`. `replace` — 뒤로 가기로 이미 쓴 동의 화면이 다시 열려 code 를 또 만들지 않게. 이동 전에 주소가 `http:`/`https:` 인지 확인한다(서버가 https·루프백 http 만 등록받지만, `javascript:` 같은 주소로는 어떤 경우에도 가지 않게 한 번 더). 아니면 오류 카드.
7. **redirect 없는 오류**(validate 400 에 `errorRedirectUrl` 없음 — 등록 안 된 redirect_uri, 모르는 client_id, client_id·redirect_uri 겹침 등) — `role="alert"` 카드: 제목 「연결할 수 없습니다」, 본문 서버 `errorDescription`(한국어), 「이 창을 닫고 연결하려던 앱에서 다시 시도해 주세요.」, 작은 글자로 오류 코드(`invalid_redirect_uri` 등 — 문의용). 링크 「Gen:iA Works 로 가기」(`/`). **어디로도 자동 이동하지 않는다**(완료 기준 4).
8. **클라이언트로 돌려보내는 오류**(validate 400 에 `errorRedirectUrl` — response_type·PKCE·resource 오류, 겹친 state 등) — RFC 6749 §4.1.2.1 대로 상태 6처럼 「앱으로 돌아가는 중…」 후 그 주소로 `replace`. 앱이 오류를 받아 사용자에게 알린다.
9. **승인 실패**(POST)
   - 400 + `errorRedirectUrl` → 상태 8.
   - 400 redirect 없음(워크스페이스를 쓸 수 없음 등) → 카드는 두고 단추 위 `role="alert"` 줄에 `errorDescription`, 단추 다시 켬(다른 워크스페이스를 고를 수 있게).
   - 403 → 상태 10 또는 서버 문구 오류 카드.
   - 5xx·네트워크 → 단추 위 「잠시 뒤 다시 눌러 주세요.」 단추 다시 켬.
   - 401 → `api/client.ts` 가 refresh 하고, 거절이면 `/login` 으로 보낸다(받아들인 위험 R1).
10. **사람 계정 전용** — `user.kind === 'AGENT'` 이면 validate 를 부르지 않고 `role="alert"` 카드 「사람 계정 전용」 / 「AI 계정으로는 앱을 연결할 수 없습니다. 사람 계정으로 로그인해 다시 시도해 주세요.」. 서버 403 이 오고 사용자가 AGENT 면 같은 카드, 아니면 상태 7 모양에 서버 `message`.
11. **validate 일시 실패**(5xx·네트워크) — 「연결 요청을 확인하지 못했습니다」 + 「다시 시도」(다시 조회). 재시도는 TanStack Query `retry: false` + 수동.
12. **다른 화면 안(iframe)에서 열림** — `window.top !== window.self` 면 아무 API 도 부르지 않고 「이 화면은 다른 화면 안에서 열 수 없습니다.」만 보인다. nginx 헤더(아래)가 1차 방어이고, 서비스 워커·SPA 안 이동으로 nginx 헤더 없이 그려지는 경우를 이 검사가 덮는다.

## 라우트·컴포넌트·파일 계획

웹(`apps/workplace-web`)
- `src/App.tsx` — `OAuthConsentPage` lazy, `<Route element={<ProtectedRoute />}>` 바로 아래 AppLayout 밖에 `<Route path="oauth/authorize" element={<OAuthConsentPage />} />`.
- `src/components/ProtectedRoute.tsx` — `LOGIN_RETURN_PREFIXES` 에 `'/oauth/authorize'` (주석에 이유).
- `src/pages/oauth/OAuthConsentPage.tsx`(신규) — 화면 셸(main·카드)과 상태 분기. 쿼리 읽기 → validate(useQuery, `retry:false`, `staleTime: Infinity`, 창 포커스 재조회 끔) → 동의 카드 / 오류 / 이동.
- `src/pages/oauth/OAuthConsentCard.tsx`(신규) — 동의 카드(앱 머리, 확인되지 않은 앱, `dl` 3줄, 워크스페이스 고르기, 단추, 끊기 안내). 승인은 useMutation(응답을 캐시에 넣지 않는다 — code 가 들어 있다).
- `src/api/oauth.ts`(신규) — `validateAuthorize(search: string)` = `client.get('/oauth/authorize/validate' + search)`(쿼리를 다시 만들지 않는다), `decideAuthorize(body)`.
- `src/types/oauth.ts`(신규) — `AuthorizeValidateResponse`·`AuthorizeWorkspace`·`AuthorizeDecisionRequest`·`AuthorizeRedirectResponse`·`OAuthAuthorizeError`(서버 DTO 와 1:1).
- `src/lib/oauthConsent.ts`(신규, 순수 함수 + 이동 한 줄)
  - `decisionBody(params: URLSearchParams, tenantId, decision)` — snake_case 쿼리 → camelCase 본문(각 이름의 첫 값, 없으면 빼서 서버가 null 로 받게).
  - `initialTenantId(validate)` — currentTenantId ?? 첫 항목 ?? null.
  - `isNavigableRedirect(url)` — `http:`/`https:` 절대 주소만.
  - `readAuthorizeError(err)` — axios 오류 → `{kind:'redirect', url} | {kind:'inline'|'fatal', code, description} | {kind:'agent'} | {kind:'transient'}`.
  - `isFramed(win)` — `win.top !== win.self`(접근 예외도 true).
  - `leaveTo(url)` — `window.location.replace(url)`(테스트에서 vi.mock).
- `src/lib/documentTitle.ts` — `'oauth'` → `['앱 연결']`.
- `src/sw/logic.ts` — `NAVIGATION_DENYLIST` 에 `/^\/oauth\/authorize/` — 서비스 워커가 캐시한 index.html(`frame-ancestors 'self'`)로 답하지 않고 nginx 로 가 동의 경로 헤더를 받게. (`isOutsideSpaPath` 도 같은 목록 — 앱 링크 카드는 새 탭으로 연다, 문제 없음.)
- `vite.config.ts` — 프록시에 `'/.well-known/oauth-authorization-server': API_TARGET` 추가(로컬 Claude Code 연결용. 운영은 인그레스가 이미 api 로 보낸다). WP-1685 spec 이 「동의 화면이 필요해지면 그때」로 미뤄 둔 것.
- `nginx.conf` + `scripts/nginx-security-headers.test.mjs` — 아래 「nginx」.
- 알림 웹 쪽 — 아래 「API 변경」의 새 종류를 그리는 곳: `src/types/notification.ts`(유니온), `src/lib/notifText.ts`(`ACTION_LABEL` Record — 빠뜨리면 tsc 오류), `src/components/layout/InboxList.tsx`(전용 줄: 굵게 「새 앱 연결 — {message}」 + 작은 줄 「내가 연결하지 않았다면 설정 › API 토큰에서 끊어 주세요」), `src/components/home/notifTarget.ts`(→ `/settings/tokens`), `src/components/home/widgets/dashboard/NotificationGroupRow.tsx`(아이콘 `Plug`), `src/lib/notifGrouping.ts`(순서·요약 「앱 연결」, 계정 알림 묶음은 PERSONAL_ASSISTANT_REVOKED 와 같은 규칙).

API(`apps/workplace-api`) — 아래 「API 변경」.

매뉴얼 — `docs/manual/user/12-my-settings.md`, `docs/manual/shots/targets.md`.

## API 변경 — 새 연결 알림 (내가 정한 것)

- **언제**: 「허용」이 **새 연결을 만들 때만**(`OAuthConnectionRepository.Created.created() == true` — 이미 감사 `OAUTH_CONNECTION_CREATED` 를 남기는 바로 그 분기). 살아 있는 같은 연결(사용자·워크스페이스·앱)을 다시 허용하면 보내지 않는다 — Claude 가 토큰을 잃고 다시 연결할 때마다 알림이 쌓이지 않게. 끊은 뒤 다시 연결하면 새 행이라 다시 알린다. 다른 워크스페이스로 같은 앱을 연결하면 그 워크스페이스에 따로 알린다(목록에도 두 줄). 거부는 알리지 않는다.
- **흐름**(WP-1170 개인 비서 회수 알림과 같은 길 — 도메인은 알림 모듈을 모르고 이벤트만 낸다)
  - `auth/outbound/OAuthConnectionCreatedEvent(long tenantId, long userId, String clientName)` 신규.
  - `OAuthAuthorizationService.issueCode` 의 `if (c.created())` 안에서 감사 뒤 `publisher.publishEvent(...)`(같은 트랜잭션 — 커밋돼야 나간다).
  - `NotificationDispatcher.onOAuthConnectionCreated` — `@Async("notifyEventExecutor") @TransactionalEventListener(AFTER_COMMIT)`, `TenantContext.runAs(e.tenantId(), …)`, 실패는 `log.warn`(알림 실패로 연결을 되돌리지 않는다).
  - `NotificationService.createOAuthAppConnectedAndFanOut(long userId, String clientName)` — `repo.insertAccountNotice(userId, OAUTH_APP_CONNECTED, null, clientName)` + `registry.fanOut([userId], "notify.created", {type})` + 푸시.
  - `NotificationRepository.insertAccountNotice` 를 행위자 null·message 를 받는 형태로 넓힌다(기존 호출은 그대로 — 오버로드). 앱 이름은 `notification.message` 에 둔다(DCR 이름 ≤100자, CIMD 이름도 서버가 자른 값).
- **종류**: `NotificationType.OAUTH_APP_CONNECTED`(VARCHAR, 마이그레이션 없음). 행위자 없음 — 본인이 한 일을 「시스템」이 알리는 계정 알림.
  - 알림 설정 줄 없음 — 늘 보낸다(보안 알림 — 끌 수 있으면 「모르는 연결을 알아챈다」가 무너진다). `NotificationSettingItem` 에서 PERSONAL_ASSISTANT_REVOKED 처럼 예외 분기, 테스트 갱신.
  - 푸시: `PushCategory` 는 MENTION(「나를 향한」 계정 알림 — PERSONAL_ASSISTANT_REVOKED 와 같음). `PushContentService` 전용 메시지: 제목 「새 앱 연결」, 본문 「{앱 이름} — 내가 연결하지 않았다면 설정 › API 토큰에서 끊어 주세요」, url `/settings/tokens`, tag `oauth-app-connected`. 앱 이름은 `InboxPushRequestedEvent` 의 스냅샷 제목 칸(`eventTitle` — 일정 취소 알림이 그때의 제목을 싣는 칸)에 실어 보낸다 — 레코드에 칸을 더하지 않는다(계획 단계에서 정함).
  - MCP `list_notifications` 는 종류 문자열·message 를 그대로 싣는다 — 추가 작업 없음.

## nginx — 동의 경로만 `frame-ancestors 'none'`

`apps/workplace-web/nginx.conf` 에 정확 일치 location 을 더한다(add_header 는 location 사이에 상속되지 않으므로 `location /` 의 나머지 줄을 함께 옮긴다):

```nginx
location = /oauth/authorize {
    add_header Cache-Control "no-cache";
    add_header Content-Security-Policy "frame-ancestors 'none'" always;
    add_header X-Frame-Options "DENY" always;
    sub_filter '__PUBLIC_HOST__' '$host';
    sub_filter_once off;
    sub_filter_last_modified on;
    try_files /index.html =404;
}
```

- 정확 일치라 쿼리(`?client_id=…`)가 붙어도 이 블록이 잡는다(location 은 쿼리를 보지 않는다). `/oauth/m365/callback` 은 그대로 `location /`(팝업은 같은 출처 창이고 iframe 이 아님).
- `X-Robots-Tag` 는 붙이지 않는다(map 값이 이 주소에선 빈 값이고 색인될 내용도 없다).
- `scripts/nginx-security-headers.test.mjs`: 「index.html 을 내보내는 location 마다 'self'」 단언에서 `= /oauth/authorize` 를 빼고, 그 location 은 `'none'`·`DENY` 를 따로 단언한다. 웹 설정에 그 location 이 **있어야** 한다는 단언도(지워지면 실패).
- 이미 모든 화면이 `'self'` 라 다른 출처 iframe 은 지금도 막힌다. `'none'` 은 같은 출처 iframe 까지 막는다 — 동의 화면은 어떤 프레임에도 들어갈 이유가 없다. 서비스 워커 우회는 위 `NAVIGATION_DENYLIST`, SPA 안 이동(로그인 복귀가 `navigate` 로 들어옴 — 문서 헤더는 `/` 의 `'self'`)은 상태 12의 JS 검사가 덮는다.

## 접근성

- `main` 랜드마크 + h1(「{앱} 연결」 — `AuthCardTitle` 과 같은 모양). 오류·막음 카드도 h1 하나.
- 정보 상자는 `dl`/`dt`/`dd` — 라벨과 값이 짝으로 읽힌다. 워크스페이스 셀렉트는 `dt` 를 `label` 로(`id` 연결) — 「워크스페이스」로 읽힌다.
- 확인 중·이동 중은 `role="status" aria-live="polite"`, 오류·승인 실패 줄은 `role="alert"`.
- 아이콘·머리글자 타일은 `aria-hidden`(앱 이름은 h1 에 있다). 「확인되지 않은 앱」 배지는 글자라 색만으로 뜻을 싣지 않는다(경고 토큰은 대비 AA 인 `text-warning-text`).
- 탭 순서: (셀렉트) → 거부 → 허용. 자동 포커스 없음. 보내는 중 단추는 `disabled` + `aria-busy`.
- 탭 제목 「앱 연결 - Gen:iA Works」(documentTitle).

## 모바일 390px

- 바깥 `px-4`(16px), 카드 `w-full max-w-md` — 시안 그림 4처럼 한 단.
- 정보 줄 `flex items-start justify-between gap-3`, 값 칸 `min-w-0 text-right break-words` — 긴 이메일·앱 이름이 줄바꿈되고 넘치지 않는다. `redirectHost` 는 `break-all`.
- 권한 작은 줄은 390 에서 빠듯하므로 줄바꿈 허용(`text-xs`, 줄 수 제한 없음).
- 셀렉트 트리거는 `max-w-[60%]` + 글자 `truncate`(긴 워크스페이스 이름). 펼친 목록은 Radix 포털이라 카드 폭에 묶이지 않는다.
- 단추 `grid grid-cols-2 gap-2`.
- 기하(가로 넘침)는 jsdom 이 잴 수 없어 `@layout` E2E 로 지킨다.

## 테스트

판정은 apps/workplace-web/CLAUDE.md 「테스트 종류 판정」대로 — 브라우저 없이 판정되는 것은 모두 vitest.

vitest — 순수 함수 `src/lib/oauthConsent.test.ts`
- `decisionBody`: 쿼리 7개 → camelCase, 빠진 값은 키 없음, ALLOW·DENY·tenantId.
- `initialTenantId`: current 있음/목록 밖 null/없으면 첫 항목/빈 목록.
- `isNavigableRedirect`: https·루프백 http 통과, `javascript:`·`data:`·상대 경로·깨진 주소 거절.
- `readAuthorizeError`: 400+errorRedirectUrl → redirect, 400 단독 → inline/fatal, 403 → agent(사용자 AGENT)·fatal, 5xx·네트워크 → transient.
- `isFramed`: top===self false, 다름 true, top 접근 예외 true.

vitest — 화면 `src/pages/oauth/oauthConsent.test.tsx` (`renderScreen(<OAuthConsentPage/>, { path:'/oauth/authorize?…', handlers, auth })`, `leaveTo` 는 `vi.mock`)
- 쿼리를 그대로 validate 로 넘긴다 — 겹친 `state` 가 두 번 그대로 나간다(MSW 에서 `url.searchParams.getAll`).
- 워크스페이스 1개 → 이름만, 셀렉트 없음. (완료 기준 2 화면 쪽)
- 워크스페이스 2개 → 셀렉트, 기본 currentTenantId, 다른 것 고르고 「허용」 → POST 본문(camelCase 전부 + 고른 tenantId + `ALLOW`) → `leaveTo(redirectUrl)`. (완료 기준 1·2)
- 「거부」 → POST `decision:'DENY'` → `leaveTo(redirectUrl)`. (완료 기준 3 화면 쪽)
- `unverified:true` → 「확인되지 않은 앱」 배지와 안내 줄, false 면 없음. (완료 기준 6)
- validate 400 `invalid_redirect_uri`(redirect 없음) → 「연결할 수 없습니다」+ 서버 문구, `leaveTo` 안 불림, 단추 없음. (완료 기준 4)
- validate 400 + `errorRedirectUrl` → `leaveTo(errorRedirectUrl)`.
- POST 400 redirect 없음 → 단추 위 서버 문구, 단추 다시 켜짐. POST 400 + `errorRedirectUrl` → `leaveTo`. POST 500 → 「잠시 뒤 다시 눌러 주세요.」
- 같은 틱 두 번 클릭(`act` 안 `dispatchEvent` 두 번) → POST 한 번.
- AGENT 사용자 → 「사람 계정 전용」, validate 안 부름. 사람인데 403 → 서버 문구 오류 카드.
- validate 500 → 「다시 시도」 → 다시 조회 후 카드.
- 워크스페이스 0개 → 안내 + 「허용」 비활성, 「거부」 됨.
- `redirectUrl` 이 `javascript:` → 이동 안 함, 오류 카드.
- 프레임 안(`isFramed` 를 true 로 mock) → 막음 문구, validate 안 부름.
- 계정 줄: 이름·이메일, 이메일 null 이면 아이디.

vitest — 기존 파일에 더함
- `src/components/ProtectedRoute.test.tsx`: 미로그인 `/oauth/authorize?client_id=…&state=…` → 그 주소 그대로 대기 목적지에 남는다(로그인 복귀 — 완료 기준 1 앞단).
- `src/lib/documentTitle.test.ts`: `/oauth/authorize` → `['앱 연결']`.
- `src/sw/logic.test.ts`: `NAVIGATION_DENYLIST` 가 `/oauth/authorize` 를 막는다(`/oauth/m365/callback` 은 아님).
- 알림: `notifText.test.ts`·`notifTarget.test.ts`(→ `/settings/tokens`)·`notifGrouping.test.ts` 에 OAUTH_APP_CONNECTED, InboxList 줄 문구(기존 인박스 화면 테스트 `appRail.test.tsx` 의 PERSONAL_ASSISTANT_REVOKED 옆). (완료 기준 7 화면 쪽)

Playwright E2E — `e2e/pages/oauth/oauth-consent.spec.ts` (API 는 `page.route`, 클라이언트 redirect 주소도 `page.route` 로 받아 netns 밖으로 나가지 않게)
- `@wiring @smoke` — 라우트 → validate → 카드 → 「허용」 → POST → 브라우저가 redirect 주소로 실제 이동(그 주소의 code·state). 화면당 1건.
- `@layout` — 390px, 긴 앱 이름·이메일·워크스페이스 이름 + 워크스페이스 둘 + 확인되지 않은 앱: `scrollWidth <= clientWidth`, 카드·단추가 뷰포트 안. (완료 기준 8)
- `@flow` — 미로그인으로 `/oauth/authorize?…` → 로그인 화면 → 로그인 → 같은 쿼리의 동의 화면(ProtectedRoute → LoginPage → AppLayout 소비 → 동의 화면, 여러 화면을 넘나든다).
- `@platform` — 같은 출처 iframe 에 동의 화면을 넣으면 프레임 안은 막음 문구만 보이고 validate 요청이 없다(실제 `window.top` 관계는 브라우저에서만 참이다). nginx 헤더는 dev/preview 서버에 없어 여기서 보지 않는다. (완료 기준 5 의 JS 쪽)

nginx — `node --test scripts/nginx-security-headers.test.mjs`(글자) + 라이브에서 nginx 컨테이너로 `curl -I /oauth/authorize?x=1` → `frame-ancestors 'none'`·`X-Frame-Options: DENY`, `/` 는 그대로 `'self'`. (완료 기준 5)

API JUnit
- `OAuthAuthorizeTest`(또는 새 `OAuthConnectionNotificationTest`, `@RecordApplicationEvents`): 처음 ALLOW → `OAuthConnectionCreatedEvent(tenantId, userId, clientName)` 1건, 같은 연결 다시 ALLOW → 없음, DENY → 없음, 다른 워크스페이스 ALLOW → 그 tenantId 로 1건, 끊은 뒤 다시 ALLOW → 1건.
- 알림 생성: `createOAuthAppConnectedAndFanOut` → `listRecent(user)` 에 type `OAUTH_APP_CONNECTED`, `message` = 앱 이름, `actorId` null. 그 사용자가 알림 설정을 모두 꺼도 들어간다. 다른 워크스페이스 인박스엔 없다(RLS).
- 이벤트 → 리스너 끝까지 한 건(커밋 뒤 비동기 — 기존 dispatcher 테스트 방식으로 기다림).
- `NotificationSettingItemTest`(설정 줄 없음 예외), `PushContentService` 문구·url.
(완료 기준 7)

## 매뉴얼 (WP-1198)

- `docs/manual/user/12-my-settings.md`
  - 프론트매터 `routes` 에 `/oauth/authorize` 추가(`manual:check` 가 App.tsx 경로를 장에 대조한다. `/oauth/m365/callback` 만 제외 목록).
  - 「외부 AI 도구를 연결한다」 아래 새 절 `### Claude 앱에 연결한다` — `{help=…}` 는 달지 않는다(동의 화면엔 도움말 패널이 없고, 토큰 화면의 안내 블록은 WP-1687 이 만든다 — 그때 help 키를 단다).
    - Claude 앱(데스크톱·웹·모바일) 설정의 커넥터에 연결 주소(`https://<회사 주소>/mcp`)를 넣으면 브라우저에 Gen:iA Works 가 열린다. 로그인하지 않았으면 로그인(Microsoft 로그인 포함) 뒤 같은 화면으로 돌아온다.
    - 동의 화면: 계정·**워크스페이스**(여럿이면 고른다)·권한을 확인하고 **허용**. **거부** 하면 연결되지 않는다. 앱 이름 옆 **확인되지 않은 앱** 이 보이면 주소가 맞는지 확인한다.
    - 토큰을 발급·복사하지 않는다(PAT 와의 차이). 연결하면 알림 「새 앱 연결」이 온다.
    - 끊기는 **설정 › API 토큰 › 연결된 앱**(WP-1687 이 화면을 만들 때 그 절과 잇는다).
    - 오류: 「연결할 수 없습니다」가 보이면 앱에서 다시 연결, 「사람 계정 전용」은 AI 계정.
  - 「도구에 연결한다」 3번의 「Claude.ai 같은 다른 도구 = 주소 + 토큰」 문장은 Claude 앱이 이제 토큰 없이 연결된다는 것과 어긋나므로 「Claude 앱은 아래 Claude 앱에 연결한다를 본다」로 한 줄 고친다(화면 문구 자체는 WP-1687 이 바꾼다).
  - 「받을 알림을 고른다」에 「새 앱 연결 알림은 끌 수 없다」 한 줄.
  - 굵게 쓰는 문구는 모두 새 화면 소스의 글자 그대로(`manual:prose`).
- 그림: 새 그림 `my-settings-10`(동의 화면, 데스크톱 1440 — 워크스페이스 둘·셀렉트 표식 `account,workspace,permission,allow`). 촬영 장면에는 OAuth 클라이언트 등록(DCR)과 PKCE 쿼리 준비가 필요하다 — `targets.md` 행만 더하고 이번엔 찍지 않는다 → 이슈에 「매뉴얼 그림 촬영 필요: my-settings-10」. 장 본문에는 그림 지시문을 **아직 넣지 않는다** — `manual:check` 는 없는 그림을 실패로 보므로, 촬영할 때 지시문(`{marks=account,workspace,permission,allow}`)을 함께 넣는다(계획 단계에서 정함). `my-settings-5`(도구에 연결하기)는 WP-1687 이 화면을 바꿀 때 다시 찍는다.

## 라이브 검증

- 격리 스택(`.work-loop/project.md` §4): `LIVE_STACK_NAME=work-loop scripts/live-stack.sh up <워크트리>` — API·웹(vite)·DB, `workplace.public-base-url` = 웹 주소라 issuer·authorization_endpoint 가 그 웹을 가리킨다.
- 로컬에서 끝까지(curl + 브라우저)
  1. `POST <web>/api/v1/oauth/register`(DCR, redirect `http://127.0.0.1:<임의 포트>/callback`) → `swc_…`.
  2. PKCE verifier/challenge 를 만들고 `<web>/oauth/authorize?response_type=code&client_id=…&redirect_uri=…&code_challenge=…&code_challenge_method=S256&state=…&resource=…` 를 playwright-cli 브라우저로 연다 → 로그인 화면 → 로그인 → 같은 주소로 돌아와 동의 화면(완료 기준 1 앞단, 「확인되지 않은 앱」 6).
  3. 워크스페이스 둘인 계정으로 두 번째 워크스페이스를 골라 「허용」 → 주소창의 code → `POST <web>/api/v1/oauth/token` → `swo_` 로 `GET /api/v1/…issues` 가 고른 워크스페이스 것만(2), 인박스에 「새 앱 연결」 1건, 다시 허용하면 늘지 않음(7).
  4. 「거부」 → 주소창에 `error=access_denied&state=…&iss=…`(3).
  5. 등록 안 된 redirect_uri → 오류 카드, 주소창이 그대로(4).
  6. 390px 뷰포트에서 가로 스크롤 없음(8) — 스크린샷 `test-results/exploratory/oauth-consent/<timestamp>/screenshots/`.
  7. nginx: 웹 이미지의 nginx 설정을 docker nginx 컨테이너에 얹어(`--add-host api:127.0.0.1`) `curl -I` 로 헤더 확인(5).
- Claude Code(가능하면): MCP 를 빈 포트로 손수 띄우고(`WORKPLACE_API_BASE_URL=<api>`, `WORKPLACE_OAUTH_ISSUER=<web>`, `PORT`) vite 의 `/.well-known/oauth-authorization-server` 프록시와 함께 `claude mcp add --transport http <이름> http://localhost:<mcp>/mcp`(헤더 없이) → 브라우저 동의 → `list_issues`.
- 로컬에서 검증할 수 없음: **claude.ai 커스텀 커넥터**(공개 https 주소가 필요 — claude.ai 서버가 localhost 에 닿지 못한다)와 운영 인그레스·nginx 실제 헤더. 배포 뒤 사람이 `https://genia-works.iacloud.kr/mcp` 로 확인한다(완료 기준 1 의 마지막 단계).

## 완료 기준 대응

| # | 기준 | 지키는 곳 |
|---|---|---|
| 1 | claude.ai 커넥터 → 로그인·동의 → 「허용」 뒤 list_issues | E2E @wiring·@flow, vitest(복귀 대상·POST 본문), 로컬 curl/Claude Code 끝까지, claude.ai 는 배포 뒤 사람 확인 |
| 2 | 워크스페이스 둘 → 고르기, 그 워크스페이스 이슈만 | vitest(셀렉트 → tenantId), 서버 통합(WP-1685), 로컬 swo_ 이슈 목록 |
| 3 | 「거부」 → access_denied | vitest(DENY 본문 → 이동), 서버 통합(WP-1685), 로컬 주소창 |
| 4 | 등록 안 된 redirect_uri → 이동 없이 오류 | vitest(오류 카드·leaveTo 안 불림), 서버 통합, 로컬 |
| 5 | iframe 안에서 안 열림 | nginx 글자 테스트 + 컨테이너 curl, SW 거부 목록 vitest, JS 검사 vitest + E2E @platform |
| 6 | DCR 앱 「확인되지 않은 앱」 | vitest, 로컬 |
| 7 | 새 연결 알림 | JUnit(이벤트·알림·재허용 없음), vitest(인박스 문구·이동), 로컬 인박스 |
| 8 | 390px 가로 스크롤 없음 | E2E @layout, 로컬 스크린샷 |

## 받아들인 위험

- R1. 동의 화면을 보는 중 refresh 세션까지 만료되면 `api/client.ts` 가 `/login` 으로 전체 이동하고 대기 목적지를 남기지 않아, 로그인 뒤 홈에 떨어진다 — 앱에서 「연결」을 다시 누르면 된다. 화면이 열릴 때마다 대기 목적지를 남기면 연결을 끝낸 뒤에도 같은 탭의 다음 로그인이 낡은 동의 화면으로 튈 수 있어 더 나쁘다.
- R2. 로그인 복귀는 `/` 를 거친다 — AppLayout(홈)이 잠깐 마운트된 뒤 동의 화면으로 간다(공유 링크 복귀와 같다).
- R3. 끊기 안내 글자가 가리키는 「연결된 앱」은 WP-1687 이 만든다 — 두 이슈가 같은 릴리스에 나가야 한다(아래 Q4).

## 시안이 정하지 않은 UI/UX — 정한 것 (옛 열린 질문 Q1–Q5)

- Q1. 「다른 계정으로 로그인」 링크 → **두지 않는다.** 승인된 시안에 없고, 카드가 계정 이름·이메일을 보이므로 잘못된 계정은 알아챌 수 있다. 바꾸려면 앱에서 로그아웃하고 다시 연결한다.
- Q2. 「확인되지 않은 앱」 → **배지 + 한 줄.** DCR 로 등록된 앱(`unverified`)은 제목 옆 배지 「확인되지 않은 앱」과, 머리 아래 한 줄 「Gen:iA Works 가 확인하지 않은 앱입니다. 위 주소가 연결하려던 앱이 맞는지 확인하세요.」로 redirect 주소(`redirectHost`)를 확인하게 한다. DCR 은 이름을 아무렇게나 등록할 수 있어 배지만으로는 「무엇을 확인하라는지」가 비어 있다.
- Q3. 클라이언트로 돌려보낼 수 있는 오류(서버 오류에 `errorRedirectUrl` 이 있을 때 — PKCE·resource 형식, 겹친 state 등) → **바로 앱으로 이동한다**(RFC 6749 §4.1.2.1, 다른 인가 서버와 같은 동작 — 앱이 오류를 받아 안내한다). validate·승인 POST 둘 다 같다. 이동 전 `http:`/`https:` 검사는 그대로 거친다.
- Q4. 맨 아래 「연결 끊기: 설정 › API 토큰 › 연결된 앱」 → **링크 아닌 글자로 둔다**(시안 그대로). 그 화면(WP-1687)이 같은 릴리스로 나간다.
- Q5. 앱 아이콘 → **중립 머리글자 타일**(디자인 시스템 토큰 `bg-muted text-muted-foreground`, 브랜드 색 없음). hex 금지 규칙이 있고, DCR 앱이 「Claude」라는 이름으로 브랜드 색까지 얻으면 Claude 를 눈으로 사칭할 수 있다.

## 내가 정한 것 (요약)

- 라우트는 ProtectedRoute 안·AppLayout 밖, 로그인 복귀는 기존 `pendingPushTarget` 장치(접두 `/oauth/authorize` 추가).
- validate 에는 `location.search` 를 그대로 넘기고(겹침 검사 보존), 승인 본문은 첫 값만 camelCase 로.
- 이동은 `location.replace`, `http(s)` 절대 주소만. 돌려보낼 수 있는 오류는 바로 이동.
- 워크스페이스 기본값 = currentTenantId → 첫 항목, 0개면 「허용」 끔.
- 「허용」 자동 포커스 없음, 보내는 중 두 단추 끔, 같은 틱 두 번도 POST 한 번.
- AI 계정은 API 를 부르지 않고 「사람 계정 전용」. 프레임 안이면 아무것도 부르지 않고 막음.
- nginx `location = /oauth/authorize` 에 `'none'`·`DENY`, SW `NAVIGATION_DENYLIST` 에 `/oauth/authorize`, vite 에 `/.well-known/oauth-authorization-server` 프록시.
- 알림 `OAUTH_APP_CONNECTED` — 새 연결(created)일 때만, 설정과 무관하게 늘, 행위자 없음, 앱 이름은 message, 클릭·푸시는 `/settings/tokens`.
- 매뉴얼 12장 「Claude 앱에 연결한다」 절(help 키 없음), 그림 my-settings-10 은 촬영 필요로 남김.
