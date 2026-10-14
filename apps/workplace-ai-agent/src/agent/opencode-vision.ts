// WP-241: opencode 모델의 이미지(비전) 입력 지원 여부 판단.
// opencode 는 custom(openai-compatible) provider 모델을 config 에 modalities 를 선언하지 않으면 텍스트 전용으로
// 취급해 MCP 결과·read 의 이미지를 모델에 보내기 전에 버린다(WP-233 실측). 비전 모델이면 선언해 이미지를 살리고,
// 미지원 모델이면 도구 결과의 이미지를 안내 문구로 바꿔 "다시 첨부해 달라"는 연속성 위반 응답을 막는다.
//
// 판단 순서: ① credential payload 의 수동 설정(vision) → ② provider `GET {baseURL}/models` 의
// 모델별 vision 메타데이터 → ③ 그 외(baseURL 없음·메타 없음·조회 실패)는 '알 수 없음'(undefined).
// 알 수 없으면 모델 엔트리를 비워 opencode 자체 판단(models.dev 등록 provider 는 capability 를 스스로 채움)에
// 맡긴다 — 임의로 지원/미지원을 단정하면 텍스트 전용 모델에 이미지를 강제(provider 400)하거나 비전 모델의
// 이미지를 빼앗게 된다.
//
// WP-250: 같은 `/models` 응답에서 모델의 컨텍스트 한도도 읽는다(resolveOpencodeModelSettings). opencode 는 config 에 limit 이 없는
// custom provider 모델을 한도 0 으로 보고 미리 압축(compaction)하지 않는다 — 이미지가 쌓이는 긴 실행이 provider 거절 뒤에야
// 압축되고, 그때 opencode 가 "첨부가 너무 커서 처리하지 못했다"는 안내를 모델에 넣는다(1.17.18 실측). 한도를 알면 그 전에 압축한다.
import { createHash } from 'node:crypto';

import { log } from '../logger.js';
import type { OpencodeProviderConfig, ProviderCredential } from './agent-runner.js';
import { splitOpencodeModel } from './opencode-config.js';

// 성공 결과는 오래(모델 목록은 거의 안 바뀜), 실패는 짧게 캐시해 일시 장애 후 곧 회복되게 한다.
export const VISION_CACHE_TTL_MS = 60 * 60 * 1000;
export const VISION_FAILURE_TTL_MS = 5 * 60 * 1000;
const FETCH_TIMEOUT_MS = 3000;

// `/models` 에서 읽은 모델별 메타 — 값이 있을 때만 채운다(없음 = 판단 불가).
interface ModelMeta {
  vision?: boolean;
  /** 컨텍스트 한도(토큰) — 입력+출력 합. */
  context?: number;
  /** 출력 한도(토큰). */
  output?: number;
}

// credential 단위 캐시 값 — 모델 id → 메타(읽을 값이 하나도 없으면 목록에서 제외). null = 조회 실패.
type ModelMetaMap = Map<string, ModelMeta> | null;

const cache = new Map<string, { value: ModelMetaMap; expiresAt: number }>();
// 같은 credential 동시 조회는 한 번만 보낸다.
const inflight = new Map<string, Promise<ModelMetaMap>>();

// 테스트 격리용 — 캐시·진행 중 조회 초기화.
export function resetVisionCache(): void {
  cache.clear();
  inflight.clear();
}

// 수동 설정 해석 — boolean 이면 전 모델 공통, 객체면 모델별. 해당 값이 없으면 undefined.
// 모델별 키는 웹 연결 다이얼로그·API 가 저장하는 그대로 'providerId/modelId'(제출 모델 문자열)이다(WP-250). 접두 없는 modelId 키도
// 예전 수동 설정(WP-241)과의 호환으로 함께 본다 — 접두 키가 우선. providerID 를 모르면(직접 호출) 접두 없는 키만 본다.
// payload 는 검증 없는 JSON 이라 모델별 값도 boolean 일 때만 인정한다.
function manualVision(payload: OpencodeProviderConfig, modelID: string, providerID?: string): boolean | undefined {
  const map = payload.vision;
  if (typeof map === 'boolean') return map;
  const pick = (k: string) => (typeof map?.[k] === 'boolean' ? map[k] : undefined);
  return (providerID ? pick(`${providerID}/${modelID}`) : undefined) ?? pick(modelID);
}

type ModelEntry = {
  id?: unknown;
  max_model_len?: unknown;
  capabilities?: { vision?: unknown };
  metadata?: { capabilities?: { vision?: unknown }; limits?: { max_context_length?: unknown; max_output_tokens?: unknown } };
};

const positiveInt = (v: unknown): number | undefined => (typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : undefined);

// `/models` 응답(OpenAI 호환 `{ data: [{ id, ... }] }`) → 모델별 메타. 위치는 provider 마다 달라 여러 곳을 본다:
//  · vision — `metadata.capabilities.vision`(neuralwatt 실측)과 `capabilities.vision`. boolean 일 때만.
//  · context — `max_model_len`(vLLM 표준 필드 — 서버가 실제로 거절하는 길이)과 `metadata.limits.max_context_length`(neuralwatt 실측). 양의 정수일 때만.
//  · output — `metadata.limits.max_output_tokens`(neuralwatt 실측). 양의 정수일 때만.
export function parseModelsMeta(body: unknown): Map<string, ModelMeta> {
  const out = new Map<string, ModelMeta>();
  const data = (body as { data?: unknown })?.data;
  if (!Array.isArray(data)) return out;
  for (const m of data as ModelEntry[]) {
    if (typeof m?.id !== 'string') continue;
    const meta: ModelMeta = {};
    const vision = m.metadata?.capabilities?.vision ?? m.capabilities?.vision;
    if (typeof vision === 'boolean') meta.vision = vision;
    const context = positiveInt(m.max_model_len) ?? positiveInt(m.metadata?.limits?.max_context_length);
    if (context) meta.context = context;
    const output = positiveInt(m.metadata?.limits?.max_output_tokens);
    if (output) meta.output = output;
    if (Object.keys(meta).length > 0) out.set(m.id, meta);
  }
  return out;
}

async function fetchModelsMeta(baseURL: string, apiKey: string | undefined): Promise<ModelMetaMap> {
  try {
    const res = await fetch(`${baseURL.replace(/\/+$/, '')}/models`, {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return parseModelsMeta(await res.json());
  } catch (e) {
    log.error('opencode-vision', 'models_fetch_fail', {
      baseURL,
      error: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}

// credential(baseURL+apiKey) 단위로 캐시된 모델 메타 맵을 얻는다(비전·한도 판단이 같은 조회를 나눠 쓴다). 키는 해시로 저장해 비밀을 메모리 키에 두지 않는다.
async function getModelsMeta(baseURL: string, apiKey: string | undefined): Promise<ModelMetaMap> {
  const key = createHash('sha256').update(`${baseURL}\0${apiKey ?? ''}`).digest('hex');
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value;
  if (hit) cache.delete(key); // 만료분은 비워 회전된 키의 목록이 남지 않게 한다
  const pending = inflight.get(key);
  if (pending) return pending;
  const p = fetchModelsMeta(baseURL, apiKey)
    .then((value) => {
      cache.set(key, {
        value,
        expiresAt: Date.now() + (value ? VISION_CACHE_TTL_MS : VISION_FAILURE_TTL_MS),
      });
      return value;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

/** 이미지 입력 지원 여부 — true=지원, false=미지원, undefined=알 수 없음(opencode 자체 판단에 맡김). */
export type OpencodeVision = boolean | undefined;

/**
 * opencode credential·모델의 이미지 입력 지원 여부. 예외를 던지지 않는다(조회 실패 = 알 수 없음).
 * providerID 를 주면 수동 설정의 'providerId/modelId' 키(웹·API 저장 형식)를 먼저 본다. /models 메타는 provider 가 접두 없는 id 로 주므로 modelID 로만 찾는다.
 */
export async function resolveOpencodeVision(
  payload: OpencodeProviderConfig,
  modelID: string,
  providerID?: string,
): Promise<OpencodeVision> {
  const manual = manualVision(payload, modelID, providerID);
  if (manual !== undefined) return manual;
  return (await modelMeta(payload, modelID))?.vision;
}

// credential 의 `/models` 에서 이 모델의 메타 — baseURL 이 없으면(models.dev 등록 provider) 조회하지 않는다. 조회 실패 = undefined.
async function modelMeta(payload: OpencodeProviderConfig, modelID: string): Promise<ModelMeta | undefined> {
  const baseURL = payload.options?.baseURL;
  const apiKey = payload.options?.apiKey;
  if (typeof baseURL !== 'string' || !baseURL) return undefined;
  const models = await getModelsMeta(baseURL, typeof apiKey === 'string' ? apiKey : undefined);
  return models?.get(modelID);
}

/**
 * 'providerId/modelId' 형식 모델 문자열로 판단. 모델 형식이 잘못되면 splitOpencodeModel 이 던진다.
 * providerID 는 payload.providerId 가 아니라 모델 문자열에서 뗀다 — 수동 설정 키가 그 모델 문자열 그대로 저장되므로, 첫 '/' 로 나눠 다시 붙이면
 * modelId 에 '/' 가 들어 있어도 저장 키와 정확히 같다.
 */
export function resolveOpencodeModelVision(payload: OpencodeProviderConfig, model: string): Promise<OpencodeVision> {
  const { providerID, modelID } = splitOpencodeModel(model);
  return resolveOpencodeVision(payload, modelID, providerID);
}

/**
 * 실행당 한 번 내리는 비전 판단(WP-244, WP-234 메인 채팅도 사용) — 첨부 표현(프롬프트)과 러너 config(modalities)가
 * 같은 값을 쓰도록 호출자가 판단해 RunnerInput.opencodeVision 으로도 넘긴다. anthropic 은 판단하지 않는다(undefined).
 * 예외를 던지지 않는다: 모델 형식 오류 등은 undefined 를 돌려 러너가 스스로 판단하다 실행 오류로 알리게 한다.
 */
export async function opencodeVisionFor(credential: ProviderCredential, model: string): Promise<{ value: OpencodeVision } | undefined> {
  if (credential.provider !== 'opencode') return undefined;
  try {
    return { value: await resolveOpencodeModelVision(credential.payload, model) };
  } catch {
    return undefined;
  }
}

/** opencode 모델 엔트리의 limit — 없으면 opencode 판단(models.dev 등록 모델은 자체 한도, custom 은 0 = 미리 압축하지 않음). */
export type OpencodeModelLimit = { context: number; output: number } | undefined;

/** opencode 가 요청 max_tokens 와 압축 기준에 쓰는 출력 상한(ProviderTransform.OUTPUT_TOKEN_MAX, 1.17.18 바이너리 확인). */
const OPENCODE_OUTPUT_TOKEN_MAX = 32_000;

/**
 * models.dev 에 없다고 확인한 provider id — 웹 연결 다이얼로그 프리셋 키(apps/workplace-web/src/lib/opencode-presets.ts, 저장되는 providerId 가
 * 곧 프리셋 키다) 중 custom 계열. 출력 한도를 모를 때 output 0 을 이 id 에만 선언한다(limitFrom).
 * 왜 목록인가(opencode 1.17.18 라이브 확인, WP-250 리뷰):
 *  · config 의 limit 은 output 키가 필수다 — 빼면 ConfigInvalidError("Missing key")로 서버는 떠도 모든 설정 조회·실행이 실패한다. 그래서 output 을
 *    생략해 models.dev 값에 맡길 수 없다.
 *  · limit 은 필드별로 config 값이 models.dev 값보다 우선한다 — neuralwatt 에 {context, output: 0} 을 주면 models.dev 의 출력 한도 131072 가 0 으로
 *    덮인다. models.dev 출력 한도가 32000 미만인 모델이면 요청 max_tokens 가 32000 으로 올라 provider 가 거절할 수 있다.
 *  · 이 세 id 는 models.dev 에 없어(openai·google 은 있다) limit 을 안 주면 {0, 0} 이고, output 0 은 opencode 의 "모름"과 같아 덮을 값이 없다.
 * 목록에 없는 id 는 출력 한도까지 알 때만 limit 을 둔다 — 모르면 지금처럼 provider 거절 뒤 압축에 맡긴다. 프리셋을 늘리면 models.dev 등록 여부를 보고 더한다.
 */
const NON_MODELS_DEV_PROVIDER_IDS: ReadonlySet<string> = new Set(['genia', 'custom', 'amazon-bedrock-openai']);

/**
 * provider `/models` 가 알려 준 컨텍스트 한도로 opencode 모델 limit 을 만든다(WP-250). 값이 없으면 기본값을 지어내지 않고 undefined.
 * opencode 는 (마지막 응답의 토큰 합) ≥ context − min(output || 32000, 32000) 이면 미리 압축한다.
 * 출력 한도를 모르면 models.dev 에 없는 provider(NON_MODELS_DEV_PROVIDER_IDS)만 output 0 으로 둔다 — opencode 가 "모름"으로 보는 값이라 요청
 * max_tokens 는 지금처럼 32000 이고, 그 길이로는 provider 도 같은 지점에서 거절한다. 다른 provider 는 models.dev 출력 한도를 0 으로 덮지 않게 두지 않는다.
 * 쓸 수 있는 길이(context − 출력 몫)가 0 이하면 매 단계 압축만 되풀이하므로 limit 을 두지 않는다.
 */
function limitFrom(meta: ModelMeta | undefined, providerId: string): OpencodeModelLimit {
  if (!meta?.context) return undefined;
  // 출력 한도를 모르면 models.dev 값을 덮을 수 없는 provider 에만 output 0 을 둔다. 판정은 opencode 가 models.dev 와 맞추는 provider 블록 키(payload.providerId).
  if (meta.output === undefined && !NON_MODELS_DEV_PROVIDER_IDS.has(providerId)) return undefined;
  const output = meta.output ?? 0;
  const reserved = Math.min(output || OPENCODE_OUTPUT_TOKEN_MAX, OPENCODE_OUTPUT_TOKEN_MAX);
  if (meta.context <= reserved) return undefined;
  return { context: meta.context, output };
}

/** 러너가 opencode config 에 싣는 모델 설정 — 이미지 입력(modalities)과 한도(limit). 둘 다 "모름"(undefined)이면 opencode 판단에 맡긴다. */
export interface OpencodeModelSettings {
  vision: OpencodeVision;
  limit: OpencodeModelLimit;
}

/**
 * 실행당 한 번 — 비전·한도를 provider `/models` 조회 한 번으로 함께 판단한다(WP-241·WP-250). 실행 경로에서 왕복을 두 번 기다리지 않게 하나로 묶었다.
 * knownVision 을 주면(호출자가 첨부 표현용으로 이미 판단, RunnerInput.opencodeVision) 그 값을 쓰고, 없으면 수동 설정 → /models 순서로 본다.
 * 수동 비전 설정이 있어도 한도는 /models 로 판단한다. 조회는 credential 단위 캐시를 같이 쓴다 — 실패도 null 로 VISION_FAILURE_TTL_MS 동안 캐시해,
 * provider 장애 중에도 실행마다 3초 타임아웃을 다시 기다리지 않는다. 모델 형식이 잘못되면 splitOpencodeModel 이 던진다(러너가 실행 오류로 알린다).
 */
export async function resolveOpencodeModelSettings(
  payload: OpencodeProviderConfig,
  model: string,
  knownVision?: { value: OpencodeVision },
): Promise<OpencodeModelSettings> {
  const { providerID, modelID } = splitOpencodeModel(model);
  const meta = await modelMeta(payload, modelID);
  const vision = knownVision ? knownVision.value : (manualVision(payload, modelID, providerID) ?? meta?.vision);
  return { vision, limit: limitFrom(meta, payload.providerId) };
}
