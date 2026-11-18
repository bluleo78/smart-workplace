# 설정 › API 토큰 「연결된 앱」·끊기, 「Claude 앱에 연결」 주소 복사 — 설계 (WP-1687)

부모 WP-1669(기획 확정 — 방안 A, 시안 그림 2·5). 앞: WP-1685(OAuth 서버 — 연결 목록·끊기 API, origin/main), WP-1686(동의 화면·새 앱 연결 알림 — 이 이슈를 막고 있고, 구현은 그 커밋 위에서 한다). 무인 work-loop 세션 — 설계 승인은 스스로 하고, 시안이 정하지 않은 것은 끝의 「내가 정한 것」에 결정으로 남긴다.

## 1. 의도

Claude 앱(커넥터)이 토큰 없이 OAuth 로 연결되게 됐다(WP-1685·1686). 사용자는 ① 어떤 앱이 어느 워크스페이스에 내 권한으로 붙어 있는지 보고, 내가 하지 않은 연결이면 바로 끊을 수 있어야 하고, ② Claude 앱에 넣을 커넥터 주소를 어디서 얻는지 알아야 한다. 둘 다 이미 사람들이 외부 도구 연결을 관리하는 **설정 › API 토큰** 화면에 둔다(새 메뉴 없음 — WP-1669).

## 2. 목표 / 비목표

목표 (이슈 완료 기준과 1:1)
1. 연결한 앱이 「연결된 앱」에 앱 이름·redirect 호스트·워크스페이스·연결일·마지막 사용과 함께 보인다.
2. 「끊기」 → 확인 → 목록에서 빠지고, 그 앱의 다음 도구 호출이 401 이다.
3. 연결된 앱이 없으면 「연결된 앱」 절이 보이지 않는다.
4. 「Claude 앱에 연결」의 복사 단추가 커넥터 주소를 복사한다.
5. 모바일 390px 에서 가로 스크롤 없이 보인다.
6. 매뉴얼 12장(설정 › API 토큰)에 「연결된 앱을 보고 끊는다」를 더하고, 「Claude 앱에 연결한다」가 새 안내(주소 복사)를 가리키게 고친다.

비목표
- 서버 API 추가·응답 변경(WP-1685 응답에 화면이 쓸 필드가 다 있다 — 3절).
- 연결 이름 바꾸기·scope 고르기·연결 상세(토큰 목록) 화면, 끊은 연결 이력 표시.
- 관리자가 남의 연결을 보는 화면(감사 로그 `OAUTH_CONNECTION_*` 는 WP-1685 가 이미 남긴다 — 확인만).
- 발급 결과 모달(TokenIssueDialog)에 Claude 앱 안내 넣기(토큰을 막 발급한 사람에게 토큰 없는 연결을 섞지 않는다).
- dev·데모 배포에서 claude.ai 가 닿을 수 있는 공개 주소 만들기(배포 문제 — 「알려진 위험」).

## 3. 조사 결과 (제약)

- **API(WP-1685, main)** `MyOAuthConnectionController`
  - `GET /api/v1/users/me/oauth-connections` → `OAuthConnectionResponse[]` = `{ id, clientName, unverified, redirectHost(nullable), tenantId, tenantName, createdAt, lastUsedAt(nullable) }`. 본인 것만, **모든 워크스페이스**, 살아 있는 것만(revoked 제외), 최근 연결 순(created_at desc, id desc). 같은 앱을 다른 워크스페이스에 연결하면 줄이 둘.
  - `DELETE /api/v1/users/me/oauth-connections/{id}` → 204. 연결 revoked_at + 그 연결 토큰 모두 폐기 + 연결 워크스페이스에 감사 `OAUTH_CONNECTION_REVOKED` 를 한 트랜잭션에. 남의 것·없는 것·이미 끊긴 것은 404 「앱 연결을 찾을 수 없습니다」. 웹 세션 요구 없음.
  - `last_used_at` 은 토큰 인증 필터·code 교환·refresh 때 1분에 한 번 갱신(`touchLastUsed`). 화면 정밀도는 분이면 충분.
  - 인증 쿼리는 토큰 revoked_at·연결 revoked_at 을 함께 본다 → 끊은 즉시 `swo_` 가 API 에서 401(`OAuthConnectionApiTest.delete_revokesAndSwoIs401` 가 이미 지킨다).
  - **API 변경 필요 없음.**
- **화면** `TokenSettingsPage.tsx`: 토큰 표(bordered `Table`, `hidden md:table-cell` 로 모바일에서 열을 숨기고 이름 아래 메타 한 줄 — WP-617/1126), 로딩 `TableSkeletonRows`, 오류 행 「목록을 불러오지 못했습니다」, 빈 상태 `TableEmptyRow`, 폐기 `AlertDialog`(destructive), 표 아래 `<section aria-labelledby>` 「도구에 연결하기」(`TokenConnectGuide tokenSource="saved"`, data-help `tokens.connect`). 데이터는 React Query(`useMyTokens`·`useRevokeMyToken` — 성공 시 invalidate + 토스트, 실패 `handleApiError`). 전역 기본 `staleTime 30s`, `refetchOnWindowFocus false`.
- **커넥터 주소**: `lib/mcpEndpoint.ts` 의 `MCP_ENDPOINT` = `VITE_MCP_URL`(운영 빌드는 빈 값) → dev 면 `http://localhost:6090` → 아니면 `window.location.origin`, 뒤에 `/mcp`. 운영(`values.prod.yaml`: webHost `genia-works.iacloud.kr`, `mcpPathOnWeb: true`)에서 `https://genia-works.iacloud.kr/mcp` = 플러그인 기본 주소(`PLUGIN_DEFAULT_SERVER_URL`). WP-1685 보호 리소스 메타데이터의 `resource` 는 **요청의 공개 원점**(X-Forwarded-Host/Proto)+경로로 만들어 사용자가 넣은 주소와 늘 같다 → 화면이 `MCP_ENDPOINT` 를 보이면 일치한다. 같은 값이 이미 「다른 도구로 연결」의 「연결 주소」로 나가고 있다.
- **WP-1686(디스크 파일)**: 동의 카드 맨 아래 글자 「연결 끊기: 설정 › API 토큰 › 연결된 앱」(링크 아님). `OAUTH_APP_CONNECTED` 알림 → `notifTarget` 의 `TOKEN_SETTINGS_PATH = '/settings/tokens'`, 푸시 `PushContentService` 이동 주소 `"/settings/tokens"`. `types/oauth.ts`·`api/oauth.ts`(동의 화면용)를 만들었다. 매뉴얼 12장 「Claude 앱에 연결한다」(help 없음, 1단계가 `https://<회사 주소>/mcp` 를 직접 넣으라 함), 「도구에 연결한다」 2번이 「다른 도구로 연결 (Claude.ai, ChatGPT 등)」 글자를 가리킴. targets.md 에 my-settings-10(동의 화면, 미촬영) 행.
- **MCP 게이트웨이 인증 캐시**(WP-1013): 검증 성공을 60초 기억한다. 끊은 뒤 60초 안의 도구 호출은 게이트웨이를 통과하고, 도구가 부른 API 가 401 → 도구 오류 글(`API 인증 실패(401)…`)로 돌아온다. 60초 뒤엔 HTTP 401 + `WWW-Authenticate`. 어느 쪽이든 도구는 데이터에 닿지 못한다(「알려진 위험」 R1).
- **테스트 환경**: vitest MSW 는 처리 못 한 요청을 테스트 끝에 실패시킨다 → 토큰 화면을 띄우는 기존 테스트 모두 새 GET 핸들러가 필요하다. E2E 는 모킹 누락이 503.

## 4. Approaches

**목록 자리**
- A. (고름) 같은 화면 토큰 표 아래 독립 절 `ConnectedAppsSection` — 자기 쿼리·확인 창·빈 상태 숨김. 시안 그림 2·5 그대로, 토큰 표와 열·동작이 달라 따로 두는 편이 단순하다.
- B. 토큰 표에 「종류」 열을 두고 연결을 섞기 — 열 의미(앞자리·만료 vs 워크스페이스·연결일)와 동작(폐기 vs 끊기)이 달라 표가 흐려진다. 버림.
- C. 설정에 「연결된 앱」 메뉴 새로 — WP-1669 가 「새 메뉴 없이 같은 화면」으로 확정. 버림.

**「Claude 앱에 연결」 자리**
- A. (고름) `TokenConnectGuide` 에 `showClaudeApp` prop 을 두어 「Claude Code 에 연결」 3단계 **뒤**, 「다른 도구로 연결」 접힘 **앞**에 블록을 그린다. 읽는 순서가 Claude Code → Claude 앱 → 그 밖의 도구로 자연스럽고, 모달은 prop 을 안 넘겨 그대로다.
- B. 페이지에서 `TokenConnectGuide` 다음에 붙이기 — 「다른 도구로 연결」 접힘 뒤에 Claude 앱이 와서 순서가 어색하다. 버림.
- C. 「다른 도구로 연결」 접힘 안에 넣기 — 이번 기능의 주인공을 접어 숨긴다. 버림.

## 5. 설계

### 5.1 파일

| 파일 | 변경 |
|---|---|
| `src/types/oauth.ts` (WP-1686) | `OAuthConnection` 인터페이스 추가(서버 `OAuthConnectionResponse` 1:1) |
| `src/api/oauthConnections.ts` (새) | `listMyOAuthConnections()`·`revokeMyOAuthConnection(id)` — `userTokens.ts` 와 같은 모양 |
| `src/hooks/queries/useOAuthConnections.ts` (새) | `oauthConnectionKeys.mine = ['oauthConnections','me']`, `useMyOAuthConnections()`(**staleTime 0, refetchOnWindowFocus true** — 연결은 이 탭 밖(Claude 앱 → 다른 탭 동의 화면)에서 생기므로), `useRevokeMyOAuthConnection()`(성공 토스트, 실패 `handleApiError`, **onSettled 에서 invalidate** — 404(다른 곳에서 이미 끊김)여도 줄이 사라지게) |
| `src/pages/settings/components/ConnectedAppsSection.tsx` (새) | 절·표·모바일 메타·끊기 확인 창·앵커 스크롤 |
| `src/pages/settings/components/ClaudeAppConnect.tsx` (새) | 「Claude 앱에 연결」 블록(소제목·설명·`CopyableCommand`) |
| `src/pages/settings/components/TokenConnectGuide.tsx` | `showClaudeApp?: boolean` — true 면 3단계 뒤·접힘 앞에 `ClaudeAppConnect`. 접힘 글자 「다른 도구로 연결 (ChatGPT 등)」 |
| `src/pages/settings/TokenSettingsPage.tsx` | 토큰 표 아래 `<ConnectedAppsSection />`, 안내에 `showClaudeApp` |
| `src/lib/connectedApps.ts` (새) | `CONNECTED_APPS_ANCHOR = 'connected-apps'`·`CONNECTED_APPS_PATH` — 절 id·해시 비교와 알림 이동 주소가 한 글자를 쓴다(최종 리뷰 #7) |
| `src/components/home/notifTarget.ts` (WP-1686) | 새 앱 연결 알림 → `CONNECTED_APPS_PATH`(`/settings/tokens#connected-apps`) |
| `src/lib/push/openTarget.ts` | 목적지가 `CONNECTED_APPS_PATH` 면 푸시의 tenantId 가 다른 워크스페이스여도 전환하지 않는다 — 연결된 앱 목록은 사용자 단위라 전체 새로고침이 필요 없다(최종 리뷰 #6) |
| `workplace-api …/notify/push/PushContentService.java` (WP-1686) | 푸시 이동 주소 같은 값으로(문자열 한 줄) |
| `docs/manual/user/12-my-settings.md`, `docs/manual/shots/targets.md`, `docs/manual/scripts/scenes/user.mjs`, `docs/manual/help-figures/user/*` | 7절 |

### 5.2 「연결된 앱」 절

- 자리: 토큰 표 바로 아래, 「도구에 연결하기」 위(시안). `<section id="connected-apps" aria-labelledby="connected-apps-title" data-help="tokens.apps" data-testid="connected-apps">`, 제목 h2 는 「도구에 연결하기」와 같은 `text-base font-semibold`. 위 구분선은 두지 않는다(시안 — 구분선은 「도구에 연결하기」 위에만).
- 보임 규칙: **로딩 중 숨김**(대부분 사용자는 연결이 없어 뼈대가 잠깐 떴다 사라지는 깜빡임이 더 나쁘다), **빈 목록 숨김**, **오류면 보임**(보안 목록이라 실패를 숨기면 「없음」으로 착각한다 — 표 안 한 줄 오류).
- 열(데스크톱 md 이상): 앱 | 워크스페이스 | 연결 | 마지막 사용 | (끊기). 모바일(<md)은 「앱」과 끊기 열만 남기고 워크스페이스·연결·사용을 이름 아래 한 줄로(토큰 표 WP-617/1126 방식 — `hidden md:table-cell`, 메타 줄 `flex flex-wrap gap-x-2`, 각 항목 `whitespace-nowrap`, 워크스페이스만 `truncate`).
- 앱 칸: 첫 줄 `clientName`(굵게, truncate, title 전체) + `unverified` 면 동의 화면과 같은 「확인되지 않은 앱」 표시(`bg-warning-subtle text-warning-text` 작은 글자). 둘째 줄 `redirectHost`(muted xs, null 이면 줄 없음).
- 연결: `formatDateOnly(createdAt)`(YYYY-MM-DD, 시안). 마지막 사용: `formatRelativeTime(lastUsedAt)`(「방금 전」·「3시간 전」, title 에 `formatDateTimeLocale` 절대 시각), null 이면 `—`(`EMPTY_GLYPH`).
- 끊기: 행 오른쪽 `Button variant="ghost" size="sm"` 빨간 글자(시안), 접근 이름 「{앱} {워크스페이스} 연결 끊기」(줄마다 구별). 누르면 그 행 객체를 상태에 담고 확인 창.
- 확인 창: `AlertDialog`(토큰 폐기와 같은 모양, `data-help="tokens.apps"`), 확인 → `revoke.mutate(id)` 후 창 닫힘(토큰 폐기와 같다), 성공 시 목록 다시 읽기로 줄이 빠진다(낙관적 제거 안 함).
- 앵커: 주소 해시가 `#connected-apps` 이고 목록이 처음 그려지면 절을 `scrollIntoView({ block: 'start' })` 한 번. 목록이 비어 절이 없으면 아무것도 안 한다. (토큰 목록은 폐기한 것까지 쌓여 길어질 수 있어, 「내가 하지 않은 연결이면 바로 끊는다」 알림에서 곧장 끊는 곳에 닿게 한다.)
- testid: `connected-apps`, `oauth-connection-row-{id}`, `oauth-connection-meta-{id}`, `oauth-connection-revoke-{id}`, `oauth-connection-confirm-dialog`·`-confirm`·`-cancel`. 표 `aria-label="연결된 앱 목록"`.

### 5.3 「Claude 앱에 연결」 블록

`TokenConnectGuide` 안, 「3. 확인」 뒤에 `border-t pt-3` 로 구분하고 `data-help="tokens.claude-app" data-testid="{p}-claude-app"`.
소제목(「Claude Code 에 연결」과 같은 `text-sm font-medium`) → 설명(xs muted) → `CopyableCommand command={MCP_ENDPOINT} label="커넥터 주소" testId="{p}-claude-app-url"` → 끝 안내 한 줄.

### 5.4 화면 문구 (확정)

| 자리 | 문구 |
|---|---|
| 절 제목 | 연결된 앱 |
| 표 접근 이름 | 연결된 앱 목록 |
| 열 이름 | 앱 · 워크스페이스 · 연결 · 마지막 사용 · (빈 머리) |
| 확인되지 않은 앱 표시 | 확인되지 않은 앱 |
| 모바일 메타 | `{워크스페이스}` `연결 {YYYY-MM-DD}` `사용 {상대 시각 또는 —}` |
| 행 단추 / 접근 이름 | 끊기 / `{앱} {워크스페이스} 연결 끊기` |
| 확인 창 제목 | 앱 연결 끊기 |
| 확인 창 본문 | `{앱}`의 `{워크스페이스}` 연결을 끊으시겠습니까? 이 앱은 바로 Gen:iA Works 에 접근할 수 없게 되고, 다시 쓰려면 앱에서 다시 연결해야 합니다. |
| 확인 창 단추 | 취소 · 끊기(destructive) |
| 성공 토스트 | 앱 연결을 끊었습니다 |
| 실패 토스트 | 서버 메시지(404 「앱 연결을 찾을 수 없습니다」), 없으면 「앱 연결 끊기에 실패했습니다」 |
| 목록 오류 | 연결된 앱을 불러오지 못했습니다 |
| 빈 상태 | (절 숨김 — 문구 없음) |
| Claude 블록 소제목 | Claude 앱에 연결 |
| Claude 블록 설명 | Claude 앱(데스크톱·웹)의 커넥터 추가 화면에 아래 주소를 넣으세요. 토큰은 필요 없어요 — 로그인한 뒤 동의 화면에서 워크스페이스를 고르고 허용하면 연결됩니다. |
| 복사 단추 / 접근 이름 | 복사 / 커넥터 주소 복사 |
| 복사 완료 / 실패 토스트 | 커넥터 주소를 복사했습니다 / 복사에 실패했습니다. 커넥터 주소를 직접 선택해 복사하세요. (`CopyableCommand` 기본 규칙) |
| Claude 블록 끝 안내 | 연결하면 이 화면의 「연결된 앱」에서 보고 끊을 수 있어요. (연결이 없어 절이 숨었을 때도 맞는 말이 되게 「위」라고 가리키지 않는다) |
| 접힘 글자(바뀜) | 다른 도구로 연결 (ChatGPT 등) |

「도구에 연결하기」 절 설명(「발급 때 나온 안내와 같습니다…」)은 그대로 둔다 — Claude 블록 설명이 토큰이 필요 없음을 따로 말한다.

### 5.5 스케치

데스크톱(1440)
```
API 토큰                                                      [토큰 발급]
┌ 이름 │ 앞자리 │ 만료 │ 마지막 사용 │ 상태 │      ┐   (기존 그대로)
└──────────────────────────────────────────────┘
연결된 앱
┌ 앱                    │ 워크스페이스 │ 연결       │ 마지막 사용 │       ┐
│ Claude                │ Work Loop    │ 2026-11-17 │ 방금 전     │ 끊기  │
│ claude.ai             │              │            │             │       │
│ My Tool [확인되지 않은 앱]│ Work Loop │ 2026-11-12 │ 3시간 전    │ 끊기  │
│ 127.0.0.1             │              │            │             │       │
└───────────────────────────────────────────────────────────────────┘
──────────────────────────────────
도구에 연결하기
발급 때 나온 안내와 같습니다. …
Claude Code 에 연결
 1. 플러그인 설치 [명령][복사]  2. 토큰 넣기  (서버 주소)  3. 확인
 ─────
 Claude 앱에 연결
 Claude 앱(데스크톱·웹)의 커넥터 추가 화면에 아래 주소를 넣으세요. …
 [https://genia-works.iacloud.kr/mcp]                           [복사]
 연결하면 이 화면의 「연결된 앱」에서 보고 끊을 수 있어요.
 ─────
 다른 도구로 연결 (ChatGPT 등)                                      ▾
```
모바일(390)
```
< API 토큰                    토큰 발급
┌ 이름          │ 상태 ┐
연결된 앱
┌ 앱                       ┐
│ Claude              끊기 │
│ claude.ai                │
│ Work Loop 연결 2026-11-17 사용 방금 전 │  ← 넘치면 항목 단위로 줄바꿈
└──────────────────────────┘
도구에 연결하기 …
```

## 6. 테스트 전략

기본 vitest(MSW, `renderScreen`), 브라우저가 필요한 390px 넘침만 E2E @layout.

- `src/pages/settings/connectedApps.test.tsx`(새, `renderScreen(<ConnectedAppsSection />)`)
  1. 두 줄(같은 앱 다른 워크스페이스 포함) — 이름·redirect 호스트·워크스페이스·YYYY-MM-DD·상대 시각, `lastUsedAt` null → `—`, `unverified` → 「확인되지 않은 앱」, 줄마다 끊기 접근 이름이 다르다.
  2. 빈 목록 → `region` 「연결된 앱」 없음. 로딩 중(응답 지연) → 없음. 500 → 절과 「연결된 앱을 불러오지 못했습니다」.
  3. 끊기 → 확인 창 본문에 앱·워크스페이스 → 끊기 → `DELETE /api/v1/users/me/oauth-connections/{id}` 가 그 id 로 한 번, 다시 읽은 목록에서 줄이 빠지고 토스트 「앱 연결을 끊었습니다」. 취소 → DELETE 없음.
  4. DELETE 404 → 오류 토스트 「앱 연결을 찾을 수 없습니다」 + 목록 다시 읽어 줄이 빠진다.
  5. path `/settings/tokens#connected-apps` → 목록이 그려진 뒤 절에서 `scrollIntoView` 한 번(jsdom 은 `Element.prototype.scrollIntoView` 를 대역으로).
  6. `data-help`: 절·확인 창 `tokens.apps`.
- `tokenSettings.test.tsx`(기존): `openTokens` 에 `GET /api/v1/users/me/oauth-connections`(기본 `[]`) 핸들러 추가. 「Claude 앱에 연결」이 「도구에 연결하기」 안, 「Claude Code 에 연결」 뒤·접힘 앞에 있고 `커넥터 주소 복사` → 클립보드 = `MCP_ENDPOINT`. 접힘 글자 「다른 도구로 연결 (ChatGPT 등)」. data-help `tokens.claude-app`. 연결 하나를 주면 절이 토큰 표와 「도구에 연결하기」 사이에 있다(DOM 순서). 발급 결과 모달에는 Claude 블록이 없다.
- `notifTarget.test.ts`: `OAUTH_APP_CONNECTED` → `/settings/tokens#connected-apps`.
- `PushContentServiceTest`(JUnit): 이동 주소 기대값 갱신. 연결 목록·끊기·끊은 뒤 401 은 WP-1685 `OAuthConnectionApiTest` 가 지키므로 새 서버 테스트는 없다.
- E2E `e2e/pages/mobile/api-tokens.spec.ts` 에 @layout 하나: 긴 앱 이름·긴 워크스페이스 이름·`unverified` 줄을 모킹 → body 가로 넘침 없음, 끊기·메타 줄이 뷰포트 안. 같은 파일·`e2e/pages/settings/api-tokens.spec.ts`·`help-context.spec.ts`·`settings-layout.spec.ts` 의 토큰 화면 진입에 `oauth-connections` 빈 목록 모킹 추가(503 오류 행이 섞이지 않게). 타입은 `src/types/oauth.ts` 로.
- 라이브 확인(work-loop `project.md`): DCR → 동의 허용 → 토큰 교환으로 연결을 만들고 화면에 보이는지, 끊기 뒤 그 `swo_` 로 API(`/api/v1/auth/me`) 직접 호출이 401 인지(R1 때문에 MCP 경유는 60초 뒤 HTTP 401).

## 7. 매뉴얼·촬영

`docs/manual/user/12-my-settings.md`(WP-1686 판 위에서)
- `## 외부 AI 도구를 연결한다` 첫 문단: 「…도구에 연결하는 방법을 보고, 연결한 앱을 보고 끊습니다」로 한 구절 더함.
- `### 도구에 연결한다` 2번: 접힘 글자를 **다른 도구로 연결 (ChatGPT 등)** 으로.
- `### Claude 앱에 연결한다 {help=tokens.claude-app label=Claude 앱에 연결}` — help 를 단다(WP-1686 이 미뤄 둔 것). 1단계를 「**도구에 연결하기** 의 **Claude 앱에 연결** 에서 커넥터 주소를 **복사** 해 Claude 앱의 커넥터 추가 화면 서버 주소에 넣습니다.」로 바꾼다(`https://<회사 주소>/mcp` 직접 입력 문장 삭제). 끝 문단의 「연결 끊기는 **설정 › API 토큰 › 연결된 앱**」 뒤에 아래 절 링크.
- 새 `### 연결된 앱을 보고 끊는다 {help=tokens.apps label=연결된 앱}`(「Claude 앱에 연결한다」 뒤): 목록이 무엇을 보이는지(앱 이름·주소·워크스페이스·연결일·마지막 사용, 같은 앱을 다른 워크스페이스에 연결하면 줄이 따로), 연결이 없으면 절이 보이지 않음, **끊기** → 확인 창 **끊기** → 그 앱은 곧바로 접근이 막히고 다시 쓰려면 Claude 앱에서 다시 연결, 「확인되지 않은 앱」·모르는 연결은 바로 끊는다(주의 상자), 비밀번호를 바꾸면 모든 앱 연결이 함께 끊긴다(WP-1685 F5 — 서버 동작).
- 그림: `my-settings-5` **다시 찍음**(접힘 글자·Claude 블록이 바뀜). 표식 `claude,app,other,url`, 자르기 `claude+url`(Claude 블록이 사이에 들어가 저절로 포함). 장면의 복사 단추 찾기를 `.first()`/`.nth(1)` 에서 접근 이름(`설치 명령 복사`·`커넥터 주소 복사`·`연결 주소 복사`)으로 바꾼다. 본문 번호 목록을 표식 순서(claude·app·other·url)에 맞춘다.
- 새 `my-settings-11`(연결된 앱 목록, 데스크톱 1440, 자르기 `apps`, 표식 `app,workspace,revoke`): 장면이 DCR 등록 → 김서연 세션으로 승인 → 토큰 교환으로 연결 하나를 만들고 찍은 뒤 끊는다(my-settings-10 과 같은 준비 — 공용 도우미로). 촬영 환경에서 이 준비가 안 되면 WP-1686 과 같이 targets.md 행만 넣고 그림 지시문은 넣지 않고 이슈에 「매뉴얼 그림 촬영 필요: my-settings-11」을 남긴다.
- 찍은 그림이 바뀌면 `pnpm manual:help-figures`, 마지막에 `pnpm manual:check user`.

## 8. 내가 정한 것

1. 절 보임: 로딩·빈 목록은 숨김, 오류는 보임(보안 목록의 실패를 「없음」으로 오해하지 않게).
2. 날짜는 시안대로 연결 = `YYYY-MM-DD`(`formatDateOnly`), 마지막 사용 = 공용 상대 시각(`formatRelativeTime` — 시안의 「방금」 대신 공용 표기 「방금 전」), 없으면 `—`. 토큰 표의 로케일 날짜는 건드리지 않는다.
3. 시안에 없는 「확인되지 않은 앱」 표시를 앱 이름 옆에 단다(응답에 이미 있고, 동의 화면과 같은 경고를 끊는 곳에서도 보이게).
4. 끊기 확인 창은 토큰 폐기와 같은 AlertDialog·닫고 나서 다시 읽기(낙관적 제거 없음). 끊기 결과는 성공·실패 모두 목록 다시 읽기(404 = 이미 끊김도 줄이 사라진다).
5. 연결 목록 쿼리만 `staleTime 0`·창 포커스 때 다시 읽기 — 연결은 이 탭 밖에서 생긴다. 토큰 목록 설정은 그대로.
6. 새 앱 연결 알림·푸시는 `/settings/tokens#connected-apps` 로 가고 절로 스크롤한다(WP-1686 의 `notifTarget`·`PushContentService` 문자열 변경). 스크롤은 이동마다 한 번, 토큰 목록이 처음 불러오기를 마치고(성공·실패) 연결 목록을 마운트 뒤 받은(`isFetchedAfterMount`) 다음, 줄이나 오류 줄이 있을 때 한다(최종 리뷰 #1~#3). 다른 워크스페이스의 푸시여도 워크스페이스를 바꾸지 않는다(`openPushTarget`). 동의 카드 맨 아래 글자는 그대로(링크 아님 — WP-1686 Q4).
7. 「Claude 앱에 연결」은 `TokenConnectGuide` 의 `showClaudeApp` 으로 Claude Code 3단계 뒤·「다른 도구로 연결」 앞, 토큰 화면에만. 주소는 기존 `MCP_ENDPOINT` 를 그대로 쓴다(보호 리소스 `resource` 가 요청 원점 기준이라 늘 일치). 접힘 글자에서 「Claude.ai」를 뺀다.
8. 데이터 계층은 동의 화면 `api/oauth.ts` 와 나눠 `api/oauthConnections.ts`·`useOAuthConnections.ts`(토큰 쪽 모양), 타입만 `types/oauth.ts` 에 모은다.
9. 도움말 id: 절·확인 창 `tokens.apps`, Claude 블록 `tokens.claude-app` — 매뉴얼 절에 같은 id.
10. 매뉴얼 그림: my-settings-5 재촬영, 새 my-settings-11(준비가 안 되면 행만 두고 촬영 필요 표시).

## 9. 빌더에게 남긴 것

- `ConnectedAppsSection` 의 열 너비·최대 폭(시안처럼 풀폭 표, 앱 칸 `max-w-[45vw] md:max-w-[260px]` 안팎)과 빨간 ghost 단추 클래스는 기존 컴포넌트(`Button` 변형 유무)를 보고 고른다.
- 앵커 스크롤을 절 컴포넌트 안 `useEffect`(location.hash + 데이터 준비) 로 할지 작은 훅으로 뺄지.
- 서비스워커 알림 클릭이 해시 붙은 주소로 기존 창을 옮길 때 해시가 살아 있는지 확인(`sw/logic.ts` 의 열기 경로) — 안 살면 해시 없이도 동작은 같으니 앵커만 포기.
- 토큰 화면을 띄우는 다른 vitest·E2E 가 있으면(`grep -rn "settings/tokens"`) 새 GET 모킹을 넣는다.

## 10. 알려진 위험

- R1. MCP 게이트웨이 인증 캐시(60초, WP-1013) 때문에 끊은 직후 60초 동안은 MCP 응답이 HTTP 401 이 아니라 도구 오류 글(API 401)이다. 데이터 접근은 즉시 막힌다. 완료 기준 2의 「401」은 API 기준으로 확인하고, 캐시를 끊기 때 비우는 것은 이 이슈 범위 밖(필요하면 별도 이슈).
- R2. 커넥터 주소는 `MCP_ENDPOINT`(빌드 값 없으면 웹 원점 + `/mcp`)라 `mcpPathOnWeb: true` 인 배포(운영)에서만 claude.ai 가 그대로 쓸 수 있다. 기본 values(데모, false)와 dev(`http://localhost:6090`)는 기존 「연결 주소」와 같은 한계 — 이번에 고치지 않는다.
- R3. WP-1686 이 아직 main 에 없다 — 이 이슈는 그 커밋 위에서 만들고 같은 릴리스로 나가야 한다(동의 카드 글자가 가리키는 절이 이 이슈다). WP-1686 파일(`notifTarget.ts`·`PushContentService`·매뉴얼 12장)을 고치므로 그쪽이 바뀌면 충돌을 다시 본다.
- R4. 기존 토큰 화면 테스트가 새 GET 을 모킹하지 않으면 vitest 가 「처리 못 한 요청」으로 실패한다(의도된 안전장치) — 6절대로 함께 고친다.
- R5. my-settings-11 촬영 준비(DCR·승인·교환)가 장면 시드 없이 장면 안에서 이뤄져 촬영 DB 에 끊긴 연결 행·감사가 남는다 — 무해하지만 장면 주석에 적는다.

## 열린 질문

없음.
