// 조정 계획 — desired 와 클러스터에 남은 runner 리소스를 맞대어 AI 마다 할 일 하나를 고른다(순수 함수).
import type { KubernetesObject, V1Pod } from '@kubernetes/client-node';
import type { ManagedResources } from './k8s/cluster.js';
import {
  AGENT_LABEL,
  ANN_CLAUDE_VERSION,
  ANN_LOGIN_VERSION,
  ANN_REPOS_VERSION,
  LOCATION_LABEL,
  MANAGED_BY_KEY,
  MANAGED_BY_VALUE,
  podGeneration,
} from './k8s/manifest.js';
import type { RunnerDesiredAgent } from './works/client.js';

/** 클러스터에 남은 AI 한 명의 runner 리소스. */
export interface ActualAgent {
  agentUserId: number;
  /**
   * Pod 가 있으면 그 generation 라벨, 지우는 중인지, 만들 때 넣은 모델 연결 version(어노테이션, 없으면 undefined),
   * 배치된 노드(spec.nodeName — 아직 배치 전이면 undefined).
   */
  pod?: { generation: number | null; deleting: boolean; claudeVersion?: string; loginVersion?: string; reposVersion?: string; nodeName?: string };
  pvc: boolean;
  /** PVC 가 지워지는 중(deletionTimestamp) — 끄고 바로 켠 AI 는 사라질 때까지 기다렸다 새로 만든다. */
  pvcDeleting?: boolean;
  secret: boolean;
  /** Secret 이 지워지는 중(파이널라이저) — 삭제를 다시 내지 않는다. */
  secretDeleting?: boolean;
  configMap: boolean;
}

/** 리소스가 하나도 없는 AI(아직 만들지 않음). */
export function emptyActual(agentUserId: number): ActualAgent {
  return { agentUserId, pvc: false, secret: false, configMap: false };
}

export type ActionKind = 'create' | 'recreate' | 'keep' | 'delete' | 'reportStopped';

export interface Action {
  kind: ActionKind;
  agentUserId: number;
  reason: string;
}

/** runner 라벨과 AI id 라벨이 모두 있는 리소스의 AI id — 아니면 null(만지지 않는다). */
function managedAgentId(o: KubernetesObject): number | null {
  const labels = o.metadata?.labels ?? {};
  if (labels[MANAGED_BY_KEY] !== MANAGED_BY_VALUE) return null;
  const id = labels[AGENT_LABEL];
  return id && /^\d+$/.test(id) ? Number(id) : null;
}

/**
 * 이 위치(locationId)의 리소스만 남긴다. 한 네임스페이스에 runner 가 둘(위치 둘)이면 managed-by 라벨만으로는 서로의 리소스를
 * 지우게 되므로, `genia.works/location` 이 내 위치인 것만 「내 것」으로 본다. 남의 위치 리소스와 이름이 겹치면
 * 만들기 전 이름 검사(findForeign)가 FAILED 로 알린다.
 */
export function ownedByLocation(res: ManagedResources, locationId: number): ManagedResources {
  const mine = <T extends KubernetesObject>(list: T[]) =>
    list.filter((o) => o.metadata?.labels?.[LOCATION_LABEL] === String(locationId));
  return { pods: mine(res.pods), pvcs: mine(res.pvcs), secrets: mine(res.secrets), configMaps: mine(res.configMaps) };
}

/**
 * 나열한 리소스를 AI 별로 묶는다. listManaged 가 이미 라벨로 골라 오지만 여기서 한 번 더 거른다 —
 * 라벨 없는 리소스(손으로 만든 시험 Pod 등)가 지울 대상에 섞이지 않게.
 */
export function collectActual(res: ManagedResources): ActualAgent[] {
  const byId = new Map<number, ActualAgent>();
  const entry = (id: number) => {
    let a = byId.get(id);
    if (!a) {
      a = emptyActual(id);
      byId.set(id, a);
    }
    return a;
  };
  for (const p of res.pods) {
    const id = managedAgentId(p);
    if (id === null) continue;
    entry(id).pod = {
      generation: podGeneration(p),
      deleting: Boolean(p.metadata?.deletionTimestamp),
      claudeVersion: p.metadata?.annotations?.[ANN_CLAUDE_VERSION],
      loginVersion: p.metadata?.annotations?.[ANN_LOGIN_VERSION],
      reposVersion: p.metadata?.annotations?.[ANN_REPOS_VERSION],
      nodeName: (p as V1Pod).spec?.nodeName || undefined,
    };
  }
  // [목록, 있음 칸, 지우는 중 칸] — 한 번 돌며 둘 다 채운다(ConfigMap 은 지우는 중을 따로 보지 않는다)
  const table = [
    [res.pvcs, 'pvc', 'pvcDeleting'],
    [res.secrets, 'secret', 'secretDeleting'],
    [res.configMaps, 'configMap', undefined],
  ] as const;
  for (const [list, field, deletingField] of table) {
    for (const o of list as KubernetesObject[]) {
      const id = managedAgentId(o);
      if (id === null) continue;
      const a = entry(id);
      a[field] = true;
      if (deletingField && o.metadata?.deletionTimestamp) a[deletingField] = true;
    }
  }
  return [...byId.values()].sort((a, b) => a.agentUserId - b.agentUserId);
}

/**
 * AI 마다 할 일. 규칙(계획 Task 3 · runner API 계약):
 * - desired 에 있고 Pod 없음 → create(applyNow 무관 — 새 AI 는 바로 띄운다)
 * - Pod 가 지우는 중 → keep(사라지면 다음 회차에 create)
 * - generation 같음 → keep / 다르고 applyNow → recreate / applyNow=false → keep(하던 일을 마치게)
 * - desired 에 없고 Pod 가 있음 → delete(Pod·PVC·Secret, ConfigMap 은 남김)
 * - desired 에 없고 Pod 는 없는데 리소스가 남음 → reportStopped(STOPPED 가 받아들여지면 ConfigMap 을 지움)
 */
export function planReconcile(desired: RunnerDesiredAgent[], actual: ActualAgent[]): Action[] {
  const actualById = new Map(actual.map((a) => [a.agentUserId, a]));
  const desiredIds = new Set(desired.map((d) => d.agentUserId));
  const actions: Action[] = [];

  for (const d of desired) {
    const id = d.agentUserId;
    const pod = actualById.get(id)?.pod;
    if (!pod) {
      actions.push({ kind: 'create', agentUserId: id, reason: 'no pod' });
    } else if (pod.deleting) {
      actions.push({ kind: 'keep', agentUserId: id, reason: 'pod terminating' });
    } else if (pod.generation === d.generation) {
      actions.push({ kind: 'keep', agentUserId: id, reason: 'generation matches' });
    } else if (d.applyNow) {
      actions.push({ kind: 'recreate', agentUserId: id, reason: `generation ${pod.generation} → ${d.generation}` });
    } else {
      actions.push({ kind: 'keep', agentUserId: id, reason: `generation ${pod.generation} → ${d.generation} waits (applyNow=false)` });
    }
  }

  for (const a of actual) {
    if (desiredIds.has(a.agentUserId)) continue;
    if (a.pod) {
      actions.push({ kind: 'delete', agentUserId: a.agentUserId, reason: 'not in desired' });
    } else if (a.pvc || a.secret || a.configMap) {
      actions.push({ kind: 'reportStopped', agentUserId: a.agentUserId, reason: 'pod gone, STOPPED not yet reported' });
    }
  }
  return actions;
}

/** 템플릿 이미지·sidecar 이미지가 허용 접두어 안인지. 밖이면 사유, 안이면 null. */
export function checkImages(agent: RunnerDesiredAgent, allowedPrefixes: string[]): string | null {
  const images = [agent.image, ...(agent.sidecars ?? []).map((s) => s.image)];
  const bad = images.filter((img) => !img || !allowedPrefixes.some((p) => img.startsWith(p)));
  if (bad.length === 0) return null;
  return `허용되지 않은 이미지라 띄우지 않습니다: ${bad.join(', ')}`;
}
