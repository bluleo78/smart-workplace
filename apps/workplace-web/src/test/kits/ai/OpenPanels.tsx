// 패널 열기 탐침(WP-1507, 테스트 전용) — 설정 화면 AI 참고 요약은 AI 패널이나 도움말 패널이 열려 있을 때만 도움말 묶음을 받는다(useManualSummary).
// 화면 테스트가 패널 UI 를 띄우지 않고 그 「열림」 상태만 만들도록, 마운트할 때 공급자의 열기 함수를 한 번 부른다.
import { useEffect } from 'react'

import { useAssistant } from '@/components/ai/AIAssistantContext'
import { useHelpPanel } from '@/components/help/HelpPanelContext'

/** 마운트하면 AI 옆 패널을 연다 — AIAssistantProvider 안에 둔다. */
export function OpenAiPanel() {
  const { open } = useAssistant()
  useEffect(() => {
    open('side')
  }, [open])
  return null
}

/** 마운트하면 도움말 패널을 연다 — HelpPanelProvider 안에 둔다. */
export function OpenHelpPanel() {
  const { setOpen } = useHelpPanel()
  useEffect(() => {
    setOpen(true)
  }, [setOpen])
  return null
}
