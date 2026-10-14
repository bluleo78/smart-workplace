/** 하위 진행 「└ done/total」 — 이슈 목록 행·AI 위임 작업 표/모바일 목록이 같은 모양으로 쓴다. 하위가 없으면(total 0·null) 그리지 않는다. */
export function ChildProgress({
  done,
  total,
  testId,
}: {
  done: number | null
  total: number | null
  testId?: string
}) {
  if (!total) return null
  return (
    <span
      className="shrink-0 text-xs font-normal text-muted-foreground"
      data-testid={testId}
      aria-label={`하위 작업 ${done ?? 0}/${total}`}
    >
      └ {done ?? 0}/{total}
    </span>
  )
}
