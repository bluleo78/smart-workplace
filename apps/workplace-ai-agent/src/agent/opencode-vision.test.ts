// WP-241: opencode 모델 비전 판단 — 수동 설정 우선, provider /models 파싱, 캐시(성공/실패 TTL·동시 조회 1회).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  opencodeVisionFor,
  parseModelsMeta,
  resetVisionCache,
  resolveOpencodeModelSettings,
  resolveOpencodeModelVision,
  resolveOpencodeVision,
  VISION_CACHE_TTL_MS,
  VISION_FAILURE_TTL_MS,
} from './opencode-vision.js';
import type { OpencodeProviderConfig } from './agent-runner.js';

const payload = (over: Partial<OpencodeProviderConfig> = {}): OpencodeProviderConfig => ({
  providerId: 'custom',
  options: { baseURL: 'https://api.example.com/v1/', apiKey: 'sk-1' },
  ...over,
});

// neuralwatt 실측 응답 형태 — metadata.capabilities.vision true/false/필드 없음.
const MODELS_BODY = {
  data: [
    { id: 'qwen3.6-35b', object: 'model', metadata: { capabilities: { tools: true, vision: true } } },
    { id: 'glm-5.3', object: 'model', metadata: { capabilities: { tools: true, vision: false } } },
    { id: 'plain-model', object: 'model' },
  ],
};

function okResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

describe('parseModelsMeta — vision', () => {
  const vision = (body: unknown) => [...parseModelsMeta(body)].map(([id, m]) => [id, m.vision]);

  it('top-level capabilities.vision 형태도 읽는다', () => {
    expect(vision({ data: [{ id: 'm', capabilities: { vision: true } }] })).toEqual([['m', true]]);
  });

  it('metadata.capabilities.vision 이 boolean 인 모델만 담는다', () => {
    expect(vision(MODELS_BODY)).toEqual([
      ['qwen3.6-35b', true],
      ['glm-5.3', false],
    ]);
  });

  it('형식이 다르면 빈 맵', () => {
    expect(parseModelsMeta({ models: [] }).size).toBe(0);
    expect(parseModelsMeta(null).size).toBe(0);
  });
});

describe('resolveOpencodeVision', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    resetVisionCache();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('/models 의 vision 값으로 판단하고, baseURL 끝 / 정리 + Bearer 키로 조회한다', async () => {
    fetchMock.mockImplementation(async () => okResponse(MODELS_BODY));
    expect(await resolveOpencodeVision(payload(), 'qwen3.6-35b')).toBe(true);
    expect(await resolveOpencodeVision(payload(), 'glm-5.3')).toBe(false);
    expect(fetchMock).toHaveBeenCalledOnce(); // 같은 credential 은 캐시
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.example.com/v1/models');
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer sk-1');
  });

  it('필드 없음·목록에 없는 모델은 알 수 없음(undefined)', async () => {
    fetchMock.mockImplementation(async () => okResponse(MODELS_BODY));
    expect(await resolveOpencodeVision(payload(), 'plain-model')).toBeUndefined();
    expect(await resolveOpencodeVision(payload(), 'unknown')).toBeUndefined();
  });

  it('조회 실패(HTTP 오류·네트워크 오류)는 알 수 없음(undefined)', async () => {
    fetchMock.mockResolvedValueOnce(new Response('no', { status: 401 }));
    expect(await resolveOpencodeVision(payload(), 'qwen3.6-35b')).toBeUndefined();
    resetVisionCache();
    fetchMock.mockRejectedValueOnce(new Error('timeout'));
    expect(await resolveOpencodeVision(payload(), 'qwen3.6-35b')).toBeUndefined();
  });

  it('options 가 없는 payload 도 예외 없이 알 수 없음', async () => {
    expect(await resolveOpencodeVision({ providerId: 'x' } as unknown as OpencodeProviderConfig, 'm')).toBeUndefined();
  });

  it('수동 설정이 메타데이터보다 우선 — boolean 은 전 모델, 객체는 모델별', async () => {
    fetchMock.mockImplementation(async () => okResponse(MODELS_BODY));
    expect(await resolveOpencodeVision(payload({ vision: true }), 'glm-5.3')).toBe(true);
    expect(await resolveOpencodeVision(payload({ vision: { 'qwen3.6-35b': false } }), 'qwen3.6-35b')).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    // 객체에 없는 모델은 메타데이터로 판단
    expect(await resolveOpencodeVision(payload({ vision: { other: true } }), 'qwen3.6-35b')).toBe(true);
  });

  // WP-250: 웹 연결 다이얼로그·API 는 모델별 키를 제출 모델 문자열 그대로('providerId/modelId') 저장한다(oauth-token.spec 이 고정한 형식).
  it('수동 설정의 접두 키(providerId/modelId)를 모델 문자열로 찾는다 — 메타데이터 조회 없음', async () => {
    fetchMock.mockImplementation(async () => okResponse(MODELS_BODY));
    expect(await resolveOpencodeModelVision(payload({ vision: { 'custom/qwen3.6-35b': false } }), 'custom/qwen3.6-35b')).toBe(false);
    expect(await resolveOpencodeModelVision(payload({ vision: { 'custom/glm-5.3': true } }), 'custom/glm-5.3')).toBe(true);
    // modelId 에 '/' 가 들어 있어도 첫 '/' 로 나눠 다시 붙이므로 저장 키와 같다.
    expect(
      await resolveOpencodeModelVision(
        payload({ vision: { 'amazon-bedrock-openai/openai/gpt-oss-120b': true } }),
        'amazon-bedrock-openai/openai/gpt-oss-120b',
      ),
    ).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('접두 키가 무접두 키보다 우선, 다른 provider 의 접두 키는 무시하고 메타데이터로 판단', async () => {
    fetchMock.mockImplementation(async () => okResponse(MODELS_BODY));
    expect(
      await resolveOpencodeModelVision(payload({ vision: { 'custom/qwen3.6-35b': false, 'qwen3.6-35b': true } }), 'custom/qwen3.6-35b'),
    ).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await resolveOpencodeModelVision(payload({ vision: { 'other/qwen3.6-35b': false } }), 'custom/qwen3.6-35b')).toBe(true);
  });

  it('무접두 키(이전 수동 설정)도 모델 문자열로 찾는다(호환)', async () => {
    expect(await resolveOpencodeModelVision(payload({ vision: { 'glm-5.3': true } }), 'custom/glm-5.3')).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('baseURL 없는 provider(models.dev 등록)는 알 수 없음으로 두고 조회하지 않는다(opencode 자체 판단)', async () => {
    expect(await resolveOpencodeVision(payload({ providerId: 'openai', options: { apiKey: 'k' } }), 'gpt-4o')).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('동시 조회는 한 번만 보낸다', async () => {
    fetchMock.mockImplementation(async () => okResponse(MODELS_BODY));
    const [a, b] = await Promise.all([
      resolveOpencodeVision(payload(), 'qwen3.6-35b'),
      resolveOpencodeVision(payload(), 'glm-5.3'),
    ]);
    expect([a, b]).toEqual([true, false]);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('credential(키)이 다르면 따로 조회한다', async () => {
    fetchMock.mockImplementation(async () => okResponse(MODELS_BODY));
    await resolveOpencodeVision(payload(), 'qwen3.6-35b');
    await resolveOpencodeVision(payload({ options: { baseURL: 'https://api.example.com/v1/', apiKey: 'sk-2' } }), 'qwen3.6-35b');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('성공 결과는 TTL 동안 유지, 지나면 재조회', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    fetchMock.mockImplementation(async () => okResponse(MODELS_BODY));
    await resolveOpencodeVision(payload(), 'qwen3.6-35b');
    vi.setSystemTime(Date.now() + VISION_CACHE_TTL_MS - 1000);
    await resolveOpencodeVision(payload(), 'qwen3.6-35b');
    expect(fetchMock).toHaveBeenCalledOnce();
    vi.setSystemTime(Date.now() + 2000);
    fetchMock.mockImplementation(async () => okResponse(MODELS_BODY));
    await resolveOpencodeVision(payload(), 'qwen3.6-35b');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('실패 결과는 짧은 TTL 후 재조회해 회복한다', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    fetchMock.mockRejectedValueOnce(new Error('down'));
    expect(await resolveOpencodeVision(payload(), 'qwen3.6-35b')).toBeUndefined();
    vi.setSystemTime(Date.now() + VISION_FAILURE_TTL_MS + 1000);
    fetchMock.mockImplementation(async () => okResponse(MODELS_BODY));
    expect(await resolveOpencodeVision(payload(), 'qwen3.6-35b')).toBe(true);
  });
});

// WP-244→WP-234: 첨부 표현과 러너 config 가 같은 값을 쓰도록 호출자가 한 번 판단하는 래퍼(이슈 챗·메인 채팅 공용).
describe('opencodeVisionFor', () => {
  it('anthropic 은 판단하지 않는다(undefined)', async () => {
    expect(await opencodeVisionFor({ provider: 'anthropic', token: 't', model: null }, 'claude-sonnet-4-6')).toBeUndefined();
  });

  it('opencode 수동 설정은 {value} 로 감싼다(조회 없음)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const cred = { provider: 'opencode' as const, payload: payload({ vision: false }), model: null };
    expect(await opencodeVisionFor(cred, 'custom/glm-5.3')).toEqual({ value: false });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('opencode 모델별 수동 설정(접두 키)도 {value} 로 감싼다(조회 없음, WP-250)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const cred = { provider: 'opencode' as const, payload: payload({ vision: { 'custom/glm-5.3': true } }), model: null };
    expect(await opencodeVisionFor(cred, 'custom/glm-5.3')).toEqual({ value: true });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('모델 형식 오류는 던지지 않고 undefined', async () => {
    const cred = { provider: 'opencode' as const, payload: payload({ vision: true }), model: null };
    expect(await opencodeVisionFor(cred, 'no-slash-model')).toBeUndefined();
  });
});

// WP-250: 같은 /models 응답에서 모델 컨텍스트 한도를 읽어 opencode limit 을 만든다(값이 없으면 지어내지 않는다).
describe('parseModelsMeta', () => {
  it('neuralwatt 실측 형태 — max_model_len·metadata.limits 의 한도와 vision 을 함께 읽는다', () => {
    const meta = parseModelsMeta({
      data: [
        {
          id: 'qwen-3.8-27b',
          max_model_len: 262128,
          metadata: { capabilities: { vision: true }, limits: { max_context_length: 262128, max_output_tokens: 131072 } },
        },
        { id: 'glm-5.3', max_model_len: 1048560, metadata: { capabilities: { vision: false }, limits: { max_output_tokens: null } } },
        { id: 'only-limits', object: 'model', metadata: { limits: { max_context_length: 65536 } } },
        { id: 'plain-model', object: 'model' },
      ],
    });
    expect([...meta]).toEqual([
      ['qwen-3.8-27b', { vision: true, context: 262128, output: 131072 }],
      ['glm-5.3', { vision: false, context: 1048560 }],
      ['only-limits', { context: 65536 }],
    ]);
  });

  it('양의 정수가 아닌 한도(0·음수·소수·문자열)는 버린다', () => {
    const meta = parseModelsMeta({ data: [{ id: 'a', max_model_len: 0 }, { id: 'b', max_model_len: '4096' }, { id: 'c', max_model_len: 1.5 }] });
    expect(meta.size).toBe(0);
  });
});

// WP-250: 비전·모델 한도를 /models 조회 한 번으로 — limitOf 는 한도만 본다.
describe('resolveOpencodeModelSettings', () => {
  const fetchMock = vi.fn<typeof fetch>();
  const body = (models: unknown[]) => ({ data: models });
  const limitOf = async (p: OpencodeProviderConfig, model: string) => (await resolveOpencodeModelSettings(p, model)).limit;

  beforeEach(() => {
    resetVisionCache();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('컨텍스트·출력 한도를 그대로 limit 으로', async () => {
    fetchMock.mockImplementation(async () => okResponse(body([{ id: 'm', max_model_len: 262128, metadata: { limits: { max_output_tokens: 131072 } } }])));
    expect(await limitOf(payload(), 'custom/m')).toEqual({ context: 262128, output: 131072 });
  });

  it('출력 한도를 모르면 models.dev 에 없는 provider(genia·custom·amazon-bedrock-openai)만 output 0(opencode 의 "모름") — 기본값을 지어내지 않는다', async () => {
    fetchMock.mockImplementation(async () => okResponse(body([{ id: 'm', max_model_len: 131072 }])));
    for (const providerId of ['genia', 'custom', 'amazon-bedrock-openai']) {
      expect(await limitOf(payload({ providerId }), `${providerId}/m`)).toEqual({ context: 131072, output: 0 });
    }
  });

  // opencode 1.17.18 실측: config limit 은 output 키가 필수이고(빼면 ConfigInvalidError), output 0 은 models.dev 의 출력 한도를 덮는다.
  it('models.dev 등록 provider(openai 등)·모르는 id 는 출력 한도를 모르면 limit 을 두지 않는다 — models.dev 출력 한도를 0 으로 덮지 않게', async () => {
    fetchMock.mockImplementation(async () => okResponse(body([{ id: 'm', max_model_len: 131072 }])));
    expect(await limitOf(payload({ providerId: 'openai' }), 'openai/m')).toBeUndefined();
    expect(await limitOf(payload({ providerId: 'neuralwatt' }), 'neuralwatt/m')).toBeUndefined();
  });

  it('출력 한도까지 알면 provider 와 상관없이 둘 다 선언한다', async () => {
    fetchMock.mockImplementation(async () => okResponse(body([{ id: 'm', max_model_len: 262128, metadata: { limits: { max_output_tokens: 131072 } } }])));
    expect(await limitOf(payload({ providerId: 'neuralwatt' }), 'neuralwatt/m')).toEqual({ context: 262128, output: 131072 });
  });

  it('컨텍스트 한도가 없거나 목록에 없는 모델·조회 실패·baseURL 없음은 undefined', async () => {
    fetchMock.mockImplementation(async () => okResponse(body([{ id: 'm', metadata: { capabilities: { vision: true } } }])));
    expect(await limitOf(payload(), 'custom/m')).toBeUndefined();
    expect(await limitOf(payload(), 'custom/missing')).toBeUndefined();
    resetVisionCache();
    fetchMock.mockImplementation(async () => new Response('no', { status: 500 }));
    expect(await limitOf(payload(), 'custom/m')).toBeUndefined();
    fetchMock.mockClear();
    expect(await limitOf(payload({ options: { apiKey: 'k' } }), 'custom/m')).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('쓸 수 있는 길이(컨텍스트 − 출력 몫 min(출력||32000, 32000))가 0 이하면 두지 않는다 — 매 단계 압축 방지', async () => {
    fetchMock.mockImplementation(async () =>
      okResponse(body([
        { id: 'small', max_model_len: 32000 },
        { id: 'small-known-out', max_model_len: 20000, metadata: { limits: { max_output_tokens: 4000 } } },
        { id: 'tight', max_model_len: 8192, metadata: { limits: { max_output_tokens: 8192 } } },
      ])),
    );
    expect(await limitOf(payload(), 'custom/small')).toBeUndefined();
    expect(await limitOf(payload(), 'custom/small-known-out')).toEqual({ context: 20000, output: 4000 });
    expect(await limitOf(payload(), 'custom/tight')).toBeUndefined();
  });

  it('비전·한도를 한 번의 조회로 함께 — 수동 비전 설정이 있어도 한도는 /models 로, 호출자가 넘긴 비전이 있으면 그 값', async () => {
    fetchMock.mockImplementation(async () => okResponse(body([{ id: 'm', max_model_len: 65536, metadata: { capabilities: { vision: true } } }])));
    expect(await resolveOpencodeModelSettings(payload(), 'custom/m')).toEqual({ vision: true, limit: { context: 65536, output: 0 } });
    expect(await resolveOpencodeModelSettings(payload({ vision: false }), 'custom/m')).toEqual({ vision: false, limit: { context: 65536, output: 0 } });
    expect(await resolveOpencodeModelSettings(payload(), 'custom/m', { value: undefined })).toEqual({ vision: undefined, limit: { context: 65536, output: 0 } });
    // 접두 키 수동 설정(providerId/modelId)도 같은 규칙으로 본다.
    expect((await resolveOpencodeModelSettings(payload({ vision: { 'custom/m': false } }), 'custom/m')).vision).toBe(false);
    // 비전 판단(resolveOpencodeModelVision)과도 같은 조회 캐시를 쓴다.
    expect(await resolveOpencodeModelVision(payload(), 'custom/m')).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('동시에 판단해도 /models 는 한 번만 보낸다', async () => {
    fetchMock.mockImplementation(async () => okResponse(body([{ id: 'm', max_model_len: 65536 }])));
    await Promise.all([resolveOpencodeModelSettings(payload(), 'custom/m'), resolveOpencodeModelVision(payload(), 'custom/m')]);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  // 실행 경로의 지연 보장: provider 가 죽어 있어도 실패를 캐시해 TTL 동안은 다시 3초 타임아웃을 기다리지 않는다.
  it('조회 실패(타임아웃·500)는 VISION_FAILURE_TTL_MS 동안 다시 보내지 않고 "모름"으로 끝낸다', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      fetchMock.mockRejectedValue(new DOMException('The operation was aborted due to timeout', 'TimeoutError'));
      const unknown = { vision: undefined, limit: undefined };
      expect(await resolveOpencodeModelSettings(payload(), 'custom/m')).toEqual(unknown);
      vi.setSystemTime(Date.now() + VISION_FAILURE_TTL_MS - 1000);
      expect(await resolveOpencodeModelSettings(payload(), 'custom/m')).toEqual(unknown);
      expect(await resolveOpencodeModelSettings(payload(), 'custom/other')).toEqual(unknown);
      expect(fetchMock).toHaveBeenCalledOnce();
      // HTTP 오류도 같은 실패 캐시를 탄다.
      resetVisionCache();
      fetchMock.mockReset();
      fetchMock.mockImplementation(async () => new Response('no', { status: 500 }));
      await resolveOpencodeModelSettings(payload(), 'custom/m');
      await resolveOpencodeModelSettings(payload(), 'custom/m');
      expect(fetchMock).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it('모델 형식 오류는 던진다(러너가 실행 오류로 알린다)', async () => {
    await expect(resolveOpencodeModelSettings(payload(), 'no-slash-model')).rejects.toThrow();
  });
});
