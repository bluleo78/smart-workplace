// src/tool-apps.ts — 공유 도구의 "앱" 분류(WP-350). 외부 MCP 클라이언트(Claude.ai·ChatGPT 등)는 도구 정의를 전부 싣기 때문에
// 연결할 때 쓸 앱만 고를 수 있게 한다(workplace-mcp 의 `/mcp/x/{apps}`·`X-MCP-Toolsets`). 앱 이름은 URL·헤더에 그대로 쓰는 값이라
// 소문자 영문이고, 화면 이름(위키=노트 등)이 바뀌어도 이 이름은 바꾸지 않는다.
// 웹은 서브패스(`/tool-apps`)로 이 TS 소스를 직접 import 한다(토큰 발급 안내의 앱 목록) — tool-labels.ts 처럼 import 없는 순수 모듈로 유지한다(zod·핸들러 금지).

/** 앱 이름 전체 — URL·헤더에 쓰는 값. 새 앱을 추가하면 아래 `TOOL_APP_GUIDES` 도 채워야 한다(타입이 강제). */
export const TOOL_APPS = [
  'issue',
  'project',
  'wiki',
  'drive',
  'mail',
  'messaging',
  'calendar',
  'contacts',
  'notify',
  'member',
] as const;

export type ToolApp = (typeof TOOL_APPS)[number];

/**
 * 도구가 속한 앱. 대부분 하나지만 **여러 앱에 걸쳐 쓰이는 도구는 배열**로 적는다 — 그 앱 중 하나만 골라도 도구가 보여야
 * 그 앱 안에서 일이 끊기지 않기 때문이다(예: read_attachment 는 이슈 첨부와 드라이브 파일을 모두 읽으므로 issue·drive 어느 쪽만 골라도 필요하다).
 * 같은 이유로 이슈 작업의 출발점인 list_projects·get_project 는 project 와 issue 에 모두 둔다(projectKey·담당자·라벨 목록을 거기서 얻는다).
 * 도구를 "있으면 편하다" 수준으로 여러 앱에 퍼뜨리지 않는다 — 꼭 필요한 선행 조회만 겹친다(분류 표는 README).
 */
export type ToolAppTag = ToolApp | readonly [ToolApp, ...ToolApp[]];

/** 도구가 속한 앱 목록(배열로 정규화). */
export function toolApps(tool: { app: ToolAppTag }): readonly ToolApp[] {
  return typeof tool.app === 'string' ? [tool.app] : tool.app;
}

/**
 * 서버 `instructions` 를 만들 때 쓰는 앱별 안내. 로드된 도구만 말하도록 읽기·쓰기 문구를 나눠 둔다(읽기 전용 연결에 "생성·수정"을 말하지 않는다).
 * - label: 화면 이름
 * - read / write: 읽기·쓰기로 할 수 있는 일 한 줄 요약
 * - entry: 먼저 부를 도구(실제 로드된 것만 안내에 싣는다)
 */
export interface ToolAppGuide {
  label: string;
  read: string;
  write: string;
  entry: readonly string[];
}

export const TOOL_APP_GUIDES: Record<ToolApp, ToolAppGuide> = {
  issue: { label: '이슈', read: '이슈·프로젝트 조회, 첨부 읽기', write: '이슈 생성·수정·댓글·의존·관심', entry: ['list_issues', 'get_issue_detail'] },
  project: { label: '프로젝트', read: '프로젝트·멤버·마일스톤 조회', write: '프로젝트 생성·수정·멤버 추가', entry: ['list_projects', 'get_project'] },
  wiki: { label: '위키(노트)', read: '페이지 검색·조회·백링크', write: '페이지 생성·수정·이동', entry: ['search_wiki', 'get_wiki_page'] },
  drive: { label: '드라이브', read: '파일 검색·요약·내용 읽기·휴지통 조회', write: '폴더 생성·이름 변경·이동·휴지통 복원', entry: ['list_drive_items', 'search_drive'] },
  mail: { label: '메일', read: '메일 조회·요약·답장·이슈 초안', write: '읽음 처리·동기화·메일로 이슈 생성(발송은 불가)', entry: ['list_mail_accounts', 'list_mail'] },
  messaging: { label: '채널·DM', read: '채널·메시지·스레드 조회', write: '메시지 작성·채널 생성·초대·DM', entry: ['list_channels', 'list_channel_messages'] },
  calendar: { label: '캘린더', read: '일정 조회', write: '일정 생성·수정·참석자 변경·참석 응답', entry: ['list_events', 'get_event'] },
  contacts: { label: '연락처', read: '연락처·그룹 조회', write: '즐겨찾기·그룹·외부 연락처 관리', entry: ['list_contacts', 'list_user_groups'] },
  notify: { label: '알림', read: '알림 조회', write: '읽음 처리', entry: ['list_notifications'] },
  member: { label: '구성원', read: '구성원 검색·연락처 조회', write: '', entry: ['search_members', 'get_member'] },
};

/** 앱 이름 문자열이 유효한 앱인지(타입 가드). */
export function isToolApp(name: string): name is ToolApp {
  return (TOOL_APPS as readonly string[]).includes(name);
}
