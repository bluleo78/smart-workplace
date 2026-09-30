// content-sheet 모드(메일·캘린더·연락처) — 모바일에선 사이드바를 인라인 대신 바텀시트로 띄운다.
// 본문(PageHeader)이 컨텍스트로 ☰ 트리거를 그려야 하므로 사이드바와 본문을 함께 감싼다.
// 데스크톱은 기존 가로 배치(sidebar + children) 그대로(DOM 불변).
import { type ReactNode, useMemo, useState } from 'react'

import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { useIsMobile } from '@/hooks/useIsMobile'

import { MobileSidebarSheetCtx } from './MobileSidebarSheetContext'
import { mobileSidebarListClass } from './sidebarListClass'

export function MobileSidebarSheet({ title, sidebar, children }: { title: string; sidebar: ReactNode; children: ReactNode }) {
  const isMobile = useIsMobile()
  const [open, setOpen] = useState(false)
  const value = useMemo(() => ({ openSheet: () => setOpen(true) }), [])
  if (!isMobile) return <>{sidebar}{children}</>
  return (
    <MobileSidebarSheetCtx.Provider value={value}>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="bottom"
          data-testid="mobile-sidebar-sheet"
          className="max-h-[85dvh] rounded-t-2xl p-0 pb-[env(safe-area-inset-bottom)]"
          // 시트 안 링크를 누르면 닫는다(이동 후 시트가 남지 않게).
          onClick={(e) => {
            if ((e.target as HTMLElement).closest('a')) setOpen(false)
          }}
        >
          <div className="mx-auto mt-2 h-1 w-9 rounded-full bg-muted-foreground/30" />
          <SheetTitle className="px-4 pt-2 text-base">{title}</SheetTitle>
          <div className={mobileSidebarListClass}>{sidebar}</div>
        </SheetContent>
      </Sheet>
      {children}
    </MobileSidebarSheetCtx.Provider>
  )
}
