import { Maximize2, Minimize2, X } from 'lucide-react'
import { useState } from 'react'

import { useDriveFileSummary } from '../../hooks/queries/useDriveFileSummary'
import { cn } from '../../lib/utils'
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

/** 패널·시트 공용 내용 — AI 요약 + 참조된 곳. 데스크톱 사이드 패널과 모바일 바텀시트가 같은 내용을 그린다. */
export function ViewerPanelContent({ item }: { item: ViewerItem }) {
  return (
    <div className="space-y-4">
      {item.summaryDriveFileId != null && <SummaryCard driveFileId={item.summaryDriveFileId} />}
      {item.backlinksDriveFileId != null && <ViewerBacklinks driveFileId={item.backlinksDriveFileId} />}
    </div>
  )
}

/**
 * 뷰어 오른쪽 사이드 패널(WP-277) — AI 요약 + 참조된 곳.
 * 데스크톱 배치(lg 이상 = MOBILE_MEDIA_QUERY 밖)에서만 그려 오른쪽 w-80 열이 된다. lg 미만은 모바일 배치라 ViewerSummarySheet 를 쓴다.
 * (lg: 접두 없는 세로 쌓기 클래스는 WP-277 의 좁은 화면용 — 지금 배치에선 적용되지 않지만 데스크톱 클래스와 함께 그대로 둔다.)
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
      <ViewerPanelContent item={item} />
    </aside>
  )
}

/**
 * 모바일 AI 요약 바텀시트(WP-278, 스펙 §4.2·시안 M4) — 반 높이로 열리고 "펼치기" 버튼으로 상단 바 아래까지 늘린다.
 * 끌어 올리기 대신 버튼인 이유: 끌기만 되는 조작은 WCAG 2.5.7(끌기 동작 대안) 위반.
 * 뷰어 다이얼로그 안에 그려 포커스 트랩·다크 토큰을 그대로 받는다. 하단 액션 바 위(z-30)에 겹친다.
 */
export function ViewerSummarySheet({ item, onClose }: { item: ViewerItem; onClose: () => void }) {
  // 펼침 여부 — 시트를 닫았다 다시 열면(언마운트) 반 높이로 돌아간다.
  const [expanded, setExpanded] = useState(false)
  return (
    <section
      aria-label="AI 요약"
      data-testid="viewer-summary-sheet"
      className={cn(
        // 좌우 안전영역 — absolute 라 루트 padding 을 받지 못한다(가로 모드 노치).
        'absolute inset-x-0 bottom-0 z-30 flex flex-col rounded-t-xl border-t border-border bg-background pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] transition-[height] duration-200',
        // 펼침 = 상단 바(3.5rem=min-h-14 + 노치) 아래까지 — 닫기(✕)·파일명은 계속 보이게 남긴다.
        expanded ? 'h-[calc(100%-3.5rem-env(safe-area-inset-top))]' : 'h-1/2',
      )}
    >
      <div className="flex items-center gap-1 px-4 pt-2">
        <h2 className="flex-1 text-sm font-medium">AI 요약</h2>
        <Button
          variant="ghost"
          size="sm"
          className="min-h-11"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? <Minimize2 aria-hidden /> : <Maximize2 aria-hidden />}
          {expanded ? '접기' : '펼치기'}
        </Button>
        <Button variant="ghost" size="icon" className="size-11" aria-label="요약 닫기" onClick={onClose}>
          <X />
        </Button>
      </div>
      {/* overscroll-contain — 시트 끝까지 스크롤해도 뒤 본문·페이지로 스크롤이 번지지 않게. 아래 여백은 홈 인디케이터만큼. */}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-2 pb-[calc(1rem+env(safe-area-inset-bottom))]">
        <ViewerPanelContent item={item} />
      </div>
    </section>
  )
}
