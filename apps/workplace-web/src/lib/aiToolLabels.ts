// AI 비서가 호출하는 MCP 도구의 표시 라벨/아이콘/detail.
// #879: 라벨 맵·표시 여부 규칙은 도구 정의와 같은 공유 패키지에 둔다 — 도구 추가 시 라벨 누락을 그쪽 테스트가 잡는다.
import {
  isDisplayableTool,
  isMemoryTool,
  stripMcpPrefix as strip,
  TOOL_LABELS,
  type ToolLabel,
} from '@smart-workplace/mcp-tools-shared/tool-labels';

import type { ToolStep } from '@/types/home';

// WP-340: 이름이 바뀌거나 없어진 도구의 옛 이름 라벨 — 이전에 저장된 AI Chat 세션의 toolName 이 원래 이름 + 🔧 로 보이지 않게 하는
// **표시 전용** 폴백이다. 공유 TOOL_LABELS 에는 옛 이름을 두지 않는다(tool-labels.test.ts 가 금지) — TOOL_LABELS 에 항목이 없을 때만 쓴다.
export const LEGACY_TOOL_LABELS: Record<string, ToolLabel> = {
  update_status: { label: '상태 변경', icon: '✏️' },
  list_project_members: { label: '멤버 조회', icon: '👥' },
  create_folder: { label: '폴더 생성', icon: '📁' },
  rename_folder: { label: '폴더 이름변경', icon: '✏️' },
  move_folder: { label: '폴더 이동', icon: '📦' },
  move_file: { label: '파일 이동', icon: '📦' },
  // WP-360: 명명 규칙에 맞춰 바뀐 이름(옛 라벨 값 그대로).
  edit_comment: { label: '코멘트 수정', icon: '✏️' },
  get_thread_replies: { label: '스레드 답글 조회', icon: '🧵' },
  get_wiki_backlinks: { label: '노트 백링크 조회', icon: '🔗' },
  get_chat_thread: { label: '대화 조회', icon: '💬' },
  // WP-352: 목록인데 get_ 이던 이름을 list_channel_messages 로 바꿈(옛 라벨 값 그대로).
  get_channel_messages: { label: '채널 메시지 조회', icon: '💬' },
  // WP-346: 이슈 챗 첨부 읽기 — 공유 첨부 읽기 도구(당시 이름 read_attachment, WP-369 에서 read_file)와 헷갈리지 않게 read_chat_thread_attachment 로 바뀜.
  read_attachment_text: { label: '첨부 읽기', icon: '📎' },
  // WP-355: 앱당 도구 15개 상한 때문에 list_channels 의 q 옵션으로 접힌 채널 탐색(옛 라벨 값 그대로).
  discover_channels: { label: '채널 탐색', icon: '🔍' },
  // WP-369: 드라이브 앱 도구 15개 상한 안에 전송 도구 자리를 만들려고 파일·폴더 이름변경·이동을 하나씩으로 합치고,
  // 첨부 읽기는 드라이브 파일까지 읽는 이름 read_file 로 바꿈(옛 라벨 값 그대로).
  rename_drive_folder: { label: '폴더 이름변경', icon: '✏️' },
  rename_drive_file: { label: '파일 이름변경', icon: '✏️' },
  move_drive_folder: { label: '폴더 이동', icon: '📦' },
  move_drive_file: { label: '파일 이동', icon: '📦' },
  read_attachment: { label: '첨부·파일 읽기', icon: '📎' },
};

export function getToolDisplay(toolName: string): ToolLabel {
  const name = strip(toolName);
  return TOOL_LABELS[name] ?? LEGACY_TOOL_LABELS[name] ?? { label: name, icon: '🔧' };
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
// WP-55: 메모리 도구는 결과 줄로 따로 보이므로 숨긴다(API HomeChatService.isDisplayableTool 과 같은 규칙).
export function isVisibleStep(s: ToolStep): boolean {
  return s.kind === 'delegation' || (s.toolName ? isDisplayableTool(s.toolName) && !isMemoryTool(s.toolName) : true);
}

// 필터 적용한 steps.
export function visibleSteps(steps: ToolStep[]): ToolStep[] {
  return steps.filter(isVisibleStep);
}
