// 관찰 보고 — Pod 상태를 Works 의 phase 다섯 값으로 옮기고, metrics.k8s.io 수량을 숫자로 바꾼다.
import type { V1ContainerStatus, V1Pod } from '@kubernetes/client-node';
import { podGeneration } from './k8s/manifest.js';
import type { RunnerObservedAgent } from './works/client.js';

/** Works 가 받는 message 최대 길이. */
export const MESSAGE_MAX = 500;

/** 이 사유로 기다리는 컨테이너는 스스로 낫지 않는다 — FAILED 로 알린다. */
const FAILING_WAIT_REASONS = new Set(['CrashLoopBackOff', 'ImagePullBackOff', 'ErrImagePull']);

/** Pod 하나의 관찰 값(AI id·사용량은 부르는 쪽이 붙인다). */
export type ObservedState = Pick<RunnerObservedAgent, 'observedGeneration' | 'phase' | 'message' | 'startedAt'>;

/** Date·문자열 어느 쪽이 와도 ISO-8601 로 — 생성 타입은 Date 지만 가짜·직렬화된 값은 문자열이다. */
function iso(v: Date | string | undefined): string | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Works message 길이에 맞춰 자른다. */
export const clip = (s: string) => (s.length > MESSAGE_MAX ? s.slice(0, MESSAGE_MAX) : s);
const join = (a: string, b?: string) => (b ? `${a} — ${b}` : a);

function failingContainer(statuses: V1ContainerStatus[]): string | null {
  for (const s of statuses) {
    const waiting = s.state?.waiting;
    if (waiting?.reason && FAILING_WAIT_REASONS.has(waiting.reason)) {
      return join(`${s.name}: ${waiting.reason}`, waiting.message);
    }
  }
  return null;
}

/**
 * Pod → phase. stopping 은 그 AI 가 desired 에서 빠졌는지(지우는 중) — Pod 가 없으면 STOPPED, 있으면 STARTING(아직 못 만듦).
 * 순서: 지우는 중 → 실패 → 준비 중 → 실행 중.
 */
export function toObserved(pod: V1Pod | undefined, stopping: boolean): ObservedState {
  if (!pod) {
    return { observedGeneration: null, phase: stopping ? 'STOPPED' : 'STARTING', message: null, startedAt: null };
  }
  const base = { observedGeneration: podGeneration(pod), startedAt: iso(pod.status?.startTime) };

  if (pod.metadata?.deletionTimestamp) return { ...base, phase: 'STOPPING', message: null };

  const status = pod.status ?? {};
  if (status.phase === 'Failed') {
    return { ...base, phase: 'FAILED', message: clip(join(status.reason ?? 'Pod 실패', status.message)) };
  }
  if (status.phase === 'Succeeded') {
    // restartPolicy Always 라 정상이면 오지 않는다 — 끝나 버린 Pod 는 실패로 알린다
    return { ...base, phase: 'FAILED', message: 'Pod 가 끝났습니다' };
  }
  const statuses = [...(status.initContainerStatuses ?? []), ...(status.containerStatuses ?? [])];
  const failing = failingContainer(statuses);
  if (failing) return { ...base, phase: 'FAILED', message: clip(failing) };

  const containers = status.containerStatuses ?? [];
  const allReady = status.phase === 'Running' && containers.length > 0 && containers.every((c) => c.ready);
  return { ...base, phase: allReady ? 'RUNNING' : 'STARTING', message: null };
}

/** CPU 수량 → 밀리코어(반올림). 1, 250m, 250000000n, 1500u 모양. 모르면 undefined. */
export function parseCpuMillicores(q: string): number | undefined {
  const m = /^(\d+(?:\.\d+)?)(n|u|m)?$/.exec(q?.trim() ?? '');
  if (!m) return undefined;
  const n = Number(m[1]);
  const scale = { n: 1e-6, u: 1e-3, m: 1 }[m[2] as 'n' | 'u' | 'm'] ?? 1000;
  return Math.round(n * scale);
}

const MEMORY_UNITS: Record<string, number> = {
  '': 1,
  k: 1e3,
  M: 1e6,
  G: 1e9,
  T: 1e12,
  Ki: 1024,
  Mi: 1024 ** 2,
  Gi: 1024 ** 3,
  Ti: 1024 ** 4,
};

/** 메모리 수량 → 바이트. 123456, 1024Ki, 3Gi, 500M 모양. 모르면 undefined. */
export function parseMemoryBytes(q: string): number | undefined {
  const m = /^(\d+(?:\.\d+)?)(k|M|G|T|Ki|Mi|Gi|Ti)?$/.exec(q?.trim() ?? '');
  if (!m) return undefined;
  return Math.round(Number(m[1]) * (MEMORY_UNITS[m[2] ?? ''] ?? 1));
}
