// 상단 가운데 도움말 단추(WP-1505) — 검색 🔍 오른쪽의 32px 「?」. 누를 때마다 오른쪽 도움말 패널을 여닫는다(키보드 `?` 와 같은 동작).
// 크기·간격은 TopCenterSlot 의 150px 계산(칩 반폭 70 + 8 + 검색 32 + 8 + 이 단추 32)과 맞물리므로 바꾸면 그쪽도 고친다.
import { CircleHelp } from 'lucide-react'

import { TOP_CENTER_ROUND_BUTTON } from '@/components/layout/topCenterButton'
import { cn } from '@/lib/utils'

import { useHelpPanel } from './HelpPanelContext'
import { preloadHelpPanel } from './helpPanelLoader'

export function HelpTrigger() {
  const { open, toggle } = useHelpPanel()
  return (
    <button
      type="button"
      data-testid="help-toggle"
      // 패널을 닫을 때 포커스를 돌려받는 자리(HelpPanel 의 HELP_TRIGGER_SELECTOR).
      data-help-trigger
      aria-label="도움말 (?)"
      title="도움말 (?)"
      // 토글 단추라 열림을 aria-pressed 로 알린다 — 패널이 화면 오른쪽 멀리 열려도 스크린 리더가 상태를 안다.
      aria-pressed={open}
      onClick={toggle}
      // 누르기 전에 패널 본체 모듈을 미리 받는다(LazyHelpPanel) — 여는 순간의 스켈레톤을 짧게.
      onPointerEnter={() => void preloadHelpPanel()}
      onFocus={() => void preloadHelpPanel()}
      // 옆 검색 트리거(SearchTrigger)와 같은 모양 — 상단 가운데 두 동그라미가 한 묶음으로 보이게.
      // 열려 있으면(눌림) 선택 배경·강조 글자로 hover 와 구분한다(시안 mockup-help-panel.jpg 의 눌린 「?」).
      className={cn(TOP_CENTER_ROUND_BUTTON, 'aria-pressed:border-primary/30 aria-pressed:bg-selected aria-pressed:text-primary')}
    >
      <CircleHelp className="h-4 w-4" aria-hidden />
    </button>
  )
}
