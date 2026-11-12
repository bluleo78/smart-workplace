// AI 답의 출처 링크 「도움말 · <칸 이름>」 — 보이는 장의 절이면 링크 모양 단추(누르면 도움말 패널이 그 절로 열린다), 아니면 글자만(WP-1511).
// 일반 구성원에게는 관리자 장 절을 이동 대상으로 보이지 않게 한다(HelpPanel 의 canNavigate 와 같은 규칙).
import { type ReactNode, useContext } from 'react'

import { useHelpIndex } from '@/components/help/helpBundle'
import { findSection, isChapterVisible, sectionName } from '@/components/help/helpNav'
import { useAuth } from '@/hooks/useAuth'

import { HelpAnswerContext } from './helpAnswerContext'

/**
 * 출처 단추. 글은 AI 가 쓴 링크 글이 아니라 「도움말 · <절 label>」 로 화면이 정한다(AI 가 출처 이름을 꾸며 낼 수 없게).
 * 목차를 받기 전·없는 절·숨긴 장은 이동도 못 하므로 AI 가 쓴 글(children)을 글자로만 보인다.
 */
export function HelpSourceLink({ id, children }: { id: string; children?: ReactNode }) {
  const actions = useContext(HelpAnswerContext)?.actions
  const { isAdmin } = useAuth()
  const index = useHelpIndex().data
  const ref = index ? findSection(index, id) : null
  if (!actions || !ref || !isChapterVisible(ref.chapter, isAdmin)) return <>{children}</>
  return (
    <button
      type="button"
      onClick={() => actions.openHelpSection(id)}
      className="text-primary underline underline-offset-2 hover:opacity-80"
    >
      {`도움말 · ${sectionName(ref.section)}`}
    </button>
  )
}
