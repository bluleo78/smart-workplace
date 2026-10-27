// AI 패널 표면(전체화면·옆 패널·모바일 시트)을 열 때 불러온다(WP-970).
// 세 표면은 닫혀 있으면 아무것도 그리지 않는데도, 정적 import 라 AIChatPanel → 첨부 뷰어·마크다운·CSV 미리보기까지
// 메인 번들에 실려 모든 화면의 첫 부팅이 이를 내려받고 해석했다. 여기서는 열린 모드일 때만 모듈을 불러와 그린다.
// 닫혀 있을 때도 본체가 하던 대화 목록 조회·「새 답변」 정리(useAssistantChat)는 그대로 돌려 동작을 바꾸지 않는다.
import { lazy, Suspense } from 'react'

import { useAssistant } from '@/components/ai/AIAssistantContext'
import { useAssistantChat } from '@/hooks/useAssistantChat'

const AIFullscreen = lazy(() => import('@/components/ai/AIFullscreen').then((m) => ({ default: m.AIFullscreen })))
const AISidePanel = lazy(() => import('@/components/ai/AISidePanel').then((m) => ({ default: m.AISidePanel })))
const MobileAiSheet = lazy(() => import('@/components/ai/MobileAiSheet').then((m) => ({ default: m.MobileAiSheet })))

/** 전체화면 AI — mode==='fullscreen' 일 때만 본체를 불러와 그린다. */
export function LazyAIFullscreen() {
  const { mode } = useAssistant()
  useAssistantChat()
  if (mode !== 'fullscreen') return null
  return (
    <Suspense fallback={null}>
      <AIFullscreen />
    </Suspense>
  )
}

/** 옆 AI 패널 — mode==='side' 일 때만 본체를 불러와 그린다. */
export function LazyAISidePanel() {
  const { mode } = useAssistant()
  useAssistantChat()
  if (mode !== 'side') return null
  return (
    <Suspense fallback={null}>
      <AISidePanel />
    </Suspense>
  )
}

/** 모바일 AI 시트 — 닫혀 있지 않을 때만 본체를 불러와 그린다. */
export function LazyMobileAiSheet() {
  const { mode } = useAssistant()
  if (mode === 'closed') return null
  // 불러오는 동안에도 AI 표면 표식을 둔다 — 열린 엔티티 다이얼로그는 시트가 열리는 순간 셸 안의 AI 표면이 아닌 형제를
  // inert 로 만드는데(inertPageArea), 표식이 없으면 셸 전체가 inert 가 되어 뒤이어 그려진 시트 입력창까지 막힌다.
  return (
    <Suspense fallback={<div data-ai-panel hidden />}>
      <MobileAiSheet />
    </Suspense>
  )
}
