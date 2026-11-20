// ResourceQuota 거절 메시지 — 서버 원문(`exceeded quota: …, requested: …, used: …, limited: …`)에서 상한을 넘은 자원을 읽고,
// 관리자가 화면에서 바로 알아볼 한국어 사유로 만든다. 또 네임스페이스 ResourceQuota 와 Pod 요청량으로 띄울 수 있는 AI 수(수용량)를 계산한다.
import type { V1Container, V1PersistentVolumeClaim, V1Pod } from '@kubernetes/client-node';
import { parseCpuMillicores, parseMemoryBytes } from '../observe.js';

/** 상한을 넘은 자원 하나 — 값은 서버가 쓴 수량 문자열 그대로(예: 2260m, 64Gi). */
export interface QuotaExceeded {
  resource: string;
  requested: string;
  used: string;
  limited: string;
}

/** `k=v,k=v` 목록을 Map 으로(순서 유지). */
function parseList(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of text.split(',')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    out.set(part.slice(0, eq).trim(), part.slice(eq + 1).trim());
  }
  return out;
}

/** 0 이상 정수 문자열(개수) → 숫자. 아니면 undefined. */
function parseCount(q: string): number | undefined {
  return /^\d+$/.test(q) ? Number(q) : undefined;
}

/** 자원 종류별 수량 파서 — CPU 는 밀리코어, 메모리는 바이트, 그 밖은 정수. 못 읽으면 undefined. */
function parseQuantity(resource: string, q: string): number | undefined {
  if (resource.endsWith('cpu')) return parseCpuMillicores(q);
  if (resource.endsWith('memory')) return parseMemoryBytes(q);
  return parseCount(q);
}

/**
 * 쿼터 거절 서버 메시지를 읽는다. 형식이 아니면 null. 넘은 자원 = requested+used 가 limited 를 넘은 키(>, 쿠버네티스와 같게 딱 맞으면 통과)이고,
 * 수량을 비교할 수 없으면 그 키도 넘은 것으로 본다(숨기느니 보이는 쪽).
 */
export function parseQuotaExceeded(serverMessage: string): QuotaExceeded[] | null {
  const m = /exceeded quota: [^,]*, requested: (.+?), used: (.+?), limited: (.+)$/m.exec(serverMessage ?? '');
  if (!m) return null;
  const requested = parseList(m[1] ?? '');
  const used = parseList(m[2] ?? '');
  const limited = parseList(m[3] ?? '');
  const items: QuotaExceeded[] = [];
  for (const [resource, lim] of limited) {
    const req = requested.get(resource);
    const use = used.get(resource);
    // requested·used 가 빠졌으면 비교할 수 없으니 넘은 것으로 본다(빈 문자열 → 파싱 실패 → 포함)
    const r = req === undefined ? undefined : parseQuantity(resource, req);
    const u = use === undefined ? undefined : parseQuantity(resource, use);
    const l = parseQuantity(resource, lim);
    if (r !== undefined && u !== undefined && l !== undefined && r + u <= l) continue;
    items.push({ resource, requested: req ?? '', used: use ?? '', limited: lim });
  }
  return items.length > 0 ? items : null;
}

/** 소수 둘째 자리까지, 끝의 0 은 뗀다(6 → "6", 4.5700 → "4.57"). */
function num(n: number): string {
  return String(Number(n.toFixed(2)));
}

/** 수량 문자열을 파서·단위 나눗수로 읽어 문구 값으로 — 못 읽으면 원문 그대로. */
const formatQuantity = (parse: (q: string) => number | undefined, divisor: number) => (q: string): string => {
  const v = parse(q);
  return v === undefined ? q : num(v / divisor);
};

/** CPU 수량 → 코어 문구 값. */
const cores = formatQuantity(parseCpuMillicores, 1000);

/** 메모리 수량 → GiB 문구 값. */
const gib = formatQuantity(parseMemoryBytes, 1024 ** 3);

/** 괄호 안 설명 — 빠진(빈) 값은 빼고 「사용 X · 요청 Y」 중 있는 것만, 둘 다 없으면 괄호 자체를 뺀다. */
function detail(used: string | undefined, requested: string | undefined): string {
  const parts = [used ? `사용 ${used}` : '', requested ? `요청 ${requested}` : ''].filter(Boolean);
  return parts.length > 0 ? `(${parts.join(' · ')})` : '';
}

/** 자원 하나의 설명 — 아는 자원(CPU·메모리·PVC)만, 모르면 undefined. */
function describe(item: QuotaExceeded): string | undefined {
  const { resource, requested, used, limited } = item;
  if (resource === 'requests.cpu' || resource === 'cpu') {
    return `CPU 상한 ${cores(limited)}코어${detail(used && cores(used), requested && cores(requested))}`;
  }
  if (resource === 'requests.memory' || resource === 'memory') {
    return `메모리 상한 ${gib(limited)}GiB${detail(used && gib(used), requested && gib(requested))}`;
  }
  if (resource === 'persistentvolumeclaims') {
    return `작업 폴더 상한 ${limited}개${detail(used, requested)}`;
  }
  return undefined;
}

/** 넘은 자원들을 관리자용 사유 한 문장으로. 아는 자원이 하나도 없으면 null(부르는 쪽이 기존 message 를 쓴다). */
export function quotaReason(items: QuotaExceeded[]): string | null {
  const parts = items.map(describe).filter((s): s is string => s !== undefined);
  if (parts.length === 0) return null;
  return `클러스터 자원 상한이 차서 AI 를 띄우지 못했습니다 — ${parts.join(', ')}. 자리가 나면 저절로 뜹니다.`;
}

/** Pod 하나가 쿼터에서 차지하는 요청량 — CPU 는 밀리코어, 메모리는 바이트, pvcs 는 PVC 개수. */
export interface PodRequests {
  cpuMillicores: number;
  memoryBytes: number;
  pvcs: number;
}

/** 컨테이너 목록의 자원 하나 요청 — 요청이 없거나 못 읽는 컨테이너는 0 으로 센다. */
function requestOf(c: V1Container, key: 'cpu' | 'memory'): number {
  const q = c.resources?.requests?.[key];
  if (q === undefined) return 0;
  return (key === 'cpu' ? parseCpuMillicores(q) : parseMemoryBytes(q)) ?? 0;
}

/** 자원별로 둘 중 큰 요청량 — 여러 Pod 중 가장 큰 값을 찾을 때. */
export function maxRequests(a: PodRequests, b: PodRequests): PodRequests {
  return {
    cpuMillicores: Math.max(a.cpuMillicores, b.cpuMillicores),
    memoryBytes: Math.max(a.memoryBytes, b.memoryBytes),
    pvcs: Math.max(a.pvcs, b.pvcs),
  };
}

/**
 * Pod 한 개의 쿼터 요청량. 쿠버네티스 규칙대로 자원별로 max(일반 컨테이너 합, 초기화 컨테이너 중 최댓값) — 초기화 컨테이너는
 * 일반 컨테이너보다 먼저 하나씩 도므로 합하지 않는다. pvc 를 넘기면 PVC 1개가 더해진다.
 */
export function podRequests(pod: V1Pod, pvc?: V1PersistentVolumeClaim): PodRequests {
  const containers = pod.spec?.containers ?? [];
  const inits = pod.spec?.initContainers ?? [];
  const total = (key: 'cpu' | 'memory') => {
    const sum = containers.reduce((acc, c) => acc + requestOf(c, key), 0);
    const initMax = inits.reduce((acc, c) => Math.max(acc, requestOf(c, key)), 0);
    return Math.max(sum, initMax);
  };
  return { cpuMillicores: total('cpu'), memoryBytes: total('memory'), pvcs: pvc ? 1 : 0 };
}

/** 쿼터 hard 에서 자원 하나의 상한을 읽는다 — 우선 키(requests.*)가 있으면 그것, 없으면 별칭(cpu·memory). 없거나 못 읽으면 undefined. */
function hardOf(hard: Record<string, string>, keys: string[], parse: (q: string) => number | undefined): number | undefined {
  const key = keys.find((k) => hard[k] !== undefined);
  return key === undefined ? undefined : parse(hard[key] as string);
}

/**
 * 네임스페이스 쿼터가 Pod 를 몇 개까지 받는지 — 자원별 floor(상한 합계 / Pod 하나 요청량)의 최솟값.
 * 이미 쓴 양(used)은 빼지 않는다: 지금 떠 있는 AI 까지 포함한 「최대 AI 수」를 알려 설정 값과 비교하려는 것이기 때문이다.
 * 아는 자원(CPU·메모리·PVC)이 하나도 없거나, Pod 요청량이 0 이라 나눌 수 없는 자원뿐이면 null(모름).
 */
export function quotaCapacity(hard: Record<string, string>, perPod: PodRequests): number | null {
  const limits: Array<[number | undefined, number]> = [
    [hardOf(hard, ['requests.cpu', 'cpu'], parseCpuMillicores), perPod.cpuMillicores],
    [hardOf(hard, ['requests.memory', 'memory'], parseMemoryBytes), perPod.memoryBytes],
    [hardOf(hard, ['persistentvolumeclaims'], parseCount), perPod.pvcs],
  ];
  const counts = limits.filter((l): l is [number, number] => l[0] !== undefined && l[1] > 0).map(([h, p]) => Math.floor(h / p));
  return counts.length > 0 ? Math.min(...counts) : null;
}
