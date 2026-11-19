// 최신 값을 ref 로 들고 있는 훅 — 렌더마다 새로 만들어지는 콜백을 effect 의존성에 넣지 않고(한 번만 거는 듣기·주소 변화에만 도는 effect)
// 부를 때는 늘 최신 것을 쓰게 한다. ref 는 커밋 뒤 effect 에서 고친다(렌더 중 ref 쓰기를 피한다).
import { useEffect, useRef } from 'react';

export function useLatest<T>(value: T) {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  });
  return ref;
}
