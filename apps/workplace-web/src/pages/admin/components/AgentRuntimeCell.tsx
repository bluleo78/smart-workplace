// 에이전트 목록의 실행 관련 세 열(WP-1255 → WP-1513 에서 「실행」 한 열을 셋으로 나눔) — 실행 방식 | 상태 | 실행 환경.
// - 실행 방식: 배지(기본·Claude Code 등·외부, 서버가 판정한 runMode).
// - 상태: Works 가 실행하는 AI 면 상태 알약 + 한 줄(이슈 키·다음 확인·오류 사유), 외부는 마지막 접속 시각, 기본은 「—」.
// - 실행 환경: Works 가 실행하는 AI 면 기본 환경이어도 이름(서버가 실제 실행 위치 이름을 싣는다), 그 밖은 「—」.
// 행 높이를 한 줄로 맞추려고 세 칸 모두 줄바꿈 없이 가로로 놓고, 긴 글은 잘라 title 로 전부 보인다.
// 모바일은 이름 아래 줄에 배지·알약만(AgentRuntimeMetaBadge).
// 「실행 방식」 옆 「계정」 칸(AgentAccountCell, WP-1513)도 여기 둔다 — 같은 한 줄·「—」 규칙을 따른다.

import { Badge } from '@/components/ui/badge';
import { StatusBadge } from '@/components/ui/status-badge';

import { externalKeyStatusText } from '../../../lib/agentRuntime';
import { statusDetail, statusPill } from '../../../lib/agentRuntimeStatus';
import type { AgentResponse } from '../../../types/agent';
import type { AgentAccountResponse } from '../../../types/agentAccount';
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

/** 값이 없는 칸 — 비워 두면 데이터가 아직 안 온 것처럼 보여 「—」로 「해당 없음」을 밝힌다. */
function EmptyValue() {
  return <span className="text-xs text-muted-foreground">—</span>;
}

/** 실행 방식 배지 — 기본 / (Works 실행 방식 이름, 예: Claude Code) / 외부. */
function RuntimeBadge({ agent, summary }: Props) {
  // 방식 정의가 릴리스에서 빠졌으면 이름 뒤에 「(지원 끝남)」 — 빈 배지로 두면 무엇이 문제인지 알 수 없다.
  if (summary) return <Badge variant="secondary">{summary.templateTitle ?? `${summary.templateName} (지원 끝남)`}</Badge>;
  if (agent.runMode === 'EXTERNAL') return <Badge variant="info">외부</Badge>;
  return <Badge variant="secondary">기본</Badge>;
}

/** 「실행 방식」 칸 — 배지 하나. */
export function AgentRunModeCell({ agent, summary }: Props) {
  return <RuntimeBadge agent={agent} summary={summary} />;
}

/**
 * 「계정」 칸 — 이 AI 가 묶인 AI 계정(WP-1451)의 이름. 잘린 이름도 읽히게 title 에 이름 전체를, 로그인 계정이면 뒤에 이메일을 붙여 보인다.
 * 묶인 계정이 없거나 계정 목록을 못 읽었으면(account=null) 「—」.
 */
export function AgentAccountCell({ agentId, account }: { agentId: number; account: AgentAccountResponse | null }) {
  if (!account) return <EmptyValue />;
  return (
    <span
      className="block max-w-40 truncate text-xs"
      title={account.accountEmail ? `${account.label} (${account.accountEmail})` : account.label}
      data-testid={`agent-account-${agentId}`}
    >
      {account.label}
    </span>
  );
}

/** 「상태」 칸 — Works 실행 AI 는 알약 + 한 줄 설명, 외부는 마지막 접속 시각, 기본은 「—」. */
export function AgentRunStateCell({ agent, summary }: Props) {
  if (!summary) {
    if (agent.runMode !== 'EXTERNAL') return <EmptyValue />;
    return (
      <span className="text-xs text-muted-foreground" data-testid={`agent-key-status-${agent.id}`}>
        {externalKeyStatusText(agent.lastKeyUsedAt)}
      </span>
    );
  }
  const pill = statusPill(summary.status, summary.agentState);
  const detail = statusDetail(summary);
  return (
    // 알약과 설명을 한 줄로(칸의 줄바꿈 막기는 TableCell 이 한다) — 긴 오류 사유는 DETAIL_CLASS 가 잘라 title 로 보인다.
    <div className="flex items-center gap-1.5">
      <StatusBadge type={pill.type} data-testid={`agent-runtime-status-${agent.id}`}>
        {pill.label}
      </StatusBadge>
      {detail && (
        <span
          className={DETAIL_CLASS[detail.kind]}
          title={detail.kind === 'issue' ? detail.keys.join(', ') : detail.text}
          data-testid={`agent-runtime-detail-${agent.id}`}
        >
          {detail.text}
        </span>
      )}
    </div>
  );
}

/** 「실행 환경」 칸 — Works 실행 AI 면 실제 실행 위치 이름(기본 환경 포함), 그 밖(기본·외부, 이름 없음)은 「—」. */
export function AgentRunLocationCell({ agent, summary }: Props) {
  if (!summary?.locationName) return <EmptyValue />;
  return (
    <span
      className="block max-w-40 truncate text-xs text-muted-foreground"
      title={summary.locationName}
      data-testid={`agent-runtime-location-${agent.id}`}
    >
      {summary.locationName}
    </span>
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
