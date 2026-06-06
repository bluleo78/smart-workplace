import { CalendarDays, Plus } from 'lucide-react'

import { sidebarTitleClass } from '@/components/layout/sidebar-link'
import { Button } from '@/components/ui/button'

/** 캘린더 2차 사이드바 — 앱 타이틀 + 새 일정 버튼. */
export function CalendarSidebar({ onNew }: { onNew: () => void }) {
  return (
    <aside className="flex w-56 shrink-0 flex-col border-r bg-sidebar/40">
      <div className={sidebarTitleClass}>
        <CalendarDays className="h-[18px] w-[18px] shrink-0 text-muted-foreground" />
        캘린더
      </div>
      <div className="p-3">
        <Button data-testid="calendar-new-event" className="w-full gap-1" onClick={onNew}>
          <Plus className="h-4 w-4" /> 새 일정
        </Button>
      </div>
    </aside>
  )
}
