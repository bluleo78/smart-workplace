// 홈 세션 컨텍스트의 비(非)컴포넌트 조각 — 기본 사양 / 값 타입 / 컨텍스트 / 소비 훅.
// Provider 컴포넌트(HomeSessionProvider)는 HomeSessionContext.tsx 에 분리(react-refresh 규칙).
import { createContext, useContext } from 'react';

import type { WidgetSpec } from '@/types/home';

import type { useHomeSession } from './useHomeSession';

// 홈 캔버스 기본 위젯 사양 — 안정 참조(모듈 const, useHomeSession deps).
export const DEFAULT_SPECS: WidgetSpec[] = [
  { type: 'my_tasks' },
  { type: 'issue_list', params: { assignee: 'me', status: 'IN_PROGRESS' } },
  { type: 'activity' },
];

export type HomeSessionValue = ReturnType<typeof useHomeSession>;

export const HomeSessionContext = createContext<HomeSessionValue | null>(null);

// 세션 컨텍스트 소비 훅. Provider 밖에서 호출 시 에러.
export function useHomeSessionContext(): HomeSessionValue {
  const ctx = useContext(HomeSessionContext);
  if (!ctx) throw new Error('useHomeSessionContext must be used within HomeSessionProvider');
  return ctx;
}
