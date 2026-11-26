// 위젯 본문 렌더(WP-161 에서 Dashboard.tsx 로부터 분리) — 카탈로그 본문 지연 로딩(Suspense) + 시스템/카탈로그 분기, 시스템 본문 여덟 개는 registry 에 정적 import(WP-2076).
import { createElement, Suspense } from 'react'

import { Skeleton } from '@/components/ui/skeleton'

import { getChatWidget } from '../widgets/chatWidgetRegistry'
import { type WidgetHeadingLevel, WidgetHeadingLevelProvider } from '../widgets/WidgetFrame'
import type { ResolvedEntry } from './resolvedEntry'

/** 카탈로그 위젯 본문 — chatWidgetRegistry 의 기존 컴포넌트를 재사용. 미등록 타입은 아무것도 렌더하지 않는다(방어적). */
function CatalogWidgetBody({
  type,
  params,
  headingLevel,
}: {
  type: string
  params?: Record<string, unknown> | null
  headingLevel: WidgetHeadingLevel
}) {
  const ChatComponent = getChatWidget(type)
  if (!ChatComponent) return null
  // JSX(`<ChatComponent .../>`)로 렌더하면 react-hooks/static-components 가 "렌더 중 컴포넌트 생성"으로 오탐(false
  // positive)한다 — getChatWidget 은 매 호출 동일 lazy 참조를 반환하는 안정 레지스트리 조회일 뿐 신규 생성이 아니다.
  // createElement 로 우회(AIChatPanel 의 동일 레지스트리 조회 패턴과 동등한 동작).
  // 위젯 제목(WidgetFrame)의 헤딩 레벨은 놓인 카드가 정한다 — 카드 제목(h2) 아래면 3(WP-1888).
  return (
    <WidgetHeadingLevelProvider level={headingLevel}>
      {createElement(ChatComponent, { params: params ?? undefined })}
    </WidgetHeadingLevelProvider>
  )
}

/**
 * 위젯 본문(카탈로그 본문 지연 로딩 Suspense + 시스템/카탈로그 분기 — 시스템 본문 여덟 개는 registry 에 정적 import, WP-2076) — 데스크톱·모바일 카드(보기·편집)가 공통으로 쓴다.
 * frameHeadingLevel: 카탈로그 위젯 제목(WidgetFrame)의 헤딩 레벨.
 */
export function EntryBody({
  entry,
  frameHeadingLevel = 3,
}: {
  entry: ResolvedEntry
  frameHeadingLevel?: WidgetHeadingLevel
}) {
  // 시스템 본문 여덟 개는 registry 에 정적 import 라 지연 로딩이 없어 Suspense 가 필요 없다 — 감싸면
  // 공짜 폴백(h-20) 자리만 더해 둔다(WP-2076 리뷰 후속 ④). 카탈로그 본문만 lazy 라 그때만 멈춘다.
  // ⚠️ 훗날 시스템 본문에 lazy·suspend 요소를 넣으면 이 분기에도 Suspense 가 필요하다 — 그때 없애면
  // 폴백이 라우트 수준(페이지 전체)으로 새므로 함께 되돌려야 한다.
  if (entry.kind === 'system') return <entry.def.Component count={entry.cfg.count} />
  return (
    <Suspense fallback={<Skeleton className="h-20 w-full" />}>
      <CatalogWidgetBody type={entry.cfg.type} params={entry.cfg.params} headingLevel={frameHeadingLevel} />
    </Suspense>
  )
}

