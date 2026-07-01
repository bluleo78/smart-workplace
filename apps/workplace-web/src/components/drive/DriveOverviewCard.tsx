import { useEffect, useState } from 'react'

import { startDriveOverviewStream } from '@/api/overviewStream'

/** AI Overview 스트리밍 카드. SSE delta 누적. 발췌 기반 답변은 비신뢰 출처 — text-only 렌더(HTML 미해석).
 *  spaceId 지정 시 근거를 해당 공간으로 제한(콘텐츠 검색과 스코프 일관성 유지). */
export function DriveOverviewCard({ query, spaceId }: { query: string; spaceId?: number }) {
  const [text, setText] = useState('')
  const [done, setDone] = useState(false)

  useEffect(() => {
    setText('')
    setDone(false)
    const { abort } = startDriveOverviewStream({
      query,
      spaceId,
      onDelta: (t) => setText((prev) => prev + t),
      onDone: () => setDone(true),
      onError: () => setDone(true),
    })
    return () => abort()
  }, [query, spaceId])

  return (
    <div className="rounded border bg-muted/30 p-3" data-testid="drive-overview-card">
      <div className="mb-1 text-xs font-semibold text-primary">AI Overview</div>
      <p className="whitespace-pre-wrap text-sm">{text || (done ? '결과 없음' : '생성 중…')}</p>
    </div>
  )
}
