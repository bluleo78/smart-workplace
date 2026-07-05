import { Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'

import { startDriveOverviewStream } from '@/api/overviewStream'

/** AI Overview 스트리밍 카드. SSE delta 누적. 발췌 기반 답변은 비신뢰 출처 — text-only 렌더(HTML 미해석).
 *  spaceId 지정 시 근거를 해당 공간으로 제한(콘텐츠 검색과 스코프 일관성 유지). */
export function DriveOverviewCard({ query, spaceId }: { query: string; spaceId?: number }) {
  const [text, setText] = useState('')
  const [done, setDone] = useState(false)
  // 에러 메시지(타임아웃/생성 실패 등) — 없으면 "생성 중…" 또는 "결과 없음"으로 표시(#681).
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setText('')
    setDone(false)
    setError(null)
    const { abort } = startDriveOverviewStream({
      query,
      spaceId,
      onDelta: (t) => setText((prev) => prev + t),
      onDone: () => setDone(true),
      onError: (message) => {
        setError(message)
        setDone(true)
      },
    })
    return () => abort()
  }, [query, spaceId])

  // 렌더 분기: 에러 > 로딩(스피너) > 텍스트(delta 누적 중 포함) > 결과 없음.
  const content = error ? (
    // 에러는 항상 명확히 노출 — SSE 유실 등으로 무한 대기하다 클라이언트 타임아웃에 걸린 경우도
    // "결과 없음"이 아니라 실제 실패 이유를 보여준다(#681).
    <p className="text-sm text-destructive">{error}</p>
  ) : !text && !done ? (
    // 로딩 중임을 시각적으로 구분 — 이슈 상세 IssueInstantContextCard와 동일한 스피너 패턴 (#679)
    <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
      생성 중…
    </p>
  ) : (
    <p className="whitespace-pre-wrap text-sm">{text || '결과 없음'}</p>
  )

  return (
    <div className="rounded border bg-muted/30 p-3" data-testid="drive-overview-card">
      <div className="mb-1 text-xs font-semibold text-primary">AI Overview</div>
      {content}
    </div>
  )
}
