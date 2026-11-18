// 노트 한 줄 요약(WP-1701) — 아이콘 · 말줄임 제목 · 말줄임 메타. 회의록 카드와 노트 연결 창의 결과 행이 같이 쓴다.
import { NotebookText } from 'lucide-react'

interface NoteSummaryProps {
  title: string
  /** 제목 아래 보조 줄 — 비어 있으면 그리지 않는다 */
  meta?: string
}

export function NoteSummary({ title, meta }: NoteSummaryProps) {
  return (
    <>
      <NotebookText className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{title}</div>
        {meta && <div className="truncate text-xs text-muted-foreground">{meta}</div>}
      </div>
    </>
  )
}
