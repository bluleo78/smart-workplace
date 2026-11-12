// 설정 화면 AI 참고용 매뉴얼 요약 훅(WP-1507) — 화면의 대표 도움말 id 절을 도움말 묶음에서 받아 요약 항목으로 만든다.
// AI 화면 참고 쪽에 둔다 — 도움말 모듈(components/help)이 AI 상태를 읽지 않게 하려고(도움말은 AI 를 몰라도 된다).
// 목차·장 파일·자리표시 목록 질의는 도움말 패널과 같은 키라, 패널을 열어도 다시 받지 않는다(staleTime Infinity).
// 화면 참고는 AI 패널이 읽고, 묶음은 도움말 패널도 쓴다 — 둘 다 닫혀 있으면 받지 않는다(화면을 열 때마다 장 전체를 받지 않게).
import { useMemo } from 'react'

import { useOptionalAssistant } from '@/components/ai/AIAssistantContext'
import { useHelpChapter, useHelpIndex, useHelpVars } from '@/components/help/helpBundle'
import { findSection } from '@/components/help/helpNav'
import { useOptionalHelpPanel } from '@/components/help/HelpPanelContext'
import { useHelpValues } from '@/components/help/helpValues'
import { type HelpSummaryItem, summarizeHelpSection } from '@/components/help/manualSummary'

/**
 * helpId 절의 요약(summarizeHelpSection) — 아직 못 받았거나 받지 못했으면 null(받지 않은 설명을 AI 에게 싣지 않는다).
 * - AI 패널(옆·전체화면)도 도움말 패널도 닫혀 있으면 질의를 끄고 null — 화면 참고는 화면 이름·화면 값만 싣는다.
 *   AI 를 열면 그때 받아 화면 참고가 채워진다. 공급자 밖(앱 셸 없는 화면)은 닫힌 것으로 본다.
 * - 장은 주소가 아니라 도움말 id 로 찾는다(findSection) — id 는 책 전체에서 유일해 주소보다 정확하다.
 * - 자리표시 목록은 받기를 기다린다(못 받으면 null 로 넘겨 이름 꼴로 채운다) — 기다리지 않으면 표시 이름이 잠깐 날것 이름으로 실린다.
 */
export function useManualSummary(helpId: string): HelpSummaryItem[] | null {
  const aiOpen = (useOptionalAssistant()?.mode ?? 'closed') !== 'closed'
  const helpOpen = useOptionalHelpPanel()?.open ?? false
  // 받을 절 — 두 패널이 다 닫혀 있으면 null 이라 아래 질의가 모두 꺼진다.
  const activeId = aiOpen || helpOpen ? helpId : null
  const index = useHelpIndex({ enabled: activeId !== null })
  const vars = useHelpVars({ enabled: activeId !== null })
  // 목차가 이미 캐시에 있어도 꺼진 동안은 장 파일을 받지 않는다.
  const chapterSlug = activeId !== null && index.data ? (findSection(index.data, activeId)?.chapter.chapter ?? null) : null
  const chapter = useHelpChapter(chapterSlug)
  const values = useHelpValues()
  const varsPending = vars.isPending
  const varsData = vars.data
  const chapterData = chapter.data
  return useMemo(() => {
    if (activeId === null || !chapterData || varsPending) return null
    return summarizeHelpSection(chapterData, activeId, values, varsData ?? null)
  }, [activeId, chapterData, varsPending, varsData, values])
}
