import { AiContent } from '@/components/ai/AiContent'
import { AiSignalBadge } from '@/components/ai/AiSignalBadge'
import type { AiSignalVariant } from '@/components/ai/aiMarker'
import type { IssueAiContext, IssueBlockerBadge } from '@/types/issue'

// 블로커 타입 → AiSignalBadge variant 매핑.
// AiSignalVariant 실제 어휘: 'action'(사용자 행동 필요) | 'info'(정보성).
// BLOCKED/OVERDUE = 즉각 행동 필요 → 'action', STALE = 정보성 알림 → 'info'.
export function badgeVariant(type: IssueBlockerBadge['type']): AiSignalVariant {
  if (type === 'BLOCKED') return 'action'
  if (type === 'OVERDUE') return 'action'
  return 'info'
}

// 카드를 렌더할 실질적 내용이 있는지 판단. summary(공백제거 후 비어있지 않음) 또는 blockers 1개 이상이면 true.
// null/undefined → false(카드 미렌더).
export function hasCardContent(ctx: IssueAiContext | null | undefined): boolean {
  if (!ctx) return false
  return Boolean(ctx.summary?.trim()) || ctx.blockers.length > 0
}

/** 이슈 상세 상단 AI 즉각 컨텍스트 카드 (#517).
 *  aiContext 없거나 표시할 내용이 없으면 null 반환(미렌더).
 *  ① 현황 한 줄(summary) ② 블로커 배지(있을 때만) ③ 다음 액션(있을 때만).
 */
export function IssueInstantContextCard({ aiContext }: { aiContext?: IssueAiContext | null }) {
  // 내용 없으면 카드 자체를 렌더하지 않는다 — 빈 AI 컨테이너 노출 방지.
  if (!hasCardContent(aiContext)) return null
  const ctx = aiContext!
  return (
    <AiContent label="AI 현황 요약" data-testid="issue-instant-context">
      {/* ① 현황 요약 한 줄 */}
      {ctx.summary?.trim() && (
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
      {/* ③ 다음 액션 — 있을 때만 */}
      {ctx.nextAction?.trim() && (
        <p className="mt-2 text-sm" data-testid="issue-next-action">
          <span className="text-muted-foreground">다음 액션</span>{' '}
          {ctx.nextAction}
        </p>
      )}
    </AiContent>
  )
}
