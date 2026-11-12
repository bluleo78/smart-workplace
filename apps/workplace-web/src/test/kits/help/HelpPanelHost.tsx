// 도움말 패널 받침(WP-1507, 테스트 전용) — 앱의 오른쪽 도킹(RightDock)·휴대폰 시트 대신, 열렸을 때만 패널 내용을 그린다.
// 패널 테스트·「연결 방법」처럼 화면이 패널을 여는 테스트가 같은 받침을 쓰게 한곳에 둔다. HelpPanelProvider 안에 둔다.
import { HelpPanel } from '@/components/help/HelpPanel'
import { useHelpPanel } from '@/components/help/HelpPanelContext'

/** 열림이면 HelpPanel 을 그린다. openButton 이면 패널을 여는 「열기」 단추를 앞에 둔다. */
export function HelpPanelHost({ openButton = false }: { openButton?: boolean }) {
  const help = useHelpPanel()
  return (
    <div>
      {openButton && <button onClick={() => help.setOpen(true)}>열기</button>}
      {help.open && <HelpPanel />}
    </div>
  )
}
