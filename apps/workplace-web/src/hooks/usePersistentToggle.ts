import { useCallback, useState } from 'react';

// localStorage 로 영속되는 불리언 토글.
// 무엇을: key 별 열림/접힘 상태를 '1'/'0' 으로 저장·복원.
// 왜: 속성 그룹·채팅 패널의 접힘 상태를 새로고침 후에도 유지하기 위해.
export function usePersistentToggle(
  key: string,
  defaultOpen: boolean,
): [boolean, () => void, (v: boolean) => void] {
  const [open, setOpenState] = useState<boolean>(() => {
    if (typeof window === 'undefined') return defaultOpen;
    try {
      const raw = window.localStorage.getItem(key);
      return raw === null ? defaultOpen : raw === '1';
    } catch {
      // localStorage 접근 자체가 막힌 환경(차단된 사이트 데이터 등) — 기본값으로 시작.
      return defaultOpen;
    }
  });

  const set = useCallback(
    (v: boolean) => {
      setOpenState(v);
      try {
        window.localStorage.setItem(key, v ? '1' : '0');
      } catch {
        // localStorage 불가(프라이빗 모드 등) — 메모리 상태만 유지.
      }
    },
    [key],
  );

  const toggle = useCallback(() => set(!open), [open, set]);

  return [open, toggle, set];
}
