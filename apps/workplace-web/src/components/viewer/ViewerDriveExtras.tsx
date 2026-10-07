import { useDriveFileSummary } from '../../hooks/queries/useDriveFileSummary'
import { useFileBacklinks } from '../../hooks/queries/useFileBacklinks'
import { useAiAvailable } from '../../hooks/useAiAvailable'
import { AiContent } from '../ai/AiContent'
import { MarkdownMessage } from '../ai/MarkdownMessage'

/**
 * [임시] 드라이브 항목의 AI 요약 카드 — 기존 FilePreviewModal 의 카드를 그대로 옮겼다(#526·#633·#735).
 * 후속 태스크(사이드 패널)에서 이 파일째 패널 컴포넌트로 교체한다. 드라이브 회귀 E2E 를 지키기 위한 과도기 렌더.
 * driveFileId 가 없으면(첨부) 아무것도 그리지 않는다 — 훅은 0 으로 호출해 비활성.
 */
export function ViewerSummaryCard({ driveFileId }: { driveFileId?: number }) {
  const aiAvailable = useAiAvailable()
  const summaryQuery = useDriveFileSummary(driveFileId ?? 0)
  const summary = summaryQuery.data?.summary ?? null
  const status = summaryQuery.data?.status ?? null
  const reason = summaryQuery.data?.reason ?? null
  // 진행 중 = 추출/요약 미완(스켈레톤 대상). 터미널·요약없음이면 카드 숨김.
  const summaryInProgress =
    status === 'PENDING' || status === 'EXTRACTING' || status === 'TEXT_READY' || status === 'SUMMARIZING'
  // #735: 요약 불가(SKIPPED/FAILED)도 카드를 유지해 사유를 알린다 — 사라지면 사용자는 이유를 구분할 수 없다.
  const summaryUnavailable = status === 'SKIPPED' || status === 'FAILED'
  // #735: 진행 중인데 폴링 상한을 넘김 = 처리기가 멈춘 정황 → 스켈레톤 대신 지연 안내.
  const summaryStalled = summaryInProgress && summaryQuery.pollingExhausted
  const show = driveFileId != null && aiAvailable && (summary != null || summaryInProgress || summaryUnavailable)
  if (!show) return null
  return (
    <AiContent
      label="AI 요약"
      collapsible
      defaultOpen={summaryUnavailable || summaryStalled}
      data-testid="drive-summary-card"
    >
      {summary != null ? (
        // #633: LLM 이 만든 마크다운을 DM 채팅과 동일하게 MarkdownMessage 로 파싱해 보여준다.
        <MarkdownMessage>{summary}</MarkdownMessage>
      ) : summaryUnavailable || summaryStalled ? (
        // #735: 서버 문구는 평문 — 마크다운 렌더 금지(원문 그대로 노출한다는 계약).
        <p className="text-sm text-muted-foreground" data-testid="drive-summary-reason">
          {summaryStalled
            ? '요약 생성이 지연되고 있습니다. 잠시 후 다시 열어 주세요.'
            : (reason ?? '요약을 사용할 수 없습니다.')}
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
 * [임시] "참조된 곳" — 이 파일을 링크한 이슈·메시지 목록. 비어 있으면 섹션 자체를 숨긴다.
 * 후속 태스크의 사이드 패널로 교체될 과도기 렌더(ViewerSummaryCard 와 함께).
 */
export function ViewerBacklinks({ driveFileId }: { driveFileId?: number }) {
  const backlinks = useFileBacklinks(driveFileId ?? 0)
  if (driveFileId == null || (backlinks.data?.length ?? 0) === 0) return null
  return (
    <div className="border-t border-border px-4 py-3" data-testid="file-backlinks">
      <p className="mb-1 text-xs font-medium text-muted-foreground">참조된 곳</p>
      <ul className="space-y-1">
        {backlinks.data!.map((b) => (
          <li key={`${b.sourceType}-${b.sourceId}`} data-testid={`file-backlink-${b.sourceType}-${b.sourceId}`}>
            <a href={b.deepLink} className="text-sm text-primary hover:underline">
              {b.label}
            </a>
          </li>
        ))}
      </ul>
    </div>
  )
}
