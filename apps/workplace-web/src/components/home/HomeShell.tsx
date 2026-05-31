import { useEffect } from 'react';

import { FloatingChat } from './FloatingChat';
import { HomeCanvas } from './HomeCanvas';
import { ModuleSidebar } from './ModuleSidebar';
import { useCanvasState } from '@/hooks/useCanvasState';
import type { WidgetSpec } from '@/types/home';

// 기본 구성(AI 호출 없이 즉시 렌더) — 설계 §6.
const DEFAULT_SPECS: WidgetSpec[] = [
  { type: 'my_tasks' },
  { type: 'issue_list', params: { assignee: 'me', status: 'IN_PROGRESS' } },
  { type: 'activity' },
];

/** 홈 셸 — 좌측 모듈 사이드바 + 캔버스(항상 보임) + 떠있는 챗. 마운트 시 기본 구성 자동 로드. */
export function HomeShell() {
  const canvas = useCanvasState();
  const { loadDefault } = canvas;
  // 마운트 시 기본 구성 1회 로드 — AI compose 호출 없이 즉시 렌더.
  useEffect(() => {
    loadDefault(DEFAULT_SPECS);
  }, [loadDefault]);

  // AppLayout 헤더가 h-14(3.5rem) 이므로 그만큼 빼서 셸이 뷰포트를 채운다(이중 스크롤바 방지).
  return (
    <div className="flex h-[calc(100vh-3.5rem)]">
      <ModuleSidebar />
      <main className="relative flex-1 overflow-hidden">
        <HomeCanvas pages={canvas.pages} activeIndex={canvas.activeIndex} onSelectPage={canvas.setActive} />
        <FloatingChat onCompose={canvas.apply} />
      </main>
    </div>
  );
}
