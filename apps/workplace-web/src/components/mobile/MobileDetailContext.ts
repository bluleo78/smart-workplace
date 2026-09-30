// 모바일 상세 헤더 병합 컨텍스트(U1-1) — "헤더는 하나" 규칙.
// ResponsiveModuleLayout 의 상세 분기가 제공하고, 페이지 헤더(PageHeader 등)가 마운트 시 자신을 등록한다.
// 등록된 헤더가 하나라도 있으면 레이아웃은 자체 뒤로가기 바(MobileBackBar)를 그리지 않고,
// 페이지 헤더가 ‹·✦ 를 품은 병합 헤더로 그려진다. 헤더가 없는 페이지는 기존 뒤로가기 바를 그대로 쓴다.
// (컴포넌트 파일과 분리 — react-refresh 규칙: 컴포넌트 파일은 컴포넌트만 export.)
import { createContext, useContext, useLayoutEffect } from 'react'

export interface MobileDetailValue {
  /** 모듈 제목(뒤로가기 바 제목) — 페이지 헤더에 제목이 없을 때의 대체 제목. */
  title: string
  /** 헤더 등록 — 반환 함수로 해제. 카운트 방식이라 StrictMode 이중 마운트·중첩 헤더에도 균형이 맞는다. */
  register: () => () => void
}

export const MobileDetailCtx = createContext<MobileDetailValue | null>(null)

/**
 * 모바일 상세 화면이면 헤더를 등록하고 컨텍스트를 돌려준다(병합 모드). 아니면 null.
 * useLayoutEffect — 페인트 전에 뒤로가기 바를 숨겨 한 프레임 두 줄 헤더가 깜빡이지 않게 한다.
 */
export function useMobileDetailHeader(isMobile: boolean): MobileDetailValue | null {
  const ctx = useContext(MobileDetailCtx)
  const register = ctx?.register
  useLayoutEffect(() => {
    if (!isMobile || !register) return
    return register()
  }, [isMobile, register])
  return isMobile ? ctx : null
}
