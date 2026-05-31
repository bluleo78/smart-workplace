import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

import type { WidgetType } from '@/types/home';

/** 위젯 컴포넌트 공통 props — 캔버스가 spec.params 를 그대로 전달. */
export interface WidgetProps {
  params?: Record<string, unknown>;
}

// type → lazy 컴포넌트. 번들 분리. 새 위젯 추가 = import 한 줄.
const registry: Record<WidgetType, LazyExoticComponent<ComponentType<WidgetProps>>> = {
  my_tasks: lazy(() => import('./MyTasksWidget')),
  issue_list: lazy(() => import('./IssueListWidget')),
  issue_detail: lazy(() => import('./IssueDetailWidget')),
  activity: lazy(() => import('./ActivityWidget')),
};

/** 알 수 없는 type 은 null — 캔버스가 무시. */
export function getWidget(
  type: string,
): LazyExoticComponent<ComponentType<WidgetProps>> | null {
  return registry[type as WidgetType] ?? null;
}
