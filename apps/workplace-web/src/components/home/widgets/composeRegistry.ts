import { type ComponentType, lazy, type LazyExoticComponent } from 'react';

import type { WidgetType } from '@/types/home';

// ---------------------------------------------------------------------------
// 컴포즈 위젯 레지스트리 — AI 비서 응답(show_* 도구)이 지시한 위젯을 챗 도크에서 렌더한다.
// 대시보드 레지스트리(registry.ts)와 분리: 이쪽은 compose done 이벤트의 widgets[] 를 그린다.
// 각 위젯은 params(필터)만 받아 자체 훅으로 데이터를 가져온다(LLM 이 데이터 생성 X).
// 키는 ai-agent compose-parser 의 widgetType(= show_<type>) 과 일치해야 한다.
// ---------------------------------------------------------------------------

type WidgetComponent = LazyExoticComponent<
  ComponentType<{ params?: Record<string, unknown> }>
>;

const composeRegistry: Record<WidgetType, WidgetComponent> = {
  my_tasks: lazy(() => import('./MyTasksWidget')),
  issue_list: lazy(() => import('./IssueListWidget')),
  issue_detail: lazy(() => import('./IssueDetailWidget')),
  activity: lazy(() => import('./ActivityWidget')),
  // #431: 메일 목록 위젯 — show_mail_list 지시를 받아 받은편지함을 표시.
  mail_list: lazy(() => import('./MailListWidget')),
};

/** 위젯 타입 → 컴포넌트. 미등록 타입이면 undefined(렌더 측에서 skip). */
export function getComposeWidget(type: string): WidgetComponent | undefined {
  return composeRegistry[type as WidgetType];
}
