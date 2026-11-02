import { cn } from '@/lib/utils'

/**
 * 「HTML 문서」 표시(WP-1307) — 트리 행·공유 트리에서 제목 뒤에 붙는 작은 글자 표시. 색은 시맨틱 토큰만(흐린 바탕 + 흐린 글자).
 * 읽는 이름은 「HTML 문서」 — 눈에는 짧게 「HTML」만 보인다.
 */
export function WikiHtmlBadge({ testId, className }: { testId?: string; className?: string }) {
  return (
    <span
      data-testid={testId}
      className={cn('shrink-0 rounded bg-muted px-1 text-[10px] font-medium leading-4 text-muted-foreground', className)}
    >
      HTML<span className="sr-only"> 문서</span>
    </span>
  )
}
