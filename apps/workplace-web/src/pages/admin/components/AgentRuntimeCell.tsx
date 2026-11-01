// 에이전트 목록 「실행」 열(WP-1255) — 실행 방식 배지 + 작업 공간 템플릿이면 상태 알약·처리 중 이슈(또는 다음 확인)·기본이 아닌 위치.
// 외부는 지금처럼 키 사용 시각을 보인다. 모바일은 이름 아래 줄에 배지·알약만(AgentRuntimeMetaBadge).

import { Badge } from '@/components/ui/badge';
import { StatusBadge } from '@/components/ui/status-badge';

import { externalKeyStatusText, runtimeBadgeLabel } from '../../../lib/agentRuntime';
import { statusDetail, statusPill } from '../../../lib/agentRuntimeStatus';
import type { AgentResponse } from '../../../types/agent';
import type { AgentRuntimeSummary } from '../../../types/agentRuntime';

interface Props {
  agent: AgentResponse;
  /** 작업 공간 템플릿 실행 요약 — 없으면 「기본」 또는 외부. */
  summary: AgentRuntimeSummary | null;
}

const DETAIL_CLASS = {
  error: 'max-w-48 truncate text-xs text-destructive',
  issue: 'font-mono text-xs',
  nextCheck: 'text-xs text-muted-foreground',
} as const;

/** 실행 방식 배지 — 작업 공간 템플릿이면 「내부 · 템플릿 이름」. */
function RuntimeBadge({ agent, summary }: Props) {
  // 템플릿이 빠졌으면 제목 대신 이름과 「템플릿 없음」 — 빈 배지로 두면 무엇이 문제인지 알 수 없다.
  if (summary) return <Badge variant="secondary">{runtimeBadgeLabel('INTERNAL')} · {summary.templateTitle ?? `${summary.templateName} (템플릿 없음)`}</Badge>;
  return <Badge variant={agent.runtime === 'EXTERNAL' ? 'info' : 'secondary'}>{runtimeBadgeLabel(agent.runtime)}</Badge>;
}

export function AgentRuntimeCell({ agent, summary }: Props) {
  if (!summary) {
    return (
      <div className="flex flex-col items-start gap-0.5">
        <RuntimeBadge agent={agent} summary={null} />
        {agent.runtime === 'EXTERNAL' && (
          <span className="text-xs text-muted-foreground" data-testid={`agent-key-status-${agent.id}`}>
            {externalKeyStatusText(agent.lastKeyUsedAt)}
          </span>
        )}
      </div>
    );
  }
  const pill = statusPill(summary.status, summary.agentState);
  const detail = statusDetail(summary);
  return (
    <div className="flex flex-col items-start gap-1">
      <RuntimeBadge agent={agent} summary={summary} />
      <div className="flex flex-wrap items-center gap-1.5">
        <StatusBadge type={pill.type} data-testid={`agent-runtime-status-${agent.id}`}>
          {pill.label}
        </StatusBadge>
        {detail && (
          <span
            className={DETAIL_CLASS[detail.kind]}
            title={detail.text}
            data-testid={`agent-runtime-detail-${agent.id}`}
          >
            {detail.text}
          </span>
        )}
      </div>
      {summary.locationName && (
        <span className="text-xs text-muted-foreground" data-testid={`agent-runtime-location-${agent.id}`}>
          {summary.locationName}
        </span>
      )}
    </div>
  );
}

/** 모바일 이름 아래 줄 — 배지 + (작업 공간이면) 상태 알약. */
export function AgentRuntimeMetaBadge({ agent, summary }: Props) {
  if (!summary) return <RuntimeBadge agent={agent} summary={null} />;
  const pill = statusPill(summary.status, summary.agentState);
  return (
    <>
      <RuntimeBadge agent={agent} summary={summary} />
      <StatusBadge type={pill.type}>{pill.label}</StatusBadge>
    </>
  );
}
