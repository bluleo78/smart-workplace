// 모바일 사이드바 시트(☰) 여는 버튼 — PageHeader 와 상세형 헤더(연락처 그룹 보기 등)가 같이 쓴다.
// MobileSidebarSheet 가 시트를 닫을 때 [data-mobile-sidebar-trigger] 로 초점을 돌려주므로, 표식·모양을 한곳에서 지킨다.
import { Menu } from 'lucide-react'

import { useMobileSidebarSheet } from './MobileSidebarSheetContext'

/** 시트 모드가 아니면(데스크톱 포함) 그리지 않는다. */
export function MobileSidebarSheetTrigger() {
  const sheet = useMobileSidebarSheet()
  if (!sheet) return null
  return (
    <button type="button" data-mobile-sidebar-trigger data-testid="mobile-sidebar-trigger" aria-label="목록 열기" onClick={sheet.openSheet}
      className="flex h-11 w-11 shrink-0 items-center justify-center text-muted-foreground">
      <Menu className="h-5 w-5" />
    </button>
  )
}
