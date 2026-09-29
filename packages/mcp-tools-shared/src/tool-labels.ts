// src/tool-labels.ts — AI 채팅에 보여줄 도구 표시 라벨·아이콘과 표시 여부 규칙(#879).
// 웹은 서브패스(`/tool-labels`)로 이 **TS 소스를 직접** import 한다(Vite 번들, 빌드 불요 — package.json exports 가 src 를 가리키는 이유).
// 그래서 import 가 없는 순수 모듈로 유지한다 — 웹 번들에 zod·도구 핸들러가 딸려 들어가지 않게, 웹 tsc(bundler) 로도 그대로 타입체크되게.
// 누락 방지: 공유 도구 전부는 tool-labels.test.ts, ai-agent 로컬 도구·실존하지 않는 키는 ai-agent tools.test.ts 가 강제한다.

export interface ToolLabel {
  label: string;
  icon: string;
}

export const TOOL_LABELS: Readonly<Record<string, ToolLabel>> = {
  // 이슈
  list_issues: { label: '이슈 목록 조회', icon: '📋' },
  get_issue_detail: { label: '이슈 상세 조회', icon: '🔍' },
  create_issue: { label: '이슈 생성', icon: '📝' },
  update_issue: { label: '이슈 수정', icon: '✏️' },
  update_status: { label: '상태 변경', icon: '✏️' },
  unassign_self: { label: '담당 해제', icon: '🙅' },
  add_comment: { label: '코멘트 작성', icon: '💬' },
  edit_comment: { label: '코멘트 수정', icon: '✏️' },
  add_issue_dependency: { label: '이슈 의존관계 추가', icon: '🔗' },
  remove_issue_dependency: { label: '이슈 의존관계 제거', icon: '🔗' },
  watch_issue: { label: '이슈 구독', icon: '👀' },
  unwatch_issue: { label: '이슈 구독 해제', icon: '👀' },
  // 프로젝트
  list_projects: { label: '프로젝트 목록', icon: '🗂️' },
  get_project: { label: '프로젝트 조회', icon: '🗂️' },
  update_project: { label: '프로젝트 수정', icon: '✏️' },
  list_project_members: { label: '멤버 조회', icon: '👥' },
  // 노트
  search_wiki: { label: '노트 검색', icon: '🔍' },
  list_wiki_spaces: { label: '노트 공간 조회', icon: '📚' },
  list_wiki_pages: { label: '노트 목록', icon: '📚' },
  get_wiki_page: { label: '노트 조회', icon: '📄' },
  get_wiki_backlinks: { label: '노트 백링크 조회', icon: '🔗' },
  create_wiki_page: { label: '노트 생성', icon: '📝' },
  update_wiki_page: { label: '노트 수정', icon: '✏️' },
  move_wiki_page: { label: '노트 이동', icon: '📦' },
  // 이슈 컨텍스트 대화
  get_chat_thread: { label: '대화 조회', icon: '💬' },
  add_chat_message: { label: '메시지 작성', icon: '💬' },
  // 메시징
  list_channels: { label: '채널 목록', icon: '📋' },
  discover_channels: { label: '채널 탐색', icon: '🔍' },
  get_channel_messages: { label: '채널 메시지 조회', icon: '💬' },
  get_thread_replies: { label: '스레드 답글 조회', icon: '🧵' },
  add_channel_message: { label: '채널 메시지 작성', icon: '💬' },
  create_channel: { label: '채널 생성', icon: '➕' },
  leave_channel: { label: '채널 나가기', icon: '🚪' },
  open_dm: { label: 'DM 열기', icon: '✉️' },
  // 캘린더
  list_events: { label: '일정 조회', icon: '📅' },
  get_event: { label: '일정 상세', icon: '📅' },
  rsvp_event: { label: '일정 참석 응답', icon: '📅' },
  // 메일
  list_mail_accounts: { label: '메일 계정 조회', icon: '📧' },
  list_mail: { label: '메일 목록', icon: '📧' },
  get_mail: { label: '메일 조회', icon: '📧' },
  get_mail_summary: { label: '메일 요약 조회', icon: '📧' },
  sync_mail: { label: '메일 동기화', icon: '🔄' },
  draft_mail_reply: { label: '메일 답장 초안', icon: '📝' },
  set_mail_needs_reply_done: { label: '메일 회신 처리', icon: '✅' },
  draft_issue_from_mail: { label: '메일로 이슈 초안', icon: '📝' },
  create_issue_from_mail: { label: '메일로 이슈 생성', icon: '📝' },
  // 구성원·연락처·그룹
  search_members: { label: '구성원 검색', icon: '👥' },
  get_member: { label: '구성원 조회', icon: '👤' },
  get_member_contact: { label: '구성원 연락처 조회', icon: '👤' },
  list_contacts: { label: '연락처 목록', icon: '👤' },
  get_contact_facets: { label: '연락처 필터 조회', icon: '👤' },
  get_external_contact: { label: '연락처 조회', icon: '👤' },
  create_external_contact: { label: '연락처 생성', icon: '➕' },
  update_external_contact: { label: '연락처 수정', icon: '✏️' },
  add_contact_favorite: { label: '즐겨찾기 추가', icon: '⭐' },
  remove_contact_favorite: { label: '즐겨찾기 해제', icon: '⭐' },
  list_user_groups: { label: '그룹 목록', icon: '👥' },
  get_user_group: { label: '그룹 조회', icon: '👥' },
  create_user_group: { label: '그룹 생성', icon: '➕' },
  update_user_group: { label: '그룹 수정', icon: '✏️' },
  add_user_group_member: { label: '그룹 멤버 추가', icon: '👥' },
  remove_user_group_member: { label: '그룹 멤버 제거', icon: '👥' },
  // 드라이브
  list_drive_spaces: { label: '드라이브 공간 조회', icon: '🗂️' },
  list_drive_items: { label: '드라이브 항목 조회', icon: '🗂️' },
  list_drive_trash: { label: '드라이브 휴지통 조회', icon: '🗑️' },
  search_drive: { label: '드라이브 검색', icon: '🔍' },
  search_drive_content: { label: '드라이브 내용 검색', icon: '🔍' },
  get_drive_file_summary: { label: '파일 요약 조회', icon: '📄' },
  create_folder: { label: '폴더 생성', icon: '📁' },
  rename_folder: { label: '폴더 이름변경', icon: '✏️' },
  move_folder: { label: '폴더 이동', icon: '📦' },
  move_file: { label: '파일 이동', icon: '📦' },
  restore_drive_item: { label: '휴지통에서 복원', icon: '♻️' },
  // 알림
  list_notifications: { label: '알림 조회', icon: '🔔' },
  mark_notification_read: { label: '알림 읽음 처리', icon: '🔔' },
  mark_all_notifications_read: { label: '알림 모두 읽음', icon: '🔔' },
};

/**
 * MCP 프리픽스 제거 → 도구 이름. 런타임마다 도구 이름 형식이 다르다:
 * Claude SDK 는 `mcp__workplace__update_status`, opencode 는 `workplace_update_status`('<서버명>_<도구명>').
 */
export function stripMcpPrefix(name: string): string {
  const m = /^(?:mcp__[^_]+__|workplace_)(.+)$/.exec(name);
  return m ? m[1] : name;
}

/**
 * AI 채팅 도구 목록에 표시할 도구인지. 위젯(show_*)·제안(propose_* → 확인 카드와 중복)·내부 응답 배관
 * (respond_chat/submit_response)은 숨긴다 — 숨김 도구에는 라벨을 두지 않는다.
 */
export function isDisplayableTool(toolName: string): boolean {
  const n = stripMcpPrefix(toolName);
  if (n.startsWith('show_') || n.startsWith('propose_')) return false;
  return n !== 'respond_chat' && n !== 'submit_response';
}
