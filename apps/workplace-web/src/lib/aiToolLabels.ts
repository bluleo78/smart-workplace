// AI 비서가 호출하는 MCP 도구의 표시 라벨/아이콘/detail.
// #879: 라벨 맵·표시 여부 규칙은 도구 정의와 같은 공유 패키지에 둔다 — 도구 추가 시 라벨 누락을 그쪽 테스트가 잡는다.
import {
  isDisplayableTool,
  stripMcpPrefix as strip,
  TOOL_LABELS,
  type ToolLabel,
} from '@smart-workplace/mcp-tools-shared/tool-labels';

import { ownLookup } from '@/lib/ownLookup';
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
  // 도구명은 AI 응답에서 오므로 프로토타입 키('constructor' 등)가 라벨로 새지 않게 자기 키만 조회한다(WP-416).
  return ownLookup(TOOL_LABELS, name) ?? ownLookup(LEGACY_TOOL_LABELS, name) ?? { label: name, icon: '🔧' };
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

// WP-250: PDF 페이지를 이미지로 볼 수 있는(= pages 인자를 받는) 도구. 이름 접두(mcp__workplace__ 등)는 strip 으로 이미 벗긴 뒤 비교한다.
const PAGE_VIEW_TOOLS = new Set(['read_file', 'read_chat_attachment', 'read_chat_thread_attachment']);

// pages 인자 → "7쪽" / "11–13쪽"(연속 구간, en dash) / "2·5쪽"(흩어진 쪽, 가운뎃점).
// 모델이 보낸 순서·중복과 상관없이 같은 쪽 집합은 같게 보이도록 정렬·중복 제거한다([13,12,11]→11–13쪽, [7,7]→7쪽).
// 배열이 아니거나 비었거나 양의 정수가 아닌 값이 섞여 있으면 null — 호출부가 기존 표시로 폴백한다.
export function formatPages(pages: unknown): string | null {
  if (!Array.isArray(pages) || pages.length === 0) return null;
  if (!pages.every((p) => typeof p === 'number' && Number.isInteger(p) && p > 0)) return null;
  const nums = [...new Set(pages as number[])].sort((a, b) => a - b);
  const consecutive = nums.length > 1 && nums.every((p, i) => i === 0 || p === nums[i - 1] + 1);
  return consecutive ? `${nums[0]}–${nums[nums.length - 1]}쪽` : `${nums.join('·')}쪽`;
}

// 도구 단계 한 줄(아이콘 + 라벨 + detail). 페이지를 본 단계는 "📄 페이지 보기 7쪽" 으로, 그 외는 기존 라벨·detail 을 쓴다.
// 메일 첨부(read_file source 'mail')는 페이지 보기를 지원하지 않아(도구가 텍스트 읽기 안내로 돌려준다) pages 가 있어도 기존 라벨로 둔다.
export function getToolStepDisplay(
  toolName: string,
  args?: Record<string, unknown>,
): { label: string; icon: string; detail: string | null } {
  const pageView = PAGE_VIEW_TOOLS.has(strip(toolName)) && args?.source !== 'mail';
  const pagesText = pageView ? formatPages(args?.pages) : null;
  if (pagesText) return { label: '페이지 보기', icon: '📄', detail: pagesText };
  const { label, icon } = getToolDisplay(toolName);
  return { label, icon, detail: getToolDetail(toolName, args) };
}

// 단계 표시 여부 — 표시 불가 tool 은 숨김(delegation 은 유지). 렌더 필터·도구 그룹 블록 생성(WP-157)이 같은 규칙을 쓴다.
export function isVisibleStep(s: ToolStep): boolean {
  return s.kind === 'delegation' || (s.toolName ? isDisplayableTool(s.toolName) : true);
}

// 필터 적용한 steps.
export function visibleSteps(steps: ToolStep[]): ToolStep[] {
  return steps.filter(isVisibleStep);
}
