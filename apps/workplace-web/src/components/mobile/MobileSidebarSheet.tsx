// content-sheet 모드(메일·캘린더·연락처) — 모바일에선 사이드바를 인라인 대신 바텀시트로 띄운다.
// 본문(PageHeader)이 컨텍스트로 ☰ 트리거를 그려야 하므로 사이드바와 본문을 함께 감싼다.
// 데스크톱은 기존 가로 배치(sidebar + children) 그대로(DOM 불변).
import { type ReactNode, useMemo, useState } from 'react'

import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import { useIsMobile } from '@/hooks/useIsMobile'

import { MobileSidebarSheetCtx } from './MobileSidebarSheetContext'
import { mobileSidebarListClass } from './sidebarListClass'

export function MobileSidebarSheet({ title, sidebar, children }: { title: string; sidebar: ReactNode; children: ReactNode }) {
  const isMobile = useIsMobile()
  const [open, setOpen] = useState(false)
  const value = useMemo(() => ({ openSheet: () => setOpen(true), closeSheet: () => setOpen(false) }), [])
  if (!isMobile) return <>{sidebar}{children}</>
  return (
    <MobileSidebarSheetCtx.Provider value={value}>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="bottom"
          data-testid="mobile-sidebar-sheet"
          className="max-h-[85dvh] rounded-t-2xl p-0 pb-[env(safe-area-inset-bottom)]"
          // 시트 안 링크, 또는 data-sheet-dismiss 를 단 버튼을 누르면 닫는다 — 이동하거나 시트 밖 화면(다이얼로그·작성창)을
          // 연 뒤 시트가 남아 그 화면을 덮지 않게(WP-578). 버튼의 onClick 이 먼저 돌고 여기로 올라온다.
          // 드롭다운 메뉴 항목은 메뉴가 다 닫힌 뒤 닫아야 하므로 이 규칙 대신 useCloseSheetAfterMenu 를 쓴다.
          onClick={(e) => {
            if ((e.target as HTMLElement).closest('a,[data-sheet-dismiss]')) setOpen(false)
          }}
          // 닫힐 때 초점이 빠졌으면(이동으로 원래 요소가 사라짐 등) ☰ 로 돌려준다 — ☰ 는 Radix SheetTrigger 가 아니라 자동 복귀가 없다.
          // 작성창·다이얼로그가 초점을 가졌으면 그대로 둔다.
          onCloseAutoFocus={(e) => {
            e.preventDefault()
            const active = document.activeElement
            if (!active || active === document.body || !active.isConnected) {
              document.querySelector<HTMLElement>('[data-mobile-sidebar-trigger]')?.focus()
            }
          }}
        >
          <div className="mx-auto mt-2 h-1 w-9 rounded-full bg-muted-foreground/30" />
          <SheetTitle className="px-4 pt-2 text-base">{title}</SheetTitle>
          {/* Radix Dialog 접근성 경고(Description 누락) 해소 — 시각적으로는 숨긴 스크린리더용 설명. */}
          <SheetDescription className="sr-only">{title} 목록에서 이동할 항목을 고르세요.</SheetDescription>
          <div className={mobileSidebarListClass}>{sidebar}</div>
        </SheetContent>
      </Sheet>
      {children}
    </MobileSidebarSheetCtx.Provider>
  )
}
