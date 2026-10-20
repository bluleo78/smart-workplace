// 모바일 사이드바 시트 컨텍스트 — 컴포넌트 파일과 분리(react-refresh 규칙: 컴포넌트 파일은 컴포넌트만 export).
import { createContext, useContext, useRef } from 'react'

/**
 * openSheet: PageHeader 의 ☰ 트리거가 연다.
 * closeSheet: 메뉴가 닫힌 뒤 시트를 닫을 때 쓴다(useCloseSheetAfterMenu). 시트 안 버튼은 data-sheet-dismiss 로 닫는다(WP-578).
 */
export const MobileSidebarSheetCtx = createContext<{ openSheet: () => void; closeSheet: () => void } | null>(null)

/** PageHeader 가 ☰ 트리거를 그릴지 판단. 시트 모드가 아니면(데스크톱 포함) null. */
export function useMobileSidebarSheet() {
  return useContext(MobileSidebarSheetCtx)
}

/**
 * 시트 안 드롭다운 메뉴 항목이 시트를 닫아야 할 때 — 메뉴가 다 닫힌 뒤(onCloseAutoFocus) 시트를 닫는다.
 * 메뉴와 시트를 같은 틱에 닫으면 Radix 가 body 의 pointer-events 잠금을 풀지 못해 화면이 눌리지 않는다.
 * 초점 복귀도 막는다 — 돌아갈 메뉴 트리거가 닫히는 시트 안에 있다(WP-578). 시트 모드가 아니면 아무것도 하지 않는다.
 * 사용: 항목 onSelect/onClick 에서 closeAfterMenu(), DropdownMenuContent 에 onCloseAutoFocus 연결.
 */
export function useCloseSheetAfterMenu() {
  const sheet = useMobileSidebarSheet()
  const pending = useRef(false)
  return {
    closeAfterMenu: () => {
      pending.current = true
    },
    onCloseAutoFocus: (e: Event) => {
      const close = pending.current
      pending.current = false
      // 데스크톱(시트 없음)에선 메뉴 트리거로의 초점 복귀를 그대로 둔다.
      if (!close || !sheet) return
      e.preventDefault()
      sheet.closeSheet()
    },
  }
}
