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
