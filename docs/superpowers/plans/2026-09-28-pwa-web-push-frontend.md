# PWA 셸 + Web Push 프론트엔드 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** workplace-web 을 설치 가능한 PWA 로 만들고, 사용자가 이 기기의 푸시를 켜면 서비스워커가 알림을 표시하고 탭 시 해당 화면(필요하면 다른 테넌트)으로 이동한다.

**Architecture:** `vite-plugin-pwa`(injectManifest)로 manifest·서비스워커를 빌드한다. 서비스워커 판단 로직은 순수 함수(`src/sw/logic.ts`)로 분리해 vitest 로 검증하고 `src/sw.ts` 는 이벤트 배선만 한다. 구독 수명주기는 `src/lib/push/` 모듈, 화면은 `/settings/notifications`·인박스 배너·`/push-open` 으로 구성한다. 백엔드 API 는 `docs/superpowers/plans/2026-09-28-web-push-backend.md` 가 제공한다.

**Tech Stack:** Vite 7, React 19, TypeScript 5.9, react-router 7, TanStack Query 5, sonner, shadcn(Switch·Card), vite-plugin-pwa 1.x + workbox 7, vitest 4, Playwright 1.60.

**Spec:** `docs/superpowers/specs/2026-09-28-pwa-web-push-design.md` (에픽 #862 — 이 계획은 #863·#867·#868·#869 담당)

## Global Constraints

- 모든 파일 상단 경로 주석 + 주요 로직 **한국어 주석**(무엇을·왜) — `docs/CODING_CONVENTION.md`.
- ESLint: `simple-import-sort` 강제, `toLocale*String` 금지(날짜는 `src/lib/formatters.ts`).
- 백엔드 API 계약(변경 금지):
  - `GET /api/v1/push/config` → `{ enabled: boolean, vapidPublicKey: string | null }`
  - `POST /api/v1/push/subscriptions` body `{ endpoint, keys: { p256dh, auth } }` → 204
  - `DELETE /api/v1/push/subscriptions` body `{ endpoint }` → 204
  - `GET /api/v1/push/preferences` → `{ DM, MENTION, ISSUE, CALENDAR }: boolean`
  - `PUT /api/v1/push/preferences` 부분 맵 → 전체 맵
- 푸시 payload 계약(v=1): `{ v: 1, tenantId: number, category: 'DM'|'MENTION'|'ISSUE'|'CALENDAR', title, body, url, tag }`.
- 알림 이동 url 은 **같은 origin 상대경로만** 허용(`/` 로 시작, `//`·`/\` 시작 금지) — 서비스워커·앱 양쪽에서 검증.
- 권한 요청(`Notification.requestPermission`)은 **클릭 핸들러 안에서 동기적으로 호출**하고 그 Promise 를 넘긴다(React Query `mutate` 는 mutationFn 전에 내부 await 가 있어 제스처가 끊길 수 있음 — iOS Safari 는 제스처 밖 요청을 거부).
- 서비스워커는 개발 서버에서 `E2E=1` 일 때만 활성(`devOptions.enabled`). 개발 모드 SW 는 fetch 핸들러를 등록하지 않는다(E2E `page.route` mock 이 SW 에 가로채이지 않게).
- Playwright 기본 `serviceWorkers: 'block'` — SW 가 필요한 스펙만 `test.use({ serviceWorkers: 'allow' })`.
- 프론트 변경은 Playwright E2E 필수(입력 → API payload → UI), happy path 는 `{ tag: '@smoke' }`. E2E 타입체크 `npx tsc -p tsconfig.e2e.json --noEmit`.
- 커밋 컨벤션 `docs/COMMIT_CONVENTION.md`(scope `web`, 본문 첫 줄 `- #N`, `Closes` 금지). **커밋은 사용자 명시 승인 후에만.**
- 이슈 착수 시 GitHub Projects #4 Status `In progress` + 현재 이터레이션 할당.
- 명령은 `apps/workplace-web` 에서 실행: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, `pnpm test:e2e -- <spec>`.

## Review Focus

1. **권한 요청이 제스처 밖에서 호출** — 토글/배너 클릭 핸들러가 `Notification.requestPermission()` 을 직접 호출해 Promise 를 `enablePush(vapidPublicKey, permission)` 에 넘긴다. VAPID 키는 미리 로드된 config 를 쓴다(Task 3 시그니처, Task 4 E2E 가 토글 1회 클릭으로 구독까지 완료되는지 검증).
2. **서버 VAPID 키가 바뀐 기기**(온프레미스 재설치) — 기존 브라우저 구독의 키와 다르면 해지 후 재구독해야 한다(Task 3 vitest `sameApplicationServerKey`, Task 4 E2E `키 불일치 시 재구독`).
3. **로그아웃 후 다음 사용자가 같은 브라우저로 로그인** — 로그아웃 시 서버 구독 매핑이 먼저 지워져야 한다(Task 4 E2E `로그아웃 시 구독 해제 후 logout 호출`).
4. **알림 url 이 외부/프로토콜 상대 주소** — `/push-open?to=//evil.com` 이나 payload url `https://evil.com` 이면 `/` 로 대체(Task 2 vitest `safeTarget`, Task 5 E2E `외부 url 은 홈으로`).
5. **미로그인 상태에서 알림 탭** — 로그인 후 원래 목적지로 가야 한다(Task 5 E2E `미로그인 → 로그인 후 목적지`).

---

## File Structure

```
apps/workplace-web/
  package.json                         vite-plugin-pwa, workbox-precaching, workbox-routing 추가     (Task 1)
  vite.config.ts                       VitePWA 플러그인                                              (Task 1)
  tsconfig.json                        tsconfig.sw.json 참조 추가                                    (Task 1)
  tsconfig.app.json                    src/sw.ts 제외                                                (Task 1)
  tsconfig.sw.json                     WebWorker lib 로 SW 타입체크                                  (Task 1)
  eslint.config.js                     src/sw.ts 에 serviceworker globals                            (Task 1)
  index.html                           theme-color·apple-touch-icon·apple-mobile-web-app 메타        (Task 1)
  nginx.conf                           sw.js·manifest no-cache                                       (Task 1)
  playwright.config.ts                 serviceWorkers: 'block'                                       (Task 1)
  public/pwa-64x64.png, pwa-192x192.png, pwa-512x512.png, maskable-icon-512x512.png,
         apple-touch-icon-180x180.png  아이콘(favicon.svg 에서 생성)                               (Task 1)
  src/sw.ts                            SW 진입점: precache(PROD), SKIP_WAITING, push, notificationclick (Task 1, 5)
  src/sw-env.d.ts                      SW 전용 import.meta.env 타입                                  (Task 1)
  src/vite-env.d.ts                    vite-plugin-pwa/react 타입 참조                               (Task 1)
  src/components/PwaUpdatePrompt.tsx   SW 등록 + 새 버전 토스트                                      (Task 1)
  src/main.tsx                         PwaUpdatePrompt 마운트                                        (Task 1)
  src/sw/logic.ts (+ .test.ts)         payload 파싱·억제 판단·알림 옵션·url 검증(순수)               (Task 2)
  src/api/push.ts                      /push/* REST                                                  (Task 3)
  src/types/push.ts                    PushConfig·PushPreferences·PushCategory                        (Task 3)
  src/lib/push/support.ts (+ .test.ts) 지원 상태 판별(순수) + 브라우저 환경 수집                     (Task 3)
  src/lib/push/keys.ts (+ .test.ts)    base64url ↔ bytes, 키 비교                                    (Task 3)
  src/lib/push/subscription.ts         enable/disable/sync/clear                                     (Task 3)
  src/hooks/queries/usePush.ts         config·preferences·device 구독 쿼리/뮤테이션                  (Task 4)
  src/pages/settings/NotificationSettingsPage.tsx  /settings/notifications                          (Task 4)
  src/components/layout/SettingsSidebar.tsx        "알림" 항목                                      (Task 4)
  src/components/layout/PushPromptBanner.tsx       인박스 상단 배너                                 (Task 4)
  src/components/layout/InboxPanel.tsx             배너 슬롯                                        (Task 4)
  src/hooks/AuthContext.tsx            logout 전 구독 해제, selectTenant(redirectTo)                 (Task 4, 5)
  src/hooks/auth-context-value.ts      selectTenant 시그니처                                         (Task 5)
  src/components/layout/AppLayout.tsx  syncPushOnLogin + 알림 이동 리스너 + 대기 목적지 소비         (Task 4, 5)
  src/lib/push/openTarget.ts           테넌트 전환 + 이동 공통 로직                                  (Task 5)
  src/pages/PushOpenPage.tsx           /push-open                                                    (Task 5)
  src/App.tsx                          라우트 추가                                                   (Task 4, 5)
  e2e/pages/pwa/pwa-shell.spec.ts                                                                     (Task 1)
  e2e/pages/settings/notification-settings.spec.ts                                                    (Task 4)
  e2e/pages/pwa/push-open.spec.ts, e2e/pages/pwa/sw-push.spec.ts                                     (Task 5)
  e2e/fixtures/push-mock.ts            PushManager 스텁 + /push/* mock                               (Task 4)
docs/PWA_PUSH_LIVE_SMOKE.md                                                                           (Task 6)
```

---

### Task 1: PWA 셸 — manifest, 서비스워커, 아이콘, 업데이트 토스트 (#863)

**Files:** 위 표의 (Task 1) 항목 전부 + Test `e2e/pages/pwa/pwa-shell.spec.ts`

**Interfaces:**
- Produces: `src/sw.ts`(Task 5 가 push 핸들러 추가), 빌드 산출물 `/sw.js`·`/manifest.webmanifest`, 아이콘 경로 `/pwa-192x192.png`·`/pwa-64x64.png`, `<PwaUpdatePrompt />`

- [ ] **Step 1: 의존성 설치**

Run: `cd apps/workplace-web && pnpm add -D vite-plugin-pwa@^1 && pnpm add workbox-precaching@^7 workbox-routing@^7`
Expected: 설치 성공. peer 경고에 vite 7 미지원이 나오면 `pnpm view vite-plugin-pwa peerDependencies` 로 vite 7 지원 버전을 확인해 그 버전으로 고정한다.

- [ ] **Step 2: 아이콘 생성**

Run: `cd apps/workplace-web && pnpm dlx @vite-pwa/assets-generator@^1 --preset minimal-2023 public/favicon.svg`
Expected: `public/` 에 `pwa-64x64.png`, `pwa-192x192.png`, `pwa-512x512.png`, `maskable-icon-512x512.png`, `apple-touch-icon-180x180.png`(+ `favicon.ico`) 생성. `favicon.ico` 는 쓰지 않으면 삭제. maskable 아이콘은 여백이 자동 추가되므로 육안으로 잘림 없는지 확인.

- [ ] **Step 3: 실패하는 E2E 작성**

`e2e/pages/pwa/pwa-shell.spec.ts`:
```ts
// e2e/pages/pwa/pwa-shell.spec.ts
// PWA 셸 — manifest 노출과 서비스워커 등록 확인(E2E=1 dev 서버에서 dev SW 활성).
import { expect, test } from '../../fixtures/auth.fixture'

test.use({ serviceWorkers: 'allow' })

test.describe('PWA 셸', () => {
  test('manifest 가 연결되고 앱 정보가 올바르다', { tag: '@smoke' }, async ({ authenticatedPage: page }) => {
    await page.goto('/')
    const href = await page.locator('link[rel="manifest"]').getAttribute('href')
    expect(href).toBeTruthy()
    const res = await page.request.get(href!)
    expect(res.ok()).toBeTruthy()
    const manifest = await res.json()
    expect(manifest.name).toBe('Gen:iA Workplace')
    expect(manifest.display).toBe('standalone')
    expect(manifest.icons.some((i: { sizes: string }) => i.sizes === '512x512')).toBeTruthy()
  })

  test('서비스워커가 등록되어 활성화된다', { tag: '@smoke' }, async ({ authenticatedPage: page }) => {
    await page.goto('/')
    const active = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.ready
      return !!reg.active
    })
    expect(active).toBe(true)
  })

  test('iOS 홈 화면 메타가 있다', async ({ authenticatedPage: page }) => {
    await page.goto('/')
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute('href', '/apple-touch-icon-180x180.png')
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#4338ca')
  })
})
```

- [ ] **Step 4: 실패 확인**

Run: `pnpm test:e2e -- e2e/pages/pwa/pwa-shell.spec.ts`
Expected: FAIL(manifest 링크 없음).

- [ ] **Step 5: 설정 파일 구현**

`vite.config.ts` — import 추가 후 `plugins` 교체:
```ts
import { VitePWA } from 'vite-plugin-pwa'
```
```ts
  plugins: [
    react(),
    tailwindcss(),
    // PWA — injectManifest: SW 코드(src/sw.ts)는 직접 작성하고 플러그인은 precache 목록 주입·manifest 생성만 한다.
    // dev SW 는 E2E=1 일 때만 켠다(E2E 가 mock 기반 dev 서버에서 SW 등록·push 를 검증). 일반 개발에선 캐시 혼선 방지로 끈다.
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'prompt',
      injectRegister: false, // PwaUpdatePrompt 의 useRegisterSW 가 등록한다
      manifest: {
        name: 'Gen:iA Workplace',
        short_name: 'Gen:iA',
        description: '사람과 AI가 함께 일하는 워크플레이스',
        lang: 'ko',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        theme_color: '#4338ca',
        background_color: '#ffffff',
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      },
      devOptions: { enabled: process.env.E2E === '1', type: 'module' },
    }),
  ],
```

`tsconfig.sw.json`(신규):
```json
{
  "compilerOptions": {
    "tsBuildInfoFile": "./node_modules/.tmp/tsconfig.sw.tsbuildinfo",
    "target": "ES2022",
    "lib": ["ES2022", "WebWorker"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "types": [],
    "skipLibCheck": true,
    "verbatimModuleSyntax": true,
    "noEmit": true,
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "erasableSyntaxOnly": true
  },
  "include": ["src/sw.ts", "src/sw-env.d.ts", "src/sw/**/*.ts"],
  "exclude": ["src/**/*.test.ts"]
}
```

`tsconfig.json` 의 `references` 에 `{ "path": "./tsconfig.sw.json" }` 추가. `tsconfig.app.json` 에 `"exclude": ["src/sw.ts", "src/sw-env.d.ts"]` 추가(이미 exclude 가 있으면 항목만 추가).

`src/sw-env.d.ts`(신규):
```ts
// src/sw-env.d.ts
// 서비스워커 전용 타입 — tsconfig.sw.json 은 vite/client(DOM 의존)를 쓰지 않으므로 필요한 import.meta.env 만 선언한다.
interface ImportMetaEnv {
  readonly PROD: boolean
  readonly DEV: boolean
}
interface ImportMeta {
  readonly env: ImportMetaEnv
}
```

`src/vite-env.d.ts` 에 한 줄 추가:
```ts
/// <reference types="vite-plugin-pwa/react" />
```

`eslint.config.js` — 기존 `{ files: ['src/lib/formatters.ts'], ... }` 블록 다음에 추가:
```js
  // 서비스워커 — clients·registration 등 SW 전역 사용. React 규칙 무관.
  {
    files: ['src/sw.ts'],
    languageOptions: { globals: globals.serviceworker },
  },
```

`index.html` `<head>` 에 추가(`<title>` 위):
```html
    <meta name="theme-color" content="#4338ca" />
    <meta name="mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-title" content="Gen:iA" />
    <link rel="apple-touch-icon" href="/apple-touch-icon-180x180.png" />
```

`nginx.conf` — `location /assets/` 블록 다음에 추가:
```nginx
    # 서비스워커·manifest 는 항상 재검증 — 캐시되면 새 배포가 반영되지 않는다(업데이트 토스트 불발).
    location = /sw.js {
        add_header Cache-Control "no-cache";
        try_files $uri =404;
    }
    location = /manifest.webmanifest {
        add_header Cache-Control "no-cache";
        default_type application/manifest+json;
        try_files $uri =404;
    }
```

`playwright.config.ts` 의 `use` 에 `serviceWorkers: 'block',` 추가하고 주석: `// 기본은 SW 차단 — mock(page.route) 이 SW 에 가로채이지 않게. PWA 스펙만 allow.`

- [ ] **Step 6: 서비스워커 최소 구현**

`src/sw.ts`:
```ts
// src/sw.ts
// 서비스워커 진입점. 운영 빌드에서만 앱 셸 precache + SPA 네비게이션 fallback 을 등록한다(개발 모드는 fetch 핸들러 없음 →
// E2E mock 이 SW 에 가로채이지 않음). /api 는 절대 캐시하지 않는다. 새 버전은 사용자가 토스트에서 새로고침할 때만 활성화(SKIP_WAITING).
/// <reference lib="webworker" />
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<{ url: string; revision: string | null }> }

if (import.meta.env.PROD) {
  precacheAndRoute(self.__WB_MANIFEST)
  cleanupOutdatedCaches()
  // 네비게이션(주소창 이동·새로고침)은 precache 된 index.html 로 — 단 API·공유 링크 경로는 제외.
  registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html'), { denylist: [/^\/api\//, /^\/s\//] }))
}

// 업데이트 토스트 "새로고침" → workbox-window 가 보내는 메시지로 대기 중인 SW 를 즉시 활성화.
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') void self.skipWaiting()
})
```

> 개발 모드에서 `self.__WB_MANIFEST` 참조가 if 블록 안에 있어도 플러그인이 주입 지점을 찾는다. 빌드에서 "injection point not found" 오류가 나면 참조를 if 밖 `const manifest = self.__WB_MANIFEST` 로 옮긴다.

- [ ] **Step 7: 업데이트 토스트 컴포넌트**

`src/components/PwaUpdatePrompt.tsx`:
```tsx
// src/components/PwaUpdatePrompt.tsx
// 서비스워커 등록 + 새 버전 알림. 새 SW 가 대기하면 토스트로 알리고, 사용자가 누를 때만 활성화·새로고침한다(편집 중 데이터 보호).
import { useEffect } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { toast } from 'sonner'

export function PwaUpdatePrompt() {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW()

  useEffect(() => {
    if (!needRefresh) return
    toast('새 버전이 있습니다', {
      id: 'pwa-update',
      duration: Infinity,
      action: { label: '새로고침', onClick: () => void updateServiceWorker(true) },
    })
  }, [needRefresh, updateServiceWorker])

  return null
}
```

`src/main.tsx` — `<Toaster position="top-right" />` 다음 줄에 `<PwaUpdatePrompt />` 추가, import `import { PwaUpdatePrompt } from './components/PwaUpdatePrompt.tsx'`(기존 상대 import 스타일).

- [ ] **Step 8: 통과 확인**

Run: `pnpm typecheck && pnpm lint && pnpm build && pnpm test:e2e -- e2e/pages/pwa/pwa-shell.spec.ts`
Expected: 모두 PASS. `dist/sw.js`, `dist/manifest.webmanifest` 존재 확인(`ls dist`).

- [ ] **Step 9: 기존 E2E 회귀(SW 차단 기본값 영향)**

Run: `pnpm test:e2e -- --grep @smoke`
Expected: PASS.

- [ ] **Step 10: 커밋(승인 후)**

```bash
git add apps/workplace-web
git commit -m "feat(web): PWA 설치를 위한 manifest·서비스워커·아이콘 추가

- #863
- 홈 화면에 설치할 수 있도록 manifest 와 아이콘, iOS 메타 태그를 추가한다
- 운영 빌드에서 앱 셸만 precache 하고 API 는 캐시하지 않는다
- 새 버전이 배포되면 토스트로 알리고 사용자가 누를 때만 새로고침한다"
```

---

### Task 2: 서비스워커 판단 로직(순수 함수) (#868)

**Files:**
- Create: `apps/workplace-web/src/sw/logic.ts`
- Test: `apps/workplace-web/src/sw/logic.test.ts`

**Interfaces:**
- Produces:
  - `interface PushPayload { v: 1; tenantId: number | null; category: string; title: string; body: string; url: string; tag: string | null }`
  - `parsePushPayload(raw: string | null): PushPayload`
  - `safeTarget(url: unknown): string`
  - `interface ClientView { url: string; visible: boolean }`
  - `shouldSuppress(p: PushPayload, clients: ClientView[], origin: string, alwaysShow: boolean): boolean`
  - `requiresVisibleNotification(userAgent: string): boolean`
  - `buildNotification(p: PushPayload): { title: string; options: NotificationOptions & { renotify?: boolean } }`

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// src/sw/logic.test.ts
import { describe, expect, it } from 'vitest'

import {
  buildNotification,
  parsePushPayload,
  requiresVisibleNotification,
  safeTarget,
  shouldSuppress,
} from './logic'

const ORIGIN = 'https://work.example.com'
const payload = {
  v: 1 as const,
  tenantId: 3,
  category: 'DM',
  title: '박OO',
  body: 'PR 리뷰 부탁',
  url: '/chat/dms/42',
  tag: 'ch-42',
}

describe('safeTarget', () => {
  it('상대경로는 그대로', () => {
    expect(safeTarget('/chat/channels/5?thread=3')).toBe('/chat/channels/5?thread=3')
  })
  it('외부·프로토콜 상대·비문자열은 /', () => {
    expect(safeTarget('https://evil.com')).toBe('/')
    expect(safeTarget('//evil.com')).toBe('/')
    expect(safeTarget('/\\evil.com')).toBe('/')
    expect(safeTarget('javascript:alert(1)')).toBe('/')
    expect(safeTarget(null)).toBe('/')
  })
})

describe('parsePushPayload', () => {
  it('v1 payload 파싱', () => {
    expect(parsePushPayload(JSON.stringify(payload))).toEqual(payload)
  })
  it('깨진 JSON·다른 버전·빈 값은 일반 문구', () => {
    for (const raw of ['{', JSON.stringify({ v: 2 }), null]) {
      const p = parsePushPayload(raw)
      expect(p.title).toBe('Gen:iA Workplace')
      expect(p.body).toBe('새 알림이 있습니다')
      expect(p.url).toBe('/')
    }
  })
  it('payload 의 외부 url 은 / 로 대체', () => {
    expect(parsePushPayload(JSON.stringify({ ...payload, url: 'https://evil.com' })).url).toBe('/')
  })
})

describe('shouldSuppress', () => {
  it('보이는 창이 같은 경로면 억제', () => {
    expect(shouldSuppress(payload, [{ url: `${ORIGIN}/chat/dms/42`, visible: true }], ORIGIN, false)).toBe(true)
  })
  it('창이 숨겨져 있거나 다른 경로면 표시', () => {
    expect(shouldSuppress(payload, [{ url: `${ORIGIN}/chat/dms/42`, visible: false }], ORIGIN, false)).toBe(false)
    expect(shouldSuppress(payload, [{ url: `${ORIGIN}/calendar`, visible: true }], ORIGIN, false)).toBe(false)
  })
  it('항상 표시해야 하는 브라우저(iOS/Safari)는 억제 안 함', () => {
    expect(shouldSuppress(payload, [{ url: `${ORIGIN}/chat/dms/42`, visible: true }], ORIGIN, true)).toBe(false)
  })
})

describe('requiresVisibleNotification', () => {
  it('Safari·iOS WebKit 은 true, Chromium·Firefox 는 false', () => {
    expect(
      requiresVisibleNotification(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      ),
    ).toBe(true)
    expect(
      requiresVisibleNotification(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
      ),
    ).toBe(true)
    expect(
      requiresVisibleNotification(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36',
      ),
    ).toBe(false)
    expect(requiresVisibleNotification('Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0')).toBe(false)
  })
})

describe('buildNotification', () => {
  it('tag 가 있으면 renotify, data 에 url·tenantId', () => {
    const { title, options } = buildNotification(payload)
    expect(title).toBe('박OO')
    expect(options.body).toBe('PR 리뷰 부탁')
    expect(options.tag).toBe('ch-42')
    expect(options.renotify).toBe(true)
    expect(options.data).toEqual({ url: '/chat/dms/42', tenantId: 3 })
    expect(options.icon).toBe('/pwa-192x192.png')
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm test -- src/sw/logic.test.ts`
Expected: FAIL(모듈 없음).

- [ ] **Step 3: 구현**

```ts
// src/sw/logic.ts
// 서비스워커 판단 로직(순수 함수) — SW 전역 없이 vitest 로 검증하기 위해 분리. sw.ts 는 이벤트 배선만 한다.
// DOM/WebWorker 공통 표준(URL·JSON)만 사용해 앱·SW 두 tsconfig 에서 모두 타입체크된다.

/** 서버 PushSender 가 보내는 v1 payload(검증·정규화 후). */
export interface PushPayload {
  v: 1
  tenantId: number | null
  category: string
  title: string
  body: string
  url: string
  tag: string | null
}

/** 알림을 띄울 때 판단에 쓰는 창 정보. */
export interface ClientView {
  url: string
  visible: boolean
}

const FALLBACK: PushPayload = {
  v: 1,
  tenantId: null,
  category: 'UNKNOWN',
  title: 'Gen:iA Workplace',
  body: '새 알림이 있습니다',
  url: '/',
  tag: null,
}

/** 같은 origin 상대경로만 허용 — 그 외(외부·프로토콜 상대·스킴)는 홈으로(오픈 리다이렉트 방지). */
export function safeTarget(url: unknown): string {
  if (typeof url !== 'string' || !url.startsWith('/') || url.startsWith('//') || url.startsWith('/\\')) return '/'
  return url
}

/** push 데이터 파싱. 형식이 어긋나도 iOS 는 반드시 알림을 띄워야 하므로 예외 대신 일반 문구를 돌려준다. */
export function parsePushPayload(raw: string | null): PushPayload {
  if (!raw) return FALLBACK
  try {
    const o = JSON.parse(raw) as Record<string, unknown>
    if (o?.v !== 1) return FALLBACK
    return {
      v: 1,
      tenantId: typeof o.tenantId === 'number' ? o.tenantId : null,
      category: typeof o.category === 'string' ? o.category : 'UNKNOWN',
      title: typeof o.title === 'string' && o.title ? o.title : FALLBACK.title,
      body: typeof o.body === 'string' ? o.body : '',
      url: safeTarget(o.url),
      tag: typeof o.tag === 'string' && o.tag ? o.tag : null,
    }
  } catch {
    return FALLBACK
  }
}

/**
 * 알림 생략 여부 — 사용자가 이미 그 화면을 보고 있으면(SSE 로 즉시 반영됨) 알림을 띄우지 않는다. 단 Safari/iOS 는 알림 없는 푸시가
 * 반복되면 구독을 취소하므로 항상 표시(alwaysShow).
 */
export function shouldSuppress(p: PushPayload, clients: ClientView[], origin: string, alwaysShow: boolean): boolean {
  if (alwaysShow) return false
  const target = new URL(p.url, origin)
  return clients.some((c) => {
    if (!c.visible) return false
    const u = new URL(c.url)
    return u.origin === target.origin && u.pathname === target.pathname
  })
}

/** WebKit(Safari·iOS 전 브라우저) 여부 — Chromium·Firefox 계열 표식이 없고 AppleWebKit 이면 true. */
export function requiresVisibleNotification(userAgent: string): boolean {
  if (!/AppleWebKit/.test(userAgent)) return false
  return !/Chrome|Chromium|CriOS|Edg|EdgiOS|FxiOS|Firefox|OPR/.test(userAgent) || /iPhone|iPad|iPod/.test(userAgent)
}

/** showNotification 인자. 같은 tag 는 교체되며 renotify 로 다시 울린다. */
export function buildNotification(p: PushPayload): {
  title: string
  options: NotificationOptions & { renotify?: boolean }
} {
  return {
    title: p.title,
    options: {
      body: p.body,
      tag: p.tag ?? undefined,
      renotify: p.tag != null,
      data: { url: p.url, tenantId: p.tenantId },
      icon: '/pwa-192x192.png',
      badge: '/pwa-64x64.png',
    },
  }
}
```

> `requiresVisibleNotification`: iOS 의 Chrome/Firefox(CriOS/FxiOS)도 WebKit 이라 iPhone/iPad 표식이 있으면 true 로 남긴다.

- [ ] **Step 4: 통과 확인**

Run: `pnpm test -- src/sw/logic.test.ts && pnpm typecheck`
Expected: PASS(앱·SW 두 tsconfig 모두).

- [ ] **Step 5: 커밋(승인 후)**

```bash
git add apps/workplace-web/src/sw
git commit -m "feat(web): 서비스워커 푸시 판단 로직을 순수 함수로 추가

- #868
- 푸시 payload 파싱과 이동 url 검증, 보고 있는 화면이면 알림을 생략하는 규칙을 분리해 단위 테스트로 고정한다
- Safari 와 iOS 는 알림 없는 푸시가 반복되면 구독이 취소되므로 항상 알림을 띄운다"
```

---

### Task 3: 푸시 API 클라이언트 + 구독 수명주기 모듈 (#867)

**Files:**
- Create: `apps/workplace-web/src/types/push.ts`
- Create: `apps/workplace-web/src/api/push.ts`
- Create: `apps/workplace-web/src/lib/push/keys.ts` (+ `keys.test.ts`)
- Create: `apps/workplace-web/src/lib/push/support.ts` (+ `support.test.ts`)
- Create: `apps/workplace-web/src/lib/push/subscription.ts`

**Interfaces:**
- Produces:
  - `type PushCategory = 'DM' | 'MENTION' | 'ISSUE' | 'CALENDAR'`, `interface PushConfig { enabled: boolean; vapidPublicKey: string | null }`, `type PushPreferences = Record<PushCategory, boolean>`
  - `pushApi`: `config(): Promise<PushConfig>`, `subscribe(json: PushSubscriptionJSON): Promise<void>`, `unsubscribe(endpoint: string): Promise<void>`, `preferences(): Promise<PushPreferences>`, `updatePreferences(p: Partial<PushPreferences>): Promise<PushPreferences>`
  - `urlBase64ToBytes(s: string): Uint8Array`, `sameApplicationServerKey(current: ArrayBuffer | Uint8Array | null | undefined, vapidB64: string): boolean`
  - `type PushSupport = 'unsupported' | 'ios-needs-install' | 'denied' | 'default' | 'granted'`, `interface PushEnv { hasServiceWorker; hasPushManager; hasNotification; permission: NotificationPermission | 'unavailable'; isIOS; isStandalone }`, `resolvePushSupport(env: PushEnv): PushSupport`, `readPushEnv(): PushEnv`, `getPushSupport(): PushSupport`
  - `subscription.ts`: `currentSubscription(): Promise<PushSubscription | null>`, `requestPushPermission(): Promise<NotificationPermission>`(클릭 핸들러에서 동기 호출), `enablePush(vapidPublicKey: string, permission: Promise<NotificationPermission>): Promise<void>`(granted 아니면 `Error('PERMISSION_DENIED')`), `disablePush(): Promise<void>`, `syncPushOnLogin(): Promise<void>`, `clearPushOnLogout(): Promise<void>`

- [ ] **Step 1: 실패하는 단위 테스트 작성**

`src/lib/push/keys.test.ts`:
```ts
import { describe, expect, it } from 'vitest'

import { sameApplicationServerKey, urlBase64ToBytes } from './keys'

// 65바이트(0x04 + 64바이트 0) 를 base64url 로 — 'B' + 'A'*86
const KEY = 'B' + 'A'.repeat(86)

describe('urlBase64ToBytes', () => {
  it('패딩 없는 base64url 디코드', () => {
    const b = urlBase64ToBytes(KEY)
    expect(b.length).toBe(65)
    expect(b[0]).toBe(4)
  })
  it('-_ 문자 처리', () => {
    expect(Array.from(urlBase64ToBytes('-_8'))).toEqual([251, 255])
  })
})

describe('sameApplicationServerKey', () => {
  it('같은 키면 true(ArrayBuffer·Uint8Array 모두)', () => {
    const b = urlBase64ToBytes(KEY)
    expect(sameApplicationServerKey(b, KEY)).toBe(true)
    expect(sameApplicationServerKey(b.buffer.slice(0), KEY)).toBe(true)
  })
  it('다르거나 없으면 false', () => {
    const other = urlBase64ToBytes('B' + 'A'.repeat(85) + 'E')
    expect(sameApplicationServerKey(other, KEY)).toBe(false)
    expect(sameApplicationServerKey(null, KEY)).toBe(false)
  })
})
```

`src/lib/push/support.test.ts`:
```ts
import { describe, expect, it } from 'vitest'

import { type PushEnv, resolvePushSupport } from './support'

const base: PushEnv = {
  hasServiceWorker: true,
  hasPushManager: true,
  hasNotification: true,
  permission: 'default',
  isIOS: false,
  isStandalone: false,
}

describe('resolvePushSupport', () => {
  it('권한 상태를 그대로', () => {
    expect(resolvePushSupport(base)).toBe('default')
    expect(resolvePushSupport({ ...base, permission: 'granted' })).toBe('granted')
    expect(resolvePushSupport({ ...base, permission: 'denied' })).toBe('denied')
  })
  it('iOS 는 홈 화면 설치 전이면 설치 안내', () => {
    expect(resolvePushSupport({ ...base, isIOS: true, hasPushManager: false, hasNotification: false })).toBe(
      'ios-needs-install',
    )
    expect(resolvePushSupport({ ...base, isIOS: true, isStandalone: true })).toBe('default')
  })
  it('API 가 없으면 unsupported', () => {
    expect(resolvePushSupport({ ...base, hasPushManager: false })).toBe('unsupported')
    expect(resolvePushSupport({ ...base, hasServiceWorker: false })).toBe('unsupported')
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm test -- src/lib/push`
Expected: FAIL(모듈 없음).

- [ ] **Step 3: 구현**

`src/types/push.ts`:
```ts
// src/types/push.ts
// Web Push API 타입 — 백엔드 PushController 계약과 1:1.
export type PushCategory = 'DM' | 'MENTION' | 'ISSUE' | 'CALENDAR'

export interface PushConfig {
  enabled: boolean
  vapidPublicKey: string | null
}

export type PushPreferences = Record<PushCategory, boolean>
```

`src/api/push.ts`:
```ts
// src/api/push.ts
// Web Push REST 호출. 구독·설정은 사용자 단위(테넌트 무관) API.
import type { PushConfig, PushPreferences } from '../types/push'
import { client } from './client'

export const pushApi = {
  config: () => client.get<PushConfig>('/push/config').then((r) => r.data),
  subscribe: (json: PushSubscriptionJSON) =>
    client
      .post<void>('/push/subscriptions', { endpoint: json.endpoint, keys: json.keys })
      .then(() => undefined),
  unsubscribe: (endpoint: string) =>
    client.delete<void>('/push/subscriptions', { data: { endpoint } }).then(() => undefined),
  preferences: () => client.get<PushPreferences>('/push/preferences').then((r) => r.data),
  updatePreferences: (p: Partial<PushPreferences>) =>
    client.put<PushPreferences>('/push/preferences', p).then((r) => r.data),
}
```

`src/lib/push/keys.ts`:
```ts
// src/lib/push/keys.ts
// VAPID 공개키(base64url) ↔ 바이트 변환과 비교 — 서버 키가 바뀐 기기를 감지해 재구독하기 위해 쓴다.

/** 패딩 없는 base64url → 바이트. */
export function urlBase64ToBytes(s: string): Uint8Array {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)
  const bin = atob(padded)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** 현재 구독의 applicationServerKey 가 서버 키와 같은지. */
export function sameApplicationServerKey(
  current: ArrayBuffer | Uint8Array | null | undefined,
  vapidB64: string,
): boolean {
  if (!current) return false
  const a = current instanceof Uint8Array ? current : new Uint8Array(current)
  const b = urlBase64ToBytes(vapidB64)
  if (a.length !== b.length) return false
  return a.every((v, i) => v === b[i])
}
```

`src/lib/push/support.ts`:
```ts
// src/lib/push/support.ts
// 이 기기의 푸시 지원 상태 판별. 판단(resolvePushSupport)은 순수 함수로 두고 브라우저 값 수집(readPushEnv)만 분리해 테스트한다.

export type PushSupport = 'unsupported' | 'ios-needs-install' | 'denied' | 'default' | 'granted'

export interface PushEnv {
  hasServiceWorker: boolean
  hasPushManager: boolean
  hasNotification: boolean
  permission: NotificationPermission | 'unavailable'
  isIOS: boolean
  isStandalone: boolean
}

/** iOS 는 홈 화면 설치(standalone) 전에는 Push API 자체가 없으므로 설치 안내를 우선한다. */
export function resolvePushSupport(env: PushEnv): PushSupport {
  if (env.isIOS && !env.isStandalone) return 'ios-needs-install'
  if (!env.hasServiceWorker || !env.hasPushManager || !env.hasNotification) return 'unsupported'
  if (env.permission === 'unavailable') return 'unsupported'
  return env.permission
}

/** 현재 브라우저 값 수집. iPadOS 는 데스크톱 UA 를 쓰므로 터치 포인트로 보정한다. */
export function readPushEnv(): PushEnv {
  const ua = navigator.userAgent
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  const isStandalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  const hasNotification = 'Notification' in window
  return {
    hasServiceWorker: 'serviceWorker' in navigator,
    hasPushManager: 'PushManager' in window,
    hasNotification,
    permission: hasNotification ? Notification.permission : 'unavailable',
    isIOS,
    isStandalone,
  }
}

export function getPushSupport(): PushSupport {
  return resolvePushSupport(readPushEnv())
}
```

`src/lib/push/subscription.ts`:
```ts
// src/lib/push/subscription.ts
// 이 기기의 푸시 구독 수명주기. 브라우저 구독(PushManager)과 서버 매핑(/push/subscriptions)을 함께 관리한다.
// 로그아웃은 서버 매핑만 지운다(브라우저 구독 유지 → 다음 로그인 사용자가 재등록하면 소유자 이전).
import { pushApi } from '../../api/push'
import { sameApplicationServerKey, urlBase64ToBytes } from './keys'

/** 현재 기기 구독(서비스워커 미등록·미지원이면 null). */
export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!('serviceWorker' in navigator)) return null
  const reg = await navigator.serviceWorker.getRegistration()
  return reg ? reg.pushManager.getSubscription() : null
}

/** 브라우저 구독 확보 — 키가 다르면(서버 재설치) 해지 후 새로 구독. */
async function ensureSubscription(vapidPublicKey: string): Promise<PushSubscription> {
  const reg = await navigator.serviceWorker.ready
  let sub = await reg.pushManager.getSubscription()
  if (sub && !sameApplicationServerKey(sub.options.applicationServerKey, vapidPublicKey)) {
    await sub.unsubscribe()
    sub = null
  }
  return (
    sub ??
    reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToBytes(vapidPublicKey) })
  )
}

/** 권한 요청 — 반드시 클릭 핸들러 안에서 동기적으로 호출한다(iOS 는 사용자 제스처 밖 요청을 거부). */
export function requestPushPermission(): Promise<NotificationPermission> {
  return Notification.requestPermission()
}

/**
 * 푸시 켜기. permission 은 클릭 핸들러에서 이미 시작한 권한 요청 Promise — 여기서 요청하면 React Query 내부 await 뒤라 제스처가 끊긴다.
 * VAPID 키도 미리 로드된 config 에서 받는다.
 */
export async function enablePush(
  vapidPublicKey: string,
  permission: Promise<NotificationPermission>,
): Promise<void> {
  if ((await permission) !== 'granted') throw new Error('PERMISSION_DENIED')
  const sub = await ensureSubscription(vapidPublicKey)
  await pushApi.subscribe(sub.toJSON())
}

/** 푸시 끄기 — 서버 매핑 삭제 후 브라우저 구독 해지. */
export async function disablePush(): Promise<void> {
  const sub = await currentSubscription()
  if (!sub) return
  await pushApi.unsubscribe(sub.endpoint).catch(() => undefined)
  await sub.unsubscribe()
}

/** 앱 진입(로그인·새로고침·테넌트 전환) 시 서버 매핑 재등록 — 권한과 구독이 이미 있을 때만. 실패는 조용히 무시. */
export async function syncPushOnLogin(): Promise<void> {
  try {
    if (!('Notification' in window) || Notification.permission !== 'granted') return
    const existing = await currentSubscription()
    if (!existing) return
    const cfg = await pushApi.config()
    if (!cfg.enabled || !cfg.vapidPublicKey) return
    const sub = await ensureSubscription(cfg.vapidPublicKey)
    await pushApi.subscribe(sub.toJSON())
  } catch {
    // best-effort — 다음 진입 때 다시 시도
  }
}

/** 로그아웃 직전 — 이 기기의 서버 매핑만 삭제. */
export async function clearPushOnLogout(): Promise<void> {
  try {
    const sub = await currentSubscription()
    if (sub) await pushApi.unsubscribe(sub.endpoint)
  } catch {
    // 로그아웃을 막지 않는다
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `pnpm test -- src/lib/push && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 5: 커밋(승인 후)**

```bash
git add apps/workplace-web/src/types/push.ts apps/workplace-web/src/api/push.ts apps/workplace-web/src/lib/push
git commit -m "feat(web): 푸시 API 클라이언트와 기기 구독 수명주기 모듈 추가

- #867
- 권한 요청을 가장 먼저 호출해 iOS 에서도 사용자 제스처 안에서 구독이 이뤄지게 한다
- 서버 VAPID 키가 바뀐 기기는 기존 구독을 해지하고 다시 구독한다
- 로그아웃 시 서버 매핑만 지워 다음 사용자에게 이전 사용자 알림이 가지 않게 한다"
```

---

### Task 4: 알림 설정 화면 + 인박스 배너 + 로그인/로그아웃 연동 (#867)

**Files:**
- Create: `apps/workplace-web/src/hooks/queries/usePush.ts`
- Create: `apps/workplace-web/src/pages/settings/NotificationSettingsPage.tsx`
- Create: `apps/workplace-web/src/components/layout/PushPromptBanner.tsx`
- Modify: `apps/workplace-web/src/components/layout/SettingsSidebar.tsx` (PERSONAL_ITEMS 에 알림)
- Modify: `apps/workplace-web/src/components/layout/InboxPanel.tsx` (헤더와 스크롤 영역 사이 배너)
- Modify: `apps/workplace-web/src/App.tsx` (`settings/notifications` 라우트)
- Modify: `apps/workplace-web/src/hooks/AuthContext.tsx` (logout 전 `clearPushOnLogout`)
- Modify: `apps/workplace-web/src/components/layout/AppLayout.tsx` (마운트 시 `syncPushOnLogin`)
- Create: `apps/workplace-web/e2e/fixtures/push-mock.ts`
- Test: `apps/workplace-web/e2e/pages/settings/notification-settings.spec.ts`

**Interfaces:**
- Consumes: Task 3 전부
- Produces:
  - `pushKeys = { all: ['push'], config: ['push','config'], preferences: ['push','preferences'], device: ['push','device'] }`
  - `usePushConfig()`, `usePushPreferences(enabled: boolean)`, `useUpdatePushPreference()`, `useDevicePush()`(→ `{ subscribed: boolean }`), `useEnablePush()`, `useDisablePush()`
  - `e2e/fixtures/push-mock.ts`: `VAPID_KEY`, `installPushManagerStub(page)`, `mockPushApis(page, opts?)` → `{ subscribe, unsubscribe, prefs }` capture 객체

- [ ] **Step 1: E2E mock fixture 작성**

`e2e/fixtures/push-mock.ts`:
```ts
// e2e/fixtures/push-mock.ts
// 푸시 E2E 공용 — headless Chromium 은 실제 푸시 서비스(FCM) 연결 없이 subscribe 가 실패하므로 PushManager 를 스텁하고
// /push/* API 를 mock 한다. 스텁은 페이지 로드마다 초기화(구독 없음 상태에서 시작).
import type { Page } from '@playwright/test'

import { mockApi } from './api-mock'

/** 65바이트(0x04 + 0*64) base64url — 서버 VAPID 공개키 대용. */
export const VAPID_KEY = 'B' + 'A'.repeat(86)
export const FAKE_ENDPOINT = 'https://push.example.test/sub/1'

export async function installPushManagerStub(page: Page) {
  await page.addInitScript(
    ({ endpoint }) => {
      let current: unknown = null
      const make = (key: BufferSource | null) => ({
        endpoint,
        options: { applicationServerKey: key },
        toJSON: () => ({ endpoint, keys: { p256dh: 'p256dh-fake', auth: 'auth-fake' } }),
        unsubscribe: async () => {
          current = null
          return true
        },
      })
      PushManager.prototype.getSubscription = async function () {
        return current as PushSubscription | null
      }
      PushManager.prototype.subscribe = async function (opts?: PushSubscriptionOptionsInit) {
        current = make((opts?.applicationServerKey as BufferSource) ?? null)
        return current as PushSubscription
      }
    },
    { endpoint: FAKE_ENDPOINT },
  )
}

export async function mockPushApis(page: Page, opts: { enabled?: boolean } = {}) {
  const enabled = opts.enabled ?? true
  await mockApi(page, 'GET', '/api/v1/push/config', { enabled, vapidPublicKey: enabled ? VAPID_KEY : null })
  // 설정은 GET/PUT 을 한 핸들러가 상태로 처리(PUT 결과가 이후 GET 에 반영).
  let prefsState = { DM: true, MENTION: true, ISSUE: true, CALENDAR: true }
  await page.route('**/api/v1/push/preferences', async (route) => {
    if (route.request().method() === 'PUT') {
      prefsState = { ...prefsState, ...route.request().postDataJSON() }
    }
    await route.fulfill({ json: prefsState })
  })
  const subscribe = await mockApi(page, 'POST', '/api/v1/push/subscriptions', {}, { status: 204, capture: true })
  const unsubscribe = await mockApi(page, 'DELETE', '/api/v1/push/subscriptions', {}, { status: 204, capture: true })
  /** 다음 설정 PUT 요청 대기 — 클릭 전에 호출해 Promise 를 잡아 둔다. */
  const nextPrefsPut = () =>
    page.waitForRequest((r) => r.url().endsWith('/api/v1/push/preferences') && r.method() === 'PUT')
  return { subscribe, unsubscribe, nextPrefsPut }
}
```

- [ ] **Step 2: 실패하는 E2E 작성**

`e2e/pages/settings/notification-settings.spec.ts`:
```ts
// e2e/pages/settings/notification-settings.spec.ts
// 설정 > 알림 — 기기 푸시 토글(권한→구독→서버 등록), 종류별 토글, 거부·iOS·비활성 안내, 로그아웃 시 구독 해제.
import { expect, test } from '../../fixtures/auth.fixture'
import { mockApi } from '../../fixtures/api-mock'
import { FAKE_ENDPOINT, installPushManagerStub, mockPushApis } from '../../fixtures/push-mock'

test.use({ serviceWorkers: 'allow' })

test.describe('알림 설정', () => {
  test('기기 푸시를 켜면 구독이 서버에 등록된다', { tag: '@smoke' }, async ({ authenticatedPage: page, context }) => {
    await context.grantPermissions(['notifications'])
    await installPushManagerStub(page)
    const { subscribe } = await mockPushApis(page)

    await page.goto('/settings/notifications')
    const toggle = page.getByTestId('push-device-toggle')
    await expect(toggle).toHaveAttribute('aria-checked', 'false')
    await toggle.click()

    const req = await subscribe.waitForRequest()
    expect(req.postDataJSON()).toEqual({ endpoint: FAKE_ENDPOINT, keys: { p256dh: 'p256dh-fake', auth: 'auth-fake' } })
    await expect(toggle).toHaveAttribute('aria-checked', 'true')
  })

  test('기기 푸시를 끄면 서버 구독이 삭제된다', async ({ authenticatedPage: page, context }) => {
    await context.grantPermissions(['notifications'])
    await installPushManagerStub(page)
    const { unsubscribe } = await mockPushApis(page)

    await page.goto('/settings/notifications')
    const toggle = page.getByTestId('push-device-toggle')
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-checked', 'true')
    await toggle.click()

    const req = await unsubscribe.waitForRequest()
    expect(req.postDataJSON()).toEqual({ endpoint: FAKE_ENDPOINT })
    await expect(toggle).toHaveAttribute('aria-checked', 'false')
  })

  test('종류별 토글은 부분 업데이트로 저장된다', async ({ authenticatedPage: page }) => {
    await installPushManagerStub(page)
    const { nextPrefsPut } = await mockPushApis(page)
    await page.goto('/settings/notifications')

    const put = nextPrefsPut()
    await page.getByTestId('push-pref-CALENDAR').click()

    expect((await put).postDataJSON()).toEqual({ CALENDAR: false })
    await expect(page.getByTestId('push-pref-CALENDAR')).toHaveAttribute('aria-checked', 'false')
  })

  test('권한을 거부하면 안내가 보인다', async ({ authenticatedPage: page }) => {
    // 권한 미부여 headless Chromium 은 권한 창이 자동으로 닫혀 granted 가 아닌 결과로 끝난다(denied 또는 default).
    await installPushManagerStub(page)
    await mockPushApis(page)
    await page.goto('/settings/notifications')

    await page.getByTestId('push-device-toggle').click()

    await expect(page.getByTestId('push-denied-guide')).toBeVisible()
  })

  test('서버가 푸시 비활성이면 푸시 섹션을 숨긴다', async ({ authenticatedPage: page }) => {
    await mockPushApis(page, { enabled: false })
    await page.goto('/settings/notifications')
    await expect(page.getByTestId('push-disabled-notice')).toBeVisible()
    await expect(page.getByTestId('push-device-toggle')).toHaveCount(0)
  })

  test('사이드바에 알림 메뉴가 있다', async ({ authenticatedPage: page }) => {
    await mockPushApis(page)
    await page.goto('/settings/profile')
    await page.getByTestId('settings-sidebar').getByRole('link', { name: '알림' }).click()
    await expect(page).toHaveURL(/\/settings\/notifications$/)
  })

  test('로그아웃 시 구독 해제 후 logout 호출', async ({ authenticatedPage: page, context }) => {
    await context.grantPermissions(['notifications'])
    await installPushManagerStub(page)
    const { unsubscribe } = await mockPushApis(page)
    const order: string[] = []
    await page.route('**/api/v1/auth/logout', async (route) => {
      order.push('logout')
      await route.fulfill({ json: {} })
    })
    page.on('request', (r) => {
      if (r.url().endsWith('/api/v1/push/subscriptions') && r.method() === 'DELETE') order.push('unsubscribe')
    })

    await page.goto('/settings/notifications')
    await page.getByTestId('push-device-toggle').click()
    await expect(page.getByTestId('push-device-toggle')).toHaveAttribute('aria-checked', 'true')

    await page.getByRole('button', { name: '사용자 메뉴' }).click()
    await page.getByRole('menuitem', { name: '로그아웃' }).click()
    await unsubscribe.waitForRequest()
    await expect(page).toHaveURL(/\/login$/)
    expect(order).toEqual(['unsubscribe', 'logout'])
  })
})

test.describe('알림 설정 — iOS', () => {
  test.use({
    serviceWorkers: 'allow',
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  })

  test('홈 화면 설치 전이면 설치 안내를 보이고 토글을 막는다', async ({ authenticatedPage: page }) => {
    await mockPushApis(page)
    await page.goto('/settings/notifications')
    await expect(page.getByTestId('push-ios-install-guide')).toBeVisible()
    await expect(page.getByTestId('push-device-toggle')).toBeDisabled()
  })
})

test.describe('인박스 배너', () => {
  test.use({ serviceWorkers: 'allow' })

  test('미구독이면 알림 켜기 배너가 보이고 닫으면 다시 안 보인다', async ({ authenticatedPage: page }) => {
    await installPushManagerStub(page)
    await mockPushApis(page)
    await mockApi(page, 'GET', '/api/v1/notifications', [])
    await page.goto('/')
    await page.getByRole('button', { name: /알림/ }).first().click()
    await expect(page.getByTestId('push-prompt-banner')).toBeVisible()
    await page.getByTestId('push-prompt-dismiss').click()
    await expect(page.getByTestId('push-prompt-banner')).toHaveCount(0)
    await page.reload()
    await page.getByRole('button', { name: /알림/ }).first().click()
    await expect(page.getByTestId('inbox-panel')).toBeVisible()
    await expect(page.getByTestId('push-prompt-banner')).toHaveCount(0)
  })
})
```

> 인박스 벨 버튼의 접근성 이름은 `InboxPanel.tsx` 의 PopoverTrigger 를 확인해 맞춘다(`grep -n "aria-label" src/components/layout/InboxPanel.tsx`). 기존 인박스 E2E(`grep -rln inbox-panel e2e`)의 여는 방식을 그대로 쓴다.

- [ ] **Step 3: 실패 확인**

Run: `pnpm test:e2e -- e2e/pages/settings/notification-settings.spec.ts`
Expected: FAIL(라우트 없음).

- [ ] **Step 4: 구현**

`src/hooks/queries/usePush.ts`:
```ts
// src/hooks/queries/usePush.ts
// 푸시 설정 쿼리/뮤테이션 — 서버 config·종류별 설정과 "이 기기" 구독 상태(브라우저 PushManager)를 함께 다룬다.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { pushApi } from '../../api/push'
import { handleApiError } from '../../lib/api-error'
import { currentSubscription, disablePush, enablePush } from '../../lib/push/subscription'
import type { PushCategory } from '../../types/push'

export const pushKeys = {
  all: ['push'] as const,
  config: ['push', 'config'] as const,
  preferences: ['push', 'preferences'] as const,
  device: ['push', 'device'] as const,
}

export function usePushConfig() {
  return useQuery({ queryKey: pushKeys.config, queryFn: pushApi.config, staleTime: 5 * 60_000 })
}

export function usePushPreferences(enabled: boolean) {
  return useQuery({ queryKey: pushKeys.preferences, queryFn: pushApi.preferences, enabled })
}

export function useUpdatePushPreference() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ category, enabled }: { category: PushCategory; enabled: boolean }) =>
      pushApi.updatePreferences({ [category]: enabled }),
    onSuccess: (data) => qc.setQueryData(pushKeys.preferences, data),
    onError: (e) => handleApiError(e, '알림 설정 저장에 실패했습니다'),
  })
}

/** 이 기기 구독 여부(브라우저 기준). */
export function useDevicePush() {
  return useQuery({
    queryKey: pushKeys.device,
    queryFn: async () => ({ subscribed: (await currentSubscription()) != null }),
    staleTime: Infinity,
  })
}

/** 호출자는 클릭 핸들러에서 requestPushPermission() 을 먼저 호출해 permission 으로 넘긴다. */
export function useEnablePush() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ vapidPublicKey, permission }: { vapidPublicKey: string; permission: Promise<NotificationPermission> }) =>
      enablePush(vapidPublicKey, permission),
    onSuccess: () => {
      qc.setQueryData(pushKeys.device, { subscribed: true })
      toast.success('이 기기에서 알림을 받습니다')
    },
    onError: (e) => {
      if (e instanceof Error && e.message === 'PERMISSION_DENIED') return // 화면이 거부 안내를 보여준다
      handleApiError(e, '알림을 켜지 못했습니다')
    },
  })
}

export function useDisablePush() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: disablePush,
    onSuccess: () => qc.setQueryData(pushKeys.device, { subscribed: false }),
    onError: (e) => handleApiError(e, '알림을 끄지 못했습니다'),
  })
}
```

`src/pages/settings/NotificationSettingsPage.tsx`:
```tsx
// src/pages/settings/NotificationSettingsPage.tsx
// 설정 > 개인 > 알림 — 이 기기 푸시 on/off 와 사용자 단위 종류별 설정. iOS 미설치·권한 거부·서버 비활성 상태를 안내한다.
import { useState } from 'react'

import { SettingsPage } from '@/components/layout/SettingsPage'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import {
  useDevicePush,
  useDisablePush,
  useEnablePush,
  usePushConfig,
  usePushPreferences,
  useUpdatePushPreference,
} from '@/hooks/queries/usePush'
import { requestPushPermission } from '@/lib/push/subscription'
import { getPushSupport, type PushSupport } from '@/lib/push/support'
import type { PushCategory } from '@/types/push'

const CATEGORIES: { key: PushCategory; label: string; description: string }[] = [
  { key: 'DM', label: '다이렉트 메시지', description: '나에게 온 DM' },
  { key: 'MENTION', label: '채널 멘션', description: '채널에서 나를 멘션한 메시지' },
  { key: 'ISSUE', label: '이슈', description: '배정·코멘트·상태·우선순위 변경' },
  { key: 'CALENDAR', label: '캘린더', description: '일정 초대·참석 응답·리마인더' },
]

export default function NotificationSettingsPage() {
  const config = usePushConfig()
  const enabled = config.data?.enabled === true
  const prefs = usePushPreferences(enabled)
  const updatePref = useUpdatePushPreference()
  const device = useDevicePush()
  const enablePush = useEnablePush()
  const disablePush = useDisablePush()
  // 권한 요청 결과로 바뀌므로 상태로 들고 클릭 후 다시 읽는다.
  const [support, setSupport] = useState<PushSupport>(() => getPushSupport())

  const subscribed = device.data?.subscribed === true
  const busy = enablePush.isPending || disablePush.isPending
  // 이번 요청이 거부/닫힘으로 끝났는지 — 창을 닫기만 하면 permission 이 'default' 로 남으므로 결과로도 판단한다.
  const deniedNow = enablePush.error instanceof Error && enablePush.error.message === 'PERMISSION_DENIED'

  // 토글 클릭 — 권한 요청을 이 핸들러에서 동기 호출(사용자 제스처 유지)하고 Promise 를 넘긴다.
  const onToggleDevice = (next: boolean) => {
    if (next) {
      const key = config.data?.vapidPublicKey
      if (!key) return
      const permission = requestPushPermission()
      enablePush.mutate({ vapidPublicKey: key, permission }, { onSettled: () => setSupport(getPushSupport()) })
    } else {
      disablePush.mutate()
    }
  }

  return (
    <SettingsPage title="알림" width="form" data-testid="notification-settings-page">
      {config.isSuccess && !enabled && (
        <Card data-testid="push-disabled-notice">
          <CardHeader>
            <CardTitle>푸시 알림을 사용할 수 없습니다</CardTitle>
            <CardDescription>이 서버에서는 푸시 알림이 꺼져 있습니다. 앱을 열어 둔 동안에는 인박스로 알림을 받습니다.</CardDescription>
          </CardHeader>
        </Card>
      )}

      {enabled && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>이 기기</CardTitle>
              <CardDescription>앱을 닫아도 이 기기로 알림을 받습니다.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between gap-4">
                <span className="text-sm">이 기기에서 푸시 받기</span>
                <Switch
                  data-testid="push-device-toggle"
                  checked={subscribed}
                  disabled={busy || support === 'ios-needs-install' || support === 'unsupported'}
                  onCheckedChange={onToggleDevice}
                  aria-label="이 기기에서 푸시 받기"
                />
              </div>
              {support === 'ios-needs-install' && (
                <p className="rounded-md bg-muted p-3 text-sm" data-testid="push-ios-install-guide">
                  iPhone·iPad 에서는 홈 화면에 추가한 앱에서만 알림을 받을 수 있습니다. Safari 의 공유 버튼 → “홈 화면에 추가”를 누른
                  뒤, 홈 화면의 Gen:iA 앱에서 다시 켜 주세요.
                </p>
              )}
              {(support === 'denied' || deniedNow) && (
                <p className="rounded-md bg-muted p-3 text-sm" data-testid="push-denied-guide">
                  알림 권한이 차단되어 있습니다. 브라우저 주소창의 사이트 설정(또는 OS 설정 &gt; 알림)에서 이 사이트의 알림을 허용해 주세요.
                </p>
              )}
              {support === 'unsupported' && (
                <p className="text-sm text-muted-foreground" data-testid="push-unsupported">
                  이 브라우저는 푸시 알림을 지원하지 않습니다.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>알림 종류</CardTitle>
              <CardDescription>모든 기기에 공통으로 적용됩니다.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {CATEGORIES.map((c) => (
                <div key={c.key} className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium">{c.label}</p>
                    <p className="text-xs text-muted-foreground">{c.description}</p>
                  </div>
                  <Switch
                    data-testid={`push-pref-${c.key}`}
                    checked={prefs.data?.[c.key] ?? true}
                    disabled={!prefs.isSuccess}
                    onCheckedChange={(v) => updatePref.mutate({ category: c.key, enabled: v })}
                    aria-label={c.label}
                  />
                </div>
              ))}
            </CardContent>
          </Card>
        </>
      )}
    </SettingsPage>
  )
}
```

> `@/components/ui/card` 에 `CardDescription` 이 없으면(`grep -n CardDescription src/components/ui/card.tsx`) `<p className="text-sm text-muted-foreground">` 로 대체.

`src/components/layout/PushPromptBanner.tsx`:
```tsx
// src/components/layout/PushPromptBanner.tsx
// 인박스 상단 "알림 켜기" 배너 — 서버 푸시 가능 + 권한 미결정 + 미구독 + 닫은 적 없음일 때 1회 노출. 자동 권한 요청은 하지 않는다.
import { BellRing, X } from 'lucide-react'
import { useState } from 'react'

import { useDevicePush, useEnablePush, usePushConfig } from '@/hooks/queries/usePush'
import { requestPushPermission } from '@/lib/push/subscription'
import { getPushSupport } from '@/lib/push/support'

const DISMISS_KEY = 'pushPromptDismissed'

function readDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === '1'
  } catch {
    return false
  }
}

export function PushPromptBanner() {
  const config = usePushConfig()
  const device = useDevicePush()
  const enablePush = useEnablePush()
  const [dismissed, setDismissed] = useState(readDismissed)

  const key = config.data?.vapidPublicKey
  if (dismissed || !config.data?.enabled || !key) return null
  if (device.data?.subscribed !== false || getPushSupport() !== 'default') return null

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, '1')
    } catch {
      // 저장 불가(시크릿 모드) — 이번 세션만 숨김
    }
    setDismissed(true)
  }

  return (
    <div className="flex items-center gap-2 border-b bg-muted/50 px-3 py-2 text-xs" data-testid="push-prompt-banner">
      <BellRing className="h-4 w-4 shrink-0 text-primary" />
      <span className="flex-1">앱을 닫아도 알림을 받아 보세요</span>
      <button
        type="button"
        className="font-medium text-primary hover:underline"
        disabled={enablePush.isPending}
        onClick={() => enablePush.mutate({ vapidPublicKey: key, permission: requestPushPermission() }, { onSettled: dismiss })}
        data-testid="push-prompt-enable"
      >
        알림 켜기
      </button>
      <button type="button" aria-label="배너 닫기" onClick={dismiss} data-testid="push-prompt-dismiss">
        <X className="h-3.5 w-3.5 text-muted-foreground" />
      </button>
    </div>
  )
}
```

`InboxPanel.tsx` — 헤더 `</div>`(현재 126행)와 `<div ref={scrollRef} ...>`(127행) 사이에 `<PushPromptBanner />` 삽입, import `import { PushPromptBanner } from '@/components/layout/PushPromptBanner'`.

`SettingsSidebar.tsx` — import 에 `Bell` 추가, `PERSONAL_ITEMS` 의 `'메일 계정'` 다음에 `{ label: '알림', href: '/settings/notifications', icon: Bell },`.

`App.tsx` — 88행 근처에 `const NotificationSettingsPage = lazy(() => import('./pages/settings/NotificationSettingsPage'))`, 195행 다음에 `<Route path="settings/notifications" element={<NotificationSettingsPage />} />`.

`AuthContext.tsx` — import `import { clearPushOnLogout } from '../lib/push/subscription';`, `logout` 의 `try {` 첫 줄에 `await clearPushOnLogout();`(서버 logout 전 — 토큰이 살아 있을 때 매핑 삭제).

`AppLayout.tsx` — import `useEffect` 추가 및 `import { syncPushOnLogin } from '@/lib/push/subscription'`, `useEventStream` 호출 다음에:
```tsx
  // 앱 진입(로그인·새로고침·테넌트 전환) 시 이 기기 구독을 서버에 재등록 — 계정 전환 시 소유자 이전·VAPID 키 변경 재구독.
  useEffect(() => {
    void syncPushOnLogin()
  }, [user?.id])
```

- [ ] **Step 5: 통과 확인**

Run: `pnpm typecheck && pnpm lint && pnpm test:e2e -- e2e/pages/settings/notification-settings.spec.ts && npx tsc -p tsconfig.e2e.json --noEmit`
Expected: PASS. `로그아웃 시 구독 해제 후 logout 호출` 이 실패하면 `auth.fixture` 의 기본 logout mock 과 순서 충돌인지 확인(뒤에 등록한 route 가 우선).

- [ ] **Step 6: 키 불일치 재구독 E2E 추가**

같은 스펙에 추가:
```ts
test('서버 키가 바뀐 기기는 재구독 후 재등록한다', async ({ authenticatedPage: page, context }) => {
  await context.grantPermissions(['notifications'])
  // 이전 키(마지막 바이트 다름)로 이미 구독된 브라우저 시뮬레이션
  await page.addInitScript(() => {
    const old = new Uint8Array(65)
    old[0] = 4
    old[64] = 1
    let current: unknown = {
      endpoint: 'https://push.example.test/sub/old',
      options: { applicationServerKey: old.buffer },
      toJSON: () => ({ endpoint: 'https://push.example.test/sub/old', keys: { p256dh: 'o', auth: 'o' } }),
      unsubscribe: async () => {
        current = null
        return true
      },
    }
    PushManager.prototype.getSubscription = async function () {
      return current as PushSubscription | null
    }
    PushManager.prototype.subscribe = async function () {
      current = {
        endpoint: 'https://push.example.test/sub/new',
        options: { applicationServerKey: null },
        toJSON: () => ({ endpoint: 'https://push.example.test/sub/new', keys: { p256dh: 'n', auth: 'n' } }),
        unsubscribe: async () => true,
      }
      return current as PushSubscription
    }
  })
  const { subscribe } = await mockPushApis(page)
  await page.goto('/')
  const req = await subscribe.waitForRequest()
  expect(req.postDataJSON().endpoint).toBe('https://push.example.test/sub/new')
})
```
Run: 같은 명령. Expected: PASS(AppLayout 의 syncPushOnLogin 이 키 불일치를 감지).

- [ ] **Step 7: 커밋(승인 후)**

```bash
git add apps/workplace-web
git commit -m "feat(web): 알림 설정 화면과 인박스 알림 켜기 배너 추가

- #867
- 설정 알림 화면에서 이 기기 푸시와 종류별 알림을 켜고 끌 수 있다
- iOS 미설치·권한 거부·서버 비활성 상태를 각각 안내한다
- 로그아웃 전에 이 기기 구독을 서버에서 지우고 앱 진입 시 구독을 재등록한다"
```

---

### Task 5: 서비스워커 push 수신 + 알림 탭 이동 + /push-open (#868)

**Files:**
- Modify: `apps/workplace-web/src/sw.ts` (push·notificationclick)
- Create: `apps/workplace-web/src/lib/push/openTarget.ts`
- Create: `apps/workplace-web/src/pages/PushOpenPage.tsx`
- Modify: `apps/workplace-web/src/hooks/auth-context-value.ts`, `src/hooks/AuthContext.tsx` (`selectTenant(membership, redirectTo?)`)
- Modify: `apps/workplace-web/src/components/layout/AppLayout.tsx` (알림 이동 리스너 + 대기 목적지 소비)
- Modify: `apps/workplace-web/src/App.tsx` (공개 라우트 `/push-open`)
- Test: `apps/workplace-web/e2e/pages/pwa/push-open.spec.ts`, `apps/workplace-web/e2e/pages/pwa/sw-push.spec.ts`

**Interfaces:**
- Consumes: Task 2 `logic.ts`, `authApi.memberships()`, `useAuth()`
- Produces:
  - `AuthContextValue.selectTenant(membership: Membership, redirectTo?: string): Promise<void>` — redirectTo 기본 `'/'`
  - `openPushTarget(target: { tenantId: number | null; url: string }, deps: { activeTenantId: number | null; selectTenant: AuthContextValue['selectTenant']; navigate: (to: string) => void }): Promise<void>`
  - `PENDING_PUSH_TARGET_KEY = 'pendingPushTarget'`, `savePendingPushTarget(t)`, `takePendingPushTarget(): { tenantId: number | null; url: string } | null`

- [ ] **Step 1: 실패하는 E2E 작성**

`e2e/pages/pwa/push-open.spec.ts`:
```ts
// e2e/pages/pwa/push-open.spec.ts
// 알림 탭 진입점 — 같은 테넌트 이동, 다른 테넌트 전환, 비멤버 거부, 외부 url 차단, 미로그인 후 복귀, 열린 창 postMessage 이동.
import { createMembership, createTokenResponse } from '../../factories/auth.factory'
import { mockApi } from '../../fixtures/api-mock'
import { expect, test } from '../../fixtures/auth.fixture'

const T1 = createMembership({ tenantId: 1, tenantName: 'A', tenantSlug: 'a' })
const T2 = createMembership({ tenantId: 2, tenantName: 'B', tenantSlug: 'b' })

test.describe('/push-open', () => {
  test.beforeEach(async ({ authenticatedPage: page }) => {
    await page.addInitScript((m) => localStorage.setItem('activeTenant', JSON.stringify(m)), T1)
    await mockApi(page, 'GET', '/api/v1/auth/memberships', [T1, T2])
  })

  test('같은 테넌트면 바로 이동', { tag: '@smoke' }, async ({ authenticatedPage: page }) => {
    await page.goto('/push-open?t=1&to=' + encodeURIComponent('/calendar?eventId=9'))
    await expect(page).toHaveURL(/\/calendar/)
  })

  test('다른 테넌트면 전환 후 이동', async ({ authenticatedPage: page }) => {
    const sel = await mockApi(page, 'POST', '/api/v1/auth/select-tenant', createTokenResponse(), { capture: true })
    await page.goto('/push-open?t=2&to=' + encodeURIComponent('/chat/dms/42'))
    const req = await sel.waitForRequest()
    expect(req.postDataJSON()).toEqual({ tenantId: 2 })
    await expect(page).toHaveURL(/\/chat\/dms\/42$/)
  })

  test('소속되지 않은 테넌트면 안내 후 홈', async ({ authenticatedPage: page }) => {
    await page.goto('/push-open?t=77&to=' + encodeURIComponent('/chat/dms/42'))
    await expect(page.getByText('해당 워크스페이스에 접근할 수 없습니다')).toBeVisible()
    await expect(page).toHaveURL(/\/$/)
  })

  test('외부 url 은 홈으로', async ({ authenticatedPage: page }) => {
    await page.goto('/push-open?t=1&to=' + encodeURIComponent('//evil.com'))
    await expect(page).toHaveURL(/\/$/)
  })

  test('열린 창은 서비스워커 메시지로 이동', async ({ authenticatedPage: page }) => {
    await page.goto('/')
    await expect(page.getByTestId('app-rail')).toBeVisible()
    await page.evaluate(() =>
      navigator.serviceWorker.dispatchEvent(
        new MessageEvent('message', { data: { type: 'push-navigate', url: '/calendar', tenantId: 1 } }),
      ),
    )
    await expect(page).toHaveURL(/\/calendar$/)
  })
})

test('미로그인 → 로그인 후 목적지', async ({ page }) => {
  await mockApi(page, 'GET', '/api/v1/auth/signup-available', { available: true })
  await page.goto('/push-open?t=1&to=' + encodeURIComponent('/calendar'))
  await expect(page).toHaveURL(/\/login$/)
  const pending = await page.evaluate(() => sessionStorage.getItem('pendingPushTarget'))
  expect(JSON.parse(pending!)).toEqual({ tenantId: 1, url: '/calendar' })
})
```

> 마지막 테스트는 "목적지 저장"까지만 검증한다. 로그인 후 소비(AppLayout)는 아래 `대기 목적지 소비` 테스트가 담당.

같은 파일에 추가:
```ts
test('대기 목적지는 앱 진입 시 소비된다', async ({ authenticatedPage: page }) => {
  await page.addInitScript(() =>
    sessionStorage.setItem('pendingPushTarget', JSON.stringify({ tenantId: null, url: '/calendar' })),
  )
  await page.goto('/')
  await expect(page).toHaveURL(/\/calendar$/)
  expect(await page.evaluate(() => sessionStorage.getItem('pendingPushTarget'))).toBeNull()
})
```

`e2e/pages/pwa/sw-push.spec.ts`:
```ts
// e2e/pages/pwa/sw-push.spec.ts
// 서비스워커 push 핸들러 — CDP 로 실제 push 이벤트를 주입해 알림 표시/억제를 확인한다(Chromium 전용).
import type { CDPSession, Page } from '@playwright/test'

import { expect, test } from '../../fixtures/auth.fixture'

test.use({ serviceWorkers: 'allow' })

async function deliverPush(page: Page, data: object) {
  const cdp: CDPSession = await page.context().newCDPSession(page)
  const origin = new URL(page.url()).origin
  const regId = await new Promise<string>((resolve) => {
    cdp.on('ServiceWorker.workerRegistrationUpdated', (e) => {
      const r = e.registrations.find((x) => x.scopeURL.startsWith(origin) && !x.isDeleted)
      if (r) resolve(r.registrationId)
    })
    void cdp.send('ServiceWorker.enable')
  })
  await cdp.send('ServiceWorker.deliverPushMessage', { origin, registrationId: regId, data: JSON.stringify(data) })
}

const payload = { v: 1, tenantId: 1, category: 'DM', title: '박OO', body: '안녕', url: '/chat/dms/42', tag: 'ch-42' }

test('다른 화면을 보고 있으면 알림을 표시한다', async ({ authenticatedPage: page, context }) => {
  await context.grantPermissions(['notifications'])
  await page.goto('/')
  await page.evaluate(() => navigator.serviceWorker.ready)
  await deliverPush(page, payload)
  await expect
    .poll(async () =>
      page.evaluate(async () => {
        const reg = await navigator.serviceWorker.ready
        return (await reg.getNotifications()).map((n) => ({ title: n.title, body: n.body, tag: n.tag }))
      }),
    )
    .toEqual([{ title: '박OO', body: '안녕', tag: 'ch-42' }])
})

test('같은 화면을 보고 있으면 알림 대신 창에 메시지를 보낸다', async ({ authenticatedPage: page, context }) => {
  await context.grantPermissions(['notifications'])
  await page.goto('/chat/dms/42')
  await page.evaluate(() => {
    ;(window as unknown as { __pushReceived: unknown[] }).__pushReceived = []
    navigator.serviceWorker.addEventListener('message', (e) => {
      if (e.data?.type === 'push-received') (window as unknown as { __pushReceived: unknown[] }).__pushReceived.push(e.data)
    })
    return navigator.serviceWorker.ready
  })
  await deliverPush(page, payload)
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __pushReceived: unknown[] }).__pushReceived.length))
    .toBe(1)
  const count = await page.evaluate(async () => (await (await navigator.serviceWorker.ready).getNotifications()).length)
  expect(count).toBe(0)
})
```

> headless Chromium 에서 `getNotifications()` 가 항상 빈 배열이면(플랫폼 알림 미지원) 첫 테스트를 `test.fixme` 로 두고 실기기 스모크(Task 6)로 대체한다 — 억제 경로 테스트는 알림 표시와 무관하게 유효하다.

- [ ] **Step 2: 실패 확인**

Run: `pnpm test:e2e -- e2e/pages/pwa/push-open.spec.ts e2e/pages/pwa/sw-push.spec.ts`
Expected: FAIL.

- [ ] **Step 3: 구현**

`src/sw.ts` — import 에 logic 추가하고 파일 끝에 핸들러 추가:
```ts
import { buildNotification, parsePushPayload, requiresVisibleNotification, safeTarget, shouldSuppress } from './sw/logic'
```
```ts
// 푸시 수신 — 사용자가 이미 그 화면을 보고 있으면(비 Safari) 알림 대신 창에 알리고, 아니면 알림을 표시한다.
self.addEventListener('push', (event) => {
  event.waitUntil(handlePush(event.data?.text() ?? null))
})

async function handlePush(raw: string | null) {
  const payload = parsePushPayload(raw)
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
  const views = windows.map((c) => ({ url: c.url, visible: c.visibilityState === 'visible' }))
  if (shouldSuppress(payload, views, self.location.origin, requiresVisibleNotification(self.navigator.userAgent))) {
    windows
      .filter((c) => c.visibilityState === 'visible')
      .forEach((c) => c.postMessage({ type: 'push-received', payload }))
    return
  }
  const { title, options } = buildNotification(payload)
  await self.registration.showNotification(title, options)
}

// 알림 탭 — 열린 창이 있으면 포커스 후 앱 라우터로 이동시키고, 없으면 /push-open 으로 새 창(테넌트 전환 포함).
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(openFromNotification(event.notification.data))
})

async function openFromNotification(data: unknown) {
  const d = (data ?? {}) as { url?: unknown; tenantId?: unknown }
  const url = safeTarget(d.url)
  const tenantId = typeof d.tenantId === 'number' ? d.tenantId : null
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
  const existing = windows.find((c) => new URL(c.url).origin === self.location.origin)
  if (existing) {
    await existing.focus()
    existing.postMessage({ type: 'push-navigate', url, tenantId })
    return
  }
  const qs = new URLSearchParams({ to: url })
  if (tenantId != null) qs.set('t', String(tenantId))
  await self.clients.openWindow(`/push-open?${qs.toString()}`)
}
```

`src/hooks/auth-context-value.ts` — `selectTenant(membership: Membership): Promise<void>;` 를 다음으로 교체:
```ts
  /** 테넌트 전환 — 토큰 재발급 후 redirectTo(기본 '/')로 전체 리로드. 알림 탭 이동은 목적지를 넘긴다. */
  selectTenant(membership: Membership, redirectTo?: string): Promise<void>;
```

`src/hooks/AuthContext.tsx` — `selectTenant` 구현 변경:
```ts
  const selectTenant = useCallback(async (membership: Membership, redirectTo = '/') => {
    const { data: token } = await authApi.selectTenant(membership.tenantId);
    setAccessToken(token.accessToken);
    writeActiveTenant(membership);
    localStorage.setItem(AUTH_FLAG_KEY, 'true');
    window.location.assign(redirectTo);
  }, []);
```

`src/lib/push/openTarget.ts`:
```ts
// src/lib/push/openTarget.ts
// 알림 탭 목적지로 이동 — 다른 테넌트 알림이면 전환(토큰 재발급 + 목적지로 리로드), 소속이 아니면 안내 후 홈.
// /push-open·SW postMessage·로그인 후 대기 목적지 세 경로가 공유한다.
import { toast } from 'sonner'

import { authApi } from '../../api/auth'
import type { AuthContextValue } from '../../hooks/auth-context-value'
import { safeTarget } from '../../sw/logic'

export interface PushTarget {
  tenantId: number | null
  url: string
}

export const PENDING_PUSH_TARGET_KEY = 'pendingPushTarget'

export function savePendingPushTarget(t: PushTarget) {
  try {
    sessionStorage.setItem(PENDING_PUSH_TARGET_KEY, JSON.stringify(t))
  } catch {
    // 저장 불가 — 로그인 후 홈으로
  }
}

export function takePendingPushTarget(): PushTarget | null {
  try {
    const raw = sessionStorage.getItem(PENDING_PUSH_TARGET_KEY)
    if (!raw) return null
    sessionStorage.removeItem(PENDING_PUSH_TARGET_KEY)
    const o = JSON.parse(raw) as { tenantId?: unknown; url?: unknown }
    return { tenantId: typeof o.tenantId === 'number' ? o.tenantId : null, url: safeTarget(o.url) }
  } catch {
    return null
  }
}

export async function openPushTarget(
  target: PushTarget,
  deps: {
    activeTenantId: number | null
    selectTenant: AuthContextValue['selectTenant']
    navigate: (to: string) => void
  },
): Promise<void> {
  const url = safeTarget(target.url)
  if (target.tenantId == null || target.tenantId === deps.activeTenantId) {
    deps.navigate(url)
    return
  }
  try {
    const { data: memberships } = await authApi.memberships()
    const m = memberships.find((x) => x.tenantId === target.tenantId)
    if (!m) {
      toast.error('해당 워크스페이스에 접근할 수 없습니다')
      deps.navigate('/')
      return
    }
    await deps.selectTenant(m, url)
  } catch {
    toast.error('워크스페이스를 전환하지 못했습니다')
    deps.navigate('/')
  }
}
```

`src/pages/PushOpenPage.tsx`:
```tsx
// src/pages/PushOpenPage.tsx
// 알림 탭으로 새 창이 열릴 때의 진입점(공개 라우트). 미로그인이면 목적지를 저장하고 로그인으로, 로그인 상태면 테넌트 확인 후 이동.
import { useEffect, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'

import { useAuth } from '@/hooks/useAuth'
import { openPushTarget, savePendingPushTarget } from '@/lib/push/openTarget'
import { safeTarget } from '@/sw/logic'

export default function PushOpenPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { isLoading, isAuthenticated, activeTenant, selectTenant } = useAuth()
  const started = useRef(false)

  useEffect(() => {
    if (isLoading || started.current) return
    started.current = true
    const t = Number(params.get('t'))
    const target = { tenantId: Number.isFinite(t) && t > 0 ? t : null, url: safeTarget(params.get('to')) }
    if (!isAuthenticated) {
      savePendingPushTarget(target)
      navigate('/login', { replace: true })
      return
    }
    void openPushTarget(target, {
      activeTenantId: activeTenant?.tenantId ?? null,
      selectTenant,
      navigate: (to) => navigate(to, { replace: true }),
    })
  }, [isLoading, isAuthenticated, activeTenant, selectTenant, navigate, params])

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="text-muted-foreground">이동 중...</div>
    </div>
  )
}
```

`App.tsx` — lazy import `const PushOpenPage = lazy(() => import('./pages/PushOpenPage'))`, `/oauth/m365/callback` 라우트 다음에 `<Route path="/push-open" element={<PushOpenPage />} />`.

`AppLayout.tsx` — Task 4 의 `useEffect` 다음에 추가(`useNavigate` import, `openPushTarget`·`takePendingPushTarget` import, `useAuth()` 에서 `activeTenant, selectTenant` 추가 구조분해):
```tsx
  const navigate = useNavigate()
  // 로그인 전에 알림을 탭했다면 저장된 목적지로 1회 이동.
  useEffect(() => {
    const pending = takePendingPushTarget()
    if (pending) void openPushTarget(pending, { activeTenantId: activeTenant?.tenantId ?? null, selectTenant, navigate })
    // 최초 진입 1회만
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // 열린 창에서 알림을 탭하면 SW 가 보내는 이동 요청.
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    const onMessage = (e: MessageEvent) => {
      if (e.data?.type !== 'push-navigate') return
      void openPushTarget(
        { tenantId: typeof e.data.tenantId === 'number' ? e.data.tenantId : null, url: e.data.url },
        { activeTenantId: activeTenant?.tenantId ?? null, selectTenant, navigate },
      )
    }
    navigator.serviceWorker.addEventListener('message', onMessage)
    return () => navigator.serviceWorker.removeEventListener('message', onMessage)
  }, [activeTenant, selectTenant, navigate])
```

- [ ] **Step 4: 통과 확인**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e -- e2e/pages/pwa && npx tsc -p tsconfig.e2e.json --noEmit`
Expected: PASS(sw-push 첫 테스트는 위 주석 조건에 따라 fixme 가능).

- [ ] **Step 5: 전체 회귀**

Run: `pnpm build && pnpm test:e2e`
Expected: PASS.

- [ ] **Step 6: 커밋(승인 후)**

```bash
git add apps/workplace-web
git commit -m "feat(web): 서비스워커 푸시 수신과 알림 탭 이동 추가

- #868
- 푸시를 받으면 알림을 표시하고 이미 그 화면을 보고 있으면 알림 대신 창에 알린다
- 알림을 탭하면 열린 창을 이동시키거나 새 창을 열고 다른 워크스페이스 알림이면 전환한다
- 로그인 전에 탭한 알림은 로그인 후 원래 목적지로 이동한다"
```

---

### Task 6: 실기기 스모크 문서 (#869)

**Files:**
- Create: `docs/PWA_PUSH_LIVE_SMOKE.md`

- [ ] **Step 1: 기존 스모크 문서 형식 확인**

Run: `sed -n 1,40p docs/M365_CALENDAR_LIVE_SMOKE.md`
Expected: 제목·전제·절차·기록 표 형식 파악 — 같은 구조를 따른다.

- [ ] **Step 2: 문서 작성**

```markdown
# PWA · Web Push 실기기 스모크

자동화(E2E)로 검증할 수 없는 실제 푸시 서비스(Apple·Google·Mozilla) 경유 수신과 OS 알림 표시를 기기별로 확인한다.

## 전제

- HTTPS 로 접근 가능한 서버(스테이징 또는 운영). `workplace.push.enabled=true`.
- 서버에서 외부 푸시 서비스로 아웃바운드 연결 가능(`web.push.apple.com`, `fcm.googleapis.com`, `updates.push.services.mozilla.com`).
- 테스트 계정 2개(A: 수신자, B: 발신자), 두 계정이 같은 테넌트의 같은 채널 멤버. A 는 두 번째 테넌트에도 소속.

## 대상 환경

| 환경 | 설치 방법 |
|---|---|
| iPhone (iOS 16.4+) Safari | 공유 → 홈 화면에 추가 → 홈 화면 아이콘으로 실행 |
| iPad (iPadOS 16.4+) Safari | 위와 동일 |
| Android Chrome | 메뉴 → 앱 설치(또는 브라우저 그대로) |
| 데스크톱 Chrome / Edge | 주소창 설치 아이콘(또는 브라우저 그대로) |
| macOS Safari 16+ | 파일 → Dock 에 추가(또는 브라우저 그대로) |

## 절차 (환경마다 반복)

1. A 로 로그인 → 설정 > 알림 → "이 기기에서 푸시 받기" 켜기 → OS 권한 허용.
2. iOS 만: Safari 탭에서 설정 > 알림을 열면 설치 안내가 보이고 토글이 비활성인지 확인.
3. 앱(또는 탭)을 **완전히 종료**한다.
4. B 가 A 에게 DM 전송 → A 기기에 "B 이름 / 메시지 미리보기" 알림이 오는지.
5. B 가 채널에서 A 를 멘션 → "#채널 · B 이름" 알림이 오는지.
6. B 가 이슈를 A 에게 배정 → "KEY-N 제목 / B님이 회원님을 배정했습니다" 알림.
7. B 가 A 를 일정에 초대 → "일정 제목 / B님이 일정에 초대했습니다" 알림.
8. 같은 DM 에 연속 3건 → 알림 센터에 한 줄로 교체되며 다시 울리는지(tag).
9. 알림 탭 → 앱이 열리고 해당 DM/채널/이슈/캘린더 화면으로 이동하는지.
10. A 가 두 번째 테넌트를 보고 있는 상태에서 첫 테넌트 DM 알림 탭 → 첫 테넌트로 전환되어 DM 이 열리는지.
11. 앱을 열어 해당 DM 을 보고 있는 중 새 DM → (iOS/Safari 제외) 알림이 뜨지 않고 화면에만 표시되는지.
12. 설정 > 알림 에서 "캘린더" 끄기 → 일정 초대 알림이 오지 않는지.
13. 로그아웃 → B 가 DM 전송 → 알림이 오지 않는지.
14. 새 버전 배포 후 앱 재진입 → "새 버전이 있습니다" 토스트 → 새로고침 시 반영되는지.

## 기록

| 날짜 | 환경(기기·OS·브라우저) | 실패 단계 | 비고 |
|---|---|---|---|
|  |  |  |  |

## 알려진 제약

- iOS/iPadOS 는 홈 화면에 설치한 앱에서만 푸시 수신. 알림 액션 버튼 없음.
- Android 는 배터리 최적화로 지연될 수 있음(수 초~수 분).
- 폐쇄망(`workplace.push.enabled=false`)이면 설정 화면에 "푸시 알림을 사용할 수 없습니다" 가 보이는 것이 정상.
```

- [ ] **Step 3: 커밋(승인 후)**

```bash
git add docs/PWA_PUSH_LIVE_SMOKE.md
git commit -m "docs(repo): PWA 푸시 실기기 스모크 체크리스트 추가

- #869
- 자동화로 검증할 수 없는 실제 푸시 서비스 경유 수신과 알림 탭 이동을 기기별로 확인하는 절차를 정리한다"
```

---

## Self-Review 결과

- **Spec 커버리지:** §6.1 manifest·SW·캐시·업데이트·nginx(Task 1), §6.2 구독 수명주기(Task 3·4), §6.3 설정 화면·배너(Task 4), §6.4 push 수신·억제(Task 2·5), §6.5 탭 이동·테넌트 전환·/push-open(Task 5), §7 url 검증(Task 2·5), §8 E2E·실기기(각 Task·Task 6). 업데이트 토스트의 실제 새 버전 감지는 E2E 로 재현하기 어려워 실기기 스모크 14번으로 검증.
- **타입 일관성:** `PushPayload`, `safeTarget`, `enablePush(vapidPublicKey, permission)`, `selectTenant(membership, redirectTo?)`, `openPushTarget(target, deps)`, `pendingPushTarget` 키를 모든 Task 에서 동일하게 사용.
- **착수 시 재확인 항목:** vite-plugin-pwa 의 vite 7 peer 지원 버전, `CardDescription` 존재, 인박스 벨 버튼 접근성 이름, headless Chromium `getNotifications()` 동작, `__WB_MANIFEST` 주입 지점 인식.
