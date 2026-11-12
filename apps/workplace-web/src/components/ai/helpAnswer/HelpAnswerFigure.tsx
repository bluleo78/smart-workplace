// AI 답 안의 매뉴얼 그림 한 장(WP-1511) — AI 가 그림을 만들지 않고, 답의 첫 출처 절이 든 장 파일의 그림 가운데 id 가 같은 것만 작게 보여 준다.
// 답당 그림은 최대 1장이라 첫 그림만 그리고 둘째부터는 그리지 않는다(첫 그림 판정은 MarkdownMessage 의 rehype 단계가 표시한다).
// 못 찾으면(출처 없음·장 못 받음·없는 id·일반 구성원에게 숨긴 관리자 장) alt 글로 대신한다.
import { useContext } from 'react'

import { useHelpChapter, useHelpIndex } from '@/components/help/helpBundle'
import { HelpFigureFallback, HelpFigureImage } from '@/components/help/HelpFigureImage'
import { findSection, isChapterVisible } from '@/components/help/helpNav'
import { useAuth } from '@/hooks/useAuth'

import { HelpAnswerContext } from './helpAnswerContext'

/** 그림 id(figure:<id>)로 그림을 찾아 small 로 그린다. first=false 면(둘째 그림부터) 아무것도 그리지 않는다. */
export function HelpAnswerFigure({ figureId, alt, first }: { figureId: string; alt: string; first: boolean }) {
  const sourceId = useContext(HelpAnswerContext)?.sourceId ?? null
  const { isAdmin } = useAuth()
  const index = useHelpIndex().data
  const ref = index && sourceId ? findSection(index, sourceId) : null
  const visible = ref ? isChapterVisible(ref.chapter, isAdmin) : false
  // 훅 규칙상 둘째 그림에서도 호출은 하되, 받을 장이 없으면(null) 요청하지 않는다.
  const chapter = useHelpChapter(first && visible && ref ? ref.chapter.chapter : null).data
  if (!first) return null
  const figure = chapter?.sections.flatMap((s) => s.figures).find((f) => f.id === figureId)
  return figure ? <HelpFigureImage figure={figure} size="small" /> : <HelpFigureFallback alt={alt} />
}
