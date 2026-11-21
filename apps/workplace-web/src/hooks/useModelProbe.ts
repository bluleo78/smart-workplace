import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { probeModelsErrorMessage } from '../lib/probeModelsError';
import type { ModelOption } from '../types/providerCredential';

/**
 * 「모델 불러오기」 프로브 공용 훅 — 개인 비서 설정·관리자 공급자 키 대화상자가 함께 쓴다(WP-1900).
 *
 * 요청마다 AbortController 를 만들어 probe 에 signal 로 넘기고, 다시 불러오기·clear(연결 변경)·언마운트 때
 * 앞 요청을 끊는다. 응답/오류는 그 요청의 컨트롤러가 아직 "지금 요청"일 때만 반영하므로 끊긴(또는 늦게 온) 앞
 * 요청은 조용히 버려지고(WP-1622·WP-1893), 진행 표시(isLoading)는 지금 요청이 도는 동안만 참이라 연결을 바꾸면
 * 곧바로 풀린다.
 *
 * @param probe signal 을 받아 모델 목록을 돌려주는 요청. 렌더마다 새 함수여도 되며 최신 것을 load 때 부른다.
 */
export function useModelProbe(probe: (signal: AbortSignal) => Promise<{ models: ModelOption[] }>) {
  const [models, setModels] = useState<ModelOption[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // 지금 요청의 컨트롤러 — 끝났거나 끊겼으면 null. 응답이 반영될 자격(지금 요청인가)도 이것 하나로 가린다.
  const controllerRef = useRef<AbortController | null>(null);
  // 최신 probe 를 ref 로 들어 load 의 정체성을 안정적으로 유지한다. useLatest 와 같은 뜻이지만 layout effect 로
  // 맞춘다 — 연결 칸을 바꾼 렌더와 같은 틱에 load 를 불러도 앞 렌더의 probe(옛 주소·키)로 요청하지 않게.
  const probeRef = useRef(probe);
  useLayoutEffect(() => {
    probeRef.current = probe;
  });

  /** 도는 요청을 끊는다 — 그 요청의 이후 응답·오류는 지금 요청이 아니라 모두 버려진다. */
  const supersede = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
  }, []);

  /**
   * 목록을 불러온다. 지금 요청으로 반영한 목록을 돌려준다 — 호출부가 그 목록으로(빈 목록 포함, WP-1895) 이어 할 일을
   * 정할 수 있게 하기 위함이다. 실패했거나 끊겼으면 null.
   */
  const load = useCallback(async (): Promise<ModelOption[] | null> => {
    supersede();
    const controller = new AbortController();
    controllerRef.current = controller;
    const isCurrent = () => controllerRef.current === controller;
    setModels(null);
    setError(null);
    setIsLoading(true);
    try {
      const res = await probeRef.current(controller.signal);
      if (!isCurrent()) return null;
      setModels(res.models);
      return res.models;
    } catch (e) {
      // 끊긴 요청(CanceledError 포함)은 이미 지금 요청이 아니라 여기서 조용히 버려진다.
      if (!isCurrent()) return null;
      setError(probeModelsErrorMessage(e));
      return null;
    } finally {
      // 지금 요청이 끝났을 때만 진행 표시를 내린다 — 끊긴 요청은 그것을 끊은 쪽(load·clear)이 이미 정했다.
      if (isCurrent()) {
        controllerRef.current = null;
        setIsLoading(false);
      }
    }
  }, [supersede]);

  /** 연결이 바뀌었을 때 — 앞 요청을 끊고 목록·오류·진행 표시를 비운다. */
  const clear = useCallback(() => {
    supersede();
    setModels(null);
    setError(null);
    setIsLoading(false);
  }, [supersede]);

  // 화면이 사라지면 도는 요청을 끊는다(clear 와 같은 끊기라 catch 가 사라진 화면에 오류를 두지 않는다).
  useEffect(() => supersede, [supersede]);

  return { models, error, isLoading, load, clear };
}
