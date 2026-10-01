// AI 비서가 호출하는 MCP 도구의 표시 라벨/아이콘/detail.
// #879: 라벨 맵·표시 여부 규칙은 도구 정의와 같은 공유 패키지에 둔다 — 도구 추가 시 라벨 누락을 그쪽 테스트가 잡는다.
import {
  isDisplayableTool,
  stripMcpPrefix as strip,
  TOOL_LABELS,
  type ToolLabel,
} from '@smart-workplace/mcp-tools-shared/tool-labels';

import type { ToolStep } from '@/types/home';

export function getToolDisplay(toolName: string): ToolLabel {
  return TOOL_LABELS[strip(toolName)] ?? { label: strip(toolName), icon: '🔧' };
}

// #461: show_* 도구명에서 위젯 타입 추출(점진 렌더용). 백엔드 compose-parser 와 동일 규칙.
// 'mcp__workplace__show_calendar' / 'show_calendar' → 'calendar'. show_* 가 아니면 null.
export function widgetTypeFromToolName(toolName: string): string | null {
  const m = /show_([a-z_]+)$/.exec(strip(toolName));
  return m ? m[1] : null;
}

// 표시용 detail — 인자 1~2개 요약. (라이브 캡처로 실제 키 확인 후 보정)
export function getToolDetail(_toolName: string, args?: Record<string, unknown>): string | null {
  if (!args) return null;
  const parts: string[] = [];
  const pick = (k: string) => {
    const v = args[k];
    if (typeof v === 'string' || typeof v === 'number') parts.push(String(v));
  };
  pick('issueKey');
  pick('status');
  pick('query');
  pick('name');
  pick('title');
  // _toolName 은 향후 도구별 분기에 활용할 수 있도록 파라미터로 유지(현재 미사용).
  return parts.length ? parts.slice(0, 2).join(' · ') : null;
}

// 단계 표시 여부 — 표시 불가 tool 은 숨김(delegation 은 유지). 렌더 필터·도구 그룹 블록 생성(WP-157)이 같은 규칙을 쓴다.
export function isVisibleStep(s: ToolStep): boolean {
  return s.kind === 'delegation' || (s.toolName ? isDisplayableTool(s.toolName) : true);
}

// 필터 적용한 steps.
export function visibleSteps(steps: ToolStep[]): ToolStep[] {
  return steps.filter(isVisibleStep);
}
