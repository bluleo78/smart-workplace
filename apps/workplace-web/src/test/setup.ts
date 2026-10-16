// 컴포넌트 테스트(dom 프로젝트, *.test.tsx) 공통 셋업 — vitest.config.ts 의 dom 프로젝트만 불러온다.
// jest-dom 매처(toBeInTheDocument 등)를 expect 에 붙이고, jsdom 에 없는 브라우저 API 를 최소한으로 보강한다.
// 렌더 트리 정리(cleanup)는 RTL 이 전역 afterEach(vitest globals: true)에 스스로 건다.
import '@testing-library/jest-dom/vitest'

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
