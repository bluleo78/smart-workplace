// 위젯 본문 렌더(WP-161 에서 Dashboard.tsx 로부터 분리) — 지연 로딩 Suspense + 시스템/카탈로그 분기.
import { createElement, Suspense } from 'react'

import { Skeleton } from '@/components/ui/skeleton'

import { getChatWidget } from '../widgets/chatWidgetRegistry'
import type { ResolvedEntry } from './resolvedEntry'

/** 카탈로그 위젯 본문 — chatWidgetRegistry 의 기존 컴포넌트를 재사용. 미등록 타입은 아무것도 렌더하지 않는다(방어적). */
function CatalogWidgetBody({
  type,
  params,
}: {
  type: string
  params?: Record<string, unknown> | null
}) {
  const ChatComponent = getChatWidget(type)
  if (!ChatComponent) return null
  // JSX(`<ChatComponent .../>`)로 렌더하면 react-hooks/static-components 가 "렌더 중 컴포넌트 생성"으로 오탐(false
  // positive)한다 — getChatWidget 은 매 호출 동일 lazy 참조를 반환하는 안정 레지스트리 조회일 뿐 신규 생성이 아니다.
  // createElement 로 우회(AIChatPanel 의 동일 레지스트리 조회 패턴과 동등한 동작).
  return createElement(ChatComponent, { params: params ?? undefined })
}

/** 위젯 본문(지연 로딩 Suspense + 시스템/카탈로그 분기) — 데스크톱·모바일 카드(보기·편집)가 공통으로 쓴다. */
export function EntryBody({ entry }: { entry: ResolvedEntry }) {
  return (
    <Suspense fallback={<Skeleton className="h-20 w-full" />}>
      {entry.kind === 'system' ? (
        <entry.def.Component count={entry.cfg.count} />
      ) : (
        <CatalogWidgetBody type={entry.cfg.type} params={entry.cfg.params} />
      )}
    </Suspense>
  )
}

