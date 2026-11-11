// AI 옆 패널 폭 손잡이(WP-892) — AI 옆 패널(AISidePanel)과 도움말·AI 를 위아래로 합친 칸(RightDock, WP-1505)이 함께 쓴다.
// 두 칸 모두 폭은 AI 패널 폭(sidePanelWidth) 하나라 범위·미리보기·확정이 같다 — 다른 것은 끄는 동안 폭을 쓸 요소와 손잡이 이름뿐이다.
import type { RefObject } from 'react'

import { useAssistant } from '@/components/ai/AIAssistantContext'
import { SIDE_DEFAULT_WIDTH, SIDE_MAX_WIDTH, SIDE_MIN_WIDTH } from '@/components/ai/aiSidePanelWidth'
import { useResizeHandle } from '@/hooks/useResizeHandle'

/**
 * AI 패널 폭을 바꾸는 왼쪽 경계 손잡이 props.
 * 끄는 동안은 대상 요소 폭과 --ai-side-width(AI 칩·대화상자 위치)만 DOM 에 직접 쓴다 — 폭이 든 AI 컨텍스트를 매 프레임 바꾸면
 * 그 소비자(이슈 화면·레일·대화 목록)가 모두 다시 그려진다. 손을 떼면 한 번 상태를 바꾸고 기억한다.
 * @param targetRef 끄는 동안 폭을 직접 쓸 요소(오른쪽에 붙은 칸)
 * @param label 손잡이 접근성 이름
 */
export function useAiSideResizeHandle(targetRef: RefObject<HTMLElement | null>, label: string) {
  const { sidePanelWidth, resize } = useAssistant()
  return useResizeHandle({
    edge: 'left',
    width: sidePanelWidth,
    min: SIDE_MIN_WIDTH,
    max: SIDE_MAX_WIDTH,
    defaultWidth: SIDE_DEFAULT_WIDTH,
    onPreview: (w) => {
      if (targetRef.current) targetRef.current.style.width = `${w}px`
      document.documentElement.style.setProperty('--ai-side-width', `${w}px`)
    },
    onCommit: (w) => resize(w, true),
    label,
  })
}
