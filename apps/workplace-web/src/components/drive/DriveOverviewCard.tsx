import { useEffect, useState } from 'react'

import { startDriveOverviewStream } from '@/api/overviewStream'

/** AI Overview 스트리밍 카드. SSE delta 누적. 발췌 기반 답변은 비신뢰 출처 — text-only 렌더(HTML 미해석). */
export function DriveOverviewCard({ query }: { query: string }) {
  const [text, setText] = useState('')
  const [done, setDone] = useState(false)

  useEffect(() => {
    setText('')
    setDone(false)
    const { abort } = startDriveOverviewStream({
      query,
      onDelta: (t) => setText((prev) => prev + t),
      onDone: () => setDone(true),
      onError: () => setDone(true),
    })
    return () => abort()
  }, [query])

  return (
    <div className="rounded border bg-muted/30 p-3" data-testid="drive-overview-card">
      <div className="mb-1 text-xs font-semibold text-primary">AI Overview</div>
      <p className="whitespace-pre-wrap text-sm">{text || (done ? '결과 없음' : '생성 중…')}</p>
    </div>
  )
}
