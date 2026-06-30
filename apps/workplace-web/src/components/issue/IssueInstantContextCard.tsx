import { Loader2, RotateCcw } from 'lucide-react'

import { AiContent } from '@/components/ai/AiContent'
import type { AiSignalVariant } from '@/components/ai/aiMarker'
import { Badge } from '@/components/ui/badge'
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
 * 접기/펼치기 — 공용 AiContent 의 collapsible(<details>) 재사용(기본 펼침).
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
    <AiContent label="AI 현황 요약" collapsible data-testid="issue-instant-context">
      {/* space-y-2 로 간격 통일(순서 의존성 제거). 순서: ① 블로커 → ② 요약 → ③ 다음 액션 → ④ 버튼. */}
      <div className="space-y-2">
        {/* ① 블로커 배지 목록 — 긴급 신호이므로 요약보다 위. 있을 때만.
            AI 컨테이너(이 카드) 내부이므로 AI 마커(AiSignalBadge ✨) 대신 일반 상태 배지를 쓴다.
            블로커는 차단/마감초과/정체 등 결정적 상태값이라 AI 판단 신호도 아니다.
            action(BLOCKED/OVERDUE)=warning(주의), info(STALE)=info 톤으로 매핑. */}
        {ctx.blockers.length > 0 && (
          <div className="flex flex-wrap gap-2" data-testid="issue-blocker-badges">
            {ctx.blockers.map((b) => (
              <Badge
                key={b.type}
                variant={badgeVariant(b.type) === 'action' ? 'warning' : 'info'}
                data-testid={`blocker-${b.type}`}
              >
                {b.message}
              </Badge>
            ))}
          </div>
        )}
        {/* ② 현황 요약 한 줄 — summary 있을 때만 */}
        {hasSummary && <p className="text-sm leading-relaxed">{ctx.summary}</p>}
        {/* ③ 다음 액션 — summary 있을 때만 */}
        {hasSummary && ctx.nextAction?.trim() && (
          <p className="text-sm" data-testid="issue-next-action">
            <span className="text-muted-foreground">다음 액션</span>{' '}
            {ctx.nextAction}
          </p>
        )}
        {/* ④ 생성/재생성 버튼 행 — 항상 렌더. 신선도는 summary 있을 때만. */}
        <div className="flex items-center gap-3 pt-1">
        <Button
          size="sm"
          variant="outline"
          onClick={onGenerate}
          disabled={isGenerating}
          data-testid="issue-summary-generate"
          // AI 테마 — 카드 아우라(ai-accent)와 일관. 디자인 시스템 토큰만 사용(violet 하드코딩 금지).
          className="gap-1.5 border-ai-accent/40 text-ai-accent hover:border-ai-accent hover:bg-ai-accent-subtle hover:text-ai-accent"
        >
          {/* 아이콘 — AI 컨테이너 내부라 AI 마커(✨) 대신 일반 아이콘만.
              생성 중=스피너 / 갱신=회전 / 첫 생성=아이콘 없음. */}
          {isGenerating ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          ) : hasSummary ? (
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
          ) : null}
          {isGenerating ? '생성 중…' : hasSummary ? '요약 갱신' : '요약 생성'}
        </Button>
        {/* 신선도 레이블 — summary 생성 시각(generatedAt) 기반 상대시간 */}
        {hasSummary && ctx.generatedAt && (
          <span className="text-xs text-muted-foreground">
            {formatRelativeTime(ctx.generatedAt)}
          </span>
        )}
        </div>
      </div>
    </AiContent>
  )
}
