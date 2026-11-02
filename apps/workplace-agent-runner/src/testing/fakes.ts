// 테스트용 가짜 클러스터·Works — 실제 쿠버네티스·HTTP 없이 조정 흐름을 단언하려고 메모리에 둔다.
import { vi } from 'vitest';
import type { KubernetesObject, V1ConfigMap, V1PersistentVolumeClaim, V1Pod, V1Secret } from '@kubernetes/client-node';
import { ClusterError, type ClusterApi, type ManagedKind, type ManagedResources } from '../k8s/cluster.js';
import type {
  AgentKeyResponse,
  ClaudeSecretResponse,
  RepoSecretsResponse,
  RunnerDesired,
  RunnerObservedAgent,
  WorksClient,
} from '../works/client.js';
import { MANAGED_BY_KEY, MANAGED_BY_VALUE } from '../k8s/manifest.js';

/** 메모리 클러스터 — kind/name 으로 객체를 둔다. Pod 삭제는 기본적으로 「지우는 중」(deletionTimestamp)으로만 바꾼다. */
export class FakeCluster implements ClusterApi {
  readonly objects = new Map<string, KubernetesObject>();
  readonly calls: string[] = [];
  /** true 면 Pod 삭제를 바로 끝낸다(유예 없이 사라짐). */
  instantPodDelete = false;
  /** true 면 PVC 삭제도 「지우는 중」으로만 바꾼다(pvc-protection 파이널라이저로 Terminating 에 머무는 것처럼). */
  lingeringPvcDelete = false;
  /** apply 를 클러스터가 거절하게 한다 — 오류를 돌려주면 그 오류로 던진다(쿼터 403 등). */
  rejectApply: ((obj: KubernetesObject) => Error | undefined) | undefined;
  metrics = new Map<string, { cpuMillicores?: number; memoryBytes?: number }>();
  failMetrics = false;
  /** 사용량 API(metrics.k8s.io)가 없는 클러스터 — 404 ClusterError 를 던진다(WP-1280). */
  missingMetricsApi = false;

  private key(kind: string, name: string) {
    return `${kind}/${name}`;
  }

  /** 시험 준비용 — runner 를 거치지 않고 객체를 넣는다. */
  seed(obj: KubernetesObject) {
    this.objects.set(this.key(obj.kind ?? '', obj.metadata?.name ?? ''), structuredClone(obj));
  }

  get<T extends KubernetesObject>(kind: ManagedKind, name: string): T | undefined {
    return this.objects.get(this.key(kind, name)) as T | undefined;
  }

  /** 지우는 중인 Pod 를 kubelet 이 정리 끝낸 것처럼 없앤다. */
  finishPodDeletion(name: string) {
    this.objects.delete(this.key('Pod', name));
  }

  async listManaged(): Promise<ManagedResources> {
    const managed = [...this.objects.values()].filter(
      (o) => o.metadata?.labels?.[MANAGED_BY_KEY] === MANAGED_BY_VALUE,
    );
    const of = <T>(kind: string) => managed.filter((o) => o.kind === kind).map((o) => structuredClone(o) as T);
    return {
      pods: of<V1Pod>('Pod'),
      pvcs: of<V1PersistentVolumeClaim>('PersistentVolumeClaim'),
      secrets: of<V1Secret>('Secret'),
      configMaps: of<V1ConfigMap>('ConfigMap'),
    };
  }

  async exists(kind: ManagedKind, name: string): Promise<boolean> {
    return this.objects.has(this.key(kind, name));
  }

  async apply(obj: KubernetesObject): Promise<void> {
    this.calls.push(`apply ${obj.kind}/${obj.metadata?.name}`);
    const rejection = this.rejectApply?.(obj);
    if (rejection) throw rejection;
    this.objects.set(this.key(obj.kind ?? '', obj.metadata?.name ?? ''), structuredClone(obj));
  }

  async delete(kind: ManagedKind, name: string): Promise<void> {
    this.calls.push(`delete ${kind}/${name}`);
    const k = this.key(kind, name);
    const obj = this.objects.get(k);
    if (!obj) return;
    if ((kind === 'Pod' && !this.instantPodDelete) || (kind === 'PersistentVolumeClaim' && this.lingeringPvcDelete)) {
      obj.metadata = { ...obj.metadata, deletionTimestamp: new Date('2026-11-01T01:00:00Z') };
      return;
    }
    this.objects.delete(k);
  }

  async podMetrics() {
    if (this.missingMetricsApi) throw new ClusterError('list', 'PodMetrics', 'agents', 404, 'NotFound');
    if (this.failMetrics) throw new Error('metrics.k8s.io unavailable');
    return this.metrics;
  }
}

/** 가짜 Works — desired 는 칸을 바꿔 가며 쓰고, 나머지 호출은 vi.fn 으로 센다. */
export class FakeWorks implements WorksClient {
  desired: RunnerDesired;
  issueAgentKey = vi.fn(async (agentUserId: number): Promise<AgentKeyResponse> => ({
    keyId: 900 + agentUserId,
    plaintext: `ak_plain_${agentUserId}`,
    expiresAt: '2026-12-01T01:00:00Z',
    rotateAfter: '2026-11-24T01:00:00Z',
  }));
  getClaudeSecret = vi.fn(async (_agentUserId: number): Promise<ClaudeSecretResponse | null> => ({
    version: 57,
    provider: 'anthropic',
    payload: 'sk-ant-plain',
  }));
  /** 기본: 모든 AI 가 GitHub 토큰 하나 — AI 별로 다르게 하려면 mockImplementation. */
  getRepoSecrets = vi.fn(async (agentUserId: number): Promise<RepoSecretsResponse> => ({
    version: 1730505600000,
    tokens: [{ kind: 'GITHUB', host: 'github.com', token: `ghp_plain_${agentUserId}` }],
  }));
  reportObserved = vi.fn(async (agents: RunnerObservedAgent[], _metricsAvailable?: boolean) => ({
    updated: agents.length,
    ignored: [] as number[],
  }));

  constructor(desired: RunnerDesired) {
    this.desired = desired;
  }

  async getDesired(): Promise<RunnerDesired> {
    return structuredClone(this.desired);
  }
}
