// Works runner API 클라이언트(docs/integrations/agent-runner-api.md) — 모양 정의와 HTTP 구현.
// 조정 로직은 WorksClient 인터페이스만 보고, 테스트는 가짜를 끼운다.

/** desired 의 비밀값 참조 — 원문 없이 이름·출처·버전만. */
export interface RunnerSecretRef {
  name: string;
  source: 'WORKS' | string;
  version: number | null;
  rotateAfter: string | null;
}

/** 템플릿 sidecar — dind 면 runner 가 고정 배선을 붙인다. */
export interface RunnerSidecar {
  name: string;
  image: string;
  privileged?: boolean;
}

export interface RunnerResources {
  cpuRequest?: string | null;
  memoryRequest?: string | null;
  cpuLimit?: string | null;
  memoryLimit?: string | null;
  workDisk?: string | null;
}

/** 이 위치에 떠 있어야 할 AI 한 명. */
export interface RunnerDesiredAgent {
  agentUserId: number;
  username: string;
  tenantId: number;
  generation: number;
  applyNow: boolean;
  templateName: string;
  templateVersion: string;
  image: string;
  resources: RunnerResources;
  sidecars: RunnerSidecar[];
  plugins: Record<string, unknown>[];
  config: Record<string, string>;
  secrets: RunnerSecretRef[];
}

export interface RunnerDesired {
  locationId: number;
  locationName: string;
  generatedAt: string;
  pollIntervalSeconds: number;
  mcpUrl: string;
  apiUrl: string;
  agents: RunnerDesiredAgent[];
}

export type RunnerPhase = 'STARTING' | 'RUNNING' | 'STOPPING' | 'STOPPED' | 'FAILED';

/** 관찰 보고의 AI 한 명. 모르는 칸은 null 로 보낸다(Works 는 null 이면 그대로 둔다). */
export interface RunnerObservedAgent {
  agentUserId: number;
  observedGeneration: number | null;
  phase: RunnerPhase;
  message: string | null;
  cpuMillicores: number | null;
  memoryBytes: number | null;
  startedAt: string | null;
}

export interface AgentKeyResponse {
  keyId: number;
  plaintext: string;
  expiresAt: string;
  rotateAfter: string;
}

/**
 * 모델 연결(claude)·로그인 정보(login, WP-1296)의 원문 응답 — 둘이 같은 모양이다. payload 는 claude 면 토큰·provider 설정 JSON,
 * login 이면 Gen:iA·ChatGPT 프로그램의 auth.json 내용(JSON 문자열). 원문이라 로그에 남기지 않는다.
 */
export interface SecretPayloadResponse {
  version: number;
  provider: string;
  payload: string;
}

/** AI 의 저장소 토큰 전부(활성만, host 오름차순) — 등록이 없으면 version null·빈 배열. */
export interface RepoSecretsResponse {
  version: number | null;
  tokens: { kind: 'GITHUB' | 'GITLAB'; host: string; token: string }[];
}

export interface ObservedResponse {
  updated: number;
  ignored: number[];
}

/** runner 가 Works 에 하는 호출 전부. */
export interface WorksClient {
  getDesired(): Promise<RunnerDesired>;
  /** 부르면 곧 키 교체(generation+1)다 — 필요할 때만(secretFetches). */
  issueAgentKey(agentUserId: number): Promise<AgentKeyResponse>;
  /** 등록된 연결이 없으면(404 RUNNER_SECRET_NOT_FOUND) null. */
  getClaudeSecret(agentUserId: number): Promise<SecretPayloadResponse | null>;
  /** 로그인 정보(WP-1296) — 켜져 있지 않음·활성 연결 없음·템플릿 계정과 다른 종류면 404 라 null(=지운다). */
  getLoginSecret(agentUserId: number): Promise<SecretPayloadResponse | null>;
  /** 저장소 토큰(WP-1268) — 원문이 들어 있으니 로그에 남기지 않는다. */
  getRepoSecrets(agentUserId: number): Promise<RepoSecretsResponse>;
  /** metricsAvailable — 사용량 API 가 있는지(WP-1280). 모르면(일시 오류) undefined 라 보내지 않는다. */
  reportObserved(agents: RunnerObservedAgent[], metricsAvailable?: boolean): Promise<ObservedResponse>;
}

/**
 * Works 가 2xx 가 아닌 답을 줬다. 메시지에는 경로·상태·오류 코드만 담는다 —
 * 요청·응답 본문(원문 키가 있을 수 있음)은 담지 않는다.
 */
export class WorksHttpError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    readonly code: string | undefined,
  ) {
    super(`Works ${path} → ${status}${code ? ` (${code})` : ''}`);
    this.name = 'WorksHttpError';
  }
}

/** 오류 본문에서 errors.code 만 꺼낸다(다른 API 와 같은 status·message·errors 모양). */
async function errorCode(res: Response): Promise<string | undefined> {
  try {
    const body = (await res.json()) as { errors?: unknown };
    const errors = body?.errors;
    if (Array.isArray(errors)) {
      const first = errors[0] as { code?: unknown } | undefined;
      return typeof first?.code === 'string' ? first.code : undefined;
    }
    if (errors && typeof errors === 'object' && 'code' in errors) {
      const code = (errors as { code?: unknown }).code;
      return typeof code === 'string' ? code : undefined;
    }
  } catch {
    // 본문이 JSON 이 아니면 코드 없이
  }
  return undefined;
}

/** fetch 로 runner API 를 부르는 구현. 요청마다 10초 제한(멈춘 연결이 조정을 붙잡지 않게). */
export class HttpWorksClient implements WorksClient {
  private readonly base: string;

  constructor(
    worksUrl: string,
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly timeoutMs = 10_000,
  ) {
    this.base = `${worksUrl}/api/v1/agent-runtime/runner`;
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.fetchImpl(`${this.base}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) throw new WorksHttpError(res.status, path, await errorCode(res));
    return (await res.json()) as T;
  }

  getDesired(): Promise<RunnerDesired> {
    return this.call('GET', '/desired');
  }

  issueAgentKey(agentUserId: number): Promise<AgentKeyResponse> {
    return this.call('POST', `/agents/${agentUserId}/agent-key`);
  }

  getClaudeSecret(agentUserId: number): Promise<SecretPayloadResponse | null> {
    return this.getSecretOrNull(agentUserId, 'claude');
  }

  getLoginSecret(agentUserId: number): Promise<SecretPayloadResponse | null> {
    return this.getSecretOrNull(agentUserId, 'login');
  }

  /** `…/secrets/<name>` 를 받는다 — 등록된 연결이 없으면(404 RUNNER_SECRET_NOT_FOUND) null. 그 밖의 오류는 던진다. */
  private async getSecretOrNull(agentUserId: number, name: 'claude' | 'login'): Promise<SecretPayloadResponse | null> {
    try {
      return await this.call<SecretPayloadResponse>('GET', `/agents/${agentUserId}/secrets/${name}`);
    } catch (e) {
      if (e instanceof WorksHttpError && e.status === 404 && e.code === 'RUNNER_SECRET_NOT_FOUND') return null;
      throw e;
    }
  }

  getRepoSecrets(agentUserId: number): Promise<RepoSecretsResponse> {
    return this.call('GET', `/agents/${agentUserId}/secrets/repos`);
  }

  reportObserved(agents: RunnerObservedAgent[], metricsAvailable?: boolean): Promise<ObservedResponse> {
    return this.call('POST', '/observed', { agents, metricsAvailable });
  }
}
