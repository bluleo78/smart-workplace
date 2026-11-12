// AI 답의 굵은 글자(화면 문구) — 지금 화면에 같은 이름의 단추가 있으면 링크 모양이 되어 누르면 그 단추로 안내한다(WP-1511).
// 도움말 본문의 HighlightStrong 과 같은 규칙(helpScreenControls)이되, AI 패널 안의 같은 이름 단추는 맞추지 않는다 — 답이 자기 패널을 가리키면 뜻이 없다.
import { type ReactNode, useContext, useEffect, useState } from 'react'

import { type ControlScanOptions, findScreenControls, normalizeControlText, screenControlNames } from '@/components/help/helpScreenControls'
import { nodeText } from '@/components/help/nodeText'
import { useScreenHighlight } from '@/components/help/useScreenHighlight'
import { cn } from '@/lib/utils'

import { HelpAnswerContext } from './helpAnswerContext'

/** AI 답의 화면 문구는 AI 패널 안 같은 이름 단추(「새 대화」 등)를 화면 단추로 맞추지 않는다 — 답이 자기 패널을 가리키면 뜻이 없다. 안정된 참조(훅 의존성). */
const AI_ANSWER_SCAN: ControlScanOptions = { excludeAiSurface: true }

// 링크 모양(점선 밑줄) 첫 판정 — 굵은 글자마다 마운트 때 문서를 훑으면 답이 길거나 스트리밍 중일 때 훑기가 글자 수만큼 늘어난다.
// 그렇다고 호버 때만 판정하면 점선 밑줄 단서가 호버 전에는 없어 「누를 수 있는 화면 문구」임을 알 수 없다.
// 그래서 마운트한 굵은 글자들을 한 큐에 모았다가 한가한 때(requestIdleCallback, 없으면 짧은 타이머) 문서를 한 번만 훑어(screenControlNames)
// 모두 같이 판정한다 — 단서는 곧 나타나고, 훑기는 답 한 번당 한 번이다. 호버·포커스 때는 기존처럼 다시 찾아 정확히 고친다.
const pending = new Set<{ text: string; set: (m: boolean) => void }>()
let scheduled: number | ReturnType<typeof setTimeout> | null = null

/** 모인 굵은 글자들을 한 번의 훑기로 판정한다. */
function flushPending(): void {
  scheduled = null
  const batch = [...pending]
  pending.clear()
  if (batch.length === 0) return
  const names = screenControlNames(AI_ANSWER_SCAN)
  for (const item of batch) item.set(names.has(normalizeControlText(item.text)))
}

/** text 의 첫 판정을 큐에 넣는다. 돌려주는 함수는 취소(언마운트·글자 바뀜) — 큐에서 뺀다. */
function queueMatch(text: string, set: (m: boolean) => void): () => void {
  const item = { text, set }
  pending.add(item)
  if (scheduled === null) {
    scheduled =
      typeof window.requestIdleCallback === 'function'
        ? window.requestIdleCallback(flushPending, { timeout: 500 })
        : setTimeout(flushPending, 30)
  }
  return () => {
    pending.delete(item)
  }
}

/**
 * 굵은 글자 한 조각. 마운트 뒤 한가한 때(일괄)·호버·포커스 때 화면 단추를 찾아 링크 모양 여부를 정한다(화면은 언제든 바뀌므로).
 * 맞는 단추가 있을 때만 role="button"·점선 밑줄·호버 강조를 쓰고, 없으면 평범한 굵은 글자다.
 */
export function ScreenPhrase({ children }: { children?: ReactNode }) {
  const actions = useContext(HelpAnswerContext)?.actions
  const text = nodeText(children)
  const [matched, setMatched] = useState(false)
  const { enter: highlight, stop } = useScreenHighlight(text, AI_ANSWER_SCAN)
  // 마운트 뒤 첫 판정 — 화면 단추는 렌더 밖(DOM) 사실이라 effect 에서 읽어 상태로 옮기되, 위 큐로 모아 한 번에 훑는다.
  useEffect(() => queueMatch(text, setMatched), [text])

  if (!actions) return <strong className="font-semibold">{children}</strong>

  // 이 글자와 같은 이름의 화면 단추가 있는지 다시 본다(AI 패널 안 단추는 AI_ANSWER_SCAN 이 뺀다).
  const refresh = () => setMatched(findScreenControls(text, AI_ANSWER_SCAN).length > 0)
  const enter = () => setMatched(highlight().length > 0)
  return (
    <strong
      role={matched ? 'button' : undefined}
      tabIndex={matched ? 0 : undefined}
      className={cn(
        'font-semibold',
        matched && 'cursor-pointer underline decoration-dotted underline-offset-2 hover:text-primary focus-visible:text-primary',
      )}
      onMouseEnter={enter}
      onMouseLeave={stop}
      onFocus={refresh}
      onClick={matched ? () => actions.focusScreenControl(text) : undefined}
      onKeyDown={
        matched
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                actions.focusScreenControl(text)
              }
            }
          : undefined
      }
    >
      {children}
    </strong>
  )
}
