# OAuth 동의 화면(웹) Implementation Plan — WP-1686

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Claude 앱 커넥터가 여는 `{issuer}/oauth/authorize` 웹 동의 화면을 만들고(로그인 복귀·워크스페이스 고르기·허용/거부·오류·프레임 막기), 새 연결이 생기면 본인에게 「새 앱 연결 — <앱 이름>」 알림을 보낸다.

**Architecture:** 동의 화면은 `ProtectedRoute` 안·`AppLayout` 밖 라우트로 두고 기존 로그인 복귀 장치(`pendingPushTarget`)에 `/oauth/authorize` 접두를 더한다. 화면은 `location.search` 를 손대지 않고 WP-1685 의 validate API 에 넘겨 결과만 그리고, 「허용」·「거부」는 승인 API 를 한 번 불러 받은 주소로 `location.replace` 만 한다. 알림은 `OAuthAuthorizationService.issueCode` 의 새 연결 분기에서 이벤트를 내고 notify 모듈이 커밋 뒤 계정 알림(설정 줄 없음)으로 넣는다 — WP-1170 개인 비서 회수 알림과 같은 길.

**Tech Stack:** React 19 + TS + Vite + Tailwind 4 + shadcn/ui, TanStack Query, axios(`api/client.ts`), vitest + RTL + MSW, Playwright; Spring Boot + jOOQ + JUnit(Testcontainers); nginx; `node --test`.

**Spec:** `docs/superpowers/specs/2026-11-17-oauth-consent-screen-design.md` (binding — 화면 상태 1–12, 「API 변경」, 「nginx」, 「접근성」, 「모바일 390px」, 「테스트」, 「매뉴얼」, 「시안이 정하지 않은 UI/UX — 정한 것」 Q1–Q5). 서버 계약: `docs/superpowers/specs/2026-11-17-oauth-authorization-server-design.md`(WP-1685).

## Global Constraints

- 서버 계약은 바꾸지 않는다(WP-1685 그대로) — API 변경은 새 연결 이벤트·알림뿐.
- validate 에는 `location.search` 를 **그대로** 넘긴다: `client.get('/oauth/authorize/validate' + search)` — 쿼리를 다시 만들지 않는다(서버의 겹친 파라미터 검사가 살아야 한다).
- 승인 본문은 camelCase `{responseType, clientId, redirectUri, codeChallenge, codeChallengeMethod, state, resource, tenantId, decision:'ALLOW'|'DENY'}`, 각 이름의 첫 값, 쿼리에 없으면 키를 뺀다.
- 「허용」 한 번 = POST 한 번. 보내는 중엔 두 단추 모두 `disabled` + `aria-busy`, ref 로도 막는다. 「허용」 자동 포커스 없음.
- 이동은 `window.location.replace(url)` 만, `http:`/`https:` 절대 주소만. 승인 응답은 Query 캐시에 넣지 않는다(code 가 들어 있다).
- validate 쿼리: `retry: false`, `staleTime: Infinity`, `refetchOnWindowFocus: false`.
- 레이아웃: 바깥 `main` `min-h-svh` 가운데 정렬 `px-4`, 카드 `w-full max-w-md`, 정보 줄 `flex items-start justify-between gap-3`, 값 칸 `min-w-0 text-right break-words`, `redirectHost` `break-all`, 셀렉트 트리거 `max-w-[60%]` + `truncate`, 단추 `grid grid-cols-2 gap-2`.
- 시맨틱 토큰만(hex 금지), `src/components/ui/*` 수동 편집 금지. 제목은 h1 하나(`AuthCardTitle`), 머리글자 타일·아이콘 `aria-hidden`.
- 화면 문구는 spec 의 글자 그대로(아래 Task 5 의 문구 표). `manual:prose` 가 매뉴얼의 굵은 글자를 소스와 대조한다.
- 알림 종류 `OAUTH_APP_CONNECTED` — 새 연결(`Created.created() == true`)일 때만, 설정과 무관하게 늘, 행위자 없음(null), 앱 이름은 `notification.message`, 클릭·푸시 url `/settings/tokens`, 푸시 tag `oauth-app-connected`, 카테고리 MENTION.
- nginx: `location = /oauth/authorize` 에 `frame-ancestors 'none'` + `X-Frame-Options "DENY"`, 다른 location 은 그대로 `'self'`/`SAMEORIGIN`.
- 한국어 주석(무엇을·왜) 필수. 커밋 제목 `feat(<scope>): <한국어> (WP-1686)` + 한국어 평문 `- ` 본문 + 빈 줄 + `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. 훅을 건너뛰지 않는다(`--no-verify` 금지).
- 로컬 포트 6060/6070/6080/6090/6095/6173/6174/5434 는 쓰지 않는다(라이브는 `scripts/live-stack.sh` 가 고른 6160/6273/5444 대). `pnpm dev`·`pnpm db:*`·`git stash` 금지.

## Review Focus

spec 이 함의하지만 spec 의 테스트 목록이 지키지 않는, 사람을 가장 먼저 물 다섯 가지(테스트는 소유 태스크에 더했다):

1. **`+`·퍼센트 인코딩이 든 `state`·`redirect_uri`** — 승인 본문의 값이 서버가 validate 쿼리를 디코드한 값과 같아야 한다(`+` → 공백, `%2B` → `+`). 어긋나면 서버가 「요청이 바뀌었다」로 거절하거나 다른 state 를 돌려준다. → Task 4 `decisionBody decodes like the server`.
2. **오류 응답의 `errorRedirectUrl` 이 `http(s)` 가 아님**(`javascript:` 등) — spec 은 성공 `redirectUrl` 만 검사한다. 오류 쪽도 이동하지 않고 오류 카드여야 한다. → Task 4 `readAuthorizeError rejects non-http errorRedirectUrl`, Task 5 화면 테스트.
3. **같은 틱에 「거부」 뒤 「허용」**(서로 다른 단추) — 진행 중 막음이 단추별이면 POST 두 번에 code 가 생긴다. POST 한 번(DENY)만. → Task 5 `거부와 허용을 같은 틱에 눌러도 POST 는 한 번`.
4. **열자마자 Enter** — 자동 포커스가 없어야 키보드가 실수로 승인하지 않는다. → Task 5 `열자마자 허용에 포커스가 없다`.
5. **쿼리 없는 `/oauth/authorize`**(북마크·주소 잘림) — validate 에 빈 search 를 넘겨 서버 400(redirect 없음) → 오류 카드, 어디로도 이동하지 않음. `?` 만 붙이거나 앱이 죽지 않는다. → Task 5 `쿼리 없이 열면 오류 카드`.

---

## File Structure

API (`apps/workplace-api/src/main/java/com/workplace/`)
- `auth/outbound/OAuthConnectionCreatedEvent.java` (신규) — 새 연결 이벤트 레코드.
- `auth/oauth/service/OAuthAuthorizationService.java` — `issueCode` 새 연결 분기에서 이벤트 발행.
- `notify/dto/NotificationType.java` · `notify/dto/NotificationSettingItem.java` · `notify/push/PushCategory.java` · `notify/push/PushContentService.java` — 새 종류.
- `notify/repository/NotificationRepository.java` — `insertAccountNotice` 오버로드(행위자 null·message).
- `notify/service/NotificationService.java` — `createOAuthAppConnectedAndFanOut`.
- `notify/outbound/NotificationDispatcher.java` — `onOAuthConnectionCreated`.

API 테스트 (`apps/workplace-api/src/test/java/com/workplace/`)
- `notify/OAuthAppConnectedNotificationTest.java` (신규) — 알림 생성·RLS·설정 무관.
- `notify/dto/NotificationSettingItemTest.java`, `notify/push/PushContentServiceTest.java` — 갱신.
- `auth/oauth/OAuthConnectionNotificationTest.java` (신규, `@Transactional @RecordApplicationEvents`) — 언제 이벤트가 나가는지.
- `auth/oauth/OAuthConnectionNotificationDeliveryTest.java` (신규, 커밋하는 테스트) — 승인 → 인박스 끝까지.

웹 (`apps/workplace-web/`)
- `src/types/oauth.ts` · `src/api/oauth.ts` · `src/lib/oauthConsent.ts` (+ `.test.ts`) (신규) — 계약 타입, API, 순수 판정 + 이동 한 줄.
- `src/pages/oauth/OAuthConsentPage.tsx` · `src/pages/oauth/OAuthConsentCard.tsx` · `src/pages/oauth/oauthConsent.test.tsx` (신규) — 화면 셸·상태 분기, 동의 카드, 화면 테스트.
- `src/App.tsx` · `src/components/ProtectedRoute.tsx`(+test) · `src/lib/documentTitle.ts`(+test) — 라우트·복귀·탭 제목.
- `src/sw/logic.ts`(+test) · `nginx.conf` · `vite.config.ts` — 프레임 헤더가 실제로 붙는 길.
- 알림: `src/types/notification.ts` · `src/lib/notifText.ts` · `src/components/home/notifTarget.ts` · `src/lib/notifGrouping.ts` · `src/components/layout/InboxList.tsx` · `src/components/home/widgets/dashboard/NotificationGroupRow.tsx` (+ 기존 테스트 4개).
- `e2e/pages/oauth/oauth-consent.spec.ts` (신규).

저장소 루트
- `scripts/nginx-security-headers.test.mjs` — 동의 location 예외 + 별도 단언(이 저장소의 nginx 글자 테스트, `pnpm test:scripts` = `node --test scripts/*.test.mjs`).
- `docs/manual/user/12-my-settings.md` · `docs/manual/shots/targets.md` — 매뉴얼 동반 수정(WP-1198).

---

### Task 1: 「새 앱 연결」 알림 종류와 생성(notify)

**Files:**
- Modify: `apps/workplace-api/src/main/java/com/workplace/notify/dto/NotificationType.java` (끝에 `OAUTH_APP_CONNECTED`)
- Modify: `.../notify/dto/NotificationSettingItem.java:97` (PERSONAL_ASSISTANT_REVOKED 와 같은 `IllegalArgumentException` 분기에 더함)
- Modify: `.../notify/push/PushCategory.java:36` (MENTION 묶음), `.../notify/push/PushContentService.java:35-46`(전용 분기), `:213`(`label` switch)
- Modify: `.../notify/repository/NotificationRepository.java:156-162`
- Modify: `.../notify/service/NotificationService.java:439-446` 옆
- Create: `apps/workplace-api/src/test/java/com/workplace/notify/OAuthAppConnectedNotificationTest.java`
- Modify: `.../test/java/com/workplace/notify/dto/NotificationSettingItemTest.java:49-57`, `.../notify/push/PushContentServiceTest.java`

**Interfaces:**
- Produces:
  - `NotificationType.OAUTH_APP_CONNECTED`
  - `NotificationRepository.insertAccountNotice(long recipientId, NotificationType type, Long actorId, String message)` — 기존 3인자 판은 이것에 위임.
  - `NotificationService.createOAuthAppConnectedAndFanOut(long userId, String clientName)` — `@Transactional`, 설정 판정 없음, insert → `registry.fanOut(List.of(userId), "notify.created", Map.of("type", "OAUTH_APP_CONNECTED"))` → 푸시 이벤트 `new InboxPushRequestedEvent(tenantId, OAUTH_APP_CONNECTED, MENTION, List.of(userId), null, null, null, null, clientName)`(앱 이름은 9번째 `eventTitle` 칸, TenantContext 없으면 건너뜀 — 기존 `publishPush` 와 같다).
  - 푸시 메시지: 제목 `새 앱 연결`, 본문 `{clientName} — 내가 연결하지 않았다면 설정 › API 토큰에서 끊어 주세요`, url `/settings/tokens`, tag `oauth-app-connected`, `"normal"`, `INBOX_TTL`. `label(OAUTH_APP_CONNECTED)` = `새 앱이 연결됐어요`.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`OAuthAppConnectedNotificationTest extends IntegrationTestBase`, 클래스 `@Transactional`, `@BeforeEach` 에서 `TenantContext.set(1L)`·`TestFixtures.createHuman`·`ensureActiveMember(…, 1L)`, `@AfterEach TenantContext.clear()`:

```java
@Test void 새_앱_연결_알림은_행위자_없이_앱_이름을_싣는다() {
  service.createOAuthAppConnectedAndFanOut(user, "Claude");
  assertThat(service.listRecent(user, 10, 0)).singleElement().satisfies(n -> {
    assertThat(n.type()).isEqualTo("OAUTH_APP_CONNECTED");
    assertThat(n.message()).isEqualTo("Claude");
    assertThat(n.actorId()).isNull();
  });
}
@Test void 알림_설정을_모두_꺼도_들어간다() { /* settingService.get(user) 의 모든 줄을 inbox·push false 로 update 한 뒤 생성 → listRecent 1건 */ }
@Test void 다른_워크스페이스_인박스에는_없다() { /* 생성 뒤 TenantContext.runAs(other, () -> listRecent(user,10,0)) 가 비어 있다 — other 는 createTenant + ensureActiveMember */ }
```

`NotificationSettingItemTest`: `everyNotificationType_mapsToAnItem` 의 건너뛰기에 `OAUTH_APP_CONNECTED` 추가, 새 테스트 `oauthAppConnected_hasNoSettingItem`(`assertThatThrownBy(() -> of(OAUTH_APP_CONNECTED)).isInstanceOf(IllegalArgumentException.class)`).

`PushContentServiceTest`: `forInbox_oauthAppConnected_buildsTokenSettingsMessage` — `new InboxPushRequestedEvent(1L, OAUTH_APP_CONNECTED, MENTION, List.of(u), null, null, null, null, "Claude")` → `title()=="새 앱 연결"`, `body()=="Claude — 내가 연결하지 않았다면 설정 › API 토큰에서 끊어 주세요"`, `url()=="/settings/tokens"`, `tag()=="oauth-app-connected"`(PushMessage 접근자 이름은 기존 테스트를 따른다). `PushCategory.of(OAUTH_APP_CONNECTED) == MENTION` 단언도 같은 테스트에.

- [ ] **Step 2: 실패 확인** — Run: `cd apps/workplace-api && ./gradlew test --tests '*OAuthAppConnectedNotificationTest' --tests '*NotificationSettingItemTest' --tests '*PushContentServiceTest'` / Expected: 컴파일 실패(`OAUTH_APP_CONNECTED` 없음).

- [ ] **Step 3: 구현** — 위 Interfaces 그대로. `PushContentService.forInbox` 는 PERSONAL_ASSISTANT_REVOKED 분기 바로 뒤에 `OAUTH_APP_CONNECTED` 분기(`e.eventTitle()` 이 null 이면 본문 앞부분을 `앱` 으로). `NotificationType` 주석: 「OAuth 앱 새 연결(WP-1686) — 본인 1명, 계정 알림이라 설정 없이 늘 보냄, message=앱 이름」.

- [ ] **Step 4: 통과 확인** — 같은 명령, Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add apps/workplace-api/src
git commit -m "feat(api/notify): 새 앱 연결 계정 알림 종류를 더한다 (WP-1686)" -m "- OAUTH_APP_CONNECTED: 행위자 없이 앱 이름을 message 에 싣고 알림 설정과 무관하게 늘 보낸다(모르는 연결을 알아채게)
- 푸시는 「새 앱 연결」 제목으로 설정 › API 토큰을 연다" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 2: 새 연결일 때만 이벤트를 내고 커밋 뒤 알림으로 잇는다

**Files:**
- Create: `apps/workplace-api/src/main/java/com/workplace/auth/outbound/OAuthConnectionCreatedEvent.java`
- Modify: `.../auth/oauth/service/OAuthAuthorizationService.java:69-96`(생성자에 `ApplicationEventPublisher publisher` 마지막 인자), `:174-197`(`if (c.created())` 안, 감사 뒤)
- Modify: `.../notify/outbound/NotificationDispatcher.java:343-355` 옆
- Create: `apps/workplace-api/src/test/java/com/workplace/auth/oauth/OAuthConnectionNotificationTest.java`, `.../auth/oauth/OAuthConnectionNotificationDeliveryTest.java`

**Interfaces:**
- Consumes: Task 1 `NotificationService.createOAuthAppConnectedAndFanOut(long, String)`.
- Produces: `public record OAuthConnectionCreatedEvent(long tenantId, long userId, String clientName)`; `NotificationDispatcher.onOAuthConnectionCreated(OAuthConnectionCreatedEvent e)` — `@Async("notifyEventExecutor") @TransactionalEventListener(phase = AFTER_COMMIT)`, `TenantContext.runAs(e.tenantId(), …)`, 예외는 `log.warn("[notify] 새 앱 연결 알림 실패 userId={}: {}", …)` 만.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`OAuthConnectionNotificationTest extends IntegrationTestBase`, `@Transactional @RecordApplicationEvents`, `OAuthAuthorizeTest.seed()` 와 같은 준비(사람·테넌트 1 멤버·`clients.insertDcr(swc_…, "Claude", List.of(OAuthTestSupport.CALLBACK))`). ALLOW 는 `new OAuthTestSupport(mvc, objectMapper, 0).obtainCode(userId, clientId, tenantId)`, DENY 는 같은 본문에 `decision:"DENY"` 를 `POST /api/v1/oauth/authorize`(`WebSessionAuth.of(userId, List.of())`)로.

```java
@Test void 처음_허용하면_새_연결_이벤트_한_건() { allow(TENANT_ID); assertThat(events.stream(OAuthConnectionCreatedEvent.class)).containsExactly(new OAuthConnectionCreatedEvent(TENANT_ID, userId, "Claude")); }
@Test void 같은_연결을_다시_허용하면_이벤트가_없다() { allow(TENANT_ID); allow(TENANT_ID); assertThat(events.stream(OAuthConnectionCreatedEvent.class)).hasSize(1); }
@Test void 거부는_이벤트가_없다() { deny(); assertThat(events.stream(OAuthConnectionCreatedEvent.class)).isEmpty(); }
@Test void 다른_워크스페이스로_허용하면_그_테넌트로_한_건_더() { /* other = createTenant("ACTIVE") + ensureActiveMember; allow(1); allow(other) → tenantId 목록 [1, other] */ }
@Test void 끊은_뒤_다시_허용하면_다시_한_건() { /* allow; connections.revoke(연결 id, userId); allow → hasSize(2) — 연결 id 는 OAUTH_CONNECTION 에서 user·client 로 조회 */ }
```

`OAuthConnectionNotificationDeliveryTest extends ExternalClientMockedTestBase`(커밋 필요 — 비 `@Transactional`, `InboxPushDeliveryTest` 처럼 `@AfterEach cleanupInTenant` 로 만든 OAUTH_AUTHORIZATION_CODE·OAUTH_CONNECTION·OAUTH_CLIENT·NOTIFICATION·USER 행을 지운다):

```java
@Test void 허용이_커밋되면_본인_인박스에_새_앱_연결이_들어온다() {
  support.obtainCode(userId, clientId, 1L);
  await().atMost(Duration.ofSeconds(5)).untilAsserted(() ->
    assertThat(TenantContext.callAs(1L, () -> dsl.fetchCount(NOTIFICATION, NOTIFICATION.RECIPIENT_ID.eq(userId).and(NOTIFICATION.TYPE.eq("OAUTH_APP_CONNECTED")).and(NOTIFICATION.MESSAGE.eq("Claude"))))).isEqualTo(1));
}
```
(테넌트 감싸기는 이 저장소의 기존 도우미 이름을 쓴다 — `TenantContext.runAs` 의 값 돌려주는 판이 없으면 `cleanupInTenant` 와 같은 방식으로 테넌트를 세운 뒤 센다.)

- [ ] **Step 2: 실패 확인** — Run: `./gradlew test --tests '*OAuthConnectionNotification*'` / Expected: 컴파일 실패(`OAuthConnectionCreatedEvent` 없음).

- [ ] **Step 3: 구현** — 이벤트 레코드(Javadoc: 도메인은 notify 를 모르고 이벤트만 낸다, tenantId 는 발행 때 담는다 — PersonalAssistantCredentialRevokedEvent 본보기). `issueCode` 의 `if (c.created())` 안 감사 바로 뒤 `publisher.publishEvent(new OAuthConnectionCreatedEvent(tenantId, user.id(), client.clientName()))`. 디스패처 리스너는 Interfaces 그대로.

- [ ] **Step 4: 통과 확인** — Run: `./gradlew test --tests '*OAuthConnectionNotification*' --tests '*OAuthAuthorizeTest' --tests '*OAuthTokenEndpointTest'` / Expected: PASS(기존 OAuth 테스트 회귀 없음).

- [ ] **Step 5: 커밋**

```bash
git add apps/workplace-api/src
git commit -m "feat(api): OAuth 앱이 새로 연결되면 본인에게 알린다 (WP-1686)" -m "- 승인이 새 연결을 만들 때만(감사와 같은 분기) 이벤트를 내고, 커밋 뒤 notify 가 계정 알림으로 넣는다
- 같은 연결을 다시 허용하면 알리지 않아 Claude 가 다시 연결할 때마다 알림이 쌓이지 않는다" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 3: 웹 인박스·알림 위젯이 「새 앱 연결」을 그린다

**Files:**
- Modify: `apps/workplace-web/src/types/notification.ts:32`(유니온), `:49`(message 주석에 OAUTH_APP_CONNECTED=앱 이름)
- Modify: `src/lib/notifText.ts:33`(`ACTION_LABEL.OAUTH_APP_CONNECTED: '새 앱 연결'`)
- Modify: `src/components/home/notifTarget.ts:45-50`, `src/lib/notifGrouping.ts:50,60,75,83,108,143`, `src/components/layout/InboxList.tsx:170-185`, `src/components/home/widgets/dashboard/NotificationGroupRow.tsx:43`(`Plug`)
- Test: `src/lib/notifText.test.ts`, `src/components/home/notifTarget.test.ts`, `src/lib/notifGrouping.test.ts`(ALL_TYPES 표 L81 + 「mine」 목록 L95 + 새 it), `src/components/layout/appRail.test.tsx`(L481 옆)

**Interfaces:**
- Produces (`notifTarget.ts`): `isOAuthAppConnectedType(n: NotificationResponse): boolean`, `OAUTH_APP_LABEL = '앱 연결'`, `TOKEN_SETTINGS_PATH = '/settings/tokens'`. `notifTarget` 은 이 종류면 `TOKEN_SETTINGS_PATH`(이슈 분기보다 먼저).
- `notifGrouping`: 구역 `mine`, groupKey `'oauth-app'`(한 줄로 묶음 — 개인 비서와 같은 규칙), title·label `OAUTH_APP_LABEL`, TYPE_ORDER 끝, 요약 `c > 1 ? \`앱 연결 ${c}건\` : '앱 연결'`.
- `InboxList`: 굵게 `새 앱 연결 — {n.message}`(message 없으면 `새 앱 연결`) + 작은 줄 `내가 연결하지 않았다면 설정 › API 토큰에서 끊어 주세요`, 행위자·이슈 줄 없음.

- [ ] **Step 1: 실패하는 테스트를 쓴다**
  - `notifTarget.test.ts` `describe('새 앱 연결 알림')`: `notifTarget(app())==='/settings/tokens'`, 이슈 키가 남아 있어도 같음, `notifLabel(app())==='앱 연결'`, `isOAuthAppConnectedType(app())===true`.
  - `notifGrouping.test.ts`: ALL_TYPES 에 `OAUTH_APP_CONNECTED: true`, mine 목록에 `'OAUTH_APP_CONNECTED'`; 새 it `새 앱 연결은 내 차례 한 줄로 묶고 토큰 설정으로 간다 (WP-1686)` — 두 건 → `mine[0].title==='앱 연결'`, `target==='/settings/tokens'`, `deltaSummary==='앱 연결 2건'`, `repType==='OAUTH_APP_CONNECTED'`.
  - `notifText.test.ts`: `notificationAction(n({ type: 'OAUTH_APP_CONNECTED' }))==='새 앱 연결'`.
  - `appRail.test.tsx` `test('새 앱 연결 알림 — 앱 이름과 끊기 안내, 행위자·이슈 줄 없음, 토큰 설정으로 이동')`: 이슈 필드 null + `actorId:null, message:'Claude'` → `toHaveTextContent('새 앱 연결 — Claude')`, `('내가 연결하지 않았다면 설정 › API 토큰에서 끊어 주세요')`, not `'시스템'`·`'null'`; 누르면 `location()` 이 `/settings/tokens`.
- [ ] **Step 2: 실패 확인** — Run: `cd apps/workplace-web && pnpm vitest run src/lib/notifText.test.ts src/components/home/notifTarget.test.ts src/lib/notifGrouping.test.ts src/components/layout/appRail.test.tsx` / Expected: FAIL(종류 없음·tsc 오류).
- [ ] **Step 3: 구현** — Interfaces 그대로. 각 분기에 `// WP-1686` 주석.
- [ ] **Step 4: 통과 확인** — 같은 명령 + `pnpm typecheck` / Expected: PASS, 타입 오류 없음.
- [ ] **Step 5: 커밋** — `git add apps/workplace-web/src` 후 `git commit -m "feat(web): 인박스와 알림 위젯에 새 앱 연결 알림을 그린다 (WP-1686)" -m "- 앱 이름과 「내가 연결하지 않았다면 끊어 주세요」 안내를 보이고 누르면 설정 › API 토큰으로 간다" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

### Task 4: 동의 화면 계약 타입·API·순수 판정

**Files:**
- Create: `apps/workplace-web/src/types/oauth.ts`, `src/api/oauth.ts`, `src/lib/oauthConsent.ts`, `src/lib/oauthConsent.test.ts`

**Interfaces:**
- Produces (`types/oauth.ts`, 서버 DTO 와 1:1):
  ```ts
  export interface AuthorizeWorkspace { tenantId: number; name: string; slug: string }
  export interface AuthorizeValidateResponse { clientName: string; clientUri: string | null; redirectHost: string; unverified: boolean; workspaces: AuthorizeWorkspace[]; currentTenantId: number | null }
  export type AuthorizeDecision = 'ALLOW' | 'DENY'
  export interface AuthorizeDecisionRequest { responseType?: string; clientId?: string; redirectUri?: string; codeChallenge?: string; codeChallengeMethod?: string; state?: string; resource?: string; tenantId: number | null; decision: AuthorizeDecision }
  export interface AuthorizeRedirectResponse { redirectUrl: string }
  export interface OAuthAuthorizeError { error: string; errorDescription: string; errorRedirectUrl?: string }
  ```
- Produces (`api/oauth.ts`): `oauthApi.validate(search: string): Promise<AuthorizeValidateResponse>` = `client.get('/oauth/authorize/validate' + search)`; `oauthApi.decide(body: AuthorizeDecisionRequest): Promise<AuthorizeRedirectResponse>` = `client.post('/oauth/authorize', body)`.
- Produces (`lib/oauthConsent.ts`):
  - `decisionBody(params: URLSearchParams, tenantId: number | null, decision: AuthorizeDecision): AuthorizeDecisionRequest` — 쿼리 이름 `response_type, client_id, redirect_uri, code_challenge, code_challenge_method, state, resource` → camelCase, `params.get` (첫 값), null 이면 키 없음.
  - `initialTenantId(v: Pick<AuthorizeValidateResponse, 'workspaces' | 'currentTenantId'>): number | null` — current 가 목록에 있으면 그것, 아니면 첫 항목, 빈 목록 null.
  - `isNavigableRedirect(url: string): boolean` — `new URL(url)` 이 되고 protocol 이 `http:`/`https:`.
  - `type AuthorizeFailure = { kind: 'redirect'; url: string } | { kind: 'inline' | 'fatal'; code: string; description: string } | { kind: 'agent' } | { kind: 'transient' }`
  - `readAuthorizeError(err: unknown, phase: 'validate' | 'decide', userKind: UserKind): AuthorizeFailure` — 400 + 이동 가능한 `errorRedirectUrl` → redirect; 400 + 이동 불가 `errorRedirectUrl` → fatal(`code=error`, `description='앱이 알려 준 돌아갈 주소가 올바르지 않습니다.'`); 400 단독 → validate 면 fatal·decide 면 inline(`code=error`, `description=errorDescription`); 403 → `userKind==='AGENT'` 면 agent, 아니면 fatal(`code = data.error ?? 'forbidden'`, `description = data.message`); 그 밖(5xx·네트워크·401) → transient.
  - `appInitial(name: string): string` — 앞뒤 공백을 지운 첫 코드 포인트(`Array.from`)를 대문자로, 비면 `'?'`.
  - `isFramed(win: Window = window): boolean` — `win.top !== win.self`, 접근 예외면 true.
  - `leaveTo(url: string): void` — `window.location.replace(url)` 한 줄(화면 테스트가 `vi.mock`).

- [ ] **Step 1: 실패하는 테스트를 쓴다** — `oauthConsent.test.ts`(node 프로젝트, axios 오류는 `new AxiosError(…, …, undefined, undefined, { status, data } as AxiosResponse)` 로 만든다):
  - `decisionBody maps the seven query names` — 7개 → camelCase 전부 + `tenantId: 7, decision: 'ALLOW'`; `state`·`resource` 없는 쿼리 → `expect('state' in body).toBe(false)`; DENY + `tenantId: null`.
  - `decisionBody takes the first of repeated names` — `state=a&state=b` → `'a'`.
  - **`decisionBody decodes like the server`**(Review Focus 1) — `new URLSearchParams('?state=a+b%2Bc&redirect_uri=http%3A%2F%2F127.0.0.1%3A41234%2Fcb%3Fx%3D1')` → `state === 'a b+c'`, `redirectUri === 'http://127.0.0.1:41234/cb?x=1'`.
  - `initialTenantId` — `{current:2, [1,2]}→2`, `{current:9, [1,2]}→1`, `{null,[3]}→3`, `{null,[]}→null`.
  - `isNavigableRedirect` — true: `https://claude.ai/api/mcp/auth_callback?code=x`, `http://127.0.0.1:41234/cb`; false: `javascript:alert(1)`, `data:text/html,x`, `/relative`, `not a url`, `''`.
  - `readAuthorizeError` — 표 하나로 위 규칙 전부(validate 400 단독 → fatal, decide 400 단독 → inline, 403 HUMAN → fatal + message, 403 AGENT → agent, 500 → transient, 네트워크(`response` 없음) → transient).
  - **`readAuthorizeError rejects non-http errorRedirectUrl`**(Review Focus 2) — 400 `{error:'invalid_request', errorRedirectUrl:'javascript:alert(1)'}` → `{kind:'fatal', code:'invalid_request', description:'앱이 알려 준 돌아갈 주소가 올바르지 않습니다.'}`.
  - `appInitial` — `'claude'→'C'`, `'  가나'→'가'`, `'😀App'→'😀'`, `'   '→'?'`.
  - `isFramed` — `{top: w, self: w}` false, 다른 객체 true, `top` getter 가 throw → true.
- [ ] **Step 2: 실패 확인** — Run: `pnpm vitest run src/lib/oauthConsent.test.ts` / Expected: FAIL(모듈 없음).
- [ ] **Step 3: 구현** — Interfaces 그대로. 오류 응답 본문 읽기는 `axios.isAxiosError` 로.
- [ ] **Step 4: 통과 확인** — 같은 명령 / Expected: PASS.
- [ ] **Step 5: 커밋** — `git add apps/workplace-web/src/types/oauth.ts apps/workplace-web/src/api/oauth.ts apps/workplace-web/src/lib/oauthConsent.ts apps/workplace-web/src/lib/oauthConsent.test.ts` 후 `git commit -m "feat(web): OAuth 동의 화면의 요청·오류 판정을 순수 함수로 둔다 (WP-1686)" -m "- 쿼리 → 승인 본문(첫 값, 서버와 같은 디코드), 기본 워크스페이스, http(s) 주소만 이동, 서버 오류 → 화면 상태" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

### Task 5: 동의 화면과 라우트·로그인 복귀

**Files:**
- Create: `apps/workplace-web/src/pages/oauth/OAuthConsentPage.tsx`, `src/pages/oauth/OAuthConsentCard.tsx`, `src/pages/oauth/oauthConsent.test.tsx`
- Modify: `src/App.tsx:213-216`(lazy `OAuthConsentPage`, `<Route path="oauth/authorize" element={<OAuthConsentPage />} />` 를 `mail/compose` 옆 — ProtectedRoute 안·AppLayout 밖)
- Modify: `src/components/ProtectedRoute.tsx:13`(`LOGIN_RETURN_PREFIXES` 에 `'/oauth/authorize'`, 주석: 화면이 계정을 밝히고 사용자가 허용해야만 무엇이 생기므로 남겨도 안전), `src/components/ProtectedRoute.test.tsx`
- Modify: `src/lib/documentTitle.ts:52`(`case 'oauth': return second === 'authorize' ? ['앱 연결'] : []`), `src/lib/documentTitle.test.ts`

**Interfaces:**
- Consumes: Task 4 전부.
- Produces:
  - `export default function OAuthConsentPage()` — 셸·상태 분기. 순서: `isFramed()` → 막음 카드(API 안 부름); `user.kind === 'AGENT'` → 「사람 계정 전용」(API 안 부름); validate `useQuery({ queryKey: ['oauth-authorize', search], queryFn: () => oauthApi.validate(search), retry: false, staleTime: Infinity, refetchOnWindowFocus: false })`; 로딩 → Skeleton + status; 오류 → `readAuthorizeError(err,'validate',user.kind)` 결과대로(redirect → 이동 중 + `leaveTo`, agent → 사람 계정 전용, fatal → 오류 카드, transient → 다시 시도); 성공 → `<OAuthConsentCard …/>`; 이동 중 상태는 `leaving: string | null` 하나(이동 전에 `isNavigableRedirect` 가 거짓이면 fatal 오류 카드).
  - `OAuthConsentCard({ request, search, user, onLeave, onFatal }: { request: AuthorizeValidateResponse; search: string; user: UserResponse; onLeave: (url: string) => void; onFatal: (f: AuthorizeFailure) => void })` — 승인 `useMutation`(캐시에 넣지 않음), 진행 중 `useRef<boolean>` 하나로 두 단추를 함께 막는다. 성공 → `onLeave(redirectUrl)`, 실패 → redirect 면 `onLeave(url)`, agent/fatal 이면 `onFatal`, inline 이면 단추 위 `role="alert"` 에 description, transient 면 `잠시 뒤 다시 눌러 주세요.` — inline·transient 뒤 단추 다시 켬.
  - 셸 모양: `<main className="flex min-h-svh items-center justify-center bg-background px-4 py-6">` + `Card` `w-full max-w-md`, 모든 상태 카드에 h1 하나(`AuthCardTitle`).

화면 문구(그대로 — spec 상태 3–12):

| 자리 | 문구 |
|---|---|
| 확인 중 status | `연결 요청을 확인하는 중…` |
| h1 | `{clientName} 연결` |
| 배지 / 안내 줄 | `확인되지 않은 앱` / `Gen:iA Works 가 확인하지 않은 앱입니다. 위 주소가 연결하려던 앱이 맞는지 확인하세요.` |
| dt | `계정` · `워크스페이스` · `권한` |
| 권한 값 / 작은 줄 | `내 권한 그대로 · 읽기·쓰기` / `이슈·노트·드라이브·메일·채널·캘린더·연락처` |
| 워크스페이스 0개 | `연결할 수 있는 워크스페이스가 없습니다` |
| 단추 | `거부`(outline) · `허용`(primary) |
| 맨 아래(링크 아님) | `연결 끊기: 설정 › API 토큰 › 연결된 앱` |
| 이동 중 status | `앱으로 돌아가는 중…` |
| 오류 카드 | h1 `연결할 수 없습니다`, 본문 서버 description, `이 창을 닫고 연결하려던 앱에서 다시 시도해 주세요.`, 작은 글자 코드, 링크 `Gen:iA Works 로 가기`(`/`) |
| 승인 일시 실패 | `잠시 뒤 다시 눌러 주세요.` |
| AI 계정 | h1 `사람 계정 전용`, `AI 계정으로는 앱을 연결할 수 없습니다. 사람 계정으로 로그인해 다시 시도해 주세요.` |
| validate 일시 실패 | h1 `연결 요청을 확인하지 못했습니다`, 단추 `다시 시도`(refetch) |
| 프레임 안 | h1 `연결할 수 없습니다`, `이 화면은 다른 화면 안에서 열 수 없습니다.` |

머리: 머리글자 타일 `appInitial(clientName)`(`bg-muted text-muted-foreground`, `aria-hidden`, Q5) ↔ `BrandMark`(`aria-hidden`), h1 아래 `redirectHost`(muted, `break-all`). 배지 `bg-warning-subtle text-warning-text`. 계정 값: `user.name`(굵게) + `user.email ?? user.username`(작게). 워크스페이스: 1개 이름만, 여럿이면 shadcn `Select`(트리거 `id` ↔ `dt` 안 `<label htmlFor>`), 기본 `initialTenantId`. Q1: 「다른 계정으로 로그인」 링크 없음.

- [ ] **Step 1: 실패하는 테스트를 쓴다** — `oauthConsent.test.tsx`: `vi.mock('@/lib/oauthConsent', async (orig) => ({ ...(await orig()), leaveTo: vi.fn(), isFramed: vi.fn(() => false) }))`, `renderScreen(<OAuthConsentPage />, { path: AUTH_PATH, handlers, auth })`, `AUTH_PATH = '/oauth/authorize?response_type=code&client_id=swc_1&redirect_uri=https%3A%2F%2Fclaude.ai%2Fapi%2Fmcp%2Fauth_callback&code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&code_challenge_method=S256&state=st-1&resource=https%3A%2F%2Fmcp.example%2Fmcp'`, validate 핸들러 `http.get('/api/v1/oauth/authorize/validate', …)`, 승인 `http.post('/api/v1/oauth/authorize', …)` 가 `request.json()` 을 모은다. 테스트(이름 = 단언):
  - `쿼리를 그대로 validate 로 넘긴다` — `AUTH_PATH + '&state=st-2'` → 서버가 본 `url.searchParams.getAll('state')` 가 `['st-1','st-2']`.
  - `워크스페이스가 하나면 이름만 보인다` — `getByText('Work Loop')`, `queryByRole('combobox')` 없음; 계정 줄에 `Tester`(굵게)·`tester@example.com`(testAuthValue).
  - `워크스페이스가 둘이면 고르고 허용하면 고른 tenantId 로 한 번 보내고 받은 주소로 간다` — 기본 선택이 currentTenantId(2) 이름, 1 로 바꾸고 `허용` → POST 본문 `toEqual({ responseType:'code', clientId:'swc_1', redirectUri:'https://claude.ai/api/mcp/auth_callback', codeChallenge:'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM', codeChallengeMethod:'S256', state:'st-1', resource:'https://mcp.example/mcp', tenantId:1, decision:'ALLOW' })`, `leaveTo` 가 `'https://claude.ai/api/mcp/auth_callback?code=c1&state=st-1'` 로 1회, `앱으로 돌아가는 중…` 보임.
  - `거부하면 DENY 를 보내고 받은 주소로 간다` — 본문 `decision:'DENY'`, `leaveTo('…?error=access_denied&state=st-1')`.
  - `확인되지 않은 앱이면 배지와 안내 줄, 아니면 없다`.
  - `등록 안 된 redirect_uri 면 오류 카드만 보이고 어디로도 가지 않는다` — validate 400 `{error:'invalid_redirect_uri', errorDescription:'등록되지 않은 redirect_uri 입니다.'}` → h1 `연결할 수 없습니다`, 서버 문구, `invalid_redirect_uri`, `Gen:iA Works 로 가기` 의 href `/`, 단추 `허용` 없음, `leaveTo` 안 불림.
  - `validate 오류에 errorRedirectUrl 이 있으면 그 주소로 바로 간다`(Q3).
  - **`errorRedirectUrl 이 javascript: 면 이동하지 않고 오류 카드`**(Review Focus 2).
  - `승인 400 단독이면 단추 위에 서버 문구를 보이고 단추를 다시 켠다` / `승인 400 + errorRedirectUrl 이면 그 주소로 간다` / `승인 500 이면 잠시 뒤 다시 눌러 주세요`.
  - `같은 틱에 허용을 두 번 눌러도 POST 는 한 번` — `act(() => { btn.dispatchEvent(click); btn.dispatchEvent(click) })`.
  - **`거부와 허용을 같은 틱에 눌러도 POST 는 한 번`**(Review Focus 3) — 거부 → 허용 순서, 본문 `decision:'DENY'` 한 건.
  - **`열자마자 허용에 포커스가 없다`**(Review Focus 4) — 카드가 보인 뒤 `document.activeElement` 가 `허용` 단추가 아니고, `user.keyboard('{Enter}')` 뒤 POST 0건.
  - **`쿼리 없이 열면 오류 카드`**(Review Focus 5) — path `/oauth/authorize`, validate 가 search `''` 로 불리고(서버가 본 `url.search === ''`) 400 `invalid_client` → 오류 카드, `leaveTo` 안 불림.
  - `AI 계정이면 사람 계정 전용을 보이고 validate 를 부르지 않는다` / `사람인데 403 이면 서버 문구 오류 카드`.
  - `validate 500 이면 다시 시도로 다시 불러 카드를 그린다`.
  - `워크스페이스가 없으면 안내를 보이고 허용은 꺼지고 거부는 된다` — 거부 본문 `tenantId: null`.
  - `승인 redirectUrl 이 javascript: 면 이동하지 않고 오류 카드`.
  - `프레임 안이면 막음 문구만, validate 를 부르지 않는다` — `vi.mocked(isFramed).mockReturnValue(true)`.
  - `이메일이 없으면 아이디를 보인다` — `auth: { user: { ...testAuthValue.user, email: null } }` → 계정 줄에 `tester`.
  - `ProtectedRoute.test.tsx`: `동의 화면(/oauth/authorize)은 쿼리까지 남겨 로그인 뒤 돌아온다` — `openSignedOut('/oauth/authorize?client_id=swc_1&state=a%2Bb')` → 대기 목적지 `{ tenantId: null, url: '/oauth/authorize?client_id=swc_1&state=a%2Bb' }`.
  - `documentTitle.test.ts` 표에 `['/oauth/authorize', ['앱 연결']]`.
- [ ] **Step 2: 실패 확인** — Run: `pnpm vitest run src/pages/oauth/oauthConsent.test.tsx src/components/ProtectedRoute.test.tsx src/lib/documentTitle.test.ts` / Expected: FAIL.
- [ ] **Step 3: 구현** — Interfaces·문구 표·Global Constraints 의 레이아웃 그대로. 접근성: `dl`/`dt`/`dd`, 확인 중·이동 중 `role="status" aria-live="polite"`, 오류·승인 실패 `role="alert"`, 보내는 중 누른 단추에 `Loader2`.
- [ ] **Step 4: 통과 확인** — 같은 명령 + `pnpm typecheck` + `pnpm lint` / Expected: PASS.
- [ ] **Step 5: 커밋** — `git add apps/workplace-web/src` 후 `git commit -m "feat(web): Claude 앱 연결 동의 화면 /oauth/authorize 를 더한다 (WP-1686)" -m "- 로그인(SSO 포함) 뒤 같은 주소로 돌아와 서버 검증 결과만 그리고, 허용·거부는 승인 API 한 번 뒤 받은 주소로 replace 만 한다
- 워크스페이스 고르기·확인되지 않은 앱·AI 계정 막음·redirect 없는 오류·앱으로 돌려보내는 오류·프레임 안 막음" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

### Task 6: 동의 경로만 프레임 금지 헤더가 실제로 붙게 한다

**Files:**
- Modify: `apps/workplace-web/nginx.conf:189`(`location /` 바로 앞에 spec 「nginx」의 `location = /oauth/authorize { … }` 블록 그대로, 주석에 이유)
- Modify: `scripts/nginx-security-headers.test.mjs:38-45`
- Modify: `apps/workplace-web/src/sw/logic.ts:111`(`NAVIGATION_DENYLIST` 에 `/^\/oauth\/authorize/`, 주석), `src/sw/logic.test.ts:135-166`
- Modify: `apps/workplace-web/vite.config.ts:162`(proxy 에 `'/.well-known/oauth-authorization-server': { target: API_TARGET, changeOrigin: true }` — 로컬 Claude Code 연결용, 주석)

**Interfaces:** 없음(설정). nginx 글자 테스트는 이 저장소에 이미 있는 `node --test` 파일을 넓힌다(새 테스트 러너를 만들지 않는다).

- [ ] **Step 1: 실패하는 테스트를 쓴다**
  - `nginx-security-headers.test.mjs`: 기존 「index.html 을 내보내는 location 마다」 단언에서 `head === '= /oauth/authorize'` 를 빼고, 웹 설정(`apps/workplace-web/nginx.conf`)에만 새 테스트 `동의 화면 location 은 어떤 프레임에도 넣을 수 없다` — `topLevelLocations` 에서 `head === '= /oauth/authorize'` 가 **있고**(없으면 실패), 본문이 `/add_header\s+Content-Security-Policy\s+"frame-ancestors 'none'"\s+always;/`·`/add_header\s+X-Frame-Options\s+"DENY"\s+always;/`·`/try_files\s+\/index\.html\s+=404;/` 에 맞고, `'self'`·`SAMEORIGIN` 을 담지 않는다. 운영자 콘솔 설정은 그대로.
  - `logic.test.ts` `NAVIGATION_DENYLIST`: `denied('/oauth/authorize')`·`denied('/oauth/authorize?client_id=x')` true, `denied('/oauth/m365/callback')` false; `isOutsideSpaPath('/oauth/authorize?x=1')` true.
- [ ] **Step 2: 실패 확인** — Run: `node --test scripts/nginx-security-headers.test.mjs` 와 `cd apps/workplace-web && pnpm vitest run src/sw/logic.test.ts` / Expected: 새 단언 FAIL.
- [ ] **Step 3: 구현** — 위 Files 그대로.
- [ ] **Step 4: 통과 확인** — 같은 두 명령 + `pnpm test:scripts`(루트) / Expected: PASS.
- [ ] **Step 5: 커밋** — `git add apps/workplace-web/nginx.conf apps/workplace-web/src/sw apps/workplace-web/vite.config.ts scripts/nginx-security-headers.test.mjs` 후 `git commit -m "feat(web): 동의 화면 경로만 다른 화면 안에 넣지 못하게 한다 (WP-1686)" -m "- nginx 정확 일치 location 에 frame-ancestors 'none'·X-Frame-Options DENY, 나머지 화면은 그대로 self
- 서비스 워커가 캐시한 index.html 로 답하지 않고 서버 헤더를 받게 거부 목록에 더하고, 로컬 Claude Code 연결용 메타데이터 프록시를 둔다" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

### Task 7: 브라우저에서만 참인 것 — E2E

**Files:**
- Create: `apps/workplace-web/e2e/pages/oauth/oauth-consent.spec.ts`

**Interfaces:**
- Consumes: Task 5 화면(문구 표), `e2e/fixtures/auth.fixture`(`test`, `expect`, `setupAuthMocks`), `e2e/fixtures/mobile.fixture`(`expectNoHorizontalOverflow`), `e2e/fixtures/requests`(`trackRequests`), `e2e/factories/auth.factory`(`createUser`, `createTokenResponse`). 응답 모양은 `src/types/oauth.ts` 타입으로.
- 외부 주소(`https://claude.ai/...`)는 `page.route` 로 받아 200 빈 HTML — netns 밖으로 나가지 않는다.

파일 머리 주석: 각 테스트가 E2E 인 이유(아래 태그)와 「나머지 상태·문구·본문은 `src/pages/oauth/oauthConsent.test.tsx` 가 지킨다」.

- [ ] **Step 1: 테스트를 쓴다**
  - `{ tag: ['@wiring', '@smoke'] }` `라우트 → validate → 카드 → 허용 → 브라우저가 앱 주소로 실제 이동한다` — `authenticatedPage`, validate·POST `page.route`, `goto(AUTH_PATH)`, `허용` → `await page.waitForURL('https://claude.ai/api/mcp/auth_callback?code=c1&state=st-1')`, POST 본문 `decision:'ALLOW'`(trackRequests).
  - `{ tag: '@layout' }` `390px 에서 긴 이름·이메일·워크스페이스·확인되지 않은 앱도 가로로 넘치지 않는다` — `test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })` 를 이 테스트의 describe 에, 사용자 `createUser({ name: '아주긴이름'.repeat(8), email: 'very.long.address.for.layout.check@an-extremely-long-subdomain.example.com' })` 로 `setupAuthMocks`, validate 응답 `clientName` 60자·`redirectHost` 70자·`unverified: true`·워크스페이스 둘(이름 40자) → `expectNoHorizontalOverflow(page)`, 카드·`거부`·`허용` 의 boundingBox 가 `x >= 0 && x + width <= 390`.
  - `{ tag: '@flow' }` `미로그인으로 동의 주소를 열면 로그인 뒤 같은 쿼리의 동의 화면으로 돌아온다` — `setupAuthMocks(page, createUser(), [], createTokenResponse())` 뒤 `page.addInitScript(() => localStorage.removeItem('hasSession'))`(이 순서 — 첫 적재가 미로그인), `goto(AUTH_PATH)` → `/login` → 아이디·비밀번호 입력·`로그인` → `expect(page).toHaveURL(AUTH_PATH 와 같은 경로+쿼리)` 그리고 h1 `Claude 연결`. 홈 착지(`/`)에 필요한 부가 조회는 `setupAuthMocks` 가 깐다; 모자라면 `tenant-selection.spec.ts` 의 홈 스텁을 따른다.
  - `{ tag: '@platform' }` `같은 출처 iframe 안에서는 막음 문구만 보이고 validate 를 부르지 않는다` — `authenticatedPage` 로 `/` 에서 `page.setContent` 대신 `page.evaluate` 로 `<iframe src="${AUTH_PATH}">` 를 붙이고, `page.frameLocator('iframe')` 안 `이 화면은 다른 화면 안에서 열 수 없습니다.` 보임, `trackRequests(page,'GET','/api/v1/oauth/authorize/validate').count()` 0(dev 서버엔 nginx 헤더가 없어 JS 검사만 본다).
- [ ] **Step 2: 실행** — Run: `cd apps/workplace-web && pnpm exec playwright test e2e/pages/oauth/oauth-consent.spec.ts` / Expected: 4 passed. 한 번 `OAuthConsentPage` 의 `isFramed()` 분기를 지워 `@platform` 이, `px-4`·`min-w-0` 을 지워 `@layout` 이 실패하는지 확인하고 되돌린다.
- [ ] **Step 3: 타입·lint** — Run: `npx tsc -p tsconfig.e2e.json --noEmit` 와 `pnpm lint` / Expected: 오류 없음(태그 규칙 통과).
- [ ] **Step 4: 커밋** — `git add apps/workplace-web/e2e/pages/oauth/oauth-consent.spec.ts` 후 `git commit -m "test(web): 동의 화면의 실제 이동·390px·로그인 복귀·iframe 막음을 E2E 로 지킨다 (WP-1686)" -m "- jsdom 이 잴 수 없는 것만(@wiring·@layout·@flow·@platform) 남기고 상태·문구는 화면 테스트가 지킨다" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

### Task 8: 매뉴얼 12장 「Claude 앱에 연결한다」

**Files:**
- Modify: `docs/manual/user/12-my-settings.md:6`(routes 끝에 `/oauth/authorize`), `:201-209`(「도구에 연결한다」 3번 한 줄), `:175-209` 뒤(새 `### Claude 앱에 연결한다`, `{help=…}` 없음), `:87-116`(「받을 알림을 고른다」에 끌 수 없다는 한 줄)
- Modify: `docs/manual/shots/targets.md:234` 뒤(`my-settings-10` 행)

**Interfaces:** 굵은 글자는 Task 5 문구 표·Task 3 문구와 글자 그대로: **허용**, **거부**, **워크스페이스**, **확인되지 않은 앱**, **연결할 수 없습니다**, **사람 계정 전용**, **새 앱 연결**, **설정 › API 토큰 › 연결된 앱**(마지막은 화면 글자 「연결 끊기: 설정 › API 토큰 › 연결된 앱」 안에 있다).

- [ ] **Step 1: 집필** — 스킬 `manual-authoring` 규칙대로 spec 「매뉴얼」 절의 다섯 요점(커넥터에 `https://<회사 주소>/mcp` → 로그인 뒤 같은 화면, 계정·워크스페이스·권한 확인 후 허용/거부·확인되지 않은 앱이면 주소 확인, 토큰을 발급·복사하지 않음·알림 「새 앱 연결」, 끊기 위치, 오류 두 가지). 「도구에 연결한다」 3번은 「Claude 앱은 아래 Claude 앱에 연결한다를 본다」로. **그림 지시문은 넣지 않는다**(없는 그림은 `manual:check` 실패 — spec 「매뉴얼」 결정). `targets.md` 행: `| my-settings-10 | \`/oauth/authorize?…\` | 김서연(워크스페이스 둘) | DCR 로 클라이언트를 등록하고 PKCE 쿼리로 연다, 허용은 누르지 않는다 | (전체) | \`account,workspace,permission,allow\` | OAuth 클라이언트(DCR) |`.
- [ ] **Step 2: 검사** — Run: `pnpm manual:check user` 와 `pnpm manual:prose` / Expected: 12장 관련 오류 없음(경로 대조에 `/oauth/authorize` 가 잡히고, 굵은 글자가 소스에 있다).
- [ ] **Step 3: 커밋** — `git add docs/manual/user/12-my-settings.md docs/manual/shots/targets.md` 후 `git commit -m "docs(manual): 12장에 Claude 앱에 연결하는 절을 더한다 (WP-1686)" -m "- 커넥터 주소 → 로그인 → 동의 화면에서 워크스페이스를 골라 허용, 확인되지 않은 앱·오류·끊기 위치와 새 앱 연결 알림을 안내한다
- 동의 화면 그림 my-settings-10 은 촬영 대상 표에만 올린다(촬영 필요)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`
- [ ] **Step 4: 재촬영 목록 기록** — 이슈 보고에 「매뉴얼 그림 촬영 필요: my-settings-10(동의 화면 — 촬영 때 12장에 그림 지시문 `{marks=account,workspace,permission,allow}` 함께), my-settings-5(WP-1687 이 도구에 연결하기 화면을 바꿀 때)」.

### Task 9: 라이브 검증(커밋 없음)

**Files:** 없음. 스크린샷 `test-results/exploratory/oauth-consent/<timestamp>/screenshots/`.

- [ ] **Step 1: 스택** — Run: `LIVE_STACK_NAME=work-loop scripts/live-stack.sh up <워크트리 절대 경로>` / Expected: API·웹·DB 가 6160/6273/5444 대 포트로 뜬다(6060·6173·5434 등 금지 포트는 쓰지 않는다). 명령은 스크래치 패드 스크립트 파일로 나눠 쓴다.
- [ ] **Step 2: 끝까지(curl + playwright-cli)** — spec 「라이브 검증」 1–6: DCR(`POST <web>/api/v1/oauth/register`, redirect `http://127.0.0.1:<임의>/callback`) → PKCE → 브라우저로 `<web>/oauth/authorize?…` → 로그인 → 같은 주소 동의(확인되지 않은 앱) → 두 번째 워크스페이스 허용 → 주소창 code → `POST <web>/api/v1/oauth/token` → `swo_` 로 이슈 목록이 고른 워크스페이스 것만, 인박스 「새 앱 연결」 1건·다시 허용해도 그대로, 거부 → `error=access_denied&state=…&iss=…`, 등록 안 된 redirect_uri → 오류 카드·주소 그대로, 390px 가로 스크롤 없음.
- [ ] **Step 3: nginx 헤더** — 웹 nginx.conf 를 docker nginx 컨테이너에 얹어(`--add-host api:127.0.0.1`, 빈 포트) `curl -I '/oauth/authorize?x=1'` → `frame-ancestors 'none'`·`X-Frame-Options: DENY`, `curl -I /` → `'self'`·`SAMEORIGIN`.
- [ ] **Step 4: Claude Code(가능하면)** — MCP 를 빈 포트로(`WORKPLACE_API_BASE_URL=<api>`, `WORKPLACE_OAUTH_ISSUER=<web>`, `PORT`), `claude mcp add --transport http <이름> http://localhost:<mcp>/mcp`(헤더 없이) → 브라우저 동의 → `list_issues`. 안 되면 이유를 기록.
- [ ] **Step 5: 기록** — 완료 기준 1–8 별 결과를 이슈 보고에 남기고, claude.ai 커스텀 커넥터·운영 nginx 헤더는 「배포 뒤 사람 확인」으로 남긴다. 스택 내리기(`live-stack.sh down`).

---

## Self-Review

1. **Spec coverage** — 화면 상태 1–2(ProtectedRoute 그대로 + 복귀 접두: T5), 3–12(T5, 순수 판정 T4), 「라우트·컴포넌트·파일 계획」 전 항목(App·ProtectedRoute·Page·Card·api·types·lib·documentTitle T4–5, sw·vite·nginx T6, 알림 웹 T3), API 변경(T1–2), nginx 글자 테스트(T6), 접근성·390px(T5 구현 + T7 @layout), 테스트 절 vitest·E2E·JUnit 전부(T1–7), 매뉴얼(T8), 라이브(T9), 완료 기준 1–8(T9 표 + 각 테스트). 빈 곳 없음.
2. **Step scan** — 테스트 단계는 이름과 단언 값, 코드 단계는 시그니처와 spec 값, 검증 단계는 명령과 기대 결과. 함수 본문은 넣지 않았다.
3. **Type consistency** — `AuthorizeFailure`·`readAuthorizeError(err, phase, userKind)`·`leaveTo`·`isFramed`·`appInitial`·`initialTenantId`·`decisionBody` 이름이 T4 정의와 T5 사용에서 같다. `createOAuthAppConnectedAndFanOut(long, String)`·`OAuthConnectionCreatedEvent(long, long, String)`·`insertAccountNotice(long, NotificationType, Long, String)` 가 T1·T2 에서 같다. `TOKEN_SETTINGS_PATH`·`OAUTH_APP_LABEL`·`isOAuthAppConnectedType` 는 T3 안에서만 쓴다.
4. **Review Focus** — 다섯 줄 모두 소유 태스크에 테스트가 있다(T4 두 건, T5 네 건).
5. **Proportion** — 화면 문구 표와 테스트 이름·단언이 대부분이고, 구현 본문은 없다. spec 보다 조금 긴 정도.
