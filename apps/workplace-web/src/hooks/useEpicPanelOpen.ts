// 에픽 패널 열림 상태 — 프로젝트별 localStorage 영속(기본 닫힘).
// 진입점은 뷰 탭 바의 「에픽」 토글 하나(스펙 2026-07-04-epic-panel-redesign).
import { useState } from 'react';

const KEY_PREFIX = 'epicSidePanel.open.';

// localStorage 접근 불가 환경(사파리 프라이빗 등)에서는 기본값(닫힘)으로 동작.
function readStored(projectKey: string): boolean {
  try {
    return localStorage.getItem(KEY_PREFIX + projectKey) === 'true';
  } catch {
    return false;
  }
}

export function useEpicPanelOpen(projectKey: string) {
  // 라우트가 /projects/:key 단일이라 프로젝트 간 이동 시 컴포넌트가 리마운트되지 않는다 —
  // key 변경을 감지해 상태를 리셋하는 "derive state from props" 패턴.
  const [state, setState] = useState(() => ({ projectKey, open: readStored(projectKey) }));
  if (state.projectKey !== projectKey) {
    setState({ projectKey, open: readStored(projectKey) });
  }

  const toggle = () => {
    setState((prev) => {
      const next = !prev.open;
      try {
        localStorage.setItem(KEY_PREFIX + projectKey, String(next));
      } catch {
        // 저장 실패 시 세션 내 상태만 유지
      }
      return { projectKey: prev.projectKey, open: next };
    });
  };

  return { open: state.open, toggle };
}
