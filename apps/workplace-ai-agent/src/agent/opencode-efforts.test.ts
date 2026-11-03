// WP-1322 opencode variant(생각의 깊이 단계) 조회 — 서버 스폰은 갈아 끼운다(실제 opencode 를 띄우지 않는다).
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../logger.js', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import {
  cachedOpencodeEfforts,
  EFFORTS_CACHE_TTL_MS,
  effortsProbeConfig,
  lookupOpencodeEfforts,
  opencodeVariantFor,
  parseProviderEfforts,
  resetEffortsCache,
} from './opencode-efforts.js';
import type { OpencodeHandle } from './opencode-server-pool.js';
import { NoLiveSlotError } from './opencode-spawn.js';

const PROVIDER = 'wp-efforts-probe';
const body = (models: Record<string, unknown>) => ({ providers: [{ id: PROVIDER, models }], default: {} });

/** providers() 가 응답(또는 멈춤)을 돌려주는 가짜 서버 — close 횟수를 센다. */
function fakeHandle(providers: () => Promise<unknown>) {
  const close = vi.fn();
  const handle = {
    client: { config: { providers: vi.fn(providers) } },
    server: { url: 'http://x', close },
  } as unknown as OpencodeHandle;
  return { handle, close };
}
const answering = (models: Record<string, unknown>) => fakeHandle(async () => ({ data: body(models) }));
const asObj = (m: Map<string, readonly string[]>) => Object.fromEntries(m);

beforeEach(() => resetEffortsCache());

describe('effortsProbeConfig', () => {
  it('물을 모델을 모두 reasoning:true 로 선언하고 비밀은 싣지 않는다', () => {
    const cfg = effortsProbeConfig('@ai-sdk/openai-compatible', ['gpt-5', 'qwen3']);
    const p = (cfg.provider as Record<string, { npm: string; options: Record<string, unknown>; models: Record<string, unknown> }>)[PROVIDER];
    expect(p.npm).toBe('@ai-sdk/openai-compatible');
    expect(p.models).toEqual({ 'gpt-5': { reasoning: true }, qwen3: { reasoning: true } });
    expect(p.options.apiKey).toBe('unused');
    expect(cfg.enabled_providers).toEqual([PROVIDER]);
  });
});

describe('parseProviderEfforts', () => {
  it('variant 키를 단계로 옮기고(minimal 등 버림) variant 없는 모델은 빈 목록', () => {
    const got = parseProviderEfforts(body({ 'gpt-5': { variants: { minimal: {}, low: {}, medium: {}, high: {} } }, qwen3: {} }), [
      'gpt-5',
      'qwen3',
      'missing',
    ]);
    expect(asObj(got)).toEqual({ 'gpt-5': ['low', 'medium', 'high'], qwen3: [], missing: [] });
  });
});

describe('lookupOpencodeEfforts', () => {
  it('슬롯을 기다리지 않는 스폰으로 묻고, 서버를 닫고, 모델별로 캐시한다(두 번째는 스폰 없음)', async () => {
    const { handle, close } = answering({ 'gpt-5': { variants: { low: {}, high: {} } } });
    const spawn = vi.fn().mockResolvedValue(handle);
    expect(asObj(await lookupOpencodeEfforts(null, ['gpt-5'], { spawn }))).toEqual({ 'gpt-5': ['low', 'high'] });
    expect(spawn).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ tryOnly: true }));
    expect(close).toHaveBeenCalledTimes(1);
    expect(asObj(await lookupOpencodeEfforts(undefined, ['gpt-5'], { spawn }))).toEqual({ 'gpt-5': ['low', 'high'] });
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it('캐시에 없는 모델만 묻고, 그 조회가 실패해도 캐시된 모델은 그대로 돌려준다', async () => {
    const spawn = vi.fn().mockResolvedValueOnce(answering({ a: { variants: { low: {} } } }).handle);
    await lookupOpencodeEfforts(null, ['a'], { spawn });
    spawn.mockRejectedValueOnce(new Error('boot fail'));
    const got = await lookupOpencodeEfforts(null, ['a', 'b'], { spawn });
    expect(asObj(got)).toEqual({ a: ['low'] });
    expect(spawn.mock.calls[1][0].provider[PROVIDER].models).toEqual({ b: { reasoning: true } });
  });

  it('실패한 모델은 잠시 다시 묻지 않지만, 슬롯 부족(NoLiveSlotError)은 실패로 남기지 않아 바로 다시 묻는다', async () => {
    const spawn = vi.fn().mockRejectedValueOnce(new Error('boot fail'));
    await lookupOpencodeEfforts(null, ['a'], { spawn });
    await lookupOpencodeEfforts(null, ['a'], { spawn });
    expect(spawn).toHaveBeenCalledTimes(1);

    spawn.mockRejectedValueOnce(new NoLiveSlotError());
    expect(asObj(await lookupOpencodeEfforts(null, ['b'], { spawn }))).toEqual({});
    spawn.mockResolvedValueOnce(answering({ b: { variants: { high: {} } } }).handle);
    expect(asObj(await lookupOpencodeEfforts(null, ['b'], { spawn }))).toEqual({ b: ['high'] });
    expect(spawn).toHaveBeenCalledTimes(3);
  });

  it('진행 중인 모델은 같은 조회를 함께 기다린다(모델 id 단위 — 묶음이 달라도 겹치는 모델은 다시 묻지 않는다)', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const spawn = vi
      .fn()
      .mockImplementationOnce(async () => {
        await gate;
        return answering({ a: { variants: { low: {} } }, b: {} }).handle;
      })
      .mockResolvedValueOnce(answering({ c: { variants: { max: {} } } }).handle);
    const first = lookupOpencodeEfforts(null, ['a', 'b'], { spawn });
    const second = lookupOpencodeEfforts(null, ['b', 'c'], { spawn });
    release();
    expect(asObj(await first)).toEqual({ a: ['low'], b: [] });
    expect(asObj(await second)).toEqual({ b: [], c: ['max'] });
    expect(spawn).toHaveBeenCalledTimes(2);
    expect(spawn.mock.calls[1][0].provider[PROVIDER].models).toEqual({ c: { reasoning: true } });
  });

  it('providers() 가 멈추면 시간 초과에 서버를 바로 닫는다(슬롯 반납) — 결과는 비어 있다', async () => {
    const { handle, close } = fakeHandle(() => new Promise(() => {}));
    const spawn = vi.fn().mockResolvedValue(handle);
    expect(asObj(await lookupOpencodeEfforts(null, ['a'], { spawn, timeoutMs: 20 }))).toEqual({});
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('부팅이 시간 안에 안 끝나면 비어 있고, 늦게 뜬 서버는 뜨는 대로 닫는다', async () => {
    const { handle, close } = answering({});
    let resolveSpawn: (h: OpencodeHandle) => void = () => {};
    const spawn = vi.fn(() => new Promise<OpencodeHandle>((r) => (resolveSpawn = r)));
    expect(asObj(await lookupOpencodeEfforts(null, ['a'], { spawn, timeoutMs: 10 }))).toEqual({});
    resolveSpawn(handle);
    await vi.waitFor(() => expect(close).toHaveBeenCalledTimes(1));
    expect(handle.client.config.providers).not.toHaveBeenCalled();
  });
});

describe('캐시 만료', () => {
  it('만료된 항목은 읽을 때 지우고 다시 묻는다', async () => {
    let t = 1_000;
    const now = () => t;
    const spawn = vi.fn().mockImplementation(async () => answering({ a: { variants: { low: {} } } }).handle);
    await lookupOpencodeEfforts(null, ['a'], { spawn, now });
    expect(cachedOpencodeEfforts(null, 'a', t)).toEqual(['low']);
    t += EFFORTS_CACHE_TTL_MS + 1;
    expect(cachedOpencodeEfforts(null, 'a', t)).toBeUndefined();
    await lookupOpencodeEfforts(null, ['a'], { spawn, now });
    expect(spawn).toHaveBeenCalledTimes(2);
  });
});

describe('opencodeVariantFor', () => {
  /** 실행 서버 — 그 연결의 provider id 로 모델을 싣는다. */
  const runServer = (models: Record<string, unknown>) =>
    fakeHandle(async () => ({ data: { providers: [{ id: 'my-llm', models }], default: {} } }));
  const target = (modelID: string, level: 'low' | 'medium' | 'high' | 'xhigh' | 'max') => ({ npm: null, providerId: 'my-llm', modelID, level });

  it('실행 서버에 물어 받는 단계면 그대로, 아니면 바로 아래, 없으면 undefined — 결과는 공용 캐시에 남아 다음엔 묻지 않는다', async () => {
    const { handle } = runServer({ m: { variants: { low: {}, medium: {}, high: {} } }, none: {} });
    expect(await opencodeVariantFor(handle, target('m', 'max'))).toBe('high');
    expect(cachedOpencodeEfforts(null, 'm')).toEqual(['low', 'medium', 'high']);
    expect(await opencodeVariantFor(handle, target('m', 'medium'))).toBe('medium');
    expect(handle.client.config.providers).toHaveBeenCalledTimes(1);
    expect(await opencodeVariantFor(handle, target('none', 'low'))).toBeUndefined();
  });

  it('응답이 멈추거나 실패하면 undefined(variant 없이 돈다) — 서버는 실행 것이라 닫지 않는다', async () => {
    const hang = fakeHandle(() => new Promise(() => {}));
    expect(await opencodeVariantFor(hang.handle, target('m', 'high'), 10)).toBeUndefined();
    expect(hang.close).not.toHaveBeenCalled();
    const fail = fakeHandle(async () => ({ data: undefined, error: 'x' }));
    expect(await opencodeVariantFor(fail.handle, target('m', 'high'))).toBeUndefined();
  });
});
