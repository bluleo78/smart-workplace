// 모바일 상세 화면 ✦(AI) 버튼 — 탭바가 숨은 화면에서 AI 진입점을 제공한다(규칙: 탭바가 없으면 뒤로가기 + ✦).
// MobileBackBar(모듈 상세)와 메일·연락처 본문의 목록 복귀 바가 같은 모양·동작을 공유한다.
// AI 미사용 워크스페이스면 렌더하지 않는다. 페이지가 등록한 화면 컨텍스트를 가진 채 풀스크린을 연다.
import { Sparkles } from 'lucide-react'

import { useAssistant } from '@/components/ai/AIAssistantContext'
import { useAiAvailable } from '@/hooks/useAiAvailable'

export function DetailAiButton({ 'data-testid': testId }: { 'data-testid': string }) {
  const { open } = useAssistant()
  const aiAvailable = useAiAvailable()
  if (!aiAvailable) return null
  return (
    <button
      type="button"
      data-testid={testId}
      aria-label="이 화면에 대해 AI 에게 묻기"
      onClick={() => open('fullscreen')}
      className="flex h-11 w-11 shrink-0 items-center justify-center text-violet-600"
    >
      <Sparkles className="h-5 w-5" />
    </button>
  )
}
