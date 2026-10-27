// 컴포넌트 테스트(dom 프로젝트, *.test.tsx) 공통 셋업 — vitest.config.ts 의 dom 프로젝트만 불러온다.
// jest-dom 매처(toBeInTheDocument 등)를 expect 에 붙이고, jsdom 에 없는 브라우저 API 를 최소한으로 보강한다.
// 렌더 트리 정리(cleanup)는 RTL 이 전역 afterEach(vitest globals: true)에 스스로 건다.
import '@testing-library/jest-dom/vitest'

import { cleanup, configure, getConfig } from '@testing-library/react'
import * as React from 'react'
import { afterAll, afterEach, beforeEach } from 'vitest'

import { settleHistory } from './history'
import { memoryStorage } from './memoryStorage'
import { server, unhandledRequests } from './msw/server'

// findBy*·waitFor 기본 대기 1초는 전체 실행(파일 수백 개가 코어를 나눠 씀)에서 화면 테스트가 첫 렌더·MSW 응답을 받기에 빠듯해,
// 혼자 돌리면 통과하는 테스트가 전체 실행에서만 가끔 실패했다(WP-966). 통과하는 테스트는 기다린 만큼만 쓰므로 느려지지 않는다.
configure({ asyncUtilTimeout: 5_000 })

// React 19 개발 빌드는 JSX 요소를 만들 때마다 owner stack 용으로 Error 를 만들어 호출 스택을 잡는다(1초에 1만 개까지, 렌더마다 초기화).
// 화면 테스트에서는 이것이 CPU 의 1할 남짓을 먹었다(issueListColumns 프로파일: jsx·jsxDEV 자체 시간 7.8초/65초, WP-1002).
// owner stack 은 React 경고 메시지의 컴포넌트 스택에만 쓰여 테스트 판정과 무관하므로, 계수기를 상한에 묶어 늘 생략하게 한다.
const reactInternals = (React as unknown as Record<string, Record<string, unknown> | undefined>)
  .__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE
if (reactInternals && 'recentlyCreatedOwnerStacks' in reactInternals) {
  Object.defineProperty(reactInternals, 'recentlyCreatedOwnerStacks', { get: () => Number.MAX_SAFE_INTEGER, set: () => {}, configurable: true })
}

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
// Element.scrollTo — 모바일 탭바·보드·일정이 탭을 다시 누르면 맨 위로 올린다. 스크롤 위치는 레이아웃이라 관심사가 아니다(E2E @layout).
if (!Element.prototype.scrollTo) Element.prototype.scrollTo = () => {}

// 포인터 캡처 — Radix Select·크기 조절 손잡이·AI 시트 끌기가 pointerdown 에 부른다. jsdom 미구현이라 없으면 열리다 던진다.
// 테스트 파일마다 따로 넣던 보강을 여기로 모았다(WP-995).
Element.prototype.hasPointerCapture ??= () => false
Element.prototype.setPointerCapture ??= () => {}
Element.prototype.releasePointerCapture ??= () => {}

// objectURL — 인증 이미지·첨부 미리보기·다운로드가 blob 을 objectURL 로 바꾼다. jsdom 엔 없어 가짜 URL 을 준다(픽셀 렌더는 관심사가 아니다).
// 값을 단언하는 테스트는 vi.spyOn(URL, 'createObjectURL') 로 바꾼다 — 여기서 메서드가 생겨 spyOn 이 가능해진다.
// 캔버스(getContext)는 보강하지 않는다 — useThemeColor·imageDownscale 이 null 컨텍스트를 「캔버스 없음」으로 다루므로,
// 전역으로 넣으면 그 분기가 바뀐다. 간트처럼 캔버스가 필요한 화면은 test/kits/projects/timeline.ts 의 stubCanvas 를 쓴다.
URL.createObjectURL ??= () => 'blob:fake'
URL.revokeObjectURL ??= () => {}

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

// localStorage·sessionStorage — Node 25+ 의 실험적 전역 Web Storage 가 jsdom 것을 가리고, --localstorage-file 없이는
// 메서드가 없는 빈 객체라 clear()·getItem() 이 터진다. 실행하는 Node 버전과 무관하게 같은 결과가 나오도록 인메모리로 세운다.
for (const name of ['localStorage', 'sessionStorage'] as const) {
  if (typeof globalThis[name]?.clear !== 'function') {
    Object.defineProperty(globalThis, name, { value: memoryStorage(), configurable: true, writable: true })
  }
}

// MSW(WP-971) — 페이지 테스트가 API 를 네트워크 계층에서 모킹한다. 처리하지 못한 요청은 모아 두었다가
// 테스트 끝에 실패시킨다(E2E 의 「모킹 누락은 503」과 같은 원칙 — 누락이 조용히 지나가면 빈 화면을 정상으로 착각한다).
server.listen({
  onUnhandledRequest(request) {
    unhandledRequests.push(`${request.method} ${new URL(request.url).pathname}`)
  },
})
// 테스트가 가짜 타이머를 켠 채 끝나도 아래 정리가 멈추지 않게 진짜 setTimeout 을 잡아 둔다.
const realSetTimeout = globalThis.setTimeout
// renderPage 가 늘린 비동기 대기(WP-1006)를 테스트마다 RTL 기본값으로 되돌린다 — 같은 워커의 다음 컴포넌트 테스트에 새지 않게.
const DEFAULT_ASYNC_TIMEOUT = getConfig().asyncUtilTimeout
afterEach(async () => {
  configure({ asyncUtilTimeout: DEFAULT_ASYNC_TIMEOUT })
  // 화면을 핸들러 초기화보다 먼저 내린다 — RTL 의 자동 cleanup 은 이 afterEach 뒤에 돌아, 그 사이 아직 떠 있는 화면이 보낸
  // 조회(SSE·대화·공간 목록)와 내려가며 보내는 요청(임시저장·취소)이 이미 비운 핸들러에 걸려, 부하가 큰 전체 실행에서
  // 다음 테스트를 「핸들러 없는 요청」으로 실패시켰다(WP-1002). 내린 뒤 한 틱 기다려 그 요청이 이 테스트의 핸들러로 처리되게 한다.
  cleanup()
  await new Promise((resolve) => realSetTimeout(resolve, 0))
  server.resetHandlers()
  window.localStorage.clear()
  const missed = unhandledRequests.splice(0)
  if (missed.length) throw new Error(`MSW 핸들러가 없는 요청: ${[...new Set(missed)].join(', ')}`)
})
// 앞 테스트가 끝난 뒤에야 도착한 요청은 어느 테스트 것인지 가릴 수 없어, 다음 테스트의 실패로 돌리지 않고 버린다.
beforeEach(() => {
  unhandledRequests.length = 0
})
afterAll(() => server.close())

// 페이지 테스트는 jsdom 의 실제 세션 히스토리를 쓴다(renderPage, WP-995). 앞 테스트의 화면이 내려가며(RTL cleanup) 시트·상세가
// history.back() 으로 자기 항목을 닫는데, jsdom 은 이 이동을 타이머 몇 개(이동 예약 → 문서 갱신 → popstate)에 걸쳐 끝낸다 —
// 그대로 두면 다음 테스트가 주소를 정한 뒤 popstate 가 도착해 앞 테스트의 주소로 되돌렸다. 위 afterEach 가 화면을 내린 뒤에도
// 이동은 타이머 몇 개 뒤에 끝나므로, 테스트 시작 전에 밀린 이동을 끝낸다.
beforeEach(settleHistory)
