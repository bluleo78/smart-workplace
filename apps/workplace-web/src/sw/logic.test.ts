// src/sw/logic.test.ts
// 서비스워커 순수 판단 로직(src/sw/logic.ts) 단위 테스트. SW 전역 없이 vitest(node 환경)로 검증한다.
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
    expect(safeTarget('/chat/dms/1?thread=2')).toBe('/chat/dms/1?thread=2')
  })
  it('외부·프로토콜 상대·비문자열은 /', () => {
    expect(safeTarget('https://evil.com')).toBe('/')
    expect(safeTarget('//evil.com')).toBe('/')
    expect(safeTarget('/\\evil.com')).toBe('/')
    expect(safeTarget('javascript:alert(1)')).toBe('/')
    expect(safeTarget(null)).toBe('/')
  })
  it('TAB/LF/CR 로 origin 이 뒤바뀌는 우회는 /', () => {
    // WHATWG URL 파서가 TAB/LF/CR 을 파싱 전에 제거해 '//evil.com'(스킴 상대)이 되는 우회 (review round 1).
    expect(safeTarget('/\t/evil.com')).toBe('/')
    expect(safeTarget('/\n/evil.com')).toBe('/')
    expect(safeTarget('/\r/evil.com')).toBe('/')
    expect(safeTarget('\t//evil.com')).toBe('/')
  })
  it('percent-encoded 백슬래시는 안전한 리터럴 경로 문자로 같은 origin 유지', () => {
    expect(safeTarget('/%5Cevil.com')).toBe('/%5Cevil.com')
  })
  it('dot-segment 정규화가 //evil.com(스킴 상대)로 접히는 우회는 /', () => {
    // '..'/'%2e%2e' 가 파서에서 접혀 pathname 이 '//evil.com' 이 되면 origin 은 sentinel 그대로라
    // (3) origin 재검증만으로는 못 잡는다 — 정규화된 pathname 자체를 다시 검사해야 한다 (review round 2).
    expect(safeTarget('/..//evil.com')).toBe('/')
    expect(safeTarget('/.//evil.com')).toBe('/')
    expect(safeTarget('/a/../..//evil.com')).toBe('/')
    expect(safeTarget('/%2e%2e//evil.com')).toBe('/')
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
  it('client.url 파싱 실패는 일치하지 않음(표시)으로 처리', () => {
    // new URL(c.url) 이 던져도 억제 판단 전체가 죽지 않고 "표시" 로 안전하게 fallback (review round 1).
    expect(shouldSuppress(payload, [{ url: 'not-a-url', visible: true }], ORIGIN, false)).toBe(false)
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
