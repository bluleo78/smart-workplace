// runner 설정 — Helm 차트(Task 4)가 env 로 넘기는 값을 읽어 검증한다. 잘못된 값이면 시작하지 않는다(엉뚱한 Pod 를 띄우지 않게).
import { readFileSync } from 'node:fs';
import type { V1HostAlias, V1ResourceRequirements, V1Toleration } from '@kubernetes/client-node';

/** runner 한 대의 설정. 위치 값(nodeSelector 등)은 그 위치의 모든 AI Pod 에 똑같이 들어간다. */
export interface RunnerConfig {
  /** Works origin(예 https://genia-works.iacloud.kr) — 끝의 / 는 뗀다. runner API 는 그 아래 /api/v1/agent-runtime/runner. */
  worksUrl: string;
  /** runner 토큰(rt_…) — 파일에서만 읽는다(env·명령줄 인자에 원문을 두지 않게). */
  runnerToken: string;
  /** runner 가 돌고 AI 를 띄우는 네임스페이스 — 네임스페이스 범위 API 만 쓴다. */
  namespace: string;
  /** 허용 이미지 접두어 — 이 밖의 이미지는 템플릿이 시켜도 띄우지 않는다. */
  allowedImagePrefixes: string[];
  nodeSelector: Record<string, string>;
  tolerations: V1Toleration[];
  hostAliases: V1HostAlias[];
  /** 작업 디스크 StorageClass — 없으면 클러스터 기본. */
  storageClass: string | undefined;
  /** 위치에 미리 만든 GitHub 토큰 Secret 이름(키 token) — runner 는 복사하지 않고 Pod 가 직접 마운트한다. */
  githubSecretName: string;
  /** dind 의 /var/lib/docker emptyDir 상한. */
  dindStorageLimit: string;
  /**
   * dind 사이드카 자원 — 네임스페이스 ResourceQuota(requests.cpu/memory)가 켜져 있으면 requests 없는 컨테이너는 Pod 째 거절되므로
   * 늘 requests 를 둔다. Helm `dind.resources` → env DIND_RESOURCES(JSON).
   */
  dindResources: V1ResourceRequirements;
  /** /healthz 포트 — 클러스터 안 기본 8080. 로컬에서 다른 서비스와 겹치면 HEALTH_PORT 로 바꾼다. */
  healthPort: number;
  terminationGraceSeconds: number;
  /** AI Pod 이미지를 받을 때 쓸 pull secret 이름들(이 네임스페이스에 미리 만든 것) — 작업 공간 이미지가 비공개 레지스트리(Docker Hub iacloudops)에 있다. */
  imagePullSecrets: string[];
}

type Env = Record<string, string | undefined>;

/** dind 기본 자원(PoC 실측값) — Helm values 의 dind.resources 기본과 같다. */
export const DEFAULT_DIND_RESOURCES: V1ResourceRequirements = {
  requests: { cpu: '500m', memory: '1Gi' },
  limits: { cpu: '4', memory: '6Gi' },
};

function required(env: Env, name: string): string {
  const v = env[name]?.trim();
  if (!v) throw new Error(`${name} 가 비어 있습니다`);
  return v;
}

/** JSON env 를 읽는다 — 비어 있으면 기본값, 깨졌거나 모양이 틀리면 시작 실패. */
function json<T>(env: Env, name: string, fallback: T, valid: (v: unknown) => v is T): T {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${name} 가 올바른 JSON 이 아닙니다`);
  }
  if (!valid(parsed)) throw new Error(`${name} 의 모양이 틀렸습니다`);
  return parsed;
}

const isStringMap = (v: unknown): v is Record<string, string> =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && Object.values(v).every((x) => typeof x === 'string');
const isObjectArray = <T>(v: unknown): v is T[] =>
  Array.isArray(v) && v.every((x) => typeof x === 'object' && x !== null && !Array.isArray(x));

/**
 * requests/limits 의 수량 표 하나를 문자열 표로 — Helm toJson 은 따옴표 없는 `cpu: 4` 를 숫자 4 로 내보내므로 숫자도 받아 문자열로 바꾼다.
 * 모양이 틀리면 null.
 */
function quantityMap(v: unknown): Record<string, string> | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
  const out: Record<string, string> = {};
  for (const [k, q] of Object.entries(v)) {
    if (typeof q === 'number' && Number.isFinite(q) && q >= 0) out[k] = String(q);
    else if (typeof q === 'string' && q.trim()) out[k] = q.trim();
    else return null;
  }
  return out;
}

/** DIND_RESOURCES — {requests?, limits?} 외의 칸·잘못된 수량은 시작 실패. requests 는 cpu·memory 둘 다 있어야 한다(쿼터 승인). */
function dindResources(env: Env): V1ResourceRequirements {
  const raw = json<unknown>(env, 'DIND_RESOURCES', DEFAULT_DIND_RESOURCES, (_v): _v is unknown => true);
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error('DIND_RESOURCES 의 모양이 틀렸습니다');
  const out: V1ResourceRequirements = {};
  for (const [k, v] of Object.entries(raw)) {
    if (k !== 'requests' && k !== 'limits') throw new Error(`DIND_RESOURCES 에 모르는 칸이 있습니다: ${k}`);
    const m = quantityMap(v);
    if (!m) throw new Error(`DIND_RESOURCES.${k} 의 모양이 틀렸습니다`);
    out[k] = m;
  }
  if (!out.requests?.cpu || !out.requests?.memory) {
    throw new Error('DIND_RESOURCES.requests 에 cpu·memory 가 모두 필요합니다(네임스페이스 쿼터)');
  }
  return out;
}

/**
 * env 에서 설정을 만든다. readFile 은 테스트에서 바꿔 끼우려고 받는다.
 * 토큰 파일은 Helm Secret 을 파일로 마운트한 것 — 줄바꿈이 붙어 있을 수 있어 다듬는다.
 */
export function loadConfig(env: Env = process.env, readFile: (path: string) => string = (p) => readFileSync(p, 'utf8')): RunnerConfig {
  const worksUrl = required(env, 'WORKS_URL').replace(/\/+$/, '');
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(worksUrl);
  } catch {
    throw new Error('WORKS_URL 이 올바른 주소가 아닙니다');
  }
  if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') {
    throw new Error('WORKS_URL 은 http(s) 주소여야 합니다');
  }

  const tokenFile = required(env, 'RUNNER_TOKEN_FILE');
  const runnerToken = readFile(tokenFile).trim();
  if (!runnerToken) throw new Error('RUNNER_TOKEN_FILE 이 비어 있습니다');

  const allowedImagePrefixes = (env.ALLOWED_IMAGE_PREFIXES ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (allowedImagePrefixes.length === 0) throw new Error('ALLOWED_IMAGE_PREFIXES 가 비어 있습니다');

  const graceRaw = env.TERMINATION_GRACE_SECONDS?.trim() || '60';
  const terminationGraceSeconds = Number(graceRaw);
  if (!Number.isInteger(terminationGraceSeconds) || terminationGraceSeconds < 0) {
    throw new Error('TERMINATION_GRACE_SECONDS 는 0 이상의 정수여야 합니다');
  }

  const healthRaw = env.HEALTH_PORT?.trim() || '8080';
  const healthPort = Number(healthRaw);
  if (!Number.isInteger(healthPort) || healthPort < 1 || healthPort > 65535) {
    throw new Error('HEALTH_PORT 는 1~65535 의 정수여야 합니다');
  }

  return {
    worksUrl,
    runnerToken,
    namespace: required(env, 'NAMESPACE'),
    allowedImagePrefixes,
    nodeSelector: json(env, 'AGENT_NODE_SELECTOR', {}, isStringMap),
    tolerations: json<V1Toleration[]>(env, 'AGENT_TOLERATIONS', [], isObjectArray),
    hostAliases: json<V1HostAlias[]>(env, 'AGENT_HOST_ALIASES', [], isObjectArray),
    storageClass: env.AGENT_STORAGE_CLASS?.trim() || undefined,
    githubSecretName: required(env, 'GITHUB_SECRET_NAME'),
    dindStorageLimit: env.DIND_STORAGE_LIMIT?.trim() || '20Gi',
    dindResources: dindResources(env),
    healthPort,
    terminationGraceSeconds,
    imagePullSecrets: (env.AGENT_IMAGE_PULL_SECRETS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  };
}
