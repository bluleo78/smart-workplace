// 모바일 이슈 상세 AI 진행 칩(WP-377) — 속성 칩 줄 아래, 작업자별 [아바타 + AI 진행 배지] 칩.
// 레일이 없는 모바일에서 진행 상태를 한눈에 보이고, 탭하면 레일과 같은 내용의 「AI 진행」 시트를 연다.
import { AgentStateBadge } from '@/components/ai/agentWork/AgentWorkBits';
import { UserAvatar } from '@/components/users/UserAvatar';
import { AGENT_STATE_LABEL, byUrgency } from '@/lib/agentWork';
import { cn } from '@/lib/utils';
import { MOBILE_CHIP } from '@/pages/projects/components/mobile/chipStyles';
import type { AgentWorkView } from '@/types/issue';

/** 작업자별 칩 줄 — 급한 순. 진행 중 작업이 없으면 렌더하지 않는다. onOpen 은 「AI 진행」 시트를 연다. */
export function AgentWorkMobileChips({ list, onOpen }: { list?: AgentWorkView[]; onOpen: () => void }) {
  if (!list || list.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="AI 진행">
      {byUrgency(list).map((w) => (
        <button
          key={w.worker.id}
          type="button"
          className={cn(MOBILE_CHIP, 'gap-1.5 pl-1.5')}
          onClick={onOpen}
          aria-label={`${w.worker.name} · ${AGENT_STATE_LABEL[w.state]}`}
          data-testid={`agent-work-chip-${w.worker.id}`}
        >
          <UserAvatar user={w.worker} size="xs" agent={w.worker.kind === 'AGENT'} />
          <AgentStateBadge state={w.state} />
        </button>
      ))}
    </div>
  );
}
