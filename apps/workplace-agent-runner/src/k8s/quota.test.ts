// 쿼터 거절 메시지 파싱·사유 문구 — 서버 원문에서 넘은 자원을 읽어 사람이 읽을 한국어로 만든다.
import { describe, expect, it } from 'vitest';
import type { V1PersistentVolumeClaim, V1Pod } from '@kubernetes/client-node';
import { parseQuotaExceeded, podRequests, quotaCapacity, quotaReason } from './quota.js';

const CPU_MSG =
  'pods "agent-76" is forbidden: exceeded quota: agent-runner, requested: requests.cpu=2260m, used: requests.cpu=4570m, limited: requests.cpu=6';

describe('parseQuotaExceeded', () => {
  it('readsCpuOverflowFromServerMessage', () => {
    expect(parseQuotaExceeded(CPU_MSG)).toEqual([{ resource: 'requests.cpu', requested: '2260m', used: '4570m', limited: '6' }]);
    expect(quotaReason(parseQuotaExceeded(CPU_MSG)!)).toBe(
      '클러스터 자원 상한이 차서 AI 를 띄우지 못했습니다 — CPU 상한 6코어(사용 4.57 · 요청 2.26). 자리가 나면 저절로 뜹니다.',
    );
  });

  it('joinsCpuAndMemoryDescriptions', () => {
    const msg =
      'exceeded quota: q, requested: requests.cpu=2,requests.memory=8Gi, used: requests.cpu=5,requests.memory=60Gi, limited: requests.cpu=6,requests.memory=64Gi';
    const items = parseQuotaExceeded(msg)!;
    expect(items.map((i) => i.resource)).toEqual(['requests.cpu', 'requests.memory']);
    expect(quotaReason(items)).toBe(
      '클러스터 자원 상한이 차서 AI 를 띄우지 못했습니다 — CPU 상한 6코어(사용 5 · 요청 2), 메모리 상한 64GiB(사용 60 · 요청 8). 자리가 나면 저절로 뜹니다.',
    );
  });

  it('keepsOnlyResourcesThatOverflow', () => {
    const msg =
      'exceeded quota: q, requested: requests.cpu=1,requests.memory=1Gi, used: requests.cpu=5500m,requests.memory=2Gi, limited: requests.cpu=6,requests.memory=64Gi';
    expect(parseQuotaExceeded(msg)!.map((i) => i.resource)).toEqual(['requests.cpu']);
  });

  it('treatsExactFitAsNotExceeded', () => {
    // 쿠버네티스는 requested+used > limited 일 때만 거절한다 — 딱 맞는 자원(CPU 5+1=6)은 넘은 것이 아니다
    const msg = 'exceeded quota: q, requested: requests.cpu=1,requests.memory=8Gi, used: requests.cpu=5,requests.memory=60Gi, limited: requests.cpu=6,requests.memory=64Gi';
    expect(parseQuotaExceeded(msg)!.map((i) => i.resource)).toEqual(['requests.memory']);
  });

  it('includesKeyWhenUsedOrRequestedIsMissing', () => {
    const items = parseQuotaExceeded('exceeded quota: q, requested: requests.cpu=1, used: requests.memory=1Gi, limited: requests.cpu=6,requests.memory=64Gi');
    expect(items?.map((i) => i.resource)).toEqual(['requests.cpu', 'requests.memory']);
  });

  it('omitsMissingPartsFromParenthetical', () => {
    const r = (used: string, requested: string, resource = 'requests.cpu', limited = '6') =>
      quotaReason([{ resource, requested, used, limited }]);
    expect(r('', '1')).toContain('CPU 상한 6코어(요청 1)');
    expect(r('4570m', '')).toContain('CPU 상한 6코어(사용 4.57)');
    expect(r('', '')).toContain('CPU 상한 6코어.');
    expect(r('', '', 'persistentvolumeclaims', '10')).toContain('작업 폴더 상한 10개.');
    expect(r('', '1', 'persistentvolumeclaims', '10')).toContain('작업 폴더 상한 10개(요청 1)');
  });

  it('describesPvcAsWorkFolderCount', () => {
    const items = parseQuotaExceeded('exceeded quota: q, requested: persistentvolumeclaims=1, used: persistentvolumeclaims=10, limited: persistentvolumeclaims=10')!;
    expect(quotaReason(items)).toContain('작업 폴더 상한 10개(사용 10 · 요청 1)');
  });

  it('returnsNullForOtherRejections', () => {
    expect(parseQuotaExceeded('forbidden: violates PodSecurity')).toBeNull();
    expect(parseQuotaExceeded('')).toBeNull();
  });

  it('quotaReasonIsNullWithoutKnownResource', () => {
    expect(quotaReason([{ resource: 'count/pods', requested: '1', used: '5', limited: '5' }])).toBeNull();
  });
});

const GI = 1024 ** 3;

/** 컨테이너마다 requests 를 가진 Pod 한 개. */
function podOf(containers: Array<Record<string, string> | undefined>, init: Array<Record<string, string> | undefined> = []): V1Pod {
  const c = (n: string, r?: Record<string, string>) => ({ name: n, image: 'x', ...(r ? { resources: { requests: r } } : {}) });
  return {
    spec: {
      containers: containers.map((r, i) => c(`c${i}`, r)),
      initContainers: init.map((r, i) => c(`i${i}`, r)),
    },
  };
}

describe('podRequests', () => {
  it('takesLargerOfContainersSumAndInitMax', () => {
    const pod = podOf([{ cpu: '1', memory: '1Gi' }, { cpu: '250m', memory: '512Mi' }], [{ cpu: '2', memory: '256Mi' }]);
    // cpu: containers 1250 < init 2000 → 2000, memory: containers 1.5Gi > init → 1.5Gi
    expect(podRequests(pod)).toEqual({ cpuMillicores: 2000, memoryBytes: 1.5 * GI, pvcs: 0 });
  });

  it('countsContainerWithoutRequestsAsZeroAndPvcAsOne', () => {
    const pod = podOf([{ cpu: '500m', memory: '1Gi' }, undefined]);
    expect(podRequests(pod, {} as V1PersistentVolumeClaim)).toEqual({ cpuMillicores: 500, memoryBytes: GI, pvcs: 1 });
  });

  it('handlesPodWithoutSpec', () => {
    expect(podRequests({})).toEqual({ cpuMillicores: 0, memoryBytes: 0, pvcs: 0 });
  });
});

describe('quotaCapacity', () => {
  const perPod = { cpuMillicores: 2260, memoryBytes: 4.5 * GI, pvcs: 1 };

  it('takesMinimumOverResources', () => {
    // cpu 6000/2260=2, memory 64/4.5=14, pvc 10 → 2
    expect(quotaCapacity({ 'requests.cpu': '6', 'requests.memory': '64Gi', persistentvolumeclaims: '10' }, perPod)).toBe(2);
  });

  it('acceptsPlainCpuAndMemoryAliasesButPrefersRequestsKeys', () => {
    expect(quotaCapacity({ cpu: '16' }, perPod)).toBe(7);
    expect(quotaCapacity({ memory: '9Gi' }, perPod)).toBe(2);
    expect(quotaCapacity({ cpu: '1', 'requests.cpu': '16' }, perPod)).toBe(7);
  });

  it('returnsNullWithoutKnownKeys', () => {
    expect(quotaCapacity({ 'count/pods': '5', 'limits.cpu': '8' }, perPod)).toBeNull();
    expect(quotaCapacity({}, perPod)).toBeNull();
  });

  it('skipsUnparseableKeysAndZeroPerPodResources', () => {
    expect(quotaCapacity({ 'requests.cpu': 'abc', persistentvolumeclaims: '10' }, perPod)).toBe(10);
    expect(quotaCapacity({ 'requests.cpu': '6', persistentvolumeclaims: '10' }, { ...perPod, cpuMillicores: 0, pvcs: 0 })).toBeNull();
  });

  it('isZeroWhenOnePodDoesNotFit', () => {
    expect(quotaCapacity({ 'requests.cpu': '1' }, perPod)).toBe(0);
  });
});
