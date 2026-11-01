// AI 실행(WP-1245) 화면 판정 — 실행 방식 구분·상태 알약·자원 표기. 화면과 분리해 vitest 로 지킨다.

import type { StatusBadgeType } from '../components/ui/status-badge';
import type { AgentRuntime } from '../types/agent';
import type {
  AgentLocation,
  AgentObservedState,
  AgentRuntimeStatus,
  AgentTemplate,
  LocationConnection,
} from '../types/agentRuntime';
import { formatClockTimeCompact } from './formatters';

/**
 * 화면의 실행 방식 — 작업 공간 템플릿으로 도는 AI 는 DB 에 EXTERNAL 로 저장되지만(서버 AI 가 이슈를 처리하지 않게) 화면에서는 「내부」다.
 * 그래서 「외부」는 EXTERNAL 이면서 실행 설정이 없을 때뿐이다.
 */
export function runtimeView(runtime: AgentRuntime, hasSetting: boolean): 'INTERNAL' | 'EXTERNAL' {
  // 외부는 EXTERNAL 로 저장됐고 실행 설정이 없을 때만 — 그 밖(실행 방식이 비어 온 옛 응답 포함)은 지금까지처럼 내부.
  return runtime === 'EXTERNAL' && !hasSetting ? 'EXTERNAL' : 'INTERNAL';
}

export interface StatusPill {
  label: string;
  type: StatusBadgeType;
}

/**
 * 상태 알약 — 켜져 있으면(RUNNING·APPLY_PENDING) AI 가 보고한 일 상태로 나눈다. 아직 보고가 없으면 「켜는 중」.
 */
export function statusPill(
  status: AgentRuntimeStatus,
  agentState: AgentObservedState['agentState'] | null | undefined,
): StatusPill {
  switch (status) {
    case 'OFF':
      return { label: '꺼짐', type: 'inactive' };
    case 'STARTING':
      return { label: '켜는 중', type: 'info' };
    case 'STOPPING':
      return { label: '끄는 중', type: 'pending' };
    case 'FAILED':
      return { label: '실패', type: 'error' };
    default:
      if (agentState === 'WORKING') return { label: '작업 중', type: 'active' };
      if (agentState === 'IDLE') return { label: '대기', type: 'pending' };
      if (agentState === 'BLOCKED') return { label: '막힘', type: 'warning' };
      return { label: '켜는 중', type: 'info' };
  }
}

/** 켜져 있는 상태인지 — 「다시 시작」「끄기」를 보일지. */
export function isRunningStatus(status: AgentRuntimeStatus): boolean {
  return status === 'STARTING' || status === 'RUNNING' || status === 'APPLY_PENDING';
}

/** 상태 옆 한 줄의 종류 — 화면이 글자를 다시 읽지 않고 모양(이슈 링크·오류 색)을 고른다. */
export type StatusDetail = { kind: 'issue' | 'nextCheck' | 'error'; text: string };

/**
 * 상태 옆 한 줄 — 작업 중·막힘이면 처리 중 이슈 키, 대기면 「다음 확인 HH:mm」, 실패면 사유. 보일 것이 없으면 null.
 */
export function statusDetail(s: {
  status: AgentRuntimeStatus;
  agentState: AgentObservedState['agentState'] | null | undefined;
  agentIssueKey: string | null | undefined;
  agentNextCheckAt: string | null | undefined;
  message: string | null | undefined;
}): StatusDetail | null {
  if (s.status === 'FAILED') return s.message ? { kind: 'error', text: s.message } : null;
  if (s.status !== 'RUNNING' && s.status !== 'APPLY_PENDING') return null;
  if ((s.agentState === 'WORKING' || s.agentState === 'BLOCKED') && s.agentIssueKey) return { kind: 'issue', text: s.agentIssueKey };
  if (s.agentState === 'IDLE' && s.agentNextCheckAt)
    return { kind: 'nextCheck', text: `다음 확인 ${formatClockTimeCompact(s.agentNextCheckAt)}` };
  return null;
}

/** CPU 사용량 — 밀리코어 → 「1.2 코어」. 모르면 「-」. */
export function formatCpu(millicores: number | null | undefined): string {
  if (millicores == null) return '-';
  return `${(millicores / 1000).toFixed(1)} 코어`;
}

const GIB = 1024 ** 3;

/** 쿠버네티스 메모리 수량(8Gi·512Mi·16G) → 바이트. 해석 못 하면 null. */
export function parseMemoryQuantity(q: string | null | undefined): number | null {
  if (!q) return null;
  const m = /^(\d+(?:\.\d+)?)(Ki|Mi|Gi|Ti|K|M|G|T)?$/.exec(q.trim());
  if (!m) return null;
  const unit: Record<string, number> = {
    Ki: 1024, Mi: 1024 ** 2, Gi: GIB, Ti: 1024 ** 4, K: 1e3, M: 1e6, G: 1e9, T: 1e12,
  };
  return Number(m[1]) * (m[2] ? unit[m[2]] : 1);
}

/** 메모리 사용량 — 「3.0 / 16 GiB」(상한을 알면) 또는 「3.0 GiB」. 모르면 「-」. */
export function formatMemory(bytes: number | null | undefined, limit: string | null | undefined): string {
  if (bytes == null) return '-';
  const used = (bytes / GIB).toFixed(1);
  const max = parseMemoryQuantity(limit);
  return max ? `${used} / ${Math.round(max / GIB)} GiB` : `${used} GiB`;
}

/** 켜진 시간 — 시작 시각부터 지금까지 「1시간 12분」「8분」. 모르면 「-」. */
export function formatUptime(startedAt: string | null | undefined, now: Date): string {
  if (!startedAt) return '-';
  const ms = now.getTime() - new Date(startedAt).getTime();
  if (Number.isNaN(ms) || ms < 0) return '-';
  const min = Math.floor(ms / 60000);
  if (min < 1) return '1분 미만';
  if (min < 60) return `${min}분`;
  const h = Math.floor(min / 60);
  if (h < 24) return min % 60 ? `${h}시간 ${min % 60}분` : `${h}시간`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d}일 ${h % 24}시간` : `${d}일`;
}

/** 템플릿이 요구하는 자원 한 줄 — 「CPU 4코어 · 메모리 8Gi 필요」. 요청값이 없으면 null. */
export function templateResourceText(t: AgentTemplate): string | null {
  const r = t.resources;
  if (!r || (!r.cpuRequest && !r.memoryRequest)) return null;
  const parts = [r.cpuRequest && `CPU ${r.cpuRequest}코어`, r.memoryRequest && `메모리 ${r.memoryRequest}`].filter(Boolean);
  return `${parts.join(' · ')} 필요`;
}

/** 템플릿 config 기본값으로 채운 설정 — 저장된 값이 있으면 그것이 먼저다. */
export function configWithDefaults(t: AgentTemplate, saved: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of t.config) {
    const v = saved?.[f.key] ?? f.default;
    if (v != null) out[f.key] = v;
  }
  return out;
}

/** 위치 연결 알약. */
export function connectionPill(c: LocationConnection): StatusPill {
  if (c === 'CONNECTED') return { label: '연결됨', type: 'active' };
  if (c === 'DISCONNECTED') return { label: '끊김', type: 'error' };
  return { label: '설치 대기', type: 'pending' };
}

/** 위치에 남은 자리. */
export function freeSeats(l: Pick<AgentLocation, 'capacity' | 'used'>): number {
  return Math.max(0, l.capacity - l.used);
}

/** 위치 이름과 남은 자리 — 「운영 (기본) · 남은 자리 2」. 기본 표시가 따로 있는 자리(「워크스페이스 기본」)는 markDefault false. */
export function locationOptionLabel(l: AgentLocation, markDefault = true): string {
  return `${l.name}${markDefault && l.isDefault ? ' (기본)' : ''} · 남은 자리 ${freeSeats(l)}`;
}
