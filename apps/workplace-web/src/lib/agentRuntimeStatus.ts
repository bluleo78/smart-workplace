// AI 실행(WP-1245) 화면 판정 — 실행 방식 구분·상태 알약·자원 표기. 화면과 분리해 vitest 로 지킨다.

import type { StatusBadgeType } from '../components/ui/status-badge';
import type {
  AgentLocation,
  AgentObservedState,
  AgentRuntimeStatus,
  AgentTemplate,
  LocationConnection,
} from '../types/agentRuntime';
import { formatClockTimeCompact } from './formatters';

export interface StatusPill {
  label: string;
  type: StatusBadgeType;
}

/**
 * 상태 알약 — 실행 중이면(RUNNING·APPLY_PENDING) AI 가 보고한 일 상태로 나눈다. 아직 보고가 없으면 「시작하는 중」.
 * 문구는 에이전트 상세 시안(WP-1281)의 상태 종류 그대로 — 꺼짐·시작하는 중·작업 중·쉬는 중·막힘·실패·멈추는 중.
 */
export function statusPill(
  status: AgentRuntimeStatus,
  agentState: AgentObservedState['agentState'] | null | undefined,
): StatusPill {
  switch (status) {
    case 'OFF':
      return { label: '꺼짐', type: 'inactive' };
    case 'STARTING':
      return { label: '시작하는 중', type: 'info' };
    case 'STOPPING':
      return { label: '멈추는 중', type: 'inactive' };
    case 'FAILED':
      return { label: '실패', type: 'error' };
    default:
      if (agentState === 'WORKING') return { label: '작업 중', type: 'active' };
      if (agentState === 'IDLE') return { label: '쉬는 중', type: 'active' };
      if (agentState === 'BLOCKED') return { label: '막힘', type: 'warning' };
      return { label: '시작하는 중', type: 'info' };
  }
}

/** 실행 중인 상태인지 — 「다시 시작」「실행 멈춤」을 보일지. */
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

/** 실행 환경 이름과 여유 — 「운영 (기본) · 2명 더 띄울 수 있음」. 기본 표시가 따로 있는 자리(「워크스페이스 기본」)는 markDefault false. */
export function locationOptionLabel(l: AgentLocation, markDefault = true): string {
  return `${l.name}${markDefault && l.isDefault ? ' (기본)' : ''} · ${freeSeats(l)}명 더 띄울 수 있음`;
}

/** 실행 전 확인의 「실행 환경 여유」 설명 — 「PoC 에는 AI 를 4명까지 띄울 수 있고 지금 2명이 쓰고 있어요」. */
export function locationCapacityText(l: Pick<AgentLocation, 'name' | 'capacity' | 'used'>): string {
  return `${l.name} 에는 AI 를 ${l.capacity}명까지 띄울 수 있고 지금 ${l.used}명이 쓰고 있어요`;
}

/**
 * 실행 환경을 지울 수 없는 이유 — 서버 거절 조건과 같다: 기본 실행 환경이거나, 이 환경을 직접 고른 실행 설정이 하나라도 있으면(꺼져 있어도).
 * 지울 수 있으면 null. (예전 화면은 실행 중인 AI 가 있을 때만 막아 서버 409 를 그대로 맞았다.)
 */
export function locationDeleteBlockReason(l: Pick<AgentLocation, 'isDefault' | 'settingCount'>): string | null {
  if (l.isDefault) return '기본 실행 환경은 지울 수 없어요';
  if (l.settingCount > 0) return '이 실행 환경을 쓰는 AI 가 있어 지울 수 없어요';
  return null;
}

/** 쿠버네티스 메모리 수량을 화면 표기로 — 16Gi → 16GiB, 512Mi → 512MiB. 그 밖은 그대로. */
function memoryText(q: string): string {
  return /i$/.test(q) ? `${q}B` : q;
}

/** 최대 자원 한 줄 — 「8코어 · 16GiB」. 상한이 없으면 null. */
export function resourceLimitText(t: AgentTemplate): string | null {
  const r = t.resources;
  if (!r || (!r.cpuLimit && !r.memoryLimit)) return null;
  return [r.cpuLimit && `${r.cpuLimit}코어`, r.memoryLimit && memoryText(r.memoryLimit)].filter(Boolean).join(' · ');
}

/** 작업 설정 아래 자원 안내 — 「평소 4코어·8GiB, 많이 쓸 때 최대 8코어·16GiB」. 요청값이 없으면 null. */
export function workResourceText(t: AgentTemplate): string | null {
  const r = t.resources;
  if (!r || (!r.cpuRequest && !r.memoryRequest)) return null;
  const pair = (cpu: string | null, mem: string | null) =>
    [cpu && `${cpu}코어`, mem && memoryText(mem)].filter(Boolean).join('·');
  const base = `평소 ${pair(r.cpuRequest, r.memoryRequest)}`;
  return r.cpuLimit || r.memoryLimit ? `${base}, 많이 쓸 때 최대 ${pair(r.cpuLimit, r.memoryLimit)}` : base;
}
