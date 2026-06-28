import { AiContent } from '@/components/ai/AiContent'
import { AiSignalBadge } from '@/components/ai/AiSignalBadge'
import type { AiSignalVariant } from '@/components/ai/aiMarker'
import { Button } from '@/components/ui/button'
import { formatRelativeTime } from '@/lib/formatters'
import type { IssueAiContext, IssueBlockerBadge } from '@/types/issue'

// 블로커 타입 → AiSignalBadge variant 매핑.
// AiSignalVariant 실제 어휘: 'action'(사용자 행동 필요) | 'info'(정보성).
// BLOCKED/OVERDUE = 즉각 행동 필요 → 'action', STALE = 정보성 알림 → 'info'.
export function badgeVariant(type: IssueBlockerBadge['type']): AiSignalVariant {
  if (type === 'BLOCKED') return 'action'
  if (type === 'OVERDUE') return 'action'
  return 'info'
}

/**
 * 이슈 상세 상단 AI 즉각 컨텍스트 카드 (#517).
 * 온디맨드 재설계 — 항상 렌더(버튼 항상 노출). 세 가지 상태:
 *   (a) summary 없음 + 블로커 없음 → 컴팩트 행: 레이블 + "생성" 버튼.
 *   (b) 블로커만 있고 summary 없음 → 블로커 배지 + "생성" 버튼.
 *   (c) summary 있음 → 현황 + 블로커 + 다음액션 + "재생성" 버튼 + 신선도.
 * onGenerate/isGenerating 은 페이지에서 주입(프레젠테이셔널).
 */
export function IssueInstantContextCard({
  aiContext,
  onGenerate,
  isGenerating,
}: {
  aiContext?: IssueAiContext | null
  onGenerate: () => void
  isGenerating: boolean
}) {
  // aiContext 는 백엔드가 항상 non-null 로 반환하지만 방어적으로 처리.
  const ctx = aiContext ?? { summary: null, nextAction: null, generatedAt: null, blockers: [] }
  const hasSummary = Boolean(ctx.summary?.trim())

  return (
    <AiContent label="AI 현황 요약" data-testid="issue-instant-context">
      {/* ① 현황 요약 한 줄 — summary 있을 때만 */}
      {hasSummary && (
        <p className="text-sm leading-relaxed">{ctx.summary}</p>
      )}
      {/* ② 블로커 배지 목록 — 있을 때만 */}
      {ctx.blockers.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2" data-testid="issue-blocker-badges">
          {ctx.blockers.map((b) => (
            <AiSignalBadge
              key={b.type}
              variant={badgeVariant(b.type)}
              data-testid={`blocker-${b.type}`}
            >
              {b.message}
            </AiSignalBadge>
          ))}
        </div>
      )}
      {/* ③ 다음 액션 — summary 있을 때만 */}
      {hasSummary && ctx.nextAction?.trim() && (
        <p className="mt-2 text-sm" data-testid="issue-next-action">
          <span className="text-muted-foreground">다음 액션</span>{' '}
          {ctx.nextAction}
        </p>
      )}
      {/* ④ 생성/재생성 버튼 행 — 항상 렌더. 신선도는 summary 있을 때만. */}
      <div className="mt-3 flex items-center gap-3">
        <Button
          size="sm"
          variant="outline"
          onClick={onGenerate}
          disabled={isGenerating}
          data-testid="issue-summary-generate"
        >
          {isGenerating ? '생성 중…' : hasSummary ? '재생성' : '생성'}
        </Button>
        {/* 신선도 레이블 — summary 생성 시각(generatedAt) 기반 상대시간 */}
        {hasSummary && ctx.generatedAt && (
          <span className="text-xs text-muted-foreground">
            {formatRelativeTime(ctx.generatedAt)}
          </span>
        )}
      </div>
    </AiContent>
  )
}
