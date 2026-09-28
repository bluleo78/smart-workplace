# PWA 설치 + Web Push 알림 설계

- 작성일: 2026-09-28
- 상태: 설계 검토 중
- 범위: Gen:iA Workplace 를 PWA 로 설치 가능하게 하고, 앱/탭이 닫혀 있어도 Web Push 로 알림을 받는다.
- 비범위: 모바일 반응형 레이아웃(별도 에픽), 네이티브 앱(Capacitor), 오프라인 데이터 캐시.

## 1. 목표와 합의 사항

### 목표

- 사용자가 모바일/데스크톱에서 워크플레이스를 "앱"처럼 설치(홈 화면 추가)할 수 있다.
- 앱이 닫혀 있어도 다음 알림을 OS 푸시로 받는다.
  - 메시지: **DM 전체**, **채널에서 나를 멘션한 메시지**
  - 기존 인박스 알림: 이슈(배정·코멘트·상태·우선순위 변경), 캘린더(초대·RSVP 변경·리마인더)
- 알림을 탭하면 해당 화면(필요 시 해당 테넌트로 전환)으로 이동한다.
- SaaS 와 온프레미스가 **같은 이미지**로 동작한다. 폐쇄망(푸시 서비스로 외부 연결 불가)이면 푸시만 비활성, 나머지 PWA 는 정상.

### 합의된 결정

| 항목 | 결정 |
|---|---|
| 푸시 대상 | DM + 멘션 + 기존 인박스 알림(이슈·캘린더). 채널 일반 메시지는 제외 |
| 알림 설정 | 기기별 푸시 on/off + 사용자 단위 종류별 on/off(DM·MENTION·ISSUE·CALENDAR) |
| 발송 위치 | workplace-api notify 모듈에서 직접 발송(Java `web-push` + BouncyCastle) |
| 서비스워커 | `vite-plugin-pwa` injectManifest 모드(SW 코드는 직접 작성) |
| 메시지 알림 저장 | notification 인박스에 저장하지 않는다(푸시 전용). messaging 자체 미읽음이 이미 있음 |
| 오프라인 | 앱 셸만 precache. `/api/*` 는 캐시하지 않음 |

### 1차 비범위 (YAGNI)

앱 아이콘 배지, 알림 액션 버튼, 방해금지 시간대, 채널/DM 음소거, 스레드 팔로우 답글 알림, 메시지 수정으로 추가된 멘션 알림, 푸시 재시도 큐.

### 플랫폼 제약 (전제)

- iOS/iPadOS 16.4+ 이며 **홈 화면에 설치된 PWA** 에서만 푸시 수신. Safari 탭에서는 불가.
- iOS 는 푸시 수신 시 반드시 알림을 표시해야 한다(미표시 반복 시 구독 취소).
- 권한 요청은 사용자 제스처(버튼 클릭) 안에서만 가능.
- Android 는 절전/배터리 최적화로 지연될 수 있다(best-effort).

## 2. 아키텍처

```
[workplace-web]
  ├─ public/manifest (vite-plugin-pwa 생성)   name, icons(192/512/maskable), display=standalone
  ├─ src/sw.ts (injectManifest)               앱 셸 precache + push + notificationclick
  ├─ src/lib/push/                            권한·구독·서버 등록/해제 (UI 무관 순수 모듈)
  ├─ src/pages/settings/NotificationSettingsPage.tsx   /settings/notifications
  └─ src/pages/PushOpenPage.tsx               /push-open — 알림 탭 진입점(테넌트 전환 + 이동)

[workplace-api / notify 모듈]
  ├─ push/VapidKeyProvider              env 우선 → DB → 없으면 최초 기동 시 생성·저장
  ├─ push/PushSubscriptionService       구독 upsert/삭제/만료 정리
  ├─ push/NotificationPreferenceService 종류별 on/off (행 없으면 기본 on)
  ├─ push/PushGateway (interface)       실제 HTTP 발송 추상화 — 테스트에서 대체
  ├─ push/WebPushGateway                web-push 라이브러리 구현
  ├─ push/PushSender                    구독 조회 → 게이트웨이 호출 → 결과 반영 (pushExecutor)
  ├─ push/PushDispatcher                "누구에게 무엇을" — 인박스 알림 훅 + 메시지 이벤트 리스너
  └─ controller/PushController          /api/v1/push/*
```

- 메시지 푸시 대상 계산은 **messaging 이 이벤트에 담아** 발행하고, notify 는 발송만 한다. `MessageAiTriggerEvent` 와 같은 패턴으로, notify 가 messaging 내부(채널 멤버/종류)를 조회하지 않아 Modulith 경계와 단방향 의존을 유지한다.
- 발송은 전용 executor `pushExecutor`(core 4, queue 1000, 초과 시 로그 후 drop)에서 수행한다. 도메인 API 응답·SSE fan-out 을 절대 지연시키지 않는다.

## 3. 데이터 모델 (Flyway V134~, 착수 시점 최신 번호 다음)

```sql
-- 기기별 푸시 구독. 글로벌(테넌트 무관) — 한 기기가 여러 테넌트 알림을 받는다(membership 과 같은 성격).
CREATE TABLE push_subscription (
  id               BIGSERIAL PRIMARY KEY,
  user_id          BIGINT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  endpoint         TEXT   NOT NULL UNIQUE,
  p256dh           TEXT   NOT NULL,
  auth             TEXT   NOT NULL,
  user_agent       VARCHAR(512),
  failure_count    INT    NOT NULL DEFAULT 0,
  last_success_at  TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_push_subscription_user ON push_subscription(user_id);

-- 사용자 단위 알림 종류 설정. 행이 없으면 enabled=true 로 간주.
CREATE TABLE notification_preference (
  user_id   BIGINT      NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  category  VARCHAR(32) NOT NULL,   -- DM | MENTION | ISSUE | CALENDAR
  enabled   BOOLEAN     NOT NULL,
  PRIMARY KEY (user_id, category)
);

-- 서버당 VAPID 키 1쌍. private key 는 EncryptionService 로 암호화.
CREATE TABLE push_vapid_key (
  id               SMALLINT PRIMARY KEY CHECK (id = 1),
  public_key       TEXT NOT NULL,
  private_key_enc  TEXT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

- 세 테이블 모두 글로벌 테이블이므로 RLS 를 적용하지 않는다. `app_tenant` 롤에 필요한 권한만 부여한다.
- `endpoint` UNIQUE: 같은 브라우저에서 다른 계정이 구독 등록하면 소유자(user_id)를 새 사용자로 **이전**한다(이전 사용자 알림이 다음 사용자에게 뜨지 않게).
- 한 사용자당 구독 최대 20개. 초과 시 가장 오래된(`updated_at`) 것부터 삭제.
- 카테고리 매핑(`NotificationType` → category):
  - ASSIGNED, COMMENTED, STATUS_CHANGED, PRIORITY_CHANGED → `ISSUE`
  - CALENDAR_INVITED, CALENDAR_RSVP_CHANGED, REMINDER → `CALENDAR`
  - 메시지: DM 채널 → `DM`, 그 외 멘션 → `MENTION`

### VAPID 키

- 우선순위: 환경변수 `WORKPLACE_PUSH_VAPID_PUBLIC` / `WORKPLACE_PUSH_VAPID_PRIVATE` → DB `push_vapid_key` → 둘 다 없으면 최초 기동 시 생성·저장(`INSERT ... ON CONFLICT DO NOTHING` 후 재조회로 다중 인스턴스 경합 방지).
- 키는 교체하지 않는다(교체 시 기존 구독 전부 무효). 프론트는 키 불일치 감지 시 재구독한다(§6).
- `subject`(VAPID contact): `workplace.push.subject` 설정, 기본 `mailto:admin@<서버 호스트>`.

## 4. API

| Method | Path | 설명 |
|---|---|---|
| GET | `/api/v1/push/config` | `{ enabled, vapidPublicKey }`. `enabled=false` 면 키 생략 |
| POST | `/api/v1/push/subscriptions` | body `{ endpoint, keys: { p256dh, auth } }` — upsert(소유자 이전 포함) |
| DELETE | `/api/v1/push/subscriptions` | body `{ endpoint }` — 본인 소유만 삭제 |
| GET | `/api/v1/push/preferences` | `{ DM: true, MENTION: true, ISSUE: true, CALENDAR: true }` |
| PUT | `/api/v1/push/preferences` | 동일 shape, 부분 업데이트 허용 |

- 모두 인증 필요(로그인 사용자 본인 범위). tenant-less 토큰으로도 호출 가능해야 한다(구독/설정은 글로벌).
- `endpoint` 검증: `https` 스킴, 길이 ≤ 2048, 호스트가 사설/루프백/링크로컬 IP 로 해석되면 거부(SSRF 방지 — 서버가 endpoint 로 직접 HTTP 요청). 푸시 서비스 호스트 허용 목록은 두지 않는다.

### 설정 (application.yml)

```yaml
workplace:
  push:
    enabled: true          # 폐쇄망이면 false — config 가 enabled=false, 발송 no-op
    preview: true          # false 면 본문 대신 "새 메시지가 있습니다"
    subject: mailto:admin@example.com
    timeout: 5s
```

## 5. 발송 흐름

### 5.1 기존 인박스 알림 (이슈·캘린더)

```
NotificationService.create*AndFanOut
  → notification INSERT → registry.fanOut(SSE)
  → pushDispatcher.dispatchNotification(recipients, type, notificationSummary)   ← 추가
      (트랜잭션 커밋 후 pushExecutor 에서 실행)
```

- 제목/본문은 인박스 표시와 같은 규칙으로 서버에서 조립한다(예: 제목 `SW-123 담당자로 지정됨`, 본문 이슈 제목).
- url: 이슈 `/projects/:key/issues/:number`, 캘린더 `/calendar?event=:eventId`.

### 5.2 메시지 (DM·멘션)

```
MessageService.create (커밋)
  → [신규] MessagePushRequestedEvent 발행
      { tenantId, channelId, channelKind, channelName, messageId, parentMessageId,
        authorId, authorName, preview, dmRecipientIds, mentionedUserIds }
  → notify.PushDispatcher.onMessagePushRequested   (@Async pushExecutor, AFTER_COMMIT)
```

- 대상 계산(messaging 측, 이벤트 생성 시):
  - DM: 작성자를 제외한 DM 멤버 전원 → `dmRecipientIds`
  - 채널/DM 공통: 멘션된 사용자 중 **해당 채널 멤버** → `mentionedUserIds`
  - 제외: 작성자 본인, AGENT 사용자
- notify 측:
  - DM ∩ 멘션 중복은 1회만, 카테고리는 `DM` 우선
  - `notification_preference` 로 끈 카테고리 제외
  - 작성자가 AGENT 여도 수신자가 HUMAN 이면 발송(AI 가 DM 에 답한 경우 포함)
- url: DM `/chat/dms/:channelId?m=:messageId`, 채널 `/chat/channels/:channelId?m=:messageId`. 스레드 답글이면 `&thread=:parentMessageId`.
- 제목: DM `작성자명`, 채널 `#채널명 · 작성자명`. 본문: 미리보기 120자(멘션 토큰은 `@이름` 으로 치환, 첨부만 있으면 `파일을 보냈습니다`).

### 5.3 payload (Web Push 암호화, ≤ 4KB)

```json
{
  "v": 1,
  "tenantId": 3,
  "category": "DM",
  "title": "박OO",
  "body": "PR 리뷰 부탁드려요",
  "url": "/chat/dms/42?m=1234",
  "tag": "ch-42"
}
```

- `tag`: 메시지는 `ch-<channelId>`, 이슈는 `issue-<issueId>`, 캘린더는 `event-<eventId>`. 같은 tag 는 교체되고 `renotify: true` 로 다시 울린다.
- 헤더: 메시지 `Urgency: high`, `TTL: 86400`. 이슈·캘린더 `Urgency: normal`, `TTL: 259200`.
- `preview=false` 면 `body` 를 고정 문구로 대체하고 제목도 `새 메시지` / `새 알림` 으로 일반화.

### 5.4 실패/만료 처리 (PushSender)

| 응답 | 처리 |
|---|---|
| 2xx | `failure_count=0`, `last_success_at=now()` |
| 404 / 410 | 즉시 구독 삭제 |
| 413 | 로그(payload 초과 — 버그), 구독 유지 |
| 429 / 5xx / 타임아웃(5s) / 연결 실패 | `failure_count += 1`, 연속 5회 이상이면 삭제 |

- 재시도 큐는 두지 않는다(best-effort). 한 수신자의 여러 기기 발송은 서로 독립(하나 실패가 다른 기기에 영향 없음).
- 모든 예외는 PushSender 내부에서 로깅하고 전파하지 않는다.

## 6. 프론트엔드 / 서비스워커

### 6.1 manifest · 서비스워커 등록

- `vite-plugin-pwa`: `strategies: 'injectManifest'`, `srcDir: 'src'`, `filename: 'sw.ts'`, `registerType: 'prompt'`, `devOptions.enabled: false`.
- manifest: `name/short_name` Gen:iA Workplace, `display: standalone`, `start_url: /`, `scope: /`, 아이콘 192/512/maskable, `theme_color`/`background_color` 디자인 시스템 토큰 값. `index.html` 에 `apple-touch-icon`, `apple-mobile-web-app-capable` 메타 추가.
- precache: `index.html` + 해시 에셋. `/api/*` 는 SW 가 가로채지 않는다(네트워크 직행, SSE 포함). 네비게이션 요청은 precache 된 `index.html` 로 fallback(단 `/api/`, `/s/` 제외).
- 업데이트: 새 SW 대기 시 "새 버전이 있습니다 · 새로고침" 토스트. 사용자가 누를 때만 `skipWaiting` + reload(편집 중 데이터 보호).
- nginx: `/sw.js`, `/manifest.webmanifest`, `/registerSW.js` 는 `Cache-Control: no-cache`.

### 6.2 구독 수명 주기 (`src/lib/push/`)

```
getPushSupport()  → 'unsupported' | 'ios-needs-install' | 'denied' | 'default' | 'granted'
enablePush()      → requestPermission → pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })
                    → POST /push/subscriptions
disablePush()     → DELETE /push/subscriptions → subscription.unsubscribe()
syncPushOnLogin() → 권한 granted 이고 구독 존재 시 POST 재등록(소유자 이전)
                    + 구독의 applicationServerKey ≠ 서버 키면 unsubscribe → 재구독
clearPushOnLogout() → DELETE 를 logout 호출 **전에** 수행(브라우저 구독은 유지, 서버 매핑만 제거)
```

- `pushsubscriptionchange`: 1차는 SW 에서 처리하지 않고, 다음 앱 실행 시 `syncPushOnLogin` 이 재등록하는 것으로 갈음한다.

### 6.3 알림 설정 화면 `/settings/notifications`

- "이 기기에서 푸시 받기" 토글 — 토글 클릭 핸들러 안에서만 권한 요청.
- 종류별 토글(DM · 멘션 · 이슈 · 캘린더) — 사용자 단위, 모든 기기 공통.
- 상태별 표시:
  - `ios-needs-install`: 설치 안내 카드("공유 → 홈 화면에 추가"), 토글 비활성
  - `denied`: "브라우저/OS 설정에서 알림을 허용해 주세요" + 플랫폼별 안내
  - `/push/config` `enabled=false`: 푸시 섹션 전체 숨김
- 설정 사이드 내비게이션에 "알림" 항목 추가.
- 유도 배너: 로그인 상태 + 미구독 + 이전에 닫지 않음 → 인박스 상단 "알림 켜기" 배너 1회(닫으면 localStorage 기억). 자동 권한 요청은 하지 않는다.

### 6.4 SW push 수신

```
push 이벤트
  payload 파싱(v=1 아니면 일반 문구로 표시)
  iOS(standalone Safari) 가 아니고, visible 상태의 창이 이미 payload.url 과 같은 경로에 있으면
    → showNotification 생략, 해당 창에 postMessage({ type: 'push-received', payload })
  그 외
    → showNotification(title, { body, tag, renotify: true, data: { url, tenantId }, icon, badge })
```

- iOS 는 미표시 푸시가 반복되면 구독이 취소되므로 억제를 적용하지 않고 항상 표시한다(tag 교체로 누적 방지).

### 6.5 알림 탭 → 이동

```
notificationclick
  notification.close()
  url 이 같은 origin 의 상대경로가 아니면 '/' 로 대체
  같은 origin 창이 있으면 focus + postMessage({ type: 'push-navigate', url, tenantId })
  없으면 clients.openWindow(`/push-open?t=${tenantId}&to=${encodeURIComponent(url)}`)

앱(/push-open 라우트 + postMessage 리스너 공통 핸들러)
  to 검증(상대경로, '//' 시작 금지)
  현재 테넌트 ≠ tenantId 면 authApi.selectTenant(tenantId)
    실패(비멤버·403) → 토스트 "해당 워크스페이스에 접근할 수 없습니다" 후 홈
  navigate(to)
```

- `/push-open` 은 인증 보호 라우트 안에 둔다. 미로그인이면 로그인 후 원래 목적지로 복귀하는 기존 흐름을 따른다.

## 7. 보안

- VAPID private key 는 `global/security/EncryptionService` 로 암호화 저장. SaaS 는 k8s Secret 으로 env 주입 권장.
- 구독 API 는 본인 범위만. endpoint SSRF 검증(§4). 사용자당 구독 20개 제한.
- payload 최소화: 제목·미리보기만(첨부·링크 원문 미포함). 온프레미스용 `preview=false`.
- 수신 권한: 메시지 대상은 messaging 이 이벤트 생성 시점의 채널 멤버십으로 계산, 인박스 알림은 기존 대상 계산을 따른다.
- 클릭 url 은 서버가 생성하고 SW·앱이 같은 origin 상대경로만 허용(오픈 리다이렉트 방지).
- 로그아웃 시 서버 구독 매핑 삭제, 계정 전환 시 endpoint 소유자 이전.

## 8. 테스트

### Backend (JUnit 통합, Testcontainers)

- 구독: upsert, 소유자 이전, 본인만 삭제, 20개 제한, SSRF/비https 거부
- 설정: 기본값 on, 부분 업데이트
- VAPID: 최초 생성, 재기동 후 동일 키, env 우선
- PushDispatcher (`PushGateway` 대체 구현으로 호출 캡처):
  - DM → 상대에게, 작성자 제외
  - 채널 멘션 → 멘션된 채널 멤버에게, AGENT 제외
  - DM + 멘션 중복 → 1회, category=DM
  - 카테고리 off → 미발송
  - 이슈·캘린더 인박스 알림 → 푸시 발송, 카테고리 매핑
  - `preview=false` → 본문 고정 문구
- PushSender (MockWebServer 로 `WebPushGateway` 검증): 2xx 초기화, 410 삭제, 5xx 5회 누적 삭제, 타임아웃 처리, 암호화 헤더(`Content-Encoding: aes128gcm`, VAPID Authorization) 존재
- `enabled=false` → config `enabled=false`, 발송 no-op

### Frontend (Playwright E2E, build + preview)

- manifest 링크·SW 등록 확인
- 설정 화면: `context.grantPermissions(['notifications'])` → 토글 on → 서버 구독 등록 확인 → off → 삭제 확인
- 종류별 토글 저장/복원
- SW 에 테스트용 push 이벤트 주입 → `getNotifications()` 로 표시 확인, 같은 화면일 때 억제 확인
- notificationclick 시뮬레이션 → 이동, 다른 테넌트면 전환
- 로그아웃 → 서버 구독 삭제
- config `enabled=false` → 푸시 UI 숨김
- 새 SW 배포 시 업데이트 토스트

### 실기기 스모크

`docs/PWA_PUSH_LIVE_SMOKE.md` — iOS 홈 화면 PWA, Android Chrome, 데스크톱 Chrome·Edge·Safari 에서 설치 → 권한 → 앱 종료 상태 수신 → 탭 이동 → 로그아웃 후 미수신 체크리스트.

## 9. 작업 분할 (GitHub Projects #4)

에픽: **PWA 설치와 Web Push 알림**

| 순서 | 하위 이슈 | 내용 | 의존 |
|---|---|---|---|
| 1 | PWA 셸: manifest, 서비스워커, 앱 셸 캐시 | vite-plugin-pwa, 아이콘, nginx 캐시 헤더, 업데이트 토스트 | — |
| 2 | Web Push 백엔드 기반: VAPID, 구독, 설정 API | 테이블 3개, `/push/*`, PushSender·만료 정리, enabled/preview 설정 | — |
| 3 | 인박스 알림을 푸시로 발송 | NotificationService fan-out 에 푸시 연결(이슈·캘린더) | 2 |
| 4 | 메시지 푸시: DM, 멘션 | MessagePushRequestedEvent, 대상 계산, 중복 제거 | 2 |
| 5 | 알림 설정 화면과 구독 UX | /settings/notifications, iOS 설치 안내, 유도 배너, 로그인/로그아웃 연동 | 1, 2 |
| 6 | 서비스워커 push 수신과 알림 탭 이동 | 억제 규칙, tag 교체, /push-open, 테넌트 전환 | 1, 2 |
| 7 | 실기기 스모크 문서 | iOS·Android·데스크톱 검증 체크리스트 | 3–6 |

모바일 반응형 레이아웃은 별도 에픽으로 설계한다.
