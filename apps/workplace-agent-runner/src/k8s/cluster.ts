// 쿠버네티스 호출 — 네임스페이스 하나 안에서만, runner 라벨이 붙은 리소스만 다룬다.
// 조정 로직은 ClusterApi 인터페이스만 보고, 테스트는 가짜(testing/fakes.ts)를 끼운다.
import {
  ApiException,
  CoreV1Api,
  KubeConfig,
  KubernetesObjectApi,
  Metrics,
  PatchStrategy,
  type KubernetesObject,
  type V1ConfigMap,
  type V1PersistentVolumeClaim,
  type V1Pod,
  type V1Secret,
} from '@kubernetes/client-node';
import { MANAGED_SELECTOR } from './manifest.js';
import { parseCpuMillicores, parseMemoryBytes } from '../observe.js';

export type ManagedKind = 'Pod' | 'PersistentVolumeClaim' | 'Secret' | 'ConfigMap';

/** runner 라벨이 붙은 리소스 전부(네임스페이스 하나). */
export interface ManagedResources {
  pods: V1Pod[];
  pvcs: V1PersistentVolumeClaim[];
  secrets: V1Secret[];
  configMaps: V1ConfigMap[];
}

export interface PodUsage {
  cpuMillicores?: number;
  memoryBytes?: number;
}

export interface ClusterApi {
  /** runner 라벨(managed-by=genia-agent-runner)로 고른 리소스만 돌려준다. */
  listManaged(): Promise<ManagedResources>;
  /** 같은 이름의 리소스가 있는지 — 라벨 없는 남의 리소스를 덮어쓰지 않으려고 만들기 전에 본다. */
  exists(kind: ManagedKind, name: string): Promise<boolean>;
  /** server-side apply(fieldManager genia-agent-runner). */
  apply(obj: KubernetesObject): Promise<void>;
  /** 없으면(404) 조용히 넘어간다. 부르는 쪽은 listManaged 로 찾은 이름만 넘긴다. */
  delete(kind: ManagedKind, name: string): Promise<void>;
  /** Pod 이름 → 사용량. metrics.k8s.io 가 없으면 실패한다(부르는 쪽이 무시). */
  podMetrics(): Promise<Map<string, PodUsage>>;
}

export const FIELD_MANAGER = 'genia-agent-runner';

/** 서버 사유 한 줄의 최대 길이 — 관찰 보고 message(500자)에 종류·이름과 함께 들어간다. */
const SERVER_MESSAGE_MAX = 200;

/**
 * k8s 호출 실패. message 는 종류·이름·HTTP 상태·서버 사유(Status.reason)와 서버 메시지 첫 줄만 담는다 —
 * ApiException 의 본문에는 보낸 객체(Secret 원문)가 되돌아올 수 있어 원문 본문은 절대 쓰지 않는다. Secret 은 서버 메시지도 뺀다.
 */
export class ClusterError extends Error {
  constructor(
    readonly op: string,
    readonly kind: string,
    readonly resourceName: string,
    readonly status: number | undefined,
    readonly reason?: string,
    serverMessage?: string,
  ) {
    const detail = [status, reason].filter((x) => x !== undefined && x !== '').join(' ');
    const line = kind === 'Secret' ? undefined : serverMessage?.split('\n')[0]?.trim().slice(0, SERVER_MESSAGE_MAX);
    const paren = detail || line ? ` (${detail}${line ? `${detail ? ': ' : ''}${line}` : ''})` : '';
    super(`k8s ${op} ${kind}/${resourceName} 실패${paren}`);
    this.name = 'ClusterError';
  }

  /**
   * 클러스터가 요청 자체를 거절했는지(쿼터 403·PodSecurity 403·검증 422·잘못된 요청 400) — 다시 보내도 같은 답이라
   * 그 AI 를 FAILED 로 알리고 재시도를 늦춘다. 404·409·429·5xx·네트워크 오류는 일시 오류로 본다.
   */
  get rejected(): boolean {
    return this.status === 400 || this.status === 403 || this.status === 422;
  }
}

/** ApiException 본문에서 k8s Status 의 reason·message 만 꺼낸다(본문은 문자열 JSON 이거나 이미 풀린 객체). */
function statusOf(body: unknown): { reason?: string; message?: string } {
  let obj: unknown = body;
  if (typeof body === 'string') {
    try {
      obj = JSON.parse(body);
    } catch {
      return {};
    }
  }
  if (typeof obj !== 'object' || obj === null) return {};
  const { reason, message } = obj as { reason?: unknown; message?: unknown };
  return {
    reason: typeof reason === 'string' ? reason : undefined,
    message: typeof message === 'string' ? message : undefined,
  };
}

/** k8s 오류를 {@link ClusterError} 로 바꾼다. */
function wrap(e: unknown, op: string, kind: string, name: string): ClusterError {
  if (!(e instanceof ApiException)) return new ClusterError(op, kind, name, undefined);
  const { reason, message } = statusOf(e.body);
  return new ClusterError(op, kind, name, e.code, reason, message);
}

/** 이름으로 한 개를 다루는 호출의 인자. */
type NameQuery = { name: string; namespace: string };

const isNotFound = (e: unknown) => e instanceof ApiException && e.code === 404;

/** @kubernetes/client-node 2.x 로 만든 실제 구현. */
export class KubeCluster implements ClusterApi {
  private readonly core: CoreV1Api;
  private readonly objects: KubernetesObjectApi;
  private readonly metrics: Metrics;

  constructor(
    kc: KubeConfig,
    private readonly namespace: string,
  ) {
    this.core = kc.makeApiClient(CoreV1Api);
    this.objects = KubernetesObjectApi.makeApiClient(kc);
    this.metrics = new Metrics(kc);
  }

  /**
   * 종류별 이름 조회·삭제 — 표 하나로 두어 종류를 더하면 타입(Record<ManagedKind, …>)이 빠진 칸을 잡는다.
   * Pod 삭제 유예 시간은 Pod 의 terminationGracePeriodSeconds 를 따른다.
   */
  private readonly byKind: Record<ManagedKind, { read(q: NameQuery): Promise<unknown>; remove(q: NameQuery): Promise<unknown> }> = {
    Pod: { read: (q) => this.core.readNamespacedPod(q), remove: (q) => this.core.deleteNamespacedPod(q) },
    PersistentVolumeClaim: {
      read: (q) => this.core.readNamespacedPersistentVolumeClaim(q),
      remove: (q) => this.core.deleteNamespacedPersistentVolumeClaim(q),
    },
    Secret: { read: (q) => this.core.readNamespacedSecret(q), remove: (q) => this.core.deleteNamespacedSecret(q) },
    ConfigMap: { read: (q) => this.core.readNamespacedConfigMap(q), remove: (q) => this.core.deleteNamespacedConfigMap(q) },
  };

  async listManaged(): Promise<ManagedResources> {
    const q = { namespace: this.namespace, labelSelector: MANAGED_SELECTOR };
    try {
      const [pods, pvcs, secrets, configMaps] = await Promise.all([
        this.core.listNamespacedPod(q),
        this.core.listNamespacedPersistentVolumeClaim(q),
        this.core.listNamespacedSecret(q),
        this.core.listNamespacedConfigMap(q),
      ]);
      return { pods: pods.items, pvcs: pvcs.items, secrets: secrets.items, configMaps: configMaps.items };
    } catch (e) {
      throw wrap(e, 'list', 'managed', MANAGED_SELECTOR);
    }
  }

  async exists(kind: ManagedKind, name: string): Promise<boolean> {
    try {
      await this.byKind[kind].read({ name, namespace: this.namespace });
      return true;
    } catch (e) {
      if (isNotFound(e)) return false;
      throw wrap(e, 'read', kind, name);
    }
  }

  async apply(obj: KubernetesObject): Promise<void> {
    // 네임스페이스를 늘 우리 것으로 — 빠지면 kubeconfig 기본 네임스페이스로 가 버린다
    const spec = { ...obj, metadata: { ...obj.metadata, namespace: this.namespace } };
    try {
      await this.objects.patch(spec, undefined, undefined, FIELD_MANAGER, true, PatchStrategy.ServerSideApply);
    } catch (e) {
      throw wrap(e, 'apply', obj.kind ?? '?', obj.metadata?.name ?? '?');
    }
  }

  async delete(kind: ManagedKind, name: string): Promise<void> {
    try {
      await this.byKind[kind].remove({ name, namespace: this.namespace });
    } catch (e) {
      if (isNotFound(e)) return;
      throw wrap(e, 'delete', kind, name);
    }
  }

  async podMetrics(): Promise<Map<string, PodUsage>> {
    // 네임스페이스를 꼭 넘긴다 — 빼면 클러스터 전체 조회라 네임스페이스 Role 이 막는다
    const list = await this.metrics.getPodMetrics(this.namespace);
    const out = new Map<string, PodUsage>();
    for (const item of list.items) {
      let cpu = 0;
      let memory = 0;
      let cpuKnown = false;
      let memoryKnown = false;
      for (const c of item.containers) {
        const cm = parseCpuMillicores(c.usage.cpu);
        const mb = parseMemoryBytes(c.usage.memory);
        if (cm !== undefined) {
          cpu += cm;
          cpuKnown = true;
        }
        if (mb !== undefined) {
          memory += mb;
          memoryKnown = true;
        }
      }
      out.set(item.metadata.name, {
        cpuMillicores: cpuKnown ? cpu : undefined,
        memoryBytes: memoryKnown ? memory : undefined,
      });
    }
    return out;
  }
}
