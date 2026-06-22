// AI 비서가 호출하는 MCP 도구의 표시 라벨/아이콘/detail. firehub TOOL_LABELS 패턴을 workplace 도구셋에 맞춤.
import type { ToolStep } from '@/types/home';

const TOOL_LABELS: Record<string, { label: string; icon: string }> = {
  list_issues: { label: '이슈 목록 조회', icon: '📋' },
  get_issue_detail: { label: '이슈 상세 조회', icon: '🔍' },
  add_comment: { label: '코멘트 작성', icon: '💬' },
  update_status: { label: '상태 변경', icon: '✏️' },
  unassign_self: { label: '담당 해제', icon: '🙅' },
  search_wiki: { label: '위키 검색', icon: '🔍' },
  get_wiki_page: { label: '위키 조회', icon: '📄' },
  create_wiki_page: { label: '위키 생성', icon: '📝' },
  update_wiki_page: { label: '위키 수정', icon: '✏️' },
  get_chat_thread: { label: '대화 조회', icon: '💬' },
  add_chat_message: { label: '메시지 작성', icon: '💬' },
  get_channel_messages: { label: '채널 메시지 조회', icon: '💬' },
  add_channel_message: { label: '채널 메시지 작성', icon: '💬' },
  list_channels: { label: '채널 목록', icon: '📋' },
  discover_channels: { label: '채널 탐색', icon: '🔍' },
  list_events: { label: '일정 조회', icon: '📅' },
  get_event: { label: '일정 상세', icon: '📅' },
  list_mail: { label: '메일 목록', icon: '📧' },
  get_mail: { label: '메일 조회', icon: '📧' },
  list_mail_accounts: { label: '메일 계정 조회', icon: '📧' },
  sync_mail: { label: '메일 동기화', icon: '🔄' },
  list_contacts: { label: '연락처 목록', icon: '👤' },
  get_external_contact: { label: '연락처 조회', icon: '👤' },
  create_external_contact: { label: '연락처 생성', icon: '➕' },
  update_external_contact: { label: '연락처 수정', icon: '✏️' },
  list_projects: { label: '프로젝트 목록', icon: '🗂️' },
  get_project: { label: '프로젝트 조회', icon: '🗂️' },
  list_project_members: { label: '멤버 조회', icon: '👥' },
  list_drive_spaces: { label: '드라이브 공간 조회', icon: '🗂️' },
  list_drive_items: { label: '드라이브 항목 조회', icon: '🗂️' },
  search_drive: { label: '드라이브 검색', icon: '🔍' },
  create_folder: { label: '폴더 생성', icon: '📁' },
  rename_folder: { label: '폴더 이름변경', icon: '✏️' },
  move_folder: { label: '폴더 이동', icon: '📦' },
  move_file: { label: '파일 이동', icon: '📦' },
};

// MCP 프리픽스 제거: mcp__workplace__update_status → update_status
function strip(name: string): string {
  const m = /^mcp__[^_]+__(.+)$/.exec(name);
  return m ? m[1] : name;
}

export function getToolDisplay(toolName: string): { label: string; icon: string } {
  return TOOL_LABELS[strip(toolName)] ?? { label: strip(toolName), icon: '🔧' };
}

// #461: show_* 도구명에서 위젯 타입 추출(점진 렌더용). 백엔드 compose-parser 와 동일 규칙.
// 'mcp__workplace__show_calendar' / 'show_calendar' → 'calendar'. show_* 가 아니면 null.
export function widgetTypeFromToolName(toolName: string): string | null {
  const m = /show_([a-z_]+)$/.exec(strip(toolName));
  return m ? m[1] : null;
}

// 표시 제외: 위젯(show_*)·내부 응답 배관(respond_chat/submit_response)·제안(propose_* → 확인 카드 중복).
export function isDisplayableTool(toolName: string): boolean {
  const n = strip(toolName);
  if (n.startsWith('show_')) return false;
  if (n.startsWith('propose_')) return false;
  if (n === 'respond_chat' || n === 'submit_response') return false;
  return true;
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

// 필터 적용한 steps — 표시 불가 tool 은 제거(delegation 은 유지).
export function visibleSteps(steps: ToolStep[]): ToolStep[] {
  return steps.filter((s) => s.kind === 'delegation' || (s.toolName ? isDisplayableTool(s.toolName) : true));
}
