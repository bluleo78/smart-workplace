/**
 * AI 요약 생성 중 3줄 스켈레톤 — 메일 상세·노트 요약 카드가 같은 마크업을 쓴다(AiContent 안에서 요약 문단 자리를 채움).
 * 테스트가 화면별로 로딩 상태를 구분하도록 testid 는 호출하는 쪽이 넘긴다.
 */
export function AiSummarySkeleton({ testId }: { testId: string }) {
  return (
    <div data-testid={testId} className="mt-2 flex flex-col gap-1.5">
      <div className="h-2 w-full animate-pulse rounded bg-ai-accent/20" />
      <div className="h-2 w-3/4 animate-pulse rounded bg-ai-accent/20" />
      <div className="h-2 w-1/2 animate-pulse rounded bg-ai-accent/20" />
    </div>
  )
}
