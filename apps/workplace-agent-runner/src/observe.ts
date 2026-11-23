// 관찰 보고 — Pod 상태를 Works 의 phase 다섯 값으로 옮기고, metrics.k8s.io 수량을 숫자로 바꾼다.
import type { V1ContainerStatus, V1Pod } from '@kubernetes/client-node';
import { podGeneration } from './k8s/manifest.js';
import type { RunnerObservedAgent } from './works/client.js';

/** Works 가 받는 message 최대 길이. */
export const MESSAGE_MAX = 500;

/** 이 사유로 기다리는 컨테이너는 스스로 낫지 않는다 — FAILED 로 알린다. */
const FAILING_WAIT_REASONS = new Set(['CrashLoopBackOff', 'ImagePullBackOff', 'ErrImagePull']);

/** Pod 하나의 관찰 값(AI id·사용량은 부르는 쪽이 붙인다). podUid — 지금 떠 있는 Pod 의 정체(WP-1968). */
export type ObservedState = Pick<RunnerObservedAgent, 'observedGeneration' | 'phase' | 'message' | 'startedAt' | 'podUid'>;

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
 * 끝나 버린 Pod(phase Succeeded·Failed)의 사유 한 줄(500자) — 관찰 보고·로그·연속 끝남 실패 사유(WP-1501)가 같은 글을 쓴다.
 * Failed 면 status.reason·message(Evicted — The node was low on resource: ephemeral-storage… 등), Succeeded 면 「Pod 가 끝났습니다」.
 */
export function podFinishReason(pod: V1Pod): string {
  const status = pod.status ?? {};
  // restartPolicy Always 라 정상이면 Succeeded 는 오지 않는다 — 끝나 버린 Pod 는 실패로 알린다
  if (status.phase === 'Succeeded') return 'Pod 가 끝났습니다';
  return clip(join(status.reason ?? 'Pod 실패', status.message));
}

/** 컨테이너 재시작 알림을 관찰 보고에 싣는 기간 — 지나면 조용히 지운다(OOMKilled 재시작은 Pod 가 계속 Running 이라 흔적이 남지 않던 것을 보완). */
export const RESTART_NOTICE_MS = 6 * 60 * 60_000;

/** 시각 at(ms)의 알림이 아직 실을 나이인지 — {@link RESTART_NOTICE_MS} 이하(경계 포함)면 참. 재시작 알림·끝난 Pod 알림이 함께 쓴다(WP-1795). */
export function isWithinNoticeWindow(at: number, now: number): boolean {
  return now - at <= RESTART_NOTICE_MS;
}

/** 알림 시각 포맷터 — 만드는 비용이 커서 모듈에서 한 번만 만든다. */
const NOTICE_TIME_FORMAT = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Seoul',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** 알림 시각 — KST `MM-DD HH:mm`(0 채움). 실행 머신의 TZ 에 기대지 않으려 timeZone 을 명시한다. */
export function formatNoticeTime(d: Date): string {
  const parts = NOTICE_TIME_FORMAT.formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  return `${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`;
}

/**
 * 최근 6시간 안에 재시작된 컨테이너가 있으면 그 사유 한 줄, 없으면 null.
 * 정상 종료(exit 0·Completed)는 알리지 않는다. init 컨테이너는 제외하고, 여러 컨테이너면 가장 늦게 끝난(finishedAt) 것을 고른다. finishedAt 이 없으면 시점을 몰라 무시.
 */
export function restartNotice(pod: V1Pod, now: Date): string | null {
  let best: { at: number; text: string } | null = null;
  for (const c of pod.status?.containerStatuses ?? []) {
    const t = c.lastState?.terminated;
    if (!t?.finishedAt) continue;
    const at = new Date(t.finishedAt).getTime();
    if (Number.isNaN(at) || !isWithinNoticeWindow(at, now.getTime())) continue;
    // 정상 종료(exit 0·Completed)로 끝난 재시작은 경고가 아니라 알리지 않는다 — OOMKilled 는 그대로 알린다
    if (t.reason !== 'OOMKilled' && (t.exitCode === 0 || t.reason === 'Completed')) continue;
    if (best && at <= best.at) continue;
    // exitCode 가 없으면 `(exit …)` 를 빼고 사유만 싣는다
    const code = t.exitCode === undefined || t.exitCode === null ? '' : `(exit ${t.exitCode})`;
    const why = t.reason === 'OOMKilled' ? '메모리 한도 초과(OOMKilled)' : `${t.reason ?? '종료'}${code}`;
    best = { at, text: `${c.name} 컨테이너가 다시 시작됐습니다 — ${why} · ${formatNoticeTime(new Date(at))}` };
  }
  return best ? clip(best.text) : null;
}

/**
 * Pod → phase. stopping 은 그 AI 가 desired 에서 빠졌는지(지우는 중) — Pod 가 없으면 STOPPED, 있으면 STARTING(아직 못 만듦).
 * 순서: 지우는 중 → 실패 → 준비 중 → 실행 중. 실행·준비 중엔 최근 컨테이너 재시작 알림을 message 로 싣는다(실패 message 는 가리지 않는다).
 */
export function toObserved(pod: V1Pod | undefined, stopping: boolean, now: Date = new Date()): ObservedState {
  if (!pod) {
    return { observedGeneration: null, phase: stopping ? 'STOPPED' : 'STARTING', message: null, startedAt: null, podUid: null };
  }
  // 지금 떠 있는 Pod 의 정체 — 서버가 이 값으로 지금 Pod 인지 판정한다(WP-1968). 없으면 null(구형 클러스터 응답 대비).
  const base = { observedGeneration: podGeneration(pod), startedAt: iso(pod.status?.startTime), podUid: pod.metadata?.uid ?? null };

  if (pod.metadata?.deletionTimestamp) return { ...base, phase: 'STOPPING', message: null };

  const status = pod.status ?? {};
  if (status.phase === 'Failed' || status.phase === 'Succeeded') {
    return { ...base, phase: 'FAILED', message: podFinishReason(pod) };
  }
  const statuses = [...(status.initContainerStatuses ?? []), ...(status.containerStatuses ?? [])];
  const failing = failingContainer(statuses);
  if (failing) return { ...base, phase: 'FAILED', message: clip(failing) };

  const containers = status.containerStatuses ?? [];
  const allReady = status.phase === 'Running' && containers.length > 0 && containers.every((c) => c.ready);
  return { ...base, phase: allReady ? 'RUNNING' : 'STARTING', message: restartNotice(pod, now) };
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
