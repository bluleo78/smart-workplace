// 컴포넌트 테스트(dom 프로젝트, *.test.tsx) 공통 셋업 — vitest.config.ts 의 dom 프로젝트만 불러온다.
// jest-dom 매처(toBeInTheDocument 등)를 expect 에 붙이고, jsdom 에 없는 브라우저 API 를 최소한으로 보강한다.
// 렌더 트리 정리(cleanup)는 RTL 이 전역 afterEach(vitest globals: true)에 스스로 건다.
import '@testing-library/jest-dom/vitest'

import { afterAll, afterEach } from 'vitest'

import { server, unhandledRequests } from './msw/server'

// ResizeObserver — Radix Popper(Popover·DropdownMenu)·cmdk 가 마운트 시 생성한다. 크기 측정은 테스트 관심사가 아니라 빈 구현.
if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}

// scrollIntoView — cmdk 가 선택 항목을 보이게 하려 호출한다. jsdom 은 레이아웃이 없어 미구현.
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {}

// matchMedia — useIsMobile·테마·플랫폼 판정이 부른다. jsdom 은 미구현이라 늘 「맞지 않음」(데스크톱 폭)으로 둔다.
// 모바일 화면을 보는 테스트는 vi.spyOn(window, 'matchMedia') 로 바꾼다.
if (!window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent: () => false,
    }) as MediaQueryList
}

// IntersectionObserver — 무한 스크롤·지연 표시가 생성한다. 교차 여부는 레이아웃이라 페이지 테스트의 관심사가 아니다(E2E @layout).
if (!globalThis.IntersectionObserver) {
  globalThis.IntersectionObserver = class {
    readonly root = null
    readonly rootMargin = ''
    readonly thresholds = []
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return []
    }
  } as unknown as typeof IntersectionObserver
}

// MSW(WP-971) — 페이지 테스트가 API 를 네트워크 계층에서 모킹한다. 처리하지 못한 요청은 모아 두었다가
// 테스트 끝에 실패시킨다(E2E 의 「모킹 누락은 503」과 같은 원칙 — 누락이 조용히 지나가면 빈 화면을 정상으로 착각한다).
server.listen({
  onUnhandledRequest(request) {
    unhandledRequests.push(`${request.method} ${new URL(request.url).pathname}`)
  },
})
afterEach(() => {
  server.resetHandlers()
  window.localStorage.clear()
  const missed = unhandledRequests.splice(0)
  if (missed.length) throw new Error(`MSW 핸들러가 없는 요청: ${[...new Set(missed)].join(', ')}`)
})
afterAll(() => server.close())
