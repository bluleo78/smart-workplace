// WP-1322: OpenAI 호환(opencode) 모델이 받는 「생각의 깊이」 단계(variant) 조회 — 모델 목록 드롭다운(조회 전용 서버)과 실행(그 실행의 서버)이
// 같은 캐시를 함께 쓴다.
//
// opencode 는 모델마다 variant(low/medium/high 등 추론 노력 묶음)를 만들고 prompt 의 `variant` 로 고르게 한다. custom(openai-compatible 등)
// provider 모델은 config 에 `reasoning: true` 를 선언해야만 variant 를 만들고, 어느 variant 를 만들지는 opencode 가 모델 id·npm 으로 정한다
// (1.19.5 실측: gpt-5 → low/medium/high, qwen3-32b → 없음). 그 규칙을 우리가 따라 적지 않고 opencode 에게 직접 묻는다 — 물을 모델을 모두
// reasoning 으로 선언한 최소 config 로 서버를 띄워 `config.providers()` 의 variants 를 읽는다. 실행은 서버를 따로 띄우지 않는다 — 고른 단계가
// 있으면 실행 config 가 이미 모델을 reasoning 으로 선언하므로 그 실행의 서버에 같은 것을 묻는다(opencodeVariantFor).
//
// 비밀은 싣지 않는다 — variant 는 모델 id·npm 만으로 정해지므로 provider options 에는 접속하지 않는 가짜 값을 넣는다(서버는 목록 조회만 한다).
// 캐시는 npm+모델 id 단위: 성공은 오래(규칙은 opencode 버전이 바뀔 때만 달라진다), 실패는 짧게. 생존 슬롯이 없어 못 띄운 경우(NoLiveSlotError)는
// 실패로 남기지 않는다 — 잠깐 붐빈 것일 뿐이라 다음 조회가 바로 다시 묻게 한다. 진행 중 조회는 모델 id 단위로 함께 기다린다.
import type { Config } from '@opencode-ai/sdk';

import { log } from '../logger.js';
import { createIsolatedOpencode, NoLiveSlotError, type SpawnOptions } from './opencode-spawn.js';
import type { OpencodeHandle } from './opencode-server-pool.js';
import { clampEffort, effortsList, type EffortLevel } from './thinking.js';

// 드롭다운 경로 — api 의 ai-agent 읽기 상한(15초)에서 모델 목록 조회(10초)를 빼고 남는 안쪽. 로컬 실측 부팅 ~2초·조회 ~0.7초.
export const EFFORTS_LOOKUP_TIMEOUT_MS = 4_000;
// 실행 경로 — 이미 뜬 실행 서버에 묻기만 하므로 짧게(로컬 실측 ~0.7초). 넘으면 이번 실행은 variant 없이 돈다.
export const RUN_PROVIDERS_TIMEOUT_MS = 2_000;
export const EFFORTS_CACHE_TTL_MS = 60 * 60 * 1000;
// 실패는 1분 — opencode 부팅 실패·시간 초과가 이어질 때 드롭다운을 열 때마다 서버를 띄우지 않게 한다.
export const EFFORTS_FAILURE_TTL_MS = 60 * 1000;
export const DEFAULT_OPENCODE_NPM = '@ai-sdk/openai-compatible';

// 조회용 provider id — 실제 연결 id 와 섞이지 않는 이름. variant 는 provider id 와 무관하다(npm·모델 id 로 정해진다).
const PROBE_PROVIDER_ID = 'wp-efforts-probe';

/** 모델 id → 지원 단계(low~max, 낮은 순). 빈 배열은 단계를 받지 않는 모델. 알아내지 못한 모델은 키가 없다. */
export type EffortsMap = Map<string, EffortLevel[]>;

type Spawn = (config: Config, opts: SpawnOptions) => Promise<OpencodeHandle>;
export interface EffortsDeps {
  spawn?: Spawn;
  timeoutMs?: number;
  now?: () => number;
}

const cache = new Map<string, { efforts: EffortLevel[]; expiresAt: number }>();
const failedUntil = new Map<string, number>();
// 모델 id 단위 진행 중 조회 — 값 null = 이번 조회로 알아내지 못함.
const inflight = new Map<string, Promise<EffortLevel[] | null>>();

/** 테스트 격리용 — 캐시·진행 중 조회 초기화. */
export function resetEffortsCache(): void {
  cache.clear();
  failedUntil.clear();
  inflight.clear();
}

const keyOf = (npm: string, id: string) => `${npm}\0${id}`;
const pkgOf = (npm: string | null | undefined) => npm || DEFAULT_OPENCODE_NPM;

/** 아직 유효한 캐시 값 — 만료된 항목은 읽을 때 지운다(모델 id 가 계속 바뀌어도 맵이 끝없이 커지지 않게). */
function cachedAt(key: string, now: number): EffortLevel[] | undefined {
  const hit = cache.get(key);
  if (!hit) return undefined;
  if (hit.expiresAt > now) return hit.efforts;
  cache.delete(key);
  return undefined;
}

/** 최근 실패해 잠시 묻지 않는 모델인가 — 만료된 표시는 읽을 때 지운다. */
function recentlyFailed(key: string, now: number): boolean {
  const until = failedUntil.get(key);
  if (until === undefined) return false;
  if (until > now) return true;
  failedUntil.delete(key);
  return false;
}

function remember(pkg: string, found: EffortsMap, now: number): void {
  for (const [id, efforts] of found) cache.set(keyOf(pkg, id), { efforts, expiresAt: now + EFFORTS_CACHE_TTL_MS });
}

/** 캐시에 있는 모델의 지원 단계(없거나 만료면 undefined) — 실행이 config 를 만들기 전에 본다. */
export function cachedOpencodeEfforts(npm: string | null | undefined, modelID: string, now = Date.now()): EffortLevel[] | undefined {
  return cachedAt(keyOf(pkgOf(npm), modelID), now);
}

/** 목록의 모델을 모두 reasoning 으로 선언한 최소 config — 도구·에이전트·MCP 없음, 공유·자동 갱신 끔. */
export function effortsProbeConfig(npm: string, modelIds: string[]): Config {
  return {
    provider: {
      [PROBE_PROVIDER_ID]: {
        npm,
        options: { baseURL: 'http://127.0.0.1:9/v1', apiKey: 'unused' },
        models: Object.fromEntries(modelIds.map((id) => [id, { reasoning: true }])),
      },
    },
    enabled_providers: [PROBE_PROVIDER_ID],
    share: 'disabled',
    autoupdate: false,
    mcp: {},
  };
}

/**
 * `config.providers()` 응답 → 모델별 지원 단계. v1 SDK 타입에는 variants 가 없지만 서버(1.19.x)는 싣는다(v2 Model.variants 와 같은 모양).
 * providerId 는 조회 전용 서버면 PROBE_PROVIDER_ID, 실행 서버면 그 연결의 provider id.
 */
export function parseProviderEfforts(body: unknown, modelIds: string[], providerId: string = PROBE_PROVIDER_ID): EffortsMap {
  const providers = (body as { providers?: unknown })?.providers;
  const provider = Array.isArray(providers)
    ? (providers as { id?: unknown; models?: Record<string, { variants?: Record<string, unknown> }> }[]).find(
        (p) => p?.id === providerId,
      )
    : undefined;
  const out: EffortsMap = new Map();
  for (const id of modelIds) {
    const variants = provider?.models?.[id]?.variants;
    out.set(id, variants && typeof variants === 'object' ? effortsList(Object.keys(variants)) : []);
  }
  return out;
}

/**
 * 서버를 띄워 묻는다. 시간 안에 못 끝내면 시간 초과로 실패한다 — 그때 이미 뜬 서버는 바로 닫고(providers() 가 멈춰도 슬롯·프로세스가 새지 않게),
 * 아직 뜨는 중이면 뜨는 대로 닫는다. 서버는 어느 경로로든 정확히 한 번 닫는다.
 */
async function probe(npm: string, modelIds: string[], spawn: Spawn, timeoutMs: number): Promise<EffortsMap> {
  let handle: OpencodeHandle | undefined;
  let timedOut = false;
  let closed = false;
  const close = () => {
    if (closed || !handle) return;
    closed = true;
    handle.server.close();
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      close();
      reject(new Error(`timeout after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  const work = (async () => {
    handle = await spawn(effortsProbeConfig(npm, modelIds), { tryOnly: true, startupTimeoutMs: timeoutMs });
    if (timedOut) {
      close();
      throw new Error('timed out');
    }
    const res = await handle.client.config.providers();
    if (!res.data) throw new Error('providers 응답 없음');
    return parseProviderEfforts(res.data, modelIds);
  })();
  // 시간 초과로 먼저 끝나도 work 의 늦은 실패가 처리되지 않은 rejection 으로 남지 않게 한다.
  work.catch(() => {});
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
    close();
  }
}

/**
 * 모델 id 들의 지원 단계 — 캐시에 없고 진행 중도 아닌 것만 한 번에 묻는다. 예외를 던지지 않는다.
 * 돌려주는 맵에는 알아낸 모델만 있다 — 다른 모델 조회가 실패해도 캐시에 있던 모델은 그대로 실린다(없는 키 = 알 수 없음).
 */
export async function lookupOpencodeEfforts(
  npm: string | null | undefined,
  modelIds: string[],
  deps: EffortsDeps = {},
): Promise<EffortsMap> {
  const pkg = pkgOf(npm);
  const now = deps.now ?? Date.now;
  const ids = [...new Set(modelIds)];
  const fresh = (id: string) => cachedAt(keyOf(pkg, id), now());
  // 새로 물을 모델 — 캐시에 없고, 최근 실패하지 않았고, 다른 요청이 이미 묻고 있지 않은 것.
  const toAsk = ids.filter((id) => !fresh(id) && !recentlyFailed(keyOf(pkg, id), now()) && !inflight.has(keyOf(pkg, id)));
  if (toAsk.length > 0) {
    const run = probe(pkg, toAsk, deps.spawn ?? createIsolatedOpencode, deps.timeoutMs ?? EFFORTS_LOOKUP_TIMEOUT_MS).then(
      (found) => {
        remember(pkg, found, now());
        return found;
      },
      (e: unknown) => {
        // 슬롯이 모자라 못 띄운 것은 실패로 남기지 않는다(곧 다시 물을 수 있다). 그 밖의 실패만 잠시 묻지 않는다.
        if (!(e instanceof NoLiveSlotError)) {
          for (const id of toAsk) failedUntil.set(keyOf(pkg, id), now() + EFFORTS_FAILURE_TTL_MS);
        }
        log.warn('opencode-efforts', 'lookup_fail', { npm: pkg, models: toAsk.length, error: e instanceof Error ? e.message : String(e) });
        return null;
      },
    );
    for (const id of toAsk) {
      const k = keyOf(pkg, id);
      inflight.set(
        k,
        run.then((found) => found?.get(id) ?? null).finally(() => inflight.delete(k)),
      );
    }
  }
  const out: EffortsMap = new Map();
  await Promise.all(
    ids.map(async (id) => {
      const efforts = fresh(id) ?? (await inflight.get(keyOf(pkg, id))) ?? fresh(id);
      if (efforts) out.set(id, efforts);
    }),
  );
  return out;
}

/**
 * 실행이 보낼 variant — 고른 단계를 이 모델이 받으면 그 단계, 받지 않으면 받는 단계 중 바로 아래, 그것도 없거나 알 수 없으면 undefined(보내지 않음).
 * 화면이 보인 값(웹의 같은 보정)과 실제 실행이 어긋나지 않게 한다. 캐시에 없으면 그 실행의 서버(handle — config 가 이미 모델을 reasoning 으로
 * 선언했다)에 `config.providers()` 를 묻고 결과를 공용 캐시에 남긴다 — 조회용 서버를 따로 띄우지 않는다. 예외를 던지지 않는다.
 */
export async function opencodeVariantFor(
  handle: OpencodeHandle,
  target: { npm: string | null | undefined; providerId: string; modelID: string; level: EffortLevel },
  timeoutMs = RUN_PROVIDERS_TIMEOUT_MS,
): Promise<EffortLevel | undefined> {
  const pkg = pkgOf(target.npm);
  let supported = cachedAt(keyOf(pkg, target.modelID), Date.now());
  if (!supported) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const res = await Promise.race([
        handle.client.config.providers(),
        new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error(`timeout after ${timeoutMs}ms`)), timeoutMs))),
      ]);
      if (!res.data) throw new Error('providers 응답 없음');
      const found = parseProviderEfforts(res.data, [target.modelID], target.providerId);
      remember(pkg, found, Date.now());
      supported = found.get(target.modelID);
    } catch (e) {
      log.warn('opencode-efforts', 'run_lookup_fail', { npm: pkg, error: e instanceof Error ? e.message : String(e) });
      return undefined;
    } finally {
      clearTimeout(timer);
    }
  }
  return supported ? clampEffort(target.level, supported) : undefined;
}
