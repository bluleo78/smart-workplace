#!/usr/bin/env node
// 칸 모델의 문맥 한도(WP-1735) — OpenCode 는 한도(limit)가 없는 사설(OpenAI 호환) 모델을 한도 0 으로 보고 미리 압축하지 않아, 칸 세션이 모델 서버가
// 거절할 때까지 쌓였다가 회차가 끝나고 새 세션으로 맥락을 버렸다. 엔트리포인트(lib-opencode.sh write_opencode_config)가 opencode.json 을 만들 때
// 이 스크립트로 연결의 `{baseURL}/models` 를 읽어 고른 모델의 limit 을 얻는다.
//
// 규칙은 이슈 채팅(apps/workplace-ai-agent/src/agent/opencode-vision.ts 의 parseModelsMeta·limitFrom, WP-250)과 같다 — 이미지가 달라 코드를
// 함께 쓰지 못하므로, 두 쪽 테스트가 같은 입력·기대값(tests/model-limit-cases.json)을 읽어 어긋나면 실패하게 했다. 한쪽을 고치면 다른 쪽도 고친다.
//
// 쓰는 법: model-limit.mjs <연결 정보 파일> <모델 id> → 한도를 알면 표준 출력에 {"context":N,"output":M} 한 줄, 모르면 아무것도 내지 않는다.
// 조회 실패·시간 초과·꼴이 다른 응답은 표준 오류에 경고 한 줄만 남기고 0 으로 끝난다 — 칸 띄우기를 막지 않는다(limit 없이 지금처럼).
// 연결 정보(API 키·주소)는 파일에서 읽고, 명령줄·로그에 남기지 않는다. 사내 모델 서버 CA 는 엔트리포인트가 앞서 내보낸 NODE_EXTRA_CA_CERTS 로 믿는다.
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** 조회 상한(ms) — ai-agent 의 FETCH_TIMEOUT_MS 와 같다. 칸 띄우기가 오래 걸리지 않게 짧게 둔다. */
const FETCH_TIMEOUT_MS = Number(process.env.GENIA_MODELS_TIMEOUT_MS) || 3000;

/** opencode 가 요청 max_tokens 와 압축 기준에 쓰는 출력 상한(ProviderTransform.OUTPUT_TOKEN_MAX) — ai-agent 의 OPENCODE_OUTPUT_TOKEN_MAX 와 같다. */
const OPENCODE_OUTPUT_TOKEN_MAX = 32_000;

/**
 * models.dev 에 없는 provider id — 출력 한도를 모를 때 output 0(opencode 의 「모름」)을 이 id 에만 둔다. ai-agent 의 NON_MODELS_DEV_PROVIDER_IDS 와 같다.
 * 다른 id 에 output 0 을 주면 models.dev 의 출력 한도를 0 으로 덮고, output 키를 빼면 opencode 가 설정을 거절한다(1.17.18 실측, WP-250).
 */
const NON_MODELS_DEV_PROVIDER_IDS = new Set(['genia', 'custom', 'amazon-bedrock-openai']);

const positiveInt = (v) => (typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : undefined);

/**
 * `/models` 응답(OpenAI 호환 `{ data: [{ id, ... }] }`)에서 모델 하나의 한도 — 문맥은 `max_model_len`(vLLM) → `metadata.limits.max_context_length`,
 * 출력은 `metadata.limits.max_output_tokens`. 양의 정수만 본다. 없으면 빈 객체.
 */
export function modelMetaFrom(body, model) {
  const data = body?.data;
  if (!Array.isArray(data)) return {};
  const m = data.find((e) => e?.id === model);
  if (!m) return {};
  const meta = {};
  const context = positiveInt(m.max_model_len) ?? positiveInt(m.metadata?.limits?.max_context_length);
  if (context) meta.context = context;
  const output = positiveInt(m.metadata?.limits?.max_output_tokens);
  if (output) meta.output = output;
  return meta;
}

/**
 * 한도 → opencode 모델 limit. 문맥을 모르면 없음. 출력을 모르면 models.dev 에 없는 provider 만 output 0.
 * 쓸 수 있는 길이(문맥 − min(출력||32000, 32000))가 0 이하면 매 단계 압축만 되풀이하므로 두지 않는다.
 */
export function limitFrom(meta, providerId) {
  if (!meta?.context) return undefined;
  if (meta.output === undefined && !NON_MODELS_DEV_PROVIDER_IDS.has(providerId)) return undefined;
  const output = meta.output ?? 0;
  const reserved = Math.min(output || OPENCODE_OUTPUT_TOKEN_MAX, OPENCODE_OUTPUT_TOKEN_MAX);
  if (meta.context <= reserved) return undefined;
  return { context: meta.context, output };
}

/**
 * 실패 이유 한 마디 — 오류 메시지 원문은 쓰지 않는다. fetch 의 메시지에는 주소(자격 증명이 든 URL 포함)가, JSON 해석 오류에는 응답 본문 조각이
 * 들어갈 수 있어서다. 시간 초과·상태 코드·네트워크 오류 코드(ECONNREFUSED·ENOTFOUND·인증서 오류 등 — e.cause.code)·응답 꼴만 남긴다.
 */
function failureReason(e) {
  if (e?.name === 'TimeoutError') return `${FETCH_TIMEOUT_MS}ms 안에 답이 없음`;
  if (e instanceof HttpError) return e.message;
  if (e instanceof SyntaxError) return '응답이 JSON 이 아님';
  const code = e?.cause?.code;
  if (typeof code === 'string' && /^[A-Z0-9_]+$/.test(code)) return code;
  return e?.name ?? '알 수 없는 오류';
}

/** 모델 서버가 2xx 가 아닌 답을 줌 — 메시지는 상태 코드뿐이다. */
class HttpError extends Error {}

/** 연결 정보의 `{baseURL}/models` 를 읽어 모델 limit 을 낸다. baseURL 이 없으면 묻지 않는다. 실패는 경고를 남기고 없음. */
export async function fetchModelLimit(login, model, warn = (msg) => process.stderr.write(`${msg}\n`)) {
  const baseURL = login?.options?.baseURL;
  if (typeof baseURL !== 'string' || !baseURL) return undefined;
  const apiKey = login.options.apiKey;
  try {
    const res = await fetch(`${baseURL.replace(/\/+$/, '')}/models`, {
      headers: typeof apiKey === 'string' && apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: 'error', // 이슈 채팅 쪽(WP-596)과 같게 — 다른 주소로 넘겨 가지 않는다
    });
    if (!res.ok) throw new HttpError(`HTTP ${res.status}`);
    return limitFrom(modelMetaFrom(await res.json(), model), login.providerId);
  } catch (e) {
    const why = failureReason(e);
    warn(`경고: 모델 서버에서 문맥 한도를 읽지 못했습니다(${why}) — 한도 없이 띄웁니다(OpenCode 가 미리 압축하지 않습니다)`);
    return undefined;
  }
}

/** 명령으로 불렸는지 — 경로에 심볼릭 링크가 있어도 맞게 둘 다 실제 경로로 견준다(어긋나면 말없이 아무것도 하지 않게 된다). */
function invokedDirectly() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}

// 명령으로 불렸을 때만 돈다(테스트는 함수를 import 한다).
if (invokedDirectly()) {
  const [file, model] = process.argv.slice(2);
  if (!file || !model) {
    process.stderr.write('쓰는 법: model-limit.mjs <연결 정보 파일> <모델 id>\n');
    process.exit(2);
  }
  let login;
  try {
    login = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    process.stderr.write('경고: 연결 정보를 읽지 못해 문맥 한도를 읽지 않습니다\n');
    process.exit(0);
  }
  const limit = await fetchModelLimit(login, model);
  if (limit) process.stdout.write(`${JSON.stringify(limit)}\n`);
}
