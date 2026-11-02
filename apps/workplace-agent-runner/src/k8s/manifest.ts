// AI 한 명의 Pod·PVC·ConfigMap·Secret 모양 — docs/integrations/agent-pod-contract.md 를 그대로 옮긴 순수 함수.
// 작업 공간 이미지(WP-1252)의 엔트리포인트가 같은 계약을 읽으므로 이름·경로·env 를 바꾸면 두 쪽을 함께 바꾼다.
import type {
  KubernetesObject,
  V1ConfigMap,
  V1Container,
  V1EnvVar,
  V1PersistentVolumeClaim,
  V1Pod,
  V1ResourceRequirements,
  V1Secret,
  V1Volume,
  V1VolumeMount,
} from '@kubernetes/client-node';
import type { RunnerConfig } from '../config.js';
import type { RunnerDesiredAgent, RunnerSidecar } from '../works/client.js';

/** runner 가 만든 리소스 표시 — 이 라벨이 없는 리소스는 만지지도 지우지도 않는다. */
export const MANAGED_BY_KEY = 'app.kubernetes.io/managed-by';
export const MANAGED_BY_VALUE = 'genia-agent-runner';
export const MANAGED_SELECTOR = `${MANAGED_BY_KEY}=${MANAGED_BY_VALUE}`;
export const AGENT_LABEL = 'genia.works/agent';
export const LOCATION_LABEL = 'genia.works/location';
export const GENERATION_LABEL = 'genia.works/generation';

/** Pod 라벨의 generation — 없거나 숫자가 아니면 null(다른 generation 으로 보아 applyNow 규칙을 따른다). */
export function podGeneration(pod: KubernetesObject): number | null {
  const g = pod.metadata?.labels?.[GENERATION_LABEL];
  return g !== undefined && /^\d+$/.test(g) ? Number(g) : null;
}

/** Secret 어노테이션 — runner 가 재시작해도 「이미 받은 키」를 아는 유일한 기록. */
export const ANN_AGENT_KEY_ID = 'genia.works/agent-key-id';
export const ANN_AGENT_KEY_ROTATE_AFTER = 'genia.works/agent-key-rotate-after';
/** Secret 에는 받은 모델 연결 version, Pod 에는 만들 때 넣은 version — 둘이 다르면 Pod 를 다시 만든다(토큰이 env 로 고정되므로). */
export const ANN_CLAUDE_VERSION = 'genia.works/claude-version';
/**
 * 저장소 토큰(WP-1268) — Secret 에는 받은 repos version, Pod 에는 만들 때 넣은 version. 둘이 다르면 Pod 를 다시 만든다
 * (작업 공간 이미지가 Pod 시작 때 gh 로그인을 해 고정되므로 — Claude 모델 연결과 같은 이유).
 */
export const ANN_REPOS_VERSION = 'genia.works/repos-version';
/** Secret 에 적는 토큰 호스트 목록(`GITHUB:github.com,GITLAB:gitlab.iacloud.kr`, 원문 없음) — Pod 를 만들 때 볼륨 items 를 이것으로 만든다. */
export const ANN_REPO_HOSTS = 'genia.works/repo-hosts';
/**
 * Secret 에 적는 작업 디스크 노드(hostPath 방식, WP-1270) — 처음 뜬 Pod 의 spec.nodeName. Secret 은 켜져 있는 동안 남고
 * 끄면 지워지므로, 다시 시작(generation·모델 연결 교체)해도 같은 노드·같은 작업 폴더를 쓰고, 끄고 켜면 새로 고른다.
 */
export const ANN_WORK_NODE = 'genia.works/work-node';

/** Secret 데이터 키. */
export const SECRET_AGENT_KEY = 'agent-key';
export const SECRET_CLAUDE_TOKEN = 'claude-token';
/** 저장소 토큰 Secret 키 접두어 — 키는 `repo-<kind 소문자>-<host>`. */
export const SECRET_REPO_PREFIX = 'repo-';

export type RepoKind = 'GITHUB' | 'GITLAB';

/** 저장소 토큰의 Secret 데이터 키. */
export const repoSecretKey = (kind: RepoKind, host: string) => `${SECRET_REPO_PREFIX}${kind.toLowerCase()}-${host}`;

/** `repo-hosts` 어노테이션 값 — 원문 없이 kind:host 만, 순서를 고정해 같은 집합이면 같은 문자열. */
export function formatRepoHosts(tokens: { kind: RepoKind; host: string }[]): string {
  return tokens
    .map((t) => `${t.kind}:${t.host}`)
    .sort()
    .join(',');
}

/** `repo-hosts` 어노테이션을 읽는다 — 모양이 어긋난 항목은 건너뛴다. */
export function parseRepoHosts(value: string | undefined): { kind: RepoKind; host: string }[] {
  const out: { kind: RepoKind; host: string }[] = [];
  for (const part of (value ?? '').split(',')) {
    const [kind, host] = part.split(':');
    if ((kind === 'GITHUB' || kind === 'GITLAB') && host) out.push({ kind, host });
  }
  return out;
}

/** Pod 에 넣는 저장소 토큰 정보 — Secret 의 repos version(문자열)과 repo-hosts 어노테이션 값. */
export interface RepoMount {
  version?: string;
  hosts?: string;
}

/** agent 컨테이너 사용자 — 작업 공간 이미지의 agent 사용자와 같은 UID/GID. */
const AGENT_UID = 1001;
const DIND_SOCKET_DIR = '/dind';

export const podName = (agentUserId: number) => `agent-${agentUserId}`;
export const pvcName = (agentUserId: number) => `agent-${agentUserId}-work`;
export const secretName = (agentUserId: number) => `agent-${agentUserId}`;
export const configMapName = (agentUserId: number) => `agent-${agentUserId}`;
/** hostPath 방식의 노드 쪽 작업 폴더 — `<상위 폴더>/agent-<id>`. */
export const workHostDir = (base: string, agentUserId: number) => `${base}/agent-${agentUserId}`;

/** desired 의 위치·주소 값 — 모든 AI 에 공통. */
export interface AgentContext {
  locationId: number;
  apiUrl: string;
  mcpUrl: string;
}

/** 네 리소스 공통 라벨. */
export function baseLabels(agentUserId: number, locationId: number): Record<string, string> {
  return {
    [MANAGED_BY_KEY]: MANAGED_BY_VALUE,
    [AGENT_LABEL]: String(agentUserId),
    [LOCATION_LABEL]: String(locationId),
  };
}

/**
 * agent 컨테이너 requests 기본값 — 템플릿에 값이 없을 때. 네임스페이스 ResourceQuota(requests.cpu/memory)가 켜져 있으면
 * requests 없는 컨테이너가 하나라도 있는 Pod 는 승인에서 거절되므로 늘 채운다(계약 문서 「자원」).
 */
const AGENT_DEFAULT_REQUESTS = { cpu: '1', memory: '2Gi' };
/** dind 가 아닌 사이드카 requests 기본값 — 템플릿에 사이드카 자원 칸이 없어 작게 잡는다. */
const SIDECAR_DEFAULT_REQUESTS = { cpu: '100m', memory: '128Mi' };

/**
 * hostPath 작업 폴더 주인 맞추기(init 컨테이너) — kubelet 이 DirectoryOrCreate 로 만든 폴더는 root 소유이고 fsGroup 도
 * hostPath 에는 적용되지 않아, agent(1001)가 쓸 수 있게 폴더 자체만 넘긴다(안의 파일은 agent 가 만든 것이라 이미 1001).
 * 작업 공간 이미지를 그대로 써서 허용 이미지 밖의 것을 띄우지 않는다.
 */
function workOwnerContainer(image: string): V1Container {
  return {
    name: 'work-owner',
    image,
    command: ['chown', `${AGENT_UID}:${AGENT_UID}`, '/work'],
    securityContext: { runAsUser: 0, runAsGroup: 0, runAsNonRoot: false },
    resources: { requests: { ...SIDECAR_DEFAULT_REQUESTS } },
    volumeMounts: [{ name: 'work', mountPath: '/work' }],
  };
}

/**
 * 템플릿 자원 → requests/limits. requests 는 늘 cpu·memory 둘 다 둔다(쿼터 승인):
 * 템플릿 request → 없으면 템플릿 limit(기본값이 limit 보다 커 검증에 걸리지 않게) → 없으면 기본값. limits 는 템플릿에 있을 때만.
 */
function resourcesOf(agent: RunnerDesiredAgent): V1ResourceRequirements {
  const r = agent.resources ?? {};
  const limits: Record<string, string> = {};
  if (r.cpuLimit) limits.cpu = r.cpuLimit;
  if (r.memoryLimit) limits.memory = r.memoryLimit;
  const out: V1ResourceRequirements = {
    requests: {
      cpu: r.cpuRequest || r.cpuLimit || AGENT_DEFAULT_REQUESTS.cpu,
      memory: r.memoryRequest || r.memoryLimit || AGENT_DEFAULT_REQUESTS.memory,
    },
  };
  if (Object.keys(limits).length) out.limits = limits;
  return out;
}

/**
 * 템플릿 sidecar 한 개 → 컨테이너. 이름이 dind 면 계약의 고정 배선(소켓·그룹·저장소)과 위치 값 자원(DIND_RESOURCES)을 붙인다.
 * 다른 사이드카도 쿼터에 걸리지 않게 작은 requests 를 둔다.
 */
function sidecarContainer(s: RunnerSidecar, cfg: RunnerConfig): V1Container {
  if (s.name === 'dind') {
    return {
      name: 'dind',
      image: s.image,
      securityContext: { privileged: true },
      resources: structuredClone(cfg.dindResources),
      args: [`--host=unix://${DIND_SOCKET_DIR}/docker.sock`, `--group=${AGENT_UID}`],
      env: [{ name: 'DOCKER_TLS_CERTDIR', value: '' }],
      volumeMounts: [
        { name: 'dind-storage', mountPath: '/var/lib/docker' },
        { name: 'dind-socket', mountPath: DIND_SOCKET_DIR },
      ],
    };
  }
  return {
    name: s.name,
    image: s.image,
    securityContext: { privileged: s.privileged === true },
    resources: { requests: { ...SIDECAR_DEFAULT_REQUESTS } },
  };
}

/** config.json — 엔트리포인트가 읽는 AI·Works·템플릿 정보. config·plugins 는 desired 그대로. */
function configJson(agent: RunnerDesiredAgent, ctx: AgentContext): string {
  return JSON.stringify(
    {
      agent: {
        userId: agent.agentUserId,
        username: agent.username,
        tenantId: agent.tenantId,
        generation: agent.generation,
      },
      works: { apiUrl: ctx.apiUrl, mcpUrl: ctx.mcpUrl },
      template: { name: agent.templateName, version: agent.templateVersion },
      config: agent.config ?? {},
      plugins: agent.plugins ?? [],
    },
    null,
    2,
  );
}

/** buildAgentResources 의 선택 입력. */
export interface BuildAgentOptions {
  /** 지금 Secret 에 든 모델 연결 version — Pod 어노테이션에 적어 두고, 나중에 Secret 의 것과 다르면 Pod 를 다시 만든다. */
  claudeVersion?: string;
  /** hostPath 방식에서 Secret 에 적어 둔 작업 디스크 노드 — 있으면 그 노드에만 뜨게 고정한다. */
  workNode?: string;
  /** Secret 의 저장소 토큰 기록 — version 은 Pod 어노테이션으로, hosts 는 볼륨 repo-tokens 의 items 로 옮긴다(호스트가 없으면 볼륨·마운트 없음). */
  repos?: RepoMount;
  /** 이 AI 의 작업 디스크 방식 — 없으면 설정(cfg.workDiskType). 설정은 hostPath 인데 pvc 로 설치된 AI 를 이어 가는 때 pvc 로 넘긴다. */
  workDisk?: 'pvc' | 'hostPath';
}

/**
 * AI 한 명의 Pod·PVC·ConfigMap. Secret 은 원문이 필요해 따로({@link buildAgentSecret}).
 * 모든 객체에 apiVersion·kind·namespace 를 채운다 — server-side apply 가 이 값으로 경로를 정한다.
 * claudeVersion 은 지금 Secret 에 든 모델 연결 version — Pod 어노테이션에 적어 두고, 나중에 Secret 의 것과 다르면 Pod 를 다시 만든다.
 * pvc 는 pvc 방식에서만 돌려준다.
 */
export function buildAgentResources(
  agent: RunnerDesiredAgent,
  ctx: AgentContext,
  cfg: RunnerConfig,
  opts: BuildAgentOptions = {},
): { pod: V1Pod; pvc?: V1PersistentVolumeClaim; configMap: V1ConfigMap } {
  const { claudeVersion, workNode, repos = {} } = opts;
  const hostPathDisk = (opts.workDisk ?? cfg.workDiskType) === 'hostPath';
  const id = agent.agentUserId;
  const labels = baseLabels(id, ctx.locationId);
  const hasClaude = agent.secrets.some((s) => s.name === 'claude');
  const sidecars = agent.sidecars ?? [];
  const hasDind = sidecars.some((s) => s.name === 'dind');

  const env: V1EnvVar[] = [
    { name: 'GENIA_AGENT_NAME', value: agent.username },
    { name: 'GENIA_AGENT_GENERATION', value: String(agent.generation) },
    { name: 'GENIA_WORKS_TENANT', value: String(agent.tenantId) },
    { name: 'GENIA_WORKS_API_URL', value: ctx.apiUrl },
    { name: 'GENIA_WORKS_MCP_URL', value: ctx.mcpUrl },
    { name: 'DOCKER_HOST', value: `unix://${DIND_SOCKET_DIR}/docker.sock` },
  ];
  if (hasClaude) {
    // optional — 연결이 지워져 키가 없어도 Pod 는 뜬다(모델만 못 부름)
    env.push({
      name: 'CLAUDE_CODE_OAUTH_TOKEN',
      valueFrom: { secretKeyRef: { name: secretName(id), key: SECRET_CLAUDE_TOKEN, optional: true } },
    });
  }

  // 파일마다 subPath 로 붙인다 — /run/genia 디렉터리는 이미지 쪽에 두고, 세 파일만 읽기 전용으로 꽂는다.
  const volumeMounts: V1VolumeMount[] = [
    { name: 'genia-config', mountPath: '/run/genia/config.json', subPath: 'config.json', readOnly: true },
    { name: 'agent-secret', mountPath: '/run/genia/agent-key', subPath: SECRET_AGENT_KEY, readOnly: true },
    { name: 'work', mountPath: '/work' },
    { name: 'dind-socket', mountPath: DIND_SOCKET_DIR },
  ];
  const volumes: V1Volume[] = [
    { name: 'genia-config', configMap: { name: configMapName(id) } },
    { name: 'agent-secret', secret: { secretName: secretName(id) } },
    hostPathDisk
      ? { name: 'work', hostPath: { path: workHostDir(cfg.workHostPath, id), type: 'DirectoryOrCreate' } }
      : { name: 'work', persistentVolumeClaim: { claimName: pvcName(id) } },
    { name: 'dind-socket', emptyDir: {} },
  ];
  // 저장소 토큰 — 호스트마다 `<kind 소문자>/<host>` 파일. 이미지가 폴더를 훑어 gh 로그인한다(계약 문서 「저장소 토큰」)
  const repoHosts = parseRepoHosts(repos.hosts);
  if (repoHosts.length) {
    volumeMounts.push({ name: 'repo-tokens', mountPath: '/run/genia/repo-tokens', readOnly: true });
    volumes.push({
      name: 'repo-tokens',
      secret: {
        secretName: secretName(id),
        items: repoHosts.map((h) => ({ key: repoSecretKey(h.kind, h.host), path: `${h.kind.toLowerCase()}/${h.host}` })),
      },
    });
  }
  if (hasDind) volumes.push({ name: 'dind-storage', emptyDir: { sizeLimit: cfg.dindStorageLimit } });

  const agentContainer: V1Container = {
    name: 'agent',
    image: agent.image,
    env,
    resources: resourcesOf(agent),
    securityContext: { runAsUser: AGENT_UID, runAsGroup: AGENT_UID, runAsNonRoot: true },
    volumeMounts,
  };

  // 어노테이션은 값이 있는 것만 — 둘 다 없으면 annotations 자체를 두지 않는다
  const annotations: Record<string, string> = {
    ...(claudeVersion ? { [ANN_CLAUDE_VERSION]: claudeVersion } : {}),
    ...(repos.version ? { [ANN_REPOS_VERSION]: repos.version } : {}),
  };

  const pod: V1Pod = {
    apiVersion: 'v1',
    kind: 'Pod',
    metadata: {
      name: podName(id),
      namespace: cfg.namespace,
      labels: { ...labels, [GENERATION_LABEL]: String(agent.generation) },
      ...(Object.keys(annotations).length ? { annotations } : {}),
    },
    spec: {
      restartPolicy: 'Always',
      terminationGracePeriodSeconds: cfg.terminationGraceSeconds,
      // AI 는 쿠버네티스 API 를 쓸 일이 없다 — 네임스페이스 기본 서비스 계정 토큰을 Pod 에 넣지 않는다(실측: 기본값이면 마운트된다).
      automountServiceAccountToken: false,
      ...(cfg.imagePullSecrets.length ? { imagePullSecrets: cfg.imagePullSecrets.map((name) => ({ name })) } : {}),
      // Pod 수준에는 fsGroup 만 — runAsNonRoot 를 여기 두면 root 로 도는 특권 dind 가 막힌다
      securityContext: { fsGroup: AGENT_UID },
      ...(hostPathDisk ? { initContainers: [workOwnerContainer(agent.image)] } : {}),
      containers: [agentContainer, ...sidecars.map((sc) => sidecarContainer(sc, cfg))],
      volumes,
      ...(Object.keys(cfg.nodeSelector).length ? { nodeSelector: cfg.nodeSelector } : {}),
      // 노드 로컬 작업 폴더는 다른 노드에서 보이지 않는다 — 처음 뜬 노드에 묶는다(그 노드가 사라지면 Pending, 끄고 켜면 풀린다).
      // spec.nodeName 과 같은 값인 노드 이름(metadata.name)으로 맞춘다 — hostname 라벨은 노드 이름과 다를 수 있다.
      ...(hostPathDisk && workNode
        ? {
            affinity: {
              nodeAffinity: {
                requiredDuringSchedulingIgnoredDuringExecution: {
                  nodeSelectorTerms: [{ matchFields: [{ key: 'metadata.name', operator: 'In', values: [workNode] }] }],
                },
              },
            },
          }
        : {}),
      ...(cfg.tolerations.length ? { tolerations: cfg.tolerations } : {}),
      ...(cfg.hostAliases.length ? { hostAliases: cfg.hostAliases } : {}),
    },
  };

  const pvc: V1PersistentVolumeClaim | undefined = hostPathDisk ? undefined : {
    apiVersion: 'v1',
    kind: 'PersistentVolumeClaim',
    metadata: { name: pvcName(id), namespace: cfg.namespace, labels },
    spec: {
      accessModes: ['ReadWriteOnce'],
      ...(cfg.storageClass ? { storageClassName: cfg.storageClass } : {}),
      resources: { requests: { storage: agent.resources?.workDisk || '50Gi' } },
    },
  };

  const configMap: V1ConfigMap = {
    apiVersion: 'v1',
    kind: 'ConfigMap',
    metadata: { name: configMapName(id), namespace: cfg.namespace, labels },
    data: { 'config.json': configJson(agent, ctx) },
  };

  return { pod, pvc, configMap };
}

/**
 * AI 의 Secret — data 는 원문을 받아 base64 로 넣는다. server-side apply 는 빠진 키를 지우므로
 * 늘 남길 키 전부를 넘긴다(그래야 claude-token 지우기도 같은 apply 로 된다).
 */
export function buildAgentSecret(
  agentUserId: number,
  locationId: number,
  namespace: string,
  data: Record<string, string>,
  annotations: Record<string, string>,
): V1Secret {
  return {
    apiVersion: 'v1',
    kind: 'Secret',
    type: 'Opaque',
    metadata: {
      name: secretName(agentUserId),
      namespace,
      labels: baseLabels(agentUserId, locationId),
      annotations,
    },
    data: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, Buffer.from(v, 'utf8').toString('base64')])),
  };
}
