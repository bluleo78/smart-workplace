// 모바일 사이드바 시트 컨텍스트 — 컴포넌트 파일과 분리(react-refresh 규칙: 컴포넌트 파일은 컴포넌트만 export).
import { createContext, useContext } from 'react'

export const MobileSidebarSheetCtx = createContext<{ openSheet: () => void } | null>(null)

/** PageHeader 가 ☰ 트리거를 그릴지 판단. 시트 모드가 아니면 null. */
export function useMobileSidebarSheet() {
  return useContext(MobileSidebarSheetCtx)
}
