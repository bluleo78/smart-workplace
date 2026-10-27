// src/components/filter/useQuickFilterPrefs.ts
// 빠른 필터 칩 고정·숨김을 localStorage 에 화면별로 기억한다(WP-1020).
// 서버에 두지 않는 이유: 보기 편의(개인 취향)라 기기마다 달라도 되고, 저장소가 막힌 환경(사생활 보호 모드)에선 기본 칩으로 그냥 동작하면 된다.
import { useCallback, useState } from 'react';

import { safeLocalStorage } from '@/lib/safeLocalStorage';

import { EMPTY_QUICK_FILTER_PREFS, parseQuickFilterPrefs, type QuickFilterPrefs } from './quickFilterLayout';

/** 저장 키 머리 — 뒤에 화면 이름·사용자 id 가 붙는다. */
export const QUICK_FILTER_STORAGE_PREFIX = 'quick-filter-chips:';

function read(storageKey: string | undefined): QuickFilterPrefs {
  if (!storageKey) return EMPTY_QUICK_FILTER_PREFS;
  try {
    return parseQuickFilterPrefs(safeLocalStorage()?.getItem(storageKey) ?? null);
  } catch {
    // 읽기 자체가 막힌 환경 — 기본 칩으로 시작.
    return EMPTY_QUICK_FILTER_PREFS;
  }
}

/**
 * storageKey 별 칩 설정과 바꾸기 함수. storageKey 가 없으면 기억하지 않는다(메모리에서만 바뀐다).
 * 키가 바뀌면(다른 화면·다른 사용자) 그 키의 설정을 다시 읽는다 — 렌더 중 상태 조정(React 권장 패턴).
 */
export function useQuickFilterPrefs(storageKey: string | undefined): [QuickFilterPrefs, (next: QuickFilterPrefs) => void] {
  const [state, setState] = useState(() => ({ key: storageKey, prefs: read(storageKey) }));
  let prefs = state.prefs;
  if (state.key !== storageKey) {
    prefs = read(storageKey);
    setState({ key: storageKey, prefs });
  }

  const update = useCallback(
    (next: QuickFilterPrefs) => {
      setState({ key: storageKey, prefs: next });
      if (!storageKey) return;
      try {
        safeLocalStorage()?.setItem(storageKey, JSON.stringify(next));
      } catch {
        // 저장 불가(용량·사생활 보호 모드) — 이번 화면에서만 유지한다.
      }
    },
    [storageKey],
  );

  return [prefs, update];
}
