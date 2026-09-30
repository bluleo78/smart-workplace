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
  title: 'Gen:iA Works',
  body: '새 알림이 있습니다',
  url: '/',
  tag: null,
}

// 파싱 전에 origin 을 대조할 sentinel — 실제 서비스와 절대 충돌하지 않는 예약 TLD(.invalid) 사용.
const SENTINEL_ORIGIN = 'https://sentinel.invalid'

/**
 * 같은 origin 상대경로만 허용 — 그 외(외부·프로토콜 상대·스킴)는 홈으로(오픈 리다이렉트 방지).
 *
 * 문자열 접두사 검사만으로는 우회된다(WHATWG URL 파서가 TAB/LF/CR 을 제거하고 특수 스킴에서 `\` 를 `/` 로 취급해
 * `'/\t/evil.com'`·`'/\\evil.com'` 이 `//evil.com` 이 되고, `/..//evil.com`·`/%2e%2e//evil.com` 은 dot-segment 정규화로
 * pathname 이 `//evil.com` 이 된다). 그래서 입력별 특수 처리 대신 하나의 불변식으로 판단한다:
 * (1) `/` 로 시작하는 문자열만 받는다(스킴·외부 URL 차단), (2) sentinel origin 기준으로 실제 파싱해 origin 이 그대로여야 하고,
 * (3) 반환할 정규화 값(pathname+search+hash)을 다시 파싱해도 origin 이 그대로여야 한다 — 이 값은 shouldSuppress·notificationclick
 * 에서 다시 상대경로로 파싱되므로 "반환값이 재파싱돼도 안전한가"까지 확인한다. 위 우회는 모두 (2) 또는 (3)에서 걸린다.
 */
export function safeTarget(url: unknown): string {
  if (typeof url !== 'string' || !url.startsWith('/')) return '/'
  try {
    const u = new URL(url, SENTINEL_ORIGIN)
    if (u.origin !== SENTINEL_ORIGIN) return '/'
    const out = u.pathname + u.search + u.hash
    if (new URL(out, SENTINEL_ORIGIN).origin !== SENTINEL_ORIGIN) return '/'
    return out
  } catch {
    return '/'
  }
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
 *
 * DM·MENTION 만 억제 대상이다 — ISSUE/CALENDAR 는 절대 억제하지 않는다: 캘린더 url 은 `/calendar?eventId=N` 형태라 같은
 * `/calendar` 화면을 보고 있으면(다른 일정이라도) pathname 만으로는 오탐하고, 이슈 경로(`/projects/:key/issues/:number`)는
 * 테넌트가 달라도 key 가 겹칠 수 있어 pathname 일치가 실제 동일 화면을 보장하지 못한다. 그래서 비교도 pathname 뿐 아니라
 * search(쿼리 파라미터)까지 완전히 같아야 억제한다(예: 채널 메인 화면과 `?thread=` 스레드는 다른 화면으로 취급).
 */
export function shouldSuppress(p: PushPayload, clients: ClientView[], origin: string, alwaysShow: boolean): boolean {
  if (alwaysShow) return false
  if (p.category !== 'DM' && p.category !== 'MENTION') return false
  const target = new URL(p.url, origin)
  return clients.some((c) => {
    if (!c.visible) return false
    try {
      // client.url 파싱 실패 시 "일치하지 않음(표시)" 으로 취급 — 억제 판단이 예외로 죽어 알림
      // 자체가 안 뜨는 사고(iOS 무알림 규칙 위반)를 막는다.
      const u = new URL(c.url)
      return u.origin === target.origin && u.pathname === target.pathname && u.search === target.search
    } catch {
      return false
    }
  })
}

// notificationclick 이 postMessage 로 라우팅을 넘겨도 되는 "앱 라우트"가 아닌 경로 — 로그인/가입/공유링크/알림
// 진입점/OAuth 콜백은 AppLayout(라우터) 밖이라 push-navigate 메시지를 받아 처리할 화면이 없다.
const NON_APP_EXACT_PATHS = new Set(['/login', '/signup', '/push-open'])
const NON_APP_PATH_PREFIXES = ['/s/', '/oauth/']

/**
 * 창이 "앱 라우트"(AppLayout 안의 일반 화면)를 보고 있는지 — notificationclick 에서 postMessage 로 이동시킬 창을 고를 때 쓴다.
 * 같은 origin 이 아니거나 파싱 실패면 false(앱 라우트 아님)로 안전하게 처리한다.
 */
export function isAppRouteUrl(url: string, origin: string): boolean {
  try {
    const u = new URL(url)
    if (u.origin !== origin) return false
    if (NON_APP_EXACT_PATHS.has(u.pathname)) return false
    return !NON_APP_PATH_PREFIXES.some((prefix) => u.pathname.startsWith(prefix))
  } catch {
    return false
  }
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
