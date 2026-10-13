// 이슈 상세 「AI 진행」 섹션(WP-377) — 데스크톱 속성 레일(담당자 아래)과 모바일 「AI 진행」 시트가 같은 내용을 쓴다.
// 작업자별 한 덩어리: [아바타 · 이름 · AI 진행 배지] / 최근 보고 / [에이전트 유형 · 진행률(있을 때만) · 마지막 보고].
import { AgentLastReport, AgentProgress, AgentStateBadge, AgentToolChip } from '@/components/ai/agentWork/AgentWorkBits';
import { UserAvatar } from '@/components/users/UserAvatar';
import { byUrgency } from '@/lib/agentWork';
import type { AgentWorkView } from '@/types/issue';

/**
 * AI 진행 섹션 — 진행 중 작업이 없으면 렌더하지 않는다. 급한 순(답변 필요 → … → 일시 중지)으로 보인다.
 * hideLabel: 시트처럼 제목이 이미 「AI 진행」인 곳에선 섹션 라벨을 숨긴다(같은 말 두 번 방지).
 */
export function AgentWorkRailSection({ list, hideLabel = false }: { list?: AgentWorkView[]; hideLabel?: boolean }) {
  if (!list || list.length === 0) return null;
  return (
    <div className="space-y-1" data-testid="agent-work-rail">
      {!hideLabel && <span className="text-xs font-medium text-muted-foreground">AI 진행</span>}
      {/* 왼쪽만 들여 담당자 아바타와 줄을 맞추고, 오른쪽은 위 셀렉트 끝선까지 써서 메타 줄(유형·진행률·마지막 보고)이 280px 레일에 들어가게 한다. */}
      <ul className="space-y-3 py-1 pl-3">
        {byUrgency(list).map((w) => {
          // 작업자는 이슈당 진행 중 작업 1건(서버 부분 유니크) — key·testid 로 쓴다.
          const id = `agent-work-rail-${w.worker.id}`;
          return (
            <li key={w.worker.id} className="min-w-0 space-y-1 text-sm" data-testid={id}>
              <div className="flex min-w-0 items-center gap-1.5">
                <UserAvatar user={w.worker} size="xs" agent={w.worker.kind === 'AGENT'} />
                <span className="min-w-0 truncate">{w.worker.name}</span>
                <span className="ml-auto shrink-0">
                  <AgentStateBadge state={w.state} data-testid={`${id}-state`} />
                </span>
              </div>
              {/* 최근 보고 — 좁은 레일이라 두 줄까지, 넘치면 말줄임 + 마우스 올리면 전체. */}
              {w.note && (
                <p className="line-clamp-2 break-words pl-6 text-xs text-muted-foreground" title={w.note}>
                  {w.note}
                </p>
              )}
              {/* 메타 줄 — 유형 칩이 먼저 줄어들고 진행률·마지막 보고는 한 줄을 지킨다(시제품에서 "5분 전"이 세로로 쪼개지던 문제). */}
              <div className="flex min-w-0 items-center gap-2 pl-6">
                <AgentToolChip tool={w.tool} className="min-w-0 shrink" />
                <AgentProgress w={w} compact hideEmpty className="shrink-0" data-testid={`${id}-progress`} />
                <AgentLastReport w={w} className="ml-auto shrink-0 whitespace-nowrap" data-testid={`${id}-last`} />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
