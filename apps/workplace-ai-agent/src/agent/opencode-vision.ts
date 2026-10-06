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
import { createHash } from 'node:crypto';

import { log } from '../logger.js';
import type { OpencodeProviderConfig, ProviderCredential } from './agent-runner.js';
import { splitOpencodeModel } from './opencode-config.js';

// 성공 결과는 오래(모델 목록은 거의 안 바뀜), 실패는 짧게 캐시해 일시 장애 후 곧 회복되게 한다.
export const VISION_CACHE_TTL_MS = 60 * 60 * 1000;
export const VISION_FAILURE_TTL_MS = 5 * 60 * 1000;
const FETCH_TIMEOUT_MS = 3000;

// credential 단위 캐시 값 — 모델 id → vision(필드 없으면 목록에서 제외). null = 조회 실패.
type ModelVisionMap = Map<string, boolean> | null;

const cache = new Map<string, { value: ModelVisionMap; expiresAt: number }>();
// 같은 credential 동시 조회는 한 번만 보낸다.
const inflight = new Map<string, Promise<ModelVisionMap>>();

// 테스트 격리용 — 캐시·진행 중 조회 초기화.
export function resetVisionCache(): void {
  cache.clear();
  inflight.clear();
}

// 수동 설정 해석 — boolean 이면 전 모델 공통, 객체면 모델별. 해당 값이 없으면 undefined.
// payload 는 검증 없는 JSON 이라 모델별 값도 boolean 일 때만 인정한다.
function manualVision(payload: OpencodeProviderConfig, modelID: string): boolean | undefined {
  const v = typeof payload.vision === 'boolean' ? payload.vision : payload.vision?.[modelID];
  return typeof v === 'boolean' ? v : undefined;
}

type ModelEntry = { id?: unknown; capabilities?: { vision?: unknown }; metadata?: { capabilities?: { vision?: unknown } } };

// `/models` 응답(OpenAI 호환 `{ data: [{ id, ... }] }`) → 모델별 vision 맵. vision 위치는 provider 마다 달라
// `metadata.capabilities.vision`(neuralwatt 실측)과 `capabilities.vision` 을 모두 본다. boolean 인 모델만 담는다(없음 = 판단 불가).
export function parseModelsVision(body: unknown): Map<string, boolean> {
  const out = new Map<string, boolean>();
  const data = (body as { data?: unknown })?.data;
  if (!Array.isArray(data)) return out;
  for (const m of data as ModelEntry[]) {
    const vision = m?.metadata?.capabilities?.vision ?? m?.capabilities?.vision;
    if (typeof m?.id === 'string' && typeof vision === 'boolean') out.set(m.id, vision);
  }
  return out;
}

async function fetchModelsVision(baseURL: string, apiKey: string | undefined): Promise<ModelVisionMap> {
  try {
    const res = await fetch(`${baseURL.replace(/\/+$/, '')}/models`, {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return parseModelsVision(await res.json());
  } catch (e) {
    log.error('opencode-vision', 'models_fetch_fail', {
      baseURL,
      error: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}

// credential(baseURL+apiKey) 단위로 캐시된 모델 vision 맵을 얻는다. 키는 해시로 저장해 비밀을 메모리 키에 두지 않는다.
async function getModelsVision(baseURL: string, apiKey: string | undefined): Promise<ModelVisionMap> {
  const key = createHash('sha256').update(`${baseURL}\0${apiKey ?? ''}`).digest('hex');
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value;
  if (hit) cache.delete(key); // 만료분은 비워 회전된 키의 목록이 남지 않게 한다
  const pending = inflight.get(key);
  if (pending) return pending;
  const p = fetchModelsVision(baseURL, apiKey)
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

/** opencode credential·모델의 이미지 입력 지원 여부. 예외를 던지지 않는다(조회 실패 = 알 수 없음). */
export async function resolveOpencodeVision(payload: OpencodeProviderConfig, modelID: string): Promise<OpencodeVision> {
  const manual = manualVision(payload, modelID);
  if (manual !== undefined) return manual;
  const baseURL = payload.options?.baseURL;
  const apiKey = payload.options?.apiKey;
  if (typeof baseURL !== 'string' || !baseURL) return undefined;
  const models = await getModelsVision(baseURL, typeof apiKey === 'string' ? apiKey : undefined);
  return models?.get(modelID);
}

/** 'providerId/modelId' 형식 모델 문자열로 판단. 모델 형식이 잘못되면 splitOpencodeModel 이 던진다. */
export function resolveOpencodeModelVision(payload: OpencodeProviderConfig, model: string): Promise<OpencodeVision> {
  return resolveOpencodeVision(payload, splitOpencodeModel(model).modelID);
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
