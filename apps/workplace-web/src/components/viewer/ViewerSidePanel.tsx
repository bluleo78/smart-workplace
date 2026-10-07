import { X } from 'lucide-react'

import { useDriveFileSummary } from '../../hooks/queries/useDriveFileSummary'
import { AiContent } from '../ai/AiContent'
import { MarkdownMessage } from '../ai/MarkdownMessage'
import { Button } from '../ui/button'
import type { ViewerItem } from './types'
import { ViewerBacklinks } from './ViewerBacklinks'

/** AI 요약 카드 — 접힘 없이 항상 펼침(패널 자체가 토글). 상태 계산은 기존 모달 카드(#526·#633·#735)와 같다. */
function SummaryCard({ driveFileId }: { driveFileId: number }) {
  const q = useDriveFileSummary(driveFileId)
  const summary = q.data?.summary ?? null
  const status = q.data?.status ?? null
  const reason = q.data?.reason ?? null
  // 진행 중 = 추출/요약 미완(스켈레톤 대상).
  const inProgress =
    status === 'PENDING' || status === 'EXTRACTING' || status === 'TEXT_READY' || status === 'SUMMARIZING'
  // #735: 요약 불가(SKIPPED/FAILED)도 카드를 유지해 사유를 알린다 — 사라지면 이유를 구분할 수 없다.
  const unavailable = status === 'SKIPPED' || status === 'FAILED'
  // #735: 진행 중인데 폴링 상한을 넘김 = 처리기가 멈춘 정황 → 스켈레톤 대신 지연 안내.
  const stalled = inProgress && q.pollingExhausted

  // 요약도 진행 중도 불가도 아니고(상태 행 없음 등) 로딩도 끝났으면 한 줄 안내.
  if (summary == null && !inProgress && !unavailable) {
    return q.isLoading ? null : <p className="text-sm text-muted-foreground">요약이 아직 없습니다.</p>
  }
  return (
    <AiContent label="AI 요약" data-testid="drive-summary-card">
      {summary != null ? (
        // #633: LLM 이 만든 마크다운을 DM 채팅과 동일하게 MarkdownMessage 로 파싱한다.
        <MarkdownMessage>{summary}</MarkdownMessage>
      ) : unavailable || stalled ? (
        // #735: 서버 문구는 평문 — 마크다운 렌더 금지(원문 그대로 노출한다는 계약).
        <p className="text-sm text-muted-foreground" data-testid="drive-summary-reason">
          {stalled ? '요약 생성이 지연되고 있습니다. 잠시 후 다시 열어 주세요.' : (reason ?? '요약을 사용할 수 없습니다.')}
        </p>
      ) : (
        <div className="space-y-1" data-testid="drive-summary-loading">
          <div className="h-3 w-full animate-pulse rounded bg-ai-accent/20" />
          <div className="h-3 w-5/6 animate-pulse rounded bg-ai-accent/20" />
          <div className="h-3 w-2/3 animate-pulse rounded bg-ai-accent/20" />
        </div>
      )}
    </AiContent>
  )
}

/**
 * 뷰어 오른쪽 사이드 패널(WP-277) — AI 요약 + 참조된 곳.
 * lg 이상은 오른쪽 w-80 열, 그보다 좁으면 본문 아래에 쌓는다(모바일 바텀시트는 WP-278 에서).
 */
export function ViewerSidePanel({ item, onClose }: { item: ViewerItem; onClose: () => void }) {
  return (
    <aside
      data-testid="viewer-side-panel"
      className="max-h-[45%] w-full shrink-0 overflow-y-auto border-t border-border p-4 lg:max-h-none lg:w-80 lg:border-t-0 lg:border-l"
    >
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-medium">AI 요약</h2>
        <Button variant="ghost" size="icon" aria-label="요약 닫기" onClick={onClose}>
          <X />
        </Button>
      </div>
      <div className="space-y-4">
        {item.summaryDriveFileId != null && <SummaryCard driveFileId={item.summaryDriveFileId} />}
        {item.backlinksDriveFileId != null && <ViewerBacklinks driveFileId={item.backlinksDriveFileId} />}
      </div>
    </aside>
  )
}
