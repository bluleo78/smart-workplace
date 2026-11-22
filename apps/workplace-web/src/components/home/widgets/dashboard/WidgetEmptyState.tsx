import type { LucideIcon } from 'lucide-react'
import { Link } from 'react-router-dom'

import { EmptyState } from '@/components/layout/EmptyState'

/**
 * 대시보드 위젯 공용 빈 상태(empty state) — 아이콘 + 제목 + 보조설명 + CTA 4단 구성(#653).
 * MyTasksBody/CalendarTodayBody 가 각자 empty state 마크업을 갖고 있어 위젯마다 정보 밀도가
 * 달랐던 문제(#653)를 이 컴포넌트로 통일한다. 빈 상태는 늘 다음 행동(CTA)을 둔다 —
 * docs/design-system/06-feedback-states.md B절(WP-1853). 그래서 설명·CTA 를 필수 속성으로 두어
 * 새 위젯이 빼먹으면 타입 검사에서 막힌다.
 */
export function WidgetEmptyState({
  icon: Icon,
  title,
  description,
  cta,
  testId,
  tone = 'default',
}: {
  icon: LucideIcon
  title: string
  description: string
  cta: { label: string; to: string }
  testId?: string
  /** 'positive' = 긍정 빈 상태(할 일 없음 = 다 끝냄) — 아이콘을 muted 대신 primary 로 둔다(06 §B 의 유일한 색 예외). */
  tone?: 'default' | 'positive'
}) {
  return (
    // I3(a11y): 제목·설명만 role="status"(polite live region)로 알리고 CTA 링크는 그 밖에 둔다 — 안에 두면 링크 글자까지
    // 읽힌다(WP-1853). display:contents 는 일부 브라우저가 role 을 지워 쓰지 않고, 블록 감싸개 + space-y-1 로 간격을 맞춘다.
    // 바깥 모양·아이콘 규격은 공용 EmptyState 가 그리고(WP-1947), 제목·설명 태그는 예전 그대로 div 로 둔다.
    <EmptyState
      icon={Icon}
      title={title}
      description={description}
      tone={tone}
      grouped
      textRole="status"
      titleAs="div"
      titleClassName="mt-1"
      descriptionAs="div"
      className="gap-1 py-6"
      testId={testId}
      action={
        <Link to={cta.to} className="mt-2 inline-block rounded px-2 py-1 text-xs text-ai-accent hover:underline">
          {cta.label} →
        </Link>
      }
    />
  )
}
