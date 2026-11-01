// runner 설정 — Helm 차트(Task 4)가 env 로 넘기는 값을 읽어 검증한다. 잘못된 값이면 시작하지 않는다(엉뚱한 Pod 를 띄우지 않게).
import { readFileSync } from 'node:fs';
import { z } from 'zod';
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

// ── env 한 칸씩의 스키마. 모양·기본값·오류 문구(한국어)를 한곳에 둔다. ──

/** 필수 문자열 env — 없거나 공백뿐이면 시작 실패. 값은 다듬어 돌려준다. */
const requiredStr = (name: string) => {
  const error = `${name} 가 비어 있습니다`;
  return z.string({ error }).trim().min(1, { error });
};

/** 쉼표 목록 env — 비어 있어도 되고(빈 배열), 항목은 다듬어 빈 칸을 버린다. */
const csvEnv = z
  .string()
  .optional()
  .transform((v) =>
    (v ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );

/** 정수 env — 비어 있으면 기본값(문자열), 범위 밖·정수 아님은 message 로 시작 실패. */
const intEnv = (fallback: string, min: number, max: number, error: string) =>
  z
    .string()
    .optional()
    .transform((v) => Number(v?.trim() || fallback))
    .pipe(z.number({ error }).int({ error }).min(min, { error }).max(max, { error }));

/** 선택 문자열 env — 비어 있으면 기본값(없으면 undefined). */
const optionalStr = (fallback?: string) =>
  z
    .string()
    .optional()
    .transform((v) => v?.trim() || fallback);

/**
 * JSON env — 비어 있으면 기본값, 깨졌으면 시작 실패, 모양은 schema 가 본다.
 * schema 의 오류 문구는 호출하는 쪽이 `${name} 의 모양이 틀렸습니다` 로 맞춘다.
 */
const jsonEnv = <T extends z.ZodType>(name: string, schema: T, fallback: unknown) =>
  z
    .string()
    .optional()
    .transform((v, ctx): unknown => {
      const raw = v?.trim();
      if (!raw) return fallback;
      try {
        return JSON.parse(raw);
      } catch {
        ctx.addIssue({ code: 'custom', message: `${name} 가 올바른 JSON 이 아닙니다` });
        return z.NEVER;
      }
    })
    .pipe(schema);

/** 모양이 틀렸을 때의 공통 문구. */
const shapeError = (name: string) => `${name} 의 모양이 틀렸습니다`;

/** 객체 배열 env(tolerations·hostAliases) — 원소 내용은 쿠버네티스가 검증하므로 객체인지만 본다. */
const objectArray = <T>(name: string) =>
  z.array(z.looseObject({}, { error: shapeError(name) }), { error: shapeError(name) }) as unknown as z.ZodType<T[]>;

/**
 * 수량 표 하나(requests 또는 limits) — Helm toJson 은 따옴표 없는 `cpu: 4` 를 숫자 4 로 내보내므로
 * 0 이상의 유한한 숫자도 받아 문자열로 바꾼다. 문자열은 다듬고 빈 값은 거절한다.
 */
const quantityMap = (path: string) => {
  const error = shapeError(path);
  const quantity = z.union(
    [
      z
        .number()
        .finite()
        .nonnegative()
        .transform((n) => String(n)),
      z.string().trim().min(1),
    ],
    { error },
  );
  return z.record(z.string(), quantity, { error });
};

/** DIND_RESOURCES — {requests?, limits?} 외의 칸·잘못된 수량은 시작 실패. requests 는 cpu·memory 둘 다 있어야 한다(쿼터 승인). */
const dindResourcesSchema = z
  .strictObject(
    { requests: quantityMap('DIND_RESOURCES.requests').optional(), limits: quantityMap('DIND_RESOURCES.limits').optional() },
    {
      error: (iss) =>
        iss.code === 'unrecognized_keys' ? `DIND_RESOURCES 에 모르는 칸이 있습니다: ${iss.keys[0]}` : shapeError('DIND_RESOURCES'),
    },
  )
  .refine((v) => v.requests?.cpu && v.requests?.memory, {
    error: 'DIND_RESOURCES.requests 에 cpu·memory 가 모두 필요합니다(네임스페이스 쿼터)',
  });

/** WORKS_URL — 끝의 / 를 떼고 http(s) 주소인지 본다. */
const worksUrlSchema = requiredStr('WORKS_URL')
  .transform((s) => s.replace(/\/+$/, ''))
  .transform((s, ctx) => {
    let url: URL;
    try {
      url = new URL(s);
    } catch {
      ctx.addIssue({ code: 'custom', message: 'WORKS_URL 이 올바른 주소가 아닙니다' });
      return z.NEVER;
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      ctx.addIssue({ code: 'custom', message: 'WORKS_URL 은 http(s) 주소여야 합니다' });
      return z.NEVER;
    }
    return s;
  });

/**
 * env → 설정 스키마. 토큰은 여기서 읽지 않는다 — 변환은 모든 칸에서 실행되므로, 다른 칸이 틀렸는데도 파일을 읽다가
 * 읽기 예외가 앞선 칸의 한국어 오류를 가리지 않게 loadConfig 가 검증이 통과한 뒤에 읽는다(RUNNER_TOKEN_FILE 은 경로만 본다).
 */
const envSchema = z
    .object({
      WORKS_URL: worksUrlSchema,
      RUNNER_TOKEN_FILE: requiredStr('RUNNER_TOKEN_FILE'),
      ALLOWED_IMAGE_PREFIXES: csvEnv.pipe(z.array(z.string()).min(1, { error: 'ALLOWED_IMAGE_PREFIXES 가 비어 있습니다' })),
      TERMINATION_GRACE_SECONDS: intEnv('60', 0, Number.MAX_SAFE_INTEGER, 'TERMINATION_GRACE_SECONDS 는 0 이상의 정수여야 합니다'),
      HEALTH_PORT: intEnv('8080', 1, 65535, 'HEALTH_PORT 는 1~65535 의 정수여야 합니다'),
      NAMESPACE: requiredStr('NAMESPACE'),
      AGENT_NODE_SELECTOR: jsonEnv(
        'AGENT_NODE_SELECTOR',
        z.record(z.string(), z.string({ error: shapeError('AGENT_NODE_SELECTOR') }), { error: shapeError('AGENT_NODE_SELECTOR') }),
        {},
      ),
      AGENT_TOLERATIONS: jsonEnv('AGENT_TOLERATIONS', objectArray<V1Toleration>('AGENT_TOLERATIONS'), []),
      AGENT_HOST_ALIASES: jsonEnv('AGENT_HOST_ALIASES', objectArray<V1HostAlias>('AGENT_HOST_ALIASES'), []),
      AGENT_STORAGE_CLASS: optionalStr(),
      GITHUB_SECRET_NAME: requiredStr('GITHUB_SECRET_NAME'),
      DIND_STORAGE_LIMIT: optionalStr('20Gi'),
      DIND_RESOURCES: jsonEnv('DIND_RESOURCES', dindResourcesSchema, DEFAULT_DIND_RESOURCES),
      AGENT_IMAGE_PULL_SECRETS: csvEnv,
    })
    .transform(
      (e): Omit<RunnerConfig, 'runnerToken'> & { tokenFile: string } => ({
        worksUrl: e.WORKS_URL,
        tokenFile: e.RUNNER_TOKEN_FILE,
        namespace: e.NAMESPACE,
        allowedImagePrefixes: e.ALLOWED_IMAGE_PREFIXES,
        nodeSelector: e.AGENT_NODE_SELECTOR,
        tolerations: e.AGENT_TOLERATIONS,
        hostAliases: e.AGENT_HOST_ALIASES,
        storageClass: e.AGENT_STORAGE_CLASS,
        githubSecretName: e.GITHUB_SECRET_NAME,
        dindStorageLimit: e.DIND_STORAGE_LIMIT as string,
        dindResources: e.DIND_RESOURCES,
        healthPort: e.HEALTH_PORT,
        terminationGraceSeconds: e.TERMINATION_GRACE_SECONDS,
        imagePullSecrets: e.AGENT_IMAGE_PULL_SECRETS,
      }),
    );

/** env 에서 설정을 만든다 — 첫 오류의 한국어 문구로 Error 를 던져 시작을 멈춘다. */
export function loadConfig(env: Env = process.env, readFile: (path: string) => string = (p) => readFileSync(p, 'utf8')): RunnerConfig {
  const result = envSchema.safeParse(env);
  if (!result.success) throw new Error(result.error.issues[0].message);
  // 토큰 파일은 Helm Secret 을 파일로 마운트한 것 — 줄바꿈이 붙어 있을 수 있어 다듬는다. readFile 은 테스트에서 바꿔 끼운다.
  const { tokenFile, ...rest } = result.data;
  const runnerToken = readFile(tokenFile).trim();
  if (!runnerToken) throw new Error('RUNNER_TOKEN_FILE 이 비어 있습니다');
  return { ...rest, runnerToken };
}
