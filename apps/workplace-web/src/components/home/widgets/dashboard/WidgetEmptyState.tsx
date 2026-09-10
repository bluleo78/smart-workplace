import type { LucideIcon } from 'lucide-react'
import { Link } from 'react-router-dom'

/**
 * 대시보드 위젯 공용 빈 상태(empty state) — 아이콘 + 제목 + 보조설명(선택) + CTA(선택) 4단 구성(#653).
 * MyTasksBody/CalendarTodayBody 가 각자 empty state 마크업을 갖고 있어 위젯마다 정보 밀도가
 * 달랐던 문제(#653)를 이 컴포넌트로 통일한다. description/cta 는 위젯 성격상 자연스럽지 않으면
 * 생략 가능한 optional 필드로 둔다.
 */
export function WidgetEmptyState({
  icon: Icon,
  title,
  description,
  cta,
  testId,
}: {
  icon: LucideIcon
  title: string
  description?: string
  cta?: { label: string; to: string }
  testId?: string
}) {
  return (
    <div
      // I3(a11y): 빈 상태는 보조 안내이므로 role="status"(polite live region).
      role="status"
      className="flex flex-col items-center gap-1 py-6 text-center"
      data-testid={testId}
    >
      <Icon className="h-8 w-8 text-ai-accent" aria-hidden />
      <div className="mt-1 text-sm font-medium">{title}</div>
      {description && <div className="text-xs text-muted-foreground">{description}</div>}
      {cta && (
        <Link
          to={cta.to}
          className="mt-2 inline-block rounded px-2 py-1 text-xs text-ai-accent hover:underline"
        >
          {cta.label} →
        </Link>
      )}
    </div>
  )
}
