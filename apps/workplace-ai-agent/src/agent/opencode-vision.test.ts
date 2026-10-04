// WP-241: opencode 모델 비전 판단 — 수동 설정 우선, provider /models 파싱, 캐시(성공/실패 TTL·동시 조회 1회).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  parseModelsVision,
  resetVisionCache,
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

describe('parseModelsVision', () => {
  it('top-level capabilities.vision 형태도 읽는다', () => {
    expect([...parseModelsVision({ data: [{ id: 'm', capabilities: { vision: true } }] })]).toEqual([['m', true]]);
  });

  it('metadata.capabilities.vision 이 boolean 인 모델만 담는다', () => {
    expect([...parseModelsVision(MODELS_BODY)]).toEqual([
      ['qwen3.6-35b', true],
      ['glm-5.3', false],
    ]);
  });

  it('형식이 다르면 빈 맵', () => {
    expect(parseModelsVision({ models: [] }).size).toBe(0);
    expect(parseModelsVision(null).size).toBe(0);
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
