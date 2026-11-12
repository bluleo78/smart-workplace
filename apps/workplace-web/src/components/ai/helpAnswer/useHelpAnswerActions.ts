// AI 답 표식(출처 링크·굵은 화면 문구·창 열기 단추)을 눌렀을 때의 동작(WP-1511).
// 모든 동작은 사용자가 렌더된 표식을 누른 직후에만 불린다 — AI 가 화면을 대신 누르지 않는다.
// 안전 규칙: 도움말은 목차에 있는(보이는 장의) 절만, 창은 화면이 등록한 허용 id 만, 화면 문구는 포커스·스크롤만 한다.
import { useMemo } from 'react'

import { useAssistant } from '@/components/ai/AIAssistantContext'
import { useAiDialogTargetLookup } from '@/components/ai/dialogTargets/AiDialogTargets'
import { useHelpIndex } from '@/components/help/helpBundle'
import { findSection, isChapterVisible } from '@/components/help/helpNav'
import { useHelpPanelActions } from '@/components/help/HelpPanelContext'
import { findScreenControls, highlightScreenControls } from '@/components/help/helpScreenControls'
import { useAuth } from '@/hooks/useAuth'

import type { HelpAnswerActions } from './helpAnswerContext'

/** 화면 문구로 찾아 간 단추를 강조해 두는 시간(ms). */
const HIGHLIGHT_MS = 1500

/** 직전 강조를 떼는 함수 — 연달아 눌렀을 때 앞 강조가 남지 않게 하나만 둔다. */
let clearHighlight: (() => void) | null = null

/** els 를 HIGHLIGHT_MS 동안 강조한다(앞선 강조는 먼저 뗀다). */
function flash(els: HTMLElement[]): void {
  clearHighlight?.()
  const off = highlightScreenControls(els)
  const timer = window.setTimeout(() => {
    off()
    if (clearHighlight === cleanup) clearHighlight = null
  }, HIGHLIGHT_MS)
  const cleanup = () => {
    window.clearTimeout(timer)
    off()
  }
  clearHighlight = cleanup
}

/**
 * AI 패널이 답 말풍선들에 한 번 만들어 넘기는 표식 동작.
 * AI 전체 화면(휴대폰 시트·데스크톱 전체 화면)이 이동 대상 화면을 가리므로 모두 closeThen 으로 AI 를 걷어 낸 뒤 한다
 * (옆 패널이면 AI 는 그대로 두고 바로 한다).
 */
export function useHelpAnswerActions(): HelpAnswerActions {
  const { closeThen } = useAssistant()
  const helpPanel = useHelpPanelActions()
  // 목차는 받지 않고 캐시만 구독한다 — 출처 링크(HelpSourceLink)가 이미 받는다. 표식이 없는 AI 패널이 열릴 때마다 목차를 받지 않게.
  const index = useHelpIndex({ enabled: false }).data
  const { isAdmin } = useAuth()
  const lookupDialog = useAiDialogTargetLookup()

  return useMemo<HelpAnswerActions>(
    () => ({
      openHelpSection: (id) => {
        // 목차에 없거나 이 사용자에게 안 보이는 장의 절이면 열지 않는다(AI 가 꾸며 낸 id 방어).
        const ref = index ? findSection(index, id) : null
        if (!helpPanel || !ref || !isChapterVisible(ref.chapter, isAdmin)) return
        closeThen(() => {
          helpPanel.select({ chapter: ref.chapter.chapter, sectionId: id }, null)
          helpPanel.setOpen(true)
        })
      },
      focusScreenControl: (text) => {
        closeThen(() => {
          // AI 패널 안 같은 이름 단추(「새 대화」 등)는 excludeAiSurface 로 뺀다.
          const found = findScreenControls(text, { excludeAiSurface: true })
          const first = found[0]
          if (!first) return
          first.scrollIntoView({ block: 'center' })
          first.focus({ preventScroll: true })
          flash(found)
        })
      },
      openDialog: (id) => {
        // 허용 id 이고 지금 화면에 등록된 창만 — 아니면 missing.
        const found = lookupDialog(id)
        if (!found) return 'missing'
        // 이미 열려 있으면 다시 열지 않고 기준 단추로 스크롤만 한다 — 전체 화면 AI 가 그 창을 가리므로 이때도 AI 를 먼저 걷어 낸다.
        if (found.isOpen()) {
          closeThen(() => {
            // AI 를 걷는 동안 창이 닫혔을 수 있어 실행 시점에 다시 찾는다.
            lookupDialog(id)?.anchor?.scrollIntoView({ block: 'center' })
          })
          return 'scrolled'
        }
        closeThen(() => {
          // AI 를 걷는 동안 화면이 바뀌었을 수 있어 실행 시점에 다시 찾는다.
          const handle = lookupDialog(id)
          if (!handle) return
          handle.anchor?.scrollIntoView({ block: 'center' })
          handle.open()
        })
        return 'opened'
      },
    }),
    [closeThen, helpPanel, index, isAdmin, lookupDialog],
  )
}
