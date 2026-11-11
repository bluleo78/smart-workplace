// 모바일 탭 첫 화면 헤더의 도움말 버튼(WP-1505) — 검색 🔍 오른쪽, 알림 벨 왼쪽(검색 → 도움말 → 알림).
// 휴대폰은 화면이 좁아 도움말 시트와 AI 시트를 한 번에 하나만 둔다 — AI 가 열려 있으면 닫는 일은 도움말 시트(MobileHelpSheet ②)가
// 맡는다(`?` 단축키 등 다른 여는 길과 같은 순서: AI 를 닫고 그 히스토리 항목이 걷힌 뒤 도움말 항목을 넣는다). 단추는 열기만 한다.
// 데스크톱(lg 이상)은 상단 가운데 HelpTrigger 가 맡는다.
import { CircleHelp } from 'lucide-react'

import { useHelpPanel } from '@/components/help/HelpPanelContext'

export function MobileHelpButton() {
  const { setOpen } = useHelpPanel()
  return (
    <button
      type="button"
      aria-label="도움말"
      data-testid="mobile-help-button"
      // 도움말을 닫을 때 포커스를 돌려받는 자리(HelpPanel 의 HELP_TRIGGER_SELECTOR).
      data-help-trigger
      onClick={() => setOpen(true)}
      // 크기·색은 옆 검색 버튼·알림 벨과 맞춘다(44px 터치 영역).
      className="flex h-11 w-11 shrink-0 items-center justify-center text-muted-foreground"
    >
      <CircleHelp className="h-5 w-5" aria-hidden />
    </button>
  )
}
