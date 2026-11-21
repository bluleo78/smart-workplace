import { act, renderHook } from '@testing-library/react';
import { CanceledError } from 'axios';
import { describe, expect, it } from 'vitest';

import type { ModelOption } from '../types/providerCredential';
import { useModelProbe } from './useModelProbe';

const FALLBACK = '모델 목록을 불러오지 못했습니다. 모델 id를 직접 입력하세요.';

/** 응답을 테스트가 직접 쥐는 지연 요청 — probe 가 받은 signal 도 함께 보관한다. */
interface Pending {
  signal: AbortSignal;
  resolve: (v: { models: ModelOption[] }) => void;
  reject: (e: unknown) => void;
}

function setup() {
  const pendings: Pending[] = [];
  const probe = (signal: AbortSignal) =>
    new Promise<{ models: ModelOption[] }>((resolve, reject) => {
      pendings.push({ signal, resolve, reject });
    });
  const hook = renderHook(() => useModelProbe(probe));
  return { pendings, ...hook };
}

const A = [{ id: 'a' }] as unknown as ModelOption[];
const B = [{ id: 'b' }] as unknown as ModelOption[];

describe('useModelProbe', () => {
  it('load 가 성공하면 목록을 보이고 그 목록을 돌려준다', async () => {
    const { pendings, result } = setup();
    let p!: Promise<ModelOption[] | null>;
    act(() => {
      p = result.current.load();
    });
    expect(result.current.isLoading).toBe(true);
    let loaded: ModelOption[] | null = null;
    await act(async () => {
      pendings[0].resolve({ models: A });
      loaded = await p;
    });
    expect(loaded).toEqual(A);
    expect(result.current.models).toEqual(A);
    expect(result.current.isLoading).toBe(false);
  });

  it('load 가 실패하면 공용 문구를 error 로 두고 null 을 돌려준다', async () => {
    const { pendings, result } = setup();
    let p!: Promise<ModelOption[] | null>;
    act(() => {
      p = result.current.load();
    });
    let loaded: ModelOption[] | null = A;
    await act(async () => {
      pendings[0].reject(new Error('x'));
      loaded = await p;
    });
    expect(loaded).toBeNull();
    expect(result.current.error).toBe(FALLBACK);
    expect(result.current.isLoading).toBe(false);
  });

  it('clear 하면 도는 요청의 signal 이 끊기고 곧바로 isLoading 이 false 다', async () => {
    const { pendings, result } = setup();
    let p!: Promise<ModelOption[] | null>;
    act(() => {
      p = result.current.load();
    });
    expect(result.current.isLoading).toBe(true);
    act(() => {
      result.current.clear();
    });
    expect(pendings[0].signal.aborted).toBe(true);
    expect(result.current.isLoading).toBe(false);
    let loaded: ModelOption[] | null = A;
    await act(async () => {
      pendings[0].reject(new CanceledError());
      loaded = await p;
    });
    expect(loaded).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.models).toBeNull();
  });

  it('clear 뒤 늦게 성공한 앞 응답은 반영하지 않는다', async () => {
    const { pendings, result } = setup();
    let p!: Promise<ModelOption[] | null>;
    act(() => {
      p = result.current.load();
    });
    act(() => {
      result.current.clear();
    });
    await act(async () => {
      pendings[0].resolve({ models: A });
      expect(await p).toBeNull();
    });
    expect(result.current.models).toBeNull();
  });

  it('load 를 겹쳐 부르면 앞 요청을 끊고 뒤 응답만 반영한다', async () => {
    const { pendings, result } = setup();
    let p1!: Promise<ModelOption[] | null>;
    let p2!: Promise<ModelOption[] | null>;
    act(() => {
      p1 = result.current.load();
    });
    act(() => {
      p2 = result.current.load();
    });
    expect(pendings[0].signal.aborted).toBe(true);
    await act(async () => {
      pendings[1].resolve({ models: B });
      pendings[0].resolve({ models: A });
      await Promise.all([p1, p2]);
    });
    expect(result.current.models).toEqual(B);
  });

  it('언마운트하면 도는 요청을 끊는다', () => {
    const { pendings, result, unmount } = setup();
    act(() => {
      void result.current.load();
    });
    unmount();
    expect(pendings[0].signal.aborted).toBe(true);
  });
});
