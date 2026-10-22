// 4 MCP 도구 정의 — 모든 호출에 agentId 가 closure 로 바인딩 (#34).
import { z } from 'zod';

import {
  addChannelMemberInput,
  addProjectMemberInput,
  ADD_CHANNEL_MESSAGE_DESCRIPTION,
  buildSharedTools,
  CREATE_DRIVE_FILE_CONTENT_DESCRIPTION,
  createProjectInput,
  imageViewBlocks,
  isImageSkip,
  issueListFilterShape,
  listConflicts as listConflictsShared,
  MEMORY_TOOL_NAMES,
  NO_ATTENDEE_TO_ADD,
  normalizeTimezone,
  PAGES_DESCRIPTION,
  pageBlocks,
  parseIssueKey,
  pdfNote,
  READ_ATTACHMENT_DEFAULT_LIMIT,
  readRangeShape,
  requireActiveMember as requireActiveMemberShared,
  requireMember,
  resolveAttendees as resolveAttendeesShared,
  resolveAttendeeToRemove,
  resolveRange,
  toCreateProjectBody,
  toolAnnotations,
  withPages,
  type McpTool,
  type MemberRow,
} from '@smart-workplace/mcp-tools-shared';
import type { WorkplaceApiClient } from '../clients/workplace-api.js';
import { findThreadAttachmentMeta } from '../agent/attachment-source.js';
import { fileKind } from '../agent/attachment-presenter.js';
import { buildReadChatAttachmentTool } from './home-attachment-tool.js';
import { buildConversationSearchTool } from './conversation-search-tool.js';
import { buildMemorySearchTool, buildMemoryTools } from './memory-tools.js';
import { buildSharedMemoryTool } from './shared-memory-tool.js';

// sdk-mcp-server.ts / stdio-entry.ts 가 './tools.js' 에서 McpTool 을 계속 import 하므로 재-export 유지.
export type { McpTool };

/**
 * WP-348: AI Chat 에 싣지 않는 공유 도구 → 같은 작업을 하는 확인 카드. 외부 MCP 는 직접 실행 도구를, AI Chat 은 확인 카드를 쓴다
 * (경로마다 도구 하나 — WP-347). 둘은 참석자 해석·시간대 보정·충돌 계산을 공유 헬퍼로 같이 쓴다. sharedTool() 이 이 이름을 거부하고,
 * tools.test.ts 의 "공유 도구 전부 노출" 검사는 이 목록만 빼고 본다.
 * WP-349: 프로젝트 생성·멤버 추가·채널 초대도 같다 — 입력 스키마와 대상 구성원 판정(requireActiveMember)을 공유한다.
 */
export const CARD_ONLY_SHARED_TOOLS: Readonly<Record<string, readonly string[]>> = {
  create_event: ['propose_create_event'],
  update_event: ['propose_update_event', 'propose_add_attendees', 'propose_remove_attendee'],
  create_project: ['propose_create_project'],
  add_project_member: ['propose_add_project_member'],
  add_channel_member: ['propose_add_channel_member'],
};

/**
 * WP-377: AI Chat·서브에이전트 프로필에 싣지 않는 공유 도구. 외부 클라이언트(Claude Code·Cursor 등) 전용이다 —
 * 서버가 돌리는 AI 는 이슈 진행 기록(report_agent_work)을 남기지 않는다(스펙 §1 "하지 않는 것").
 * WP-373: get_issue_chat 도 같다 — 외부 AI 가 맡은 이슈에서 던진 질문의 답을 읽는 도구이고, 서버 AI 는 이슈 챗 스레드(chat 프로필)에서 직접 대화한다. 그래서 sharedTool() 이 이 이름을 거부하고,
 * tools.test.ts 의 "공유 도구 전부 노출" 검사도 이 목록만 빼고 본다. CARD_ONLY_SHARED_TOOLS 와 달리 대체 도구(확인 카드)는 없다.
 */
export const AI_AGENT_EXCLUDED_SHARED_TOOLS: ReadonlySet<string> = new Set(['report_agent_work', 'get_issue_chat']);

/**
 * WP-423: 에이전트 신원 프로필(messaging)에서 입력을 좁혀 싣는 공유 도구 — 도구 이름 → 뺀 입력 필드.
 * add_channel_message 의 첨부(fileIds·driveFileIds)는 요청자 신원(assistant)에만 싣는다 — 에이전트 신원 프로필의 기능 확대는
 * README WP-355 절이 보류한 제품 결정이고(upload_file 도 assistant 전용), 에이전트 신원으로는 드라이브 파일을 대신 링크할 수 없게 한다.
 * tools.test.ts 의 패리티 검사가 이 목록의 필드만 빠졌는지 확인한다.
 */
export const AGENT_IDENTITY_OMITTED_FIELDS: Readonly<Record<string, readonly string[]>> = {
  add_channel_message: ['fileIds', 'driveFileIds'],
};

const issueKey = z.object({ issueKey: z.string().min(1) });
// 6c: chat 프로필 도구 입력.
const addChatMessageInput = z.object({
  threadId: z.number().int().positive(),
  body: z.string().min(1),
});
const getChatThreadInput = z.object({
  threadId: z.number().int().positive(),
});

// WP-244: 이슈 챗 첨부 추출 텍스트 구간 읽기 입력 — 이슈 첨부·챗 메시지 첨부 모두 스레드 경유(threadId + fileId)로 읽는다.
// (예전 issueKey 분기는 실행 스레드에 묶을 수 없고 프롬프트도 더는 쓰지 않아 제거했다.)
// WP-346: offset/limit 범위·기본 길이는 공유 read_file·메인 채팅 read_chat_attachment 와 같은 정의(공유 attachment-read).
// 공유 read_file(source:'issue')로 대체하지 않는 이유: 이슈 챗에 멘션된 AGENT 는 프로젝트 비멤버라 이슈 첨부 API 가 403 이고,
// 챗 메시지 첨부는 이슈 첨부도 드라이브 파일도 아니다 — 스레드 경유만 둘 다 읽는다.
const readChatThreadAttachmentBase = z.object({
  fileId: z.number().int().positive(),
  threadId: z.number().int().positive(),
  ...readRangeShape,
});

// #833: 구성원 쓰기 제안 입력. roleId 대신 역할명을 받는다 — 실행기가 서버에서 이름→id 를 해석하므로
// 에이전트에 role:read 권한을 추가로 줄 필요가 없다.
const proposeSetMemberRoleInput = z.object({
  username: z.string().min(1),
  roles: z.array(z.enum(['ADMIN', 'USER'])).min(1),
  summary: z.string().min(1),
});
const proposeSetMemberActiveInput = z.object({
  username: z.string().min(1),
  active: z.boolean(),
  summary: z.string().min(1),
});
const proposeDeleteContactInput = z.object({ externalId: z.number().int().positive(), summary: z.string().min(1) });
// #839: 사용자 그룹 삭제 제안 — 하위 그룹·멤버십까지 캐스케이드, 복원 API 없음.
const proposeDeleteUserGroupInput = z.object({ groupId: z.number().int().positive(), summary: z.string().min(1) });

// #333 M3: 프로젝트 제안 입력. #846: 프로젝트는 조회 도구(get_project 등)와 같은 이름 projectKey 로 가리킨다.
// 실행기(ConfirmActionDispatcher)는 params.key 를 읽으므로 핸들러가 key 로 옮겨 담는다(toCreateProjectBody).
// WP-349: 필드는 외부 MCP create_project 와 같은 공유 스키마에 summary 만 더한다 — 형식 검사가 두 벌로 갈리지 않게.
const proposeCreateProjectInput = createProjectInput.extend({ summary: z.string().min(1) });
const proposeDeleteProjectInput = z.object({ projectKey: z.string().min(1), summary: z.string().min(1) });
// #833: 사람은 숫자 id 대신 username 으로 받는다. WP-349: 외부 MCP add_project_member 와 같은 공유 기반에 role·summary 를 더한다.
// role(OWNER 포함)은 카드에만 있다 — OWNER 부여는 권한 변경이라 확인 없는 직접 실행 도구는 MEMBER 로만 추가한다.
const proposeAddProjectMemberInput = addProjectMemberInput.extend({
  role: z.enum(['OWNER', 'MEMBER']),
  summary: z.string().min(1),
});

// #333 M4: 드라이브 삭제 제안 입력(폴더·파일 쓰기 도구는 공유 패키지 — create_drive_folder 등).
// #840: 파일 식별자는 driveFileId(= drive_file.id)로 명명한다. 목록 응답의 core fileId 와 혼동되지 않도록 도구 표면 전체에서 하나의 이름만 쓰고, 폴더는 folderId 로 통일한다.
const proposeDeleteFileInput = z.object({ summary: z.string().min(1), driveFileId: z.number().int().positive() });
const proposeDeleteFolderInput = z.object({ summary: z.string().min(1), folderId: z.number().int().positive() });

// #856: 파괴적이거나 다른 사람에게 영향이 나가는 작업의 확인 카드 제안 입력. 사람은 username, 대상은 조회 도구와 같은 이름
// (eventId·projectKey·issueKey·channelId·pageId·commentId)으로 받고, 실행기 키(id·key·number)로는 핸들러가 옮긴다.
const proposeAddAttendeesInput = z.object({
  eventId: z.number().int().positive(),
  attendees: z.array(z.string().min(1)).min(1), // 초대할 구성원 username
  summary: z.string().min(1),
});
const proposeRemoveAttendeeInput = z.object({
  eventId: z.number().int().positive(),
  username: z.string().min(1),
  summary: z.string().min(1),
});
const proposeUpdateProjectMemberRoleInput = z.object({
  projectKey: z.string().min(1),
  username: z.string().min(1),
  role: z.enum(['OWNER', 'MEMBER']),
  summary: z.string().min(1),
});
const proposeRemoveProjectMemberInput = z.object({
  projectKey: z.string().min(1),
  username: z.string().min(1),
  summary: z.string().min(1),
});
// WP-349: 외부 MCP add_channel_member 와 같은 공유 스키마에 summary 만 더한다.
const proposeAddChannelMemberInput = addChannelMemberInput.extend({ summary: z.string().min(1) });
const proposeLeaveChannelInput = z.object({ channelId: z.number().int().positive(), summary: z.string().min(1) });
const proposeDeleteIssueInput = z.object({ issueKey: z.string().min(1), summary: z.string().min(1) });
const proposeDeleteCommentInput = z.object({
  issueKey: z.string().min(1),
  commentId: z.number().int().positive(),
  summary: z.string().min(1),
});
const proposeDeleteWikiPageInput = z.object({ pageId: z.number().int().positive(), summary: z.string().min(1) });

// #333 M3: 메일 발송 제안 입력 — MailSendRequest 미러 + accountId(소유권 경계) + summary(카드 본문).
const proposeSendMailInput = z.object({
  accountId: z.number().int().positive(),
  to: z.array(z.string()).min(1),
  cc: z.array(z.string()).optional(),
  bcc: z.array(z.string()).optional(),
  subject: z.string().optional(),
  bodyText: z.string().optional(),
  bodyHtml: z.string().optional(),
  inReplyToMessageId: z.number().int().positive().optional(),
  summary: z.string().min(1),
});

// #333 M4: 일정 수정 제안 입력 — CalendarEventRequest 미러 + id/scope/occurrenceDate(경로/쿼리 상당) + summary.
// #852: attendees 제거 — 서버 일정 수정은 참석자를 바꾸지 않는다(로컬·외부 모두). 받아 두면 승인해도 반영되지 않는 거짓 약속이 된다.
// #846: 일정은 조회 도구(get_event·show_event)와 같은 이름 eventId 로 가리킨다. 실행기는 params.id 를 읽으므로 핸들러가 옮겨 담는다.
const proposeUpdateEventInput = z.object({
  summary: z.string().min(1),
  eventId: z.number().int().positive(),
  scope: z.enum(['THIS', 'THIS_AND_FOLLOWING', 'ALL']).default('ALL'),
  occurrenceDate: z.string().optional(), // ISO-8601, 반복 일정의 대상 회차
  title: z.string().min(1).max(200),
  description: z.string().optional(),
  startsAt: z.string(),
  endsAt: z.string(),
  allDay: z.boolean().optional(),
  location: z.string().max(200).optional(),
  color: z.string().max(32).optional(),
  reminderMinutes: z.number().int().min(0).optional(),
  recurrenceRule: z.string().max(500).optional(),
});
// #333 M4: 일정 삭제 제안 입력 — id + 반복 scope/occurrenceDate + summary.
const proposeDeleteEventInput = z.object({
  summary: z.string().min(1),
  eventId: z.number().int().positive(),
  scope: z.enum(['THIS', 'THIS_AND_FOLLOWING', 'ALL']).default('ALL'),
  occurrenceDate: z.string().optional(),
});

// #333 M2: 일정 생성 제안 입력 — CalendarEventRequest 와 1:1(서버 매핑 단순화) + summary(카드 본문).
// #852: attendees 는 초대할 구성원의 username 목록. 핸들러가 user id 로 해석해 attendeeUserIds 로 보낸다 —
//   이전에는 이메일을 받아 그대로 실었는데 서버는 attendeeUserIds 만 읽어 참석자가 조용히 버려졌다.
// #394: startsAt/endsAt 타임존 보정은 핸들러에서 normalizeTimezone 으로 처리(Zod transform 불가).
const proposeCreateEventInput = z.object({
  title: z.string().min(1).max(200),
  description: z.string().optional(),
  startsAt: z.string().min(1),   // ISO-8601, 핸들러에서 타임존 보정
  endsAt: z.string().min(1),
  allDay: z.boolean().default(false),
  location: z.string().max(200).optional(),
  reminderMinutes: z.number().int().min(0).optional(),
  recurrenceRule: z.string().max(500).optional(),
  attendees: z.array(z.string().min(1)).optional(), // #852: 초대할 구성원 username 목록(주최자 본인은 넣지 않는다)
  summary: z.string().min(1),    // 사람이 읽는 카드 요약
});

// 7b: home 컴포저 표시 지시 도구 — 모든 도구가 균일한 {params?, layout?} 봉투를 받는다.
// layout: 캔버스 배치 규칙(프론트 7c 가 해석). page/replace/pageLabel 모두 선택.
const layoutSchema = z
  .object({
    page: z.enum(['new', 'current']).optional(),
    replace: z.string().optional(),
    pageLabel: z.string().optional(),
  })
  .optional();
const showMyTasksInput = z.object({ params: z.object({}).optional(), layout: layoutSchema });
// #371/#846: show_issue_list(표시 지시)는 list_issues(데이터 조회, 공유)와 같은 필터 집합을 쓴다.
// WP-807: show_issue_list 의 status 는 웹을 거쳐 서버 status(범주만)로 그대로 가므로 상태 이름을 안내하지 않는다 — 공유 설명(범주 또는 이름)을 범주 전용으로 덮는다.
const showIssueListInput = z.object({
  params: z
    .object({ ...issueListFilterShape, status: z.string().optional().describe('CSV: TODO,IN_PROGRESS,DONE,CANCELED') })
    .optional(),
  layout: layoutSchema,
});
const showIssueDetailInput = z.object({
  params: z.object({ number: z.number().int().positive(), projectKey: z.string().optional() }),
  layout: layoutSchema,
});
const showActivityInput = z.object({
  params: z.object({ actorKind: z.enum(['HUMAN', 'AGENT']).optional() }).optional(),
  layout: layoutSchema,
});
// #431: 메일 목록 표시 지시 — 데이터(20행 표)를 LLM 이 토큰으로 생성하던 비용을 위젯 렌더로 대체.
// accountId 미지정 시 프론트가 기본 계정을 해석한다. folder 미지정 시 INBOX. limit 미지정 시 20.
const showMailListInput = z.object({
  params: z
    .object({
      accountId: z.number().int().positive().optional(),
      folder: z.string().optional(),
      query: z.string().optional(),
      // #469: true 면 안 읽은 메일만 표시. "안 읽은 메일" 목록 요청에 사용(query 검색어 대신).
      unreadOnly: z.boolean().optional(),
      limit: z.number().int().positive().optional(),
    })
    .optional(),
  layout: layoutSchema,
});

// #460 Layer2: 도메인 표시 위젯 입력 — 핸들러는 데이터를 반환하지 않으므로(displayed) 프론트가 params 로 fetch.
const showCalendarInput = z.object({
  params: z.object({ from: z.string().optional(), to: z.string().optional() }).optional(),
  layout: layoutSchema,
});
const showEventInput = z.object({
  params: z.object({ eventId: z.number().int().positive() }),
  layout: layoutSchema,
});
const showChannelsInput = z.object({ params: z.object({}).optional(), layout: layoutSchema });
const showWikiInput = z.object({
  params: z.object({ spaceId: z.number().int().positive().optional(), query: z.string().optional() }).optional(),
  layout: layoutSchema,
});
const showWikiPageInput = z.object({
  params: z.object({ pageId: z.number().int().positive() }),
  layout: layoutSchema,
});
const showContactsInput = z.object({
  params: z.object({
    search: z.string().optional(), type: z.string().optional(),
    org: z.string().optional(), title: z.string().optional(),
  }).optional(),
  layout: layoutSchema,
});
const showContactInput = z.object({
  // #840: 위젯은 외부 연락처 전용 — list_contacts 의 EXTERNAL 항목 externalId 와 같은 이름으로 받는다.
  params: z.object({ externalId: z.number().int().positive() }),
  layout: layoutSchema,
});
const showProjectsInput = z.object({ params: z.object({}).optional(), layout: layoutSchema });
const showProjectInput = z.object({
  params: z.object({ projectKey: z.string().min(1) }),
  layout: layoutSchema,
});
const showDriveInput = z.object({
  params: z.object({
    spaceId: z.number().int().positive().optional(),
    folderId: z.number().int().positive().optional(),
  }).optional(),
  layout: layoutSchema,
});

// #333: assistant 프로파일 추가 — 전 앱 도구 union(M1).
export type McpProfile = 'issue' | 'chat' | 'home' | 'messaging' | 'assistant';

/**
 * WP-351: AI Chat 라우터(assistant 프로필의 메인 스레드)가 모델에 싣는 도구 — 라우터가 직접 쓰는 것만 둔다.
 * assistant 프로필 MCP 서버는 서브에이전트와 함께 쓰므로 전 앱 도구 union 을 그대로 등록하고, 라우터만 이 목록으로 좁힌다
 * (Claude 경로의 메인 스레드 에이전트 tools). 쓰기·확인 카드(propose_*)·답 제출은 담당 서브에이전트에만 있다 —
 * 매 실행 싣는 도구 정의(토큰)를 줄이고, 라우터가 쓰기를 직접 하지 않고 위임하게 한다.
 * 포함: 프롬프트 표의 직접 읽기 도구, 표시 위젯(show_*), 알림(조회·읽음 처리 — 담당 서브에이전트가 없다), 첨부 읽기.
 * 메일 요약·답장/이슈 초안·계정 목록, 드라이브 휴지통은 읽기여도 프롬프트가 mail-agent·drive-agent 로 보내므로 두지 않는다.
 * subagent-loader.test.ts 가 이 목록 ⊂ assistant 프로필, 라우터 밖 도구는 어느 서브에이전트에든 있음을 고정한다.
 */
export const ASSISTANT_ROUTER_TOOLS: readonly string[] = [
  // 이슈
  'list_issues', 'get_issue_detail',
  // 노트
  'list_wiki_spaces', 'search_wiki', 'get_wiki_page', 'list_wiki_pages', 'list_wiki_backlinks',
  // 캘린더
  'list_events', 'get_event',
  // 메시징
  'list_channels', 'list_channel_messages', 'list_thread_replies',
  // 메일
  'list_mail', 'get_mail',
  // 연락처·사용자 그룹·구성원
  'list_contacts', 'get_external_contact', 'get_contact_facets', 'list_user_groups', 'get_user_group',
  'search_members', 'get_member', 'get_member_contact',
  // 프로젝트
  'list_projects', 'get_project',
  // 드라이브
  'list_drive_spaces', 'list_drive_items', 'search_drive', 'search_drive_content', 'get_drive_file_summary',
  // 알림 — 읽음 처리도 라우터가 직접 한다
  'list_notifications', 'mark_notification_read', 'mark_all_notifications_read',
  // 홈 현황(WP-357) — 우선순위·메일/메시징 요약·활동·스레드 인박스. 도메인 하나로 정해지지 않는 "오늘 뭐부터?" 질문을 라우터가 직접 읽는다(show_activity·show_my_tasks 는 화면 표시 전용)
  'get_home_overview',
  // 첨부 읽기 — 이 대화의 첨부(WP-234)·이슈 첨부/드라이브 파일 본문(WP-346)
  'read_chat_attachment', 'read_file',
  // WP-55: 메모리 저장·고치기·지우기, WP-386 공용 메모리 직접 요청 — "라우터는 쓰기 도구 없음" 규칙의 이름 붙은 예외(라우터가 직접 저장한다: 하위 에이전트는 이전 대화를 못 본다).
  // 하위 에이전트 frontmatter 에는 두지 않는다(subagent-loader.test.ts 가 고정).
  ...MEMORY_TOOL_NAMES,
  // WP-383·384: 메모리 찾기·지난 대화 찾기(읽기) — 하위 에이전트에는 두지 않는다(블록에도 "더 있음" 줄을 싣지 않는다, 판정 11).
  'search_memory', 'search_conversations',
  // 표시 위젯
  'show_my_tasks', 'show_issue_list', 'show_issue_detail', 'show_activity', 'show_mail_list',
  'show_calendar', 'show_event', 'show_channels', 'show_wiki', 'show_wiki_page',
  'show_contacts', 'show_contact', 'show_projects', 'show_project', 'show_drive',
];

/**
 * WP-351: 서브에이전트에 위임하는 Claude 실행에서 메인 스레드(라우터)가 싣는 도구 이름 — 지금은 assistant 만 좁힌다.
 * undefined 면 러너는 종전처럼 프로필 도구 전부를 메인 스레드에 싣는다.
 * opencode 는 쓰지 않는다 — primary 의 위임 도구(task)가 꺼져 있어 쓰기를 직접 해야 한다(opencode-config.ts 참고).
 */
export function routerToolsFor(profile: McpProfile | undefined): readonly string[] | undefined {
  return profile === 'assistant' ? ASSISTANT_ROUTER_TOOLS : undefined;
}

// #462 슬라이스4: 인-프로세스 호스트 브리지 — propose/submit_response/unassign_self 의
// 구조화 출력을 파일 사이드카(WORKPLACE_*_PATH) 대신 요청별 콜백으로 호스트에 직접 전달한다.
// (인-프로세스에선 process.env 가 전역 공유라 동시요청 경쟁 발생 → 콜백 클로저로 격리.)
export interface HostBridge {
  onProposal(p: { actionType: string; summary: string; params: Record<string, unknown> }): void;
  onSubmitResponse(text: string): void;
  onUnassignResult(r: { ok: boolean; canonical?: string }): void;
}

// L3 위임: 이슈 생성 제안 도구 입력 스키마.
// channelId·위임자·parent 는 코드가 env 에서 스탬프 — AI 입력에서 제외(가스라이팅 방지).
// projectKey: AI 가 위임 후보 목록에서 추론해 고름. 맞는 게 없으면 생략(백엔드 개인 작업 폴백).
const proposeCreateIssueInput = z.object({
  title: z.string().min(1).max(200),
  body: z.string().max(10000).optional(),
  priority: z.enum(['LOW', 'MID', 'HIGH']).optional(),
  projectKey: z.string().optional(),
});

// profile 기본값 'issue' — 이슈 핸들러는 기존 4 도구, chat 핸들러는 읽기+chat 쓰기 도구만.
export function buildTools(
  client: WorkplaceApiClient,
  agentId: number,
  profile: McpProfile = 'issue',
  // 스레드 mirror: 트리거가 스레드 안일 때 {channelId, parentMessageId}. 이 채널에 add_channel_message 하면
  // 그 스레드에 답이 들어간다(인라인 멘션이면 undefined — 현행 인라인 동작).
  threadBinding?: { channelId: number; parentMessageId: number },
  // L3 위임: 트리거 actor(위임자)+채널+(스레드)parent. 있으면 propose_create_issue 노출.
  delegationContext?: { actorId: number; channelId: number; parentMessageId?: number },
  // #462 슬라이스4: 인-프로세스 호스트 브리지. 지정 시 propose/submit/unassign 이 파일 대신 콜백 사용.
  hostBridge?: HostBridge,
  // WP-244: chat 프로필 실행이 답하는 이슈 챗 스레드. 지정 시 chat 도구는 이 스레드 외의 threadId 를 거부한다
  // (모델이 다른 스레드를 읽거나 거기에 쓰지 못하게). 미지정이면 기존 동작.
  chatThreadId?: number,
  // WP-234: 메인 AI 채팅 실행의 세션(home_session.id). assistant 의 read_chat_attachment 가 이 세션 첨부만 읽게 묶는다.
  // 미지정이면 도구는 있지만 호출 시 오류(메인 채팅 외 실행).
  homeSessionId?: string,
  // WP-250: 이미지 입력 — 모델이 이미지를 볼 수 있는지(기본 true). false 면 세 첨부 도구(공유 read_file, ai-agent 전용
  // read_chat_attachment·read_chat_thread_attachment) 모두 pages(PDF 쪽 이미지)를 스키마·설명에서 빼고 스캔 PDF 안내만 바꾼다.
  // 이미지 첨부는 imageInput 과 상관없이 이미지로 돌려준다(이미지를 볼 수 없는 opencode 모델이면 stdio 도구 등록이 결과 이미지를 안내 문구로 바꾼다, WP-241).
  imageInput = true,
): McpTool[] {
  // #846: 두 앱 공유 도구(이슈·프로젝트·노트·캘린더·메일·구성원·메시징·드라이브 읽기) — 프로필이 이름으로 골라 쓴다.
  // 같은 이름의 도구를 여기서 따로 정의하지 않는다(tools.test.ts 패리티 테스트가 강제) — 정의가 두 벌이면 파라미터가 어긋난다.
  const sc = client.toolClient(agentId);
  const shared = buildSharedTools(sc, {
    // 스레드 mirror: 바인딩된 트리거 채널에 한해 그 스레드 parent 로 답한다(다른 채널은 인라인).
    parentMessageIdFor: (channelId) =>
      threadBinding && threadBinding.channelId === channelId ? threadBinding.parentMessageId : undefined,
    imageInput,
    // WP-392: get_issue_chat 을 싣지 않으므로(AI_AGENT_EXCLUDED_SHARED_TOOLS) read_file 설명에서 issue_chat 안내도 뺀다.
    issueChatSource: !AI_AGENT_EXCLUDED_SHARED_TOOLS.has('get_issue_chat'),
    // WP-421 결정 8: upload_file 은 content 모드만 — 웹 AI Chat 사용자에게는 셸이 없어 업로드 링크를 쓸 수 없다(설명·거절은 공유본이 만든다).
    // 요청자 신원(assistant)에만 싣는다 — 에이전트 신원 프로필(issue·messaging·chat)의 기능 확대는 README WP-355 절이 보류한 제품 결정이다.
    allowUploadLink: false,
  });
  const sharedTool = (name: string): McpTool => {
    const t = shared.find((x) => x.name === name);
    if (!t) throw new Error(`공유 도구 없음: ${name}`);
    // #853: 되돌릴 수 없는 공유 도구를 직접 실행으로 노출하지 않는다 — 그런 작업은 propose_* 확인 카드로만 한다.
    if (t.kind === 'destructive') throw new Error(`destructive 공유 도구는 직접 노출할 수 없습니다: ${name}`);
    // WP-348: 확인 카드가 있는 작업의 직접 실행 도구는 AI Chat 에 싣지 않는다.
    if (name in CARD_ONLY_SHARED_TOOLS) throw new Error(`확인 카드로만 하는 공유 도구는 직접 노출할 수 없습니다: ${name}`);
    // WP-377: 외부 클라이언트 전용 도구(진행 보고)는 서버 AI 에 싣지 않는다.
    if (AI_AGENT_EXCLUDED_SHARED_TOOLS.has(name)) throw new Error(`외부 클라이언트 전용 공유 도구는 노출할 수 없습니다: ${name}`);
    // WP-342: 연산 성격 힌트를 실어 보낸다 — Claude Code 가 readOnlyHint 로 읽기 도구를 병렬 실행한다. 로컬 전용 도구는 힌트가 없다.
    return { ...t, annotations: toolAnnotations(t) };
  };

  // 일정 참석자 해석·충돌 조회 — 직접 실행 도구(create_event·update_event)와 같은 공유 헬퍼를 쓴다(WP-348, 두 경로 결과가 같다).
  // messaging 위임·assistant 공용이라 프로필 분기보다 먼저 이 실행의 클라이언트(sc)로 묶어 둔다.
  const resolveAttendees = (usernames: string[] | undefined, organizerId: number) =>
    resolveAttendeesShared(sc, usernames, organizerId);
  const listConflicts = (from: string, to: string) => listConflictsShared(sc, from, to);

  // #371: 이슈 목록 데이터 조회(공유본). ai-agent 에는 화면 표시 위젯(show_issue_list)이 있어 둘 중 고르는 기준을 덧붙인다.
  const listIssuesTool: McpTool = {
    ...sharedTool('list_issues'),
    description:
      '**네가 이슈 내용을 직접 읽고 분석/요약/판단해서 답해야 할 때만** 사용하세요(예: "이번 주 뭐부터 할까?", "내 업무량 어때?"). ' +
      '단순히 사용자가 목록을 "보고 싶어"하면(보여줘/찾아줘/뭐 있어/목록) 이 도구 대신 show_issue_list 로 화면에 표시하세요. ' +
      sharedTool('list_issues').description,
  };

  // WP-369 R6: 파일 올리기(공유본)의 AI Chat 판 — content 모드만 허용한다. 웹 AI Chat 사용자에게는 셸이 없어 업로드 링크(curl -T)를
  // 쓸 수 없고, 쓸 수 없는 로그인 없는 링크를 대화에 남길 이유도 없다. 입력 스키마는 공유본 그대로(패리티 테스트는 스키마만 비교한다),
  // content 가 없으면 새 파일(spaceId+name)이든 기존 파일의 새 버전(driveFileId)이든 API 를 부르지 않고 오류로 안내한다.
  // 설명은 한국어 머리말 + 공유 설명의 content 모드 부분만 쓴다 — 공유본의 링크·curl 안내는 여기서 쓸 수 없는 지시라 모델을 헷갈리게 하고 토큰만 든다.
  const sharedCreateDriveFile = sharedTool('create_drive_file');
  const createDriveFileTool: McpTool = {
    ...sharedCreateDriveFile,
    description:
      'AI Chat 에서는 content(직접 쓴 텍스트)로 새 파일을 만들거나 기존 텍스트 파일을 driveFileId+content 로 고칠 때만 쓰세요. 업로드 링크(content 생략)는 ' +
      '만들 수 없습니다 — 사용자의 로컬 파일은 웹 드라이브 화면에서 직접 올리라고 안내하세요. ' +
      CREATE_DRIVE_FILE_CONTENT_DESCRIPTION,
    async handler(args) {
      const content = (args as { content?: unknown } | null)?.content;
      if (content == null) {
        throw new Error(
          'AI Chat 에서는 업로드 링크를 만들 수 없습니다. 저장할 내용을 content 로 넘겨 파일을 만들거나 고치고, 로컬 파일은 웹 드라이브 화면에서 직접 올리라고 안내하세요.',
        );
      }
      return sharedCreateDriveFile.handler(args);
    },
  };

  if (profile === 'chat') {
    // #433: 단일 이벤트 처리 중 add_chat_message 중복 호출 방지.
    // buildTools 클로저가 run 단위로 격리돼야 성립한다 — Claude 는 실행마다 인-프로세스 서버를 새로 만들고,
    // opencode 는 chat 프로필을 웜 풀에서 빼 실행마다 stdio MCP 프로세스를 새로 띄운다(WP-244, opencode-runner.ts).
    // 시스템 프롬프트 지시를 AI가 무시하는 비결정적 동작을 코드 레벨에서 결정론적으로 차단한다.
    let addChatMessageCalled = false;
    // WP-250: 첨부 읽기 입력 — 이미지를 볼 수 있는 모델에만 pages 를 싣는다.
    const threadAttachmentInput = withPages(readChatThreadAttachmentBase, imageInput);
    // WP-244: 실행 스레드 바인딩 — 다른 threadId 는 API 호출 전에 거부한다.
    const assertBoundThread = (threadId: number): void => {
      if (chatThreadId != null && threadId !== chatThreadId) {
        throw new Error(`이 대화(threadId ${chatThreadId})의 스레드만 사용할 수 있습니다. 받은 threadId: ${threadId}`);
      }
    };
    return [
      sharedTool('get_issue_detail'),
      sharedTool('list_wiki_spaces'),
      sharedTool('search_wiki'),
      sharedTool('get_wiki_page'),
      {
        name: 'list_chat_messages',
        description: '현재 chat thread 의 최근 메시지 목록을 JSON 으로 반환합니다(과거 흐름 확인용).',
        inputSchema: getChatThreadInput,
        async handler(args) {
          const { threadId } = getChatThreadInput.parse(args);
          assertBoundThread(threadId);
          // authorId(숫자 사용자 ID)는 내보내지 않는다(#833, WP-353) — "이미 답했나" 검사(run-chat-agent)는 client.getChatMessages 를 직접 읽어 이 출력과 무관하다.
          return JSON.stringify((await client.getChatMessages(agentId, threadId, 50)).map(({ authorId: _authorId, ...m }) => m));
        },
      },
      {
        // WP-346: 옛 이름 read_attachment_text — 공유 read_file 과 헷갈리지 않게 범위(이슈 챗 스레드)를 이름에 드러냈다.
        name: 'read_chat_thread_attachment',
        description:
          '이 이슈 챗 스레드의 첨부파일 추출 텍스트를 구간 단위로 읽습니다. 프롬프트 첨부 섹션에 적힌 그대로 threadId 와 fileId 로 호출하세요(이슈 첨부·챗 첨부 공통). ' +
          `limit 생략 시 ${READ_ATTACHMENT_DEFAULT_LIMIT}자(최대 32000). 필요한 만큼만 읽고, 결과의 nextOffset 이 있으면 offset 으로 넘겨 이어 읽습니다. ` +
          'status 가 READY 가 아니면 text 없이 상태·사유만 옵니다. 이미지 파일은 이미지로 돌려줍니다.' +
          (imageInput ? ` ${PAGES_DESCRIPTION}` : ''),
        inputSchema: threadAttachmentInput,
        async handler(args) {
          const parsed = threadAttachmentInput.parse(args) as z.infer<typeof readChatThreadAttachmentBase> & { pages?: number[] | null };
          const { threadId, fileId } = parsed;
          assertBoundThread(threadId);
          if (parsed.pages) {
            // 쪽 이미지 — 서버(/view)가 같은 가드로 PDF 인지·쪽 범위를 확인하고, 오류 사유는 pageBlocks 가 한국어로 돌려준다(메타 조회 불필요).
            return pageBlocks(
              `스레드 첨부(fileId ${fileId})`,
              parsed.pages,
              (n) => client.viewChatAttachment(agentId, threadId, fileId, n),
            );
          }
          const { offset, limit } = resolveRange(parsed);
          const slice = await client.readChatAttachmentText(agentId, threadId, fileId, offset, limit);
          // 글자 먼저 — 문서는 이 한 번으로 끝나 목록 조회가 없다. 이미지는 원본이 아니라 늘 서버 변환본(/view)이다(이유는 imageViewBlocks).
          // 서버가 이미지로 건너뛴 파일(SKIPPED·IMAGE)은 바로 변환본을 준다. 추출 행이 없는 파일(NONE, 배포 전 업로드·HEIC 등)은 이미지가 아닐 수도
          // (PDF·문서) 있어 메타로 형식을 확인한다 — /view 로 바로 가면 문서는 형식 거절 사유만 받고 NONE 상태 안내를 잃는다.
          const view = () => client.viewChatAttachment(agentId, threadId, fileId);
          const imageLabel = `스레드 첨부 이미지(fileId ${fileId})`;
          if (isImageSkip(slice)) return imageViewBlocks(imageLabel, view);
          if (slice.status === 'NONE') {
            const meta = await findThreadAttachmentMeta(client, agentId, threadId, fileId);
            // 메타를 못 찾았어도(이슈 첨부 목록 403·삭제된 메시지·조회 창 밖) /view 는 messageId 없이 서버가 같은 가드로 풀어 주므로 변환본을 준다
            // (이미지가 아니면 서버가 거절하고 그 사유를 text 로 준다).
            if (!meta || fileKind(meta.mimeType) === 'image') return imageViewBlocks(imageLabel, view);
          }
          const note = pdfNote(slice, imageInput);
          return JSON.stringify(note ? { ...slice, note } : slice);
        },
      },
      {
        name: 'add_chat_message',
        description:
          'chat thread 에 답변 메시지를 작성합니다. 본문은 마크다운 지원. 정확히 한 번만 호출하세요.',
        inputSchema: addChatMessageInput,
        async handler(args) {
          // 다른 스레드로의 답변은 1회 가드를 소모하기 전에 거부한다(올바른 스레드로 다시 부를 수 있게).
          const { threadId, body } = addChatMessageInput.parse(args);
          assertBoundThread(threadId);
          // #433: 2번째 이후 호출 차단 — 중복 응답 방지.
          if (addChatMessageCalled) {
            console.error('[mcp:add_chat_message] 중복 호출 감지 — 차단됨 (threadId 참고: args)');
            return '이미 이 요청에 대한 답변을 등록했습니다. 추가 호출은 무시됩니다.';
          }
          addChatMessageCalled = true;
          await client.addChatMessage(agentId, threadId, body);
          return 'ok';
        },
      },
    ];
  }

  if (profile === 'messaging') {
    // WP-423: 에이전트 신원으로 쓰는 add_channel_message 는 첨부 없이 — 입력 스키마에서 fileIds·driveFileIds 를 빼고(모델에 보이지 않게),
    // 핸들러도 그 값을 버린 뒤 공유본에 넘긴다(스키마 밖 값이 들어와도 붙지 않게). 설명의 첨부 안내도 뺀다.
    const sharedAddMessage = sharedTool('add_channel_message');
    const omitted = new Set(AGENT_IDENTITY_OMITTED_FIELDS.add_channel_message);
    const addMessageShape = Object.fromEntries(
      Object.entries((sharedAddMessage.inputSchema as z.ZodObject<z.ZodRawShape>).shape).filter(([k]) => !omitted.has(k)),
    );
    const addChannelMessageTool: McpTool = {
      ...sharedAddMessage,
      description: ADD_CHANNEL_MESSAGE_DESCRIPTION,
      inputSchema: z.object(addMessageShape),
      async handler(args) {
        const rest = Object.fromEntries(Object.entries((args ?? {}) as Record<string, unknown>).filter(([k]) => !omitted.has(k)));
        // 첨부가 없으니 본문이 있어야 한다 — 공유본의 "본문이나 첨부" 문구 대신 이 프로필에 맞는 문구로 거절한다.
        if (typeof rest.body !== 'string' || !rest.body.trim()) throw new Error('보낼 본문(body)이 비어 있습니다.');
        return sharedAddMessage.handler(rest);
      },
    };
    const tools: McpTool[] = [
      sharedTool('list_channel_messages'),
      sharedTool('list_thread_replies'), // #850: 스레드 답글 조회(스레드 요약)
      addChannelMessageTool,
      sharedTool('list_channels'), // #350: 채널 목록·탐색(q — 이름 → channelId)
    ];
    // L3 위임: 위임 컨텍스트가 있을 때만 노출. channelId·위임자·parent 는 코드가 스탬프(AI 입력 아님).
    if (delegationContext) {
      const dc = delegationContext;
      // #852: 일정 제안의 참석자는 username 으로 지칭한다 — 대화 속 이름을 username 으로 바꿀 조회 수단.
      tools.push(sharedTool('search_members'));
      let proposed = false;
      tools.push({
        name: 'propose_create_issue',
        description:
          '사용자가 무언가를 이슈로 만들어 당신에게 맡기려 할 때(위임) 호출합니다. 이슈 생성 "제안 카드"를 그 자리에 올립니다(실제 생성은 위임자의 승인 후). title·body·priority 만 정하세요 — 프로젝트·담당·위치는 시스템이 정합니다. 호출 시 add_channel_message 는 호출하지 마세요(제안 카드가 곧 응답).',
        inputSchema: proposeCreateIssueInput,
        async handler(args) {
          // guard: 이미 성공적으로 제안을 등록한 경우 재호출 차단.
          if (proposed) return '이미 이 요청에 대한 제안을 등록했습니다.';
          const { title, body, priority, projectKey } = proposeCreateIssueInput.parse(args);
          try {
            await client.proposeCreateIssue(agentId, dc.channelId, {
              title, body, priority,
              proposedByUserId: dc.actorId,
              parentMessageId: dc.parentMessageId,
              // L3 위임: AI 가 후보 목록에서 추론한 projectKey. 없으면 백엔드 개인 작업 폴백.
              projectKey,
            });
          } catch (e) {
            // 실패 시 guard 를 세우지 않아 재시도 가능. 채팅에 읽을 수 있는 오류 반환.
            return `이슈 제안 등록에 실패했습니다: ${e instanceof Error ? e.message : String(e)}`;
          }
          // await 성공 후에만 guard 설정 — 실패 시 재시도 허용.
          proposed = true;
          return '제안 카드를 올렸습니다. 위임자의 승인을 기다립니다.';
        },
      });

      // L3 위임(일정): 대화에서 일정을 추출해 제안 카드를 올린다. 위치·위임자는 코드가 스탬프(AI 입력 아님).
      // 충돌 검사는 핸들러가 listEvents 로 결정적으로 수행(모델 의존 금지). 사이드카가 아니라 message_action_proposal 행을 만든다.
      let eventProposed = false;
      tools.push({
        name: 'propose_create_event',
        description:
          '사용자가 대화 내용을 일정으로 잡아달라고 할 때 호출합니다. 일정 생성 "확인 카드"를 그 자리에 올립니다(실제 생성은 위임자 승인 후). title·startsAt·endsAt(타임존 오프셋 포함 ISO-8601, 예: 2026-06-20T14:00:00+09:00)을 채우고, 필요하면 location/reminderMinutes 를 넣으세요. 함께 초대할 사람이 있으면 attendees 에 그 구성원의 username 을 넣으세요(모르면 search_members 로 확인, 위임자 본인은 넣지 않음). 위치·위임자는 시스템이 정합니다. 호출 시 add_channel_message 는 호출하지 마세요(카드가 곧 응답).',
        inputSchema: proposeCreateEventInput,
        async handler(args) {
          if (eventProposed) return '이미 이 요청에 대한 일정 제안을 등록했습니다.';
          const { summary: _summary, attendees, ...params } = proposeCreateEventInput.parse(args);
          // #852: 참석자 username → user id. 확정 못 하면 카드를 만들지 않고 교정 가능한 사유를 돌려준다.
          const resolved = await resolveAttendees(attendees, dc.actorId);
          if ('error' in resolved) return resolved.error;
          // 타임존 보정(+09:00) — naive datetime 방어.
          const startsAt = normalizeTimezone(params.startsAt as string);
          const endsAt = normalizeTimezone(params.endsAt as string);
          // 결정적 충돌 계산 — listEvents 결과를 그대로 충돌로 본다(fail-open).
          let conflicts:
            | { id: number; title: string; startsAt: string; endsAt: string }[]
            | undefined;
          try {
            const overlapping = await listConflicts(startsAt, endsAt);
            if (overlapping.length > 0) conflicts = overlapping;
          } catch {
            // fail-open: 충돌 조회 실패는 무시.
          }
          try {
            await client.proposeCreateEvent(agentId, dc.channelId, {
              title: params.title,
              startsAt,
              endsAt,
              allDay: params.allDay,
              location: params.location,
              reminderMinutes: params.reminderMinutes,
              recurrenceRule: params.recurrenceRule,
              conflicts,
              attendeeUserIds: resolved.ids,
              proposedByUserId: dc.actorId,
              parentMessageId: dc.parentMessageId,
            });
          } catch (e) {
            // POST 실패 시 guard 미설정 — 재시도 허용. 채팅에 읽을 수 있는 오류 반환.
            return `일정 제안 등록에 실패했습니다: ${e instanceof Error ? e.message : String(e)}`;
          }
          // await 성공 후에만 guard 설정 — 실패 시 재시도 허용.
          eventProposed = true;
          return '일정 제안 카드를 올렸습니다. 위임자의 승인을 기다립니다.';
        },
      });
    }
    return tools;
  }

  // 7b: home 표시 지시 도구(데이터 조회 X). home/assistant 프로파일이 공유한다.
  // 핸들러는 모두 {displayed:true} — 실제 렌더링은 프론트엔드가 담당.
  // 화면 표시 도구는 show_* 이름을 지킨다 — opencode 러너가 이 접두로 '결과 없이 답을 쓰는 도구'를 가려 진행 서술 필터에서 뺀다(WP-263, propose_* 도 같다).
  const buildShowTools = (): McpTool[] => {
    const displayed = async () => JSON.stringify({ displayed: true });
    return [
      {
        name: 'show_my_tasks',
        description: '사용자의 할 일 요약 카드(담당/워치)를 화면에 표시합니다.',
        inputSchema: showMyTasksInput,
        handler: displayed,
      },
      {
        name: 'show_issue_list',
        description:
          '필터(params)에 맞는 이슈 목록을 화면에 카드로 표시합니다. **사용자가 이슈 목록을 보고 싶어할 때의 기본 도구**입니다("내 이슈 보여줘", "급한 거 뭐 있어", "이번 주 마감 이슈", "담당자 없는 이슈"). 건수·마감 초과 집계는 화면이 자동 계산하므로 너는 건수를 직접 세지 말고 표시만 하면 됩니다. assignee="me" 내 담당, assignee="null" 담당 없음, reporter="me" 내가 만든, 다른 사람은 username, projectKey 로 프로젝트 한정, label·type 은 이름, priority/status/dueFrom/dueTo/blocked 등으로 좁힙니다.',
        inputSchema: showIssueListInput,
        handler: displayed,
      },
      {
        name: 'show_issue_detail',
        description: '단일 이슈 상세(번호 지정)를 화면에 표시합니다.',
        inputSchema: showIssueDetailInput,
        handler: displayed,
      },
      {
        name: 'show_activity',
        description: '최근 활동 피드를 표시합니다. actorKind="AGENT" 면 AI 가 한 일만 봅니다.',
        inputSchema: showActivityInput,
        handler: displayed,
      },
      {
        // #431: 메일 목록 단순 조회는 mail-agent 위임(표 텍스트 생성, 느림) 대신 이 위젯으로 직접 표시.
        name: 'show_mail_list',
        description:
          '받은편지함 등 메일 목록을 화면에 표시합니다. folder(기본 INBOX)·query·limit(기본 20)로 좁힙니다. 안 읽은 메일만 표시하려면 query 에 "is:unread" 같은 검색어를 쓰지 말고 params.unreadOnly:true 를 사용하세요. 단순 목록 조회 전용 — 요약·검색·발송·특정 메일 작업은 mail-agent 에 위임하세요.',
        inputSchema: showMailListInput,
        handler: displayed,
      },
    ];
  };

  // 이슈 쓰기 도구(add_comment/update_comment/create_issue/update_issue/add_issue_dependency/remove_issue_dependency)는 공유본(sharedTool)이다.
  // 상태 변경은 update_issue 의 status 로 한다(update_status 도구는 WP-343 에서 폐지).
  // #378: unassign_self 실패 시 고정 안내 문구를 반환해 LLM 재해석을 차단한다.
  // 동시에 WORKPLACE_UNASSIGN_ERROR_PATH 사이드카에 오류를 기록해,
  // run-ai-compose 가 최종 메시지를 결정론적으로 override 한다(이중 방어).
  // raw HTTP 오류 코드(예: "status code 405")를 사용자에게 노출하지 않도록
  // canonical 메시지에는 err 를 포함하지 않고 사이드카의 error 필드에만 남긴다.
  const UNASSIGN_CANONICAL = () =>
    '담당자 해제 요청을 처리하지 못했습니다. 이슈 화면에서 직접 변경해주세요.';
  const unassignSelfTool: McpTool = {
    name: 'unassign_self',
    description: '자기 자신을 이슈 담당자에서 제외합니다. 작업 완료·반려 시 사용합니다.',
    inputSchema: issueKey,
    async handler(args) {
      const { issueKey: k } = issueKey.parse(args);
      try {
        await client.unassignSelf(agentId, k);
        // #462 슬라이스4: 브리지 우선 — 성공 통지.
        if (hostBridge) {
          hostBridge.onUnassignResult({ ok: true });
          return 'ok';
        }
        // 폴백(stdio MCP 경로): 성공 사이드카 기록.
        const successPath = process.env.WORKPLACE_UNASSIGN_SUCCESS_PATH;
        if (successPath) {
          const { writeFileSync } = await import('node:fs');
          try {
            writeFileSync(successPath, JSON.stringify({ issueKey: k }), 'utf8');
          } catch {
            // 사이드카 쓰기 실패 — 무시(기능에는 영향 없음)
          }
        }
        return 'ok';
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        const canonical = UNASSIGN_CANONICAL();
        // #462 슬라이스4: 브리지 우선 — 실패 통지(canonical 동봉).
        if (hostBridge) {
          hostBridge.onUnassignResult({ ok: false, canonical });
          return canonical;
        }
        // 폴백(stdio MCP 경로): 에러 사이드카 기록.
        const sidecarPath = process.env.WORKPLACE_UNASSIGN_ERROR_PATH;
        if (sidecarPath) {
          const { writeFileSync } = await import('node:fs');
          try {
            writeFileSync(sidecarPath, JSON.stringify({ error: errMsg, canonical }), 'utf8');
          } catch {
            // 사이드카 쓰기 실패 — 무시(2차 방어선인 도구 반환 문구로 커버)
          }
        }
        return canonical;
      }
    },
  };

  // 7b: home 컴포저 — 표시 지시만(데이터 조회 X).
  if (profile === 'home') {
    return buildShowTools();
  }

  // #351: propose 공통 — 사이드카에 제안을 NDJSON(줄당 1제안)으로 append.
  // 한 서브에이전트가 동종 비가역 작업을 여러 건 제안하면 run-ai-compose 가 줄 단위로 읽어
  // pending_action 배열로 발행한다. (이전 #333 M4 단일-제안 하드가드는 #351 로 제거.)
  async function writeProposal(
    actionType: string,
    summary: string,
    params: Record<string, unknown>,
  ): Promise<string> {
    // #842: 카드 등록 전 서버 사전검증(dry-run) — 승인 시점과 같은 권한·매핑·도메인 검증을 미리 돌린다.
    try {
      await client.validateAction(agentId, actionType, params);
    } catch (err) {
      // 4xx = 파라미터·권한 문제 → 그대로 전파한다. 도구 에러로 변환되며 message 에 서버 사유가 담겨 있어
      // LLM 이 스스로 교정할 수 있다(자체 문구로 바꾸면 사유가 사라진다 — #840 교훈).
      // 응답 없음(네트워크·타임아웃)·5xx 는 LLM 이 고칠 수 없는 일시 장애라 카드 생성을 막지 않는다(fail-open,
      // 승인 시점에 서버가 다시 검증한다). 충돌 조회(listEvents)의 fail-open 과 같은 원칙.
      const status = (err as { response?: { status?: number } }).response?.status;
      if (status !== undefined && status >= 400 && status < 500) throw err;
    }
    // #462 슬라이스4: 브리지가 있으면 호스트 콜백으로 제안 전달(인-프로세스 — 파일 IPC 불필요).
    if (hostBridge) {
      hostBridge.onProposal({ actionType, summary, params });
      return '제안을 등록했습니다. 사용자 확인을 기다립니다.';
    }
    // 폴백(CLI stdio MCP 경로 — 슬라이스 5 까지 잔존): env 사이드카 NDJSON append.
    const sidecarPath = process.env.WORKPLACE_PENDING_ACTION_PATH;
    if (!sidecarPath) {
      return '확인 플로우가 설정되지 않아 제안을 등록하지 못했습니다.';
    }
    const { appendFileSync } = await import('node:fs');
    // NDJSON: 한 줄당 제안 1건. MCP 서버는 단일 stdio 프로세스·순차 도구호출이라 append 경쟁 없음.
    appendFileSync(sidecarPath, JSON.stringify({ actionType, summary, params }) + '\n', 'utf8');
    return '제안을 등록했습니다. 사용자 확인을 기다립니다.';
  }

  // #333 M2: 일정 생성 제안 도구 — 실행하지 않고(사전검증만, #842) 사이드카에 제안 객체를 쓰고 ack 반환.
  // #852: attendees(username) 는 resolveAttendees 로 attendeeUserIds 가 되어 서버에 전달된다.
  // #394: startsAt/endsAt 타임존 보정 — 핸들러에서 normalizeTimezone 으로 처리.
  // #395: 새 일정 시간대 충돌을 서버에서 결정론적으로 확인한다. agent.md 는 propose 전 list_events 를
  //       MUST 로 규정하지만 모델이 비결정적으로 그 단계를 건너뛰는 회귀가 반복되므로, 핸들러가
  //       스스로 listEvents 로 겹치는 일정을 조회해 제안에 embed 한다(모델 호출에 의존하지 않음).
  const proposeCreateEventTool: McpTool = {
    name: 'propose_create_event',
    description:
      '일정 생성을 제안합니다. 직접 생성하지 않고 사용자 확인 카드용 제안만 만듭니다. summary 에 사람이 읽을 한 줄 요약(일시·제목)을 넣으세요. 함께 초대할 사람이 있으면 attendees 에 그 구성원의 username 목록을 넣으세요(search_members 로 확인, 요청자 본인은 넣지 않음, 외부 이메일은 지원하지 않음). startsAt/endsAt 은 반드시 타임존 오프셋 포함 ISO-8601(예: 2026-06-20T14:00:00+09:00)로 채우세요. 승인 시 서버가 실제로 생성합니다.',
    inputSchema: proposeCreateEventInput,
    async handler(args) {
      const { summary, attendees, ...params } = proposeCreateEventInput.parse(args);
      // #852: 참석자 username → user id. 서버(CalendarEventRequest)는 attendeeUserIds 만 읽는다.
      // AI Chat 은 요청자 신원(agentId=onBehalfOf)으로 도구를 부르므로 agentId 가 곧 주최자다.
      const resolved = await resolveAttendees(attendees, agentId);
      if ('error' in resolved) return resolved.error;
      // #394: startsAt/endsAt 에 타임존 오프셋이 없으면 +09:00 보정.
      params.startsAt = normalizeTimezone(params.startsAt as string);
      params.endsAt = normalizeTimezone(params.endsAt as string);

      // #395: 보정된 시간대 [startsAt, endsAt) 에 겹치는 기존 일정을 서버에서 조회한다.
      //       listEvents 는 [from,to) 기간 일정을 반환하므로(=window 와 겹치는 일정), 반환 목록을
      //       그대로 충돌로 본다. 조회 실패(네트워크/권한 등)는 fail-open — 충돌확인 실패가 제안 자체를
      //       막으면 안 되므로 try/catch 로 감싸고 실패 시 conflicts 없이 정상 진행한다.
      // params 는 zod 추론 타입이라 index signature 가 없어 새 키(conflicts) 할당이 타입 에러가 된다.
      // 충돌을 담을 수 있도록 Record 로 복사해 제안 params 를 구성한다.
      // 확인 카드는 summary 만 보여주므로, 누구를 초대하는지 모델 문구에 맡기지 않고 확정된 이름을 덧붙인다(#852).
      let finalSummary = resolved.ids ? `${summary}\n참석자: ${resolved.names.join(', ')}` : summary;
      const proposalParams: Record<string, unknown> = { ...params, attendeeUserIds: resolved.ids };
      try {
        const overlapping = await listConflicts(params.startsAt as string, params.endsAt as string);
        if (overlapping.length > 0) {
          // 충돌 정보를 제안 params 에 구조화해 담는다(확인 실행기/카드가 활용).
          proposalParams.conflicts = overlapping;
          // summary 에 충돌 경고 한 줄을 덧붙인다 — 사용자 확인 카드에 노출되는 것은 summary 이므로
          // 카드에서 충돌을 알 수 있게 하려면 (ack 가 아니라) summary 에 넣어야 한다.
          const titles = overlapping.map((e) => e.title).join(', ');
          finalSummary = `${summary}\n[충돌] 같은 시간대에 기존 일정 ${overlapping.length}건이 있습니다: ${titles}`;
        }
      } catch {
        // fail-open: 충돌 조회 실패는 무시하고 충돌 정보 없이 제안을 진행한다.
      }

      return await writeProposal('calendar.create_event', finalSummary, proposalParams);
    },
  };

  // #333 M4: 일정 수정 제안 도구 — 실행하지 않고(사전검증만, #842) 사이드카에 수정 제안을 쓰고 ack 반환.
  // scope: THIS=이 회차, THIS_AND_FOLLOWING=이후 전체, ALL=시리즈 전체. occurrenceDate=대상 회차 시작시각.
  // #397/#842: 존재 여부는 writeProposal 의 서버 사전검증이 확인한다 — haiku 환각(no tool call, "not found") 차단은
  //   유지하면서, 읽기전용 캘린더(409) 같은 다른 실패 사유도 뭉개지 않고 그대로 LLM 에 전달된다.
  const proposeUpdateEventTool: McpTool = {
    name: 'propose_update_event',
    description:
      '일정 수정을 제안합니다. 직접 수정하지 않고 사용자 확인 카드용 제안만 만듭니다. summary 에 사람이 읽을 한 줄 요약을 넣으세요. 참석자 추가·제거는 이 도구가 아니라 propose_add_attendees / propose_remove_attendee 로 제안하세요(이 도구는 제목·시간·장소 등 일정 필드만 수정). 반복 일정은 scope 로 범위를 지정합니다(THIS=이 회차, THIS_AND_FOLLOWING=이후 전체, ALL=시리즈 전체). occurrenceDate 는 대상 회차 시작시각(ISO-8601). 승인 시 서버가 실제로 수정합니다.',
    inputSchema: proposeUpdateEventInput,
    async handler(args) {
      const { summary, eventId, ...params } = proposeUpdateEventInput.parse(args);
      return await writeProposal('calendar.update_event', summary, { id: eventId, ...params });
    },
  };

  // #333 M4: 일정 삭제 제안 도구 — 실행하지 않고(사전검증만, #842) 사이드카에 삭제 제안을 쓰고 ack 반환.
  // scope/occurrenceDate 는 수정 제안과 동일 의미. 승인 시 서버가 실제로 삭제합니다.
  // #397/#842: 존재 여부 확인은 writeProposal 의 서버 사전검증이 담당(위 수정 제안과 동일).
  const proposeDeleteEventTool: McpTool = {
    name: 'propose_delete_event',
    description:
      '일정 삭제를 제안합니다. 직접 삭제하지 않고 사용자 확인 카드용 제안만 만듭니다. summary 에 사람이 읽을 한 줄 요약을 넣으세요. 반복 일정은 scope 로 범위를 지정합니다(THIS=이 회차, THIS_AND_FOLLOWING=이후 전체, ALL=시리즈 전체). occurrenceDate 는 대상 회차 시작시각(ISO-8601). 승인 시 서버가 실제로 삭제합니다.',
    inputSchema: proposeDeleteEventInput,
    async handler(args) {
      const { summary, eventId, ...params } = proposeDeleteEventInput.parse(args);
      return await writeProposal('calendar.delete_event', summary, { id: eventId, ...params });
    },
  };

  // #333 M3: 위키 쓰기 도구 — 스페이스 멤버십 가드는 서버가 강제하므로 propose/confirm 없이 직접 노출.

  // #333 M3: 메일 읽기 도구 — assistant 프로파일 전용.
  // #333 M3: 메일 발송 제안 도구 — propose_create_event 미러. 실행하지 않고(사전검증만, #842) 사이드카에 제안 기록 후 ack 반환.
  const proposeSendMailTool: McpTool = {
    name: 'propose_send_mail',
    description:
      '메일 발송을 제안합니다. 직접 발송하지 않고 사용자 확인 카드용 제안만 만듭니다. summary 에 사람이 읽을 한 줄 요약(수신자·제목)을 넣으세요. accountId 는 발신 계정(본인 소유)입니다. 승인 시 서버가 실제로 발송합니다.',
    inputSchema: proposeSendMailInput,
    async handler(args) {
      const { summary, ...params } = proposeSendMailInput.parse(args);
      return await writeProposal('mail.send', summary, params);
    },
  };

  /**
   * 제안 도구 공용 — 대상 구성원을 확정하거나 에이전트가 바로 교정할 수 있는 오류 문구를 돌려준다(#833).
   * 판정·문구는 공유 헬퍼(requireMember·requireActiveMember)라 외부 MCP 직접 실행 도구(add_project_member·add_channel_member)와
   * 같다(WP-349). 카드는 문구를 결과로 돌려주고, 직접 실행 도구는 같은 문구로 throw 한다.
   */
  const requireMemberFor = async (username: string): Promise<{ member?: MemberRow; error?: string }> =>
    requireMember(sc, username);
  /** username → 활성 구성원. 없거나 비활성이면 에이전트가 고칠 수 있는 오류 문구. */
  const requireActiveMember = async (username: string): Promise<{ member?: MemberRow; error?: string }> =>
    requireActiveMemberShared(sc, username);

  // #333 M3: 외부 연락처 삭제는 제안(생성·수정은 공유 도구 create_external_contact·update_external_contact 로 직접 실행) — assistant 프로파일 전용.
  const proposeDeleteContactTool: McpTool = {
    name: 'propose_delete_contact',
    description:
      '외부 연락처 삭제를 제안합니다. 직접 삭제하지 않고 확인 카드용 제안만 만듭니다. summary 에 어떤 연락처를 지우는지 한 줄로 넣으세요. 승인 시 서버가 삭제합니다. ' +
      'externalId 는 list_contacts 의 EXTERNAL 항목이 주는 값입니다 — 구성원(MEMBER) 항목에는 없으며, 추측한 숫자를 넣으면 엉뚱한 사람의 연락처가 지워집니다.',
    inputSchema: proposeDeleteContactInput,
    async handler(args) {
      const { summary, externalId } = proposeDeleteContactInput.parse(args);
      // 실행기(contacts.delete_contact)는 params.id 를 읽는다 — 도구 표면만 externalId 로 명시하고 여기서 매핑.
      return await writeProposal('contacts.delete_contact', summary, { id: externalId });
    },
  };
  // #839: 사용자 그룹 삭제는 하위 그룹·멤버십까지 캐스케이드되고 복원 API 가 없다 — 직접 도구 없이 확인 카드로만.
  const proposeDeleteUserGroupTool: McpTool = {
    name: 'propose_delete_user_group',
    description:
      '사용자 그룹 삭제를 제안합니다. 직접 삭제하지 않고 확인 카드용 제안만 만듭니다. 하위 그룹과 그룹 멤버십도 함께 사라집니다(사람·연락처 자체는 유지). ' +
      'summary 에 어떤 그룹을 지우는지(하위 그룹이 있으면 그 사실도) 한 줄로 넣으세요. groupId 는 list_user_groups 로 확보합니다. ' +
      '개인 그룹은 소유자만, 공유 조직도 그룹은 조직도 관리 권한이 있어야 하며, 권한이 없으면 제안 단계에서 거절됩니다.',
    inputSchema: proposeDeleteUserGroupInput,
    async handler(args) {
      const { summary, groupId } = proposeDeleteUserGroupInput.parse(args);
      // 실행기(contacts.delete_user_group)는 params.id 를 읽는다 — 도구 표면은 조회 도구와 같은 groupId 로 받고 여기서 매핑.
      return await writeProposal('contacts.delete_user_group', summary, { id: groupId });
    },
  };

  // #833: 구성원 쓰기 제안 2종 — 실행은 확인 카드 승인 후 서버(사람 권한)가 수행한다.
  // 계정 생성(POST /users)은 초기 비밀번호를 에이전트가 정하게 되는 문제가 있어 제외했다.
  const proposeSetMemberRoleTool: McpTool = {
    name: 'propose_update_member_role',
    description:
      '사내 구성원의 역할 변경을 제안합니다. 직접 변경하지 않고 확인 카드용 제안만 만듭니다. roles 는 ADMIN(관리자) 또는 USER(일반). ' +
      'summary 에 누구를 어떤 역할로 바꾸는지 한 줄로 넣으세요. username 은 search_members 로 확보하세요. 승인 시 서버가 변경합니다.',
    inputSchema: proposeSetMemberRoleInput,
    async handler(args) {
      const { summary, username, roles } = proposeSetMemberRoleInput.parse(args);
      const { member, error } = await requireMemberFor(username);
      if (error) return error;
      // AI 에이전트 계정의 역할은 전용 역할(AGENT)로 운영된다. ADMIN/USER 로 교체하면 그 역할을 잃고
      // 비서 기능이 멈추므로 이 경로에서는 다루지 않는다.
      if (member!.kind === 'AGENT') {
        return `오류: ${member!.name} 은 AI 에이전트 계정이라 여기서 역할을 바꿀 수 없습니다. 설정 > 구성원 화면에서 변경하세요.`;
      }
      return await writeProposal('user.set_roles', summary, { userId: member!.userId, roles });
    },
  };
  const proposeSetMemberActiveTool: McpTool = {
    name: 'propose_update_member_active',
    description:
      '이 워크스페이스에서 사내 구성원의 활성/비활성 전환을 제안합니다(비활성화는 이 워크스페이스 멤버십 정지 — 사실상 퇴사 처리이며, 다른 워크스페이스와 계정 자체에는 영향이 없습니다). ' +
      '직접 변경하지 않고 확인 카드용 제안만 만듭니다. ' +
      'active=false 면 비활성화, true 면 재활성화. summary 에 대상과 이유를 한 줄로 넣으세요. username 은 search_members 로 확보하세요.',
    inputSchema: proposeSetMemberActiveInput,
    async handler(args) {
      const { summary, username, active } = proposeSetMemberActiveInput.parse(args);
      const { member, error } = await requireMemberFor(username);
      if (error) return error;
      return await writeProposal('user.set_active', summary, { userId: member!.userId, active });
    },
  };

  // #333 M3: 프로젝트 제안 도구 — 실행하지 않고(사전검증만, #842) 사이드카에 제안 객체를 쓰고 ack 반환.
  const proposeCreateProjectTool: McpTool = {
    name: 'propose_create_project',
    description: '프로젝트 생성을 제안합니다. 직접 생성하지 않고 확인 카드용 제안만 만듭니다. summary 에 한 줄 요약(이름·key)을 넣으세요. 승인 시 서버가 생성합니다.',
    inputSchema: proposeCreateProjectInput,
    async handler(args) {
      const { summary, ...input } = proposeCreateProjectInput.parse(args);
      // create_project 와 같은 변환(projectKey → key) — 실행기와 POST /projects 가 같은 CreateProjectRequest 로 받는다.
      return await writeProposal('project.create_project', summary, { ...toCreateProjectBody(input) });
    },
  };
  const proposeDeleteProjectTool: McpTool = {
    name: 'propose_delete_project',
    description: '프로젝트 삭제(소프트)를 제안합니다. 직접 삭제하지 않고 확인 카드용 제안만 만듭니다. summary 에 어떤 프로젝트인지 한 줄로 넣으세요. 승인 시 서버가 삭제합니다.',
    inputSchema: proposeDeleteProjectInput,
    async handler(args) {
      const { summary, projectKey } = proposeDeleteProjectInput.parse(args);
      return await writeProposal('project.delete_project', summary, { key: projectKey });
    },
  };
  const proposeAddProjectMemberTool: McpTool = {
    name: 'propose_add_project_member',
    description:
      '프로젝트 멤버 추가를 제안합니다. 직접 추가하지 않고 확인 카드용 제안만 만듭니다. summary 에 누구를 어떤 role 로 추가하는지 한 줄로 넣으세요. 승인 시 서버가 추가합니다. ' +
      'username 은 search_members 결과의 값을 그대로 쓰세요(추측 금지).',
    inputSchema: proposeAddProjectMemberInput,
    async handler(args) {
      const { summary, username, projectKey, role } = proposeAddProjectMemberInput.parse(args);
      // #833: 제안 생성 전에 대상을 확정한다. 사이드카 쓰기만 하면 검증이 "사용자가 카드를 승인한 뒤"로
      // 밀려, 잘못된 대상은 승인 후 실패하거나(최악) 엉뚱한 사람이 조용히 추가된다.
      const { member, error } = await requireActiveMember(username);
      if (error) return error;
      return await writeProposal('project.add_member', summary, {
        key: projectKey,
        userId: member!.userId,
        role,
      });
    },
  };

  // #333 M3: 드라이브 읽기 도구(v1 — 쓰기 연기).

  // #856: 파괴적이거나 다른 사람에게 영향이 나가는 작업 — 확인 카드 제안만 만든다(승인 시 ConfirmActionDispatcher 가 실행).
  // 카드는 summary 만 보여주므로, 사용자가 승인 전에 알아야 할 결과(확정된 사람·함께 지워지는 하위 항목)는 LLM 문구에 맡기지 않고
  // 핸들러가 조회해 summary 에 덧붙인다(propose_create_event 의 참석자·충돌 표기와 같은 원칙).

  const proposeAddAttendeesTool: McpTool = {
    name: 'propose_add_attendees',
    description:
      '내가 만든 일정에 참석자 추가를 제안합니다. 직접 추가하지 않고 확인 카드용 제안만 만듭니다. attendees 는 초대할 구성원 username 목록입니다' +
      '(search_members 결과, 추측 금지). 외부 이메일은 초대할 수 없고, M365 등 외부 캘린더에서 동기화된 일정은 그 캘린더에서 바꿔야 합니다. ' +
      'eventId 는 list_events/get_event 결과의 id 입니다. 승인 시 초대 알림이 갑니다.',
    inputSchema: proposeAddAttendeesInput,
    async handler(args) {
      const { eventId, attendees, summary } = proposeAddAttendeesInput.parse(args);
      // 요청자(=주최자)는 이미 참석자라 뺀다 — #852 와 같은 해석(없거나 비활성인 이름은 모아서 알린다).
      const resolved = await resolveAttendees(attendees, agentId);
      if ('error' in resolved) return resolved.error;
      if (!resolved.ids) return NO_ATTENDEE_TO_ADD;
      return await writeProposal('calendar.add_attendees', `${summary}\n초대: ${resolved.names.join(', ')}`, {
        id: eventId,
        userIds: resolved.ids,
      });
    },
  };

  const proposeRemoveAttendeeTool: McpTool = {
    name: 'propose_remove_attendee',
    description:
      '내가 만든 일정에서 참석자 한 명의 제거를 제안합니다. 직접 제거하지 않고 확인 카드용 제안만 만듭니다. username 은 get_event 의 참석자 중 한 명이어야 하며 ' +
      '주최자 본인은 뺄 수 없습니다. 외부 캘린더에서 동기화된 일정은 그 캘린더에서 바꿔야 합니다.',
    inputSchema: proposeRemoveAttendeeInput,
    async handler(args) {
      const { eventId, username, summary } = proposeRemoveAttendeeInput.parse(args);
      // 없는 이름·주최자 본인(서버가 조용히 무시)은 카드를 만들지 않는다 — update_event 의 removeAttendees 와 같은 공유 판정(WP-348).
      const r = await resolveAttendeeToRemove(sc, username, agentId);
      if ('error' in r) return r.error;
      return await writeProposal('calendar.remove_attendee', `${summary}\n제거: ${r.member.name}(${username})`, {
        id: eventId,
        userId: r.member.userId,
      });
    },
  };

  const proposeUpdateProjectMemberRoleTool: McpTool = {
    name: 'propose_update_project_member_role',
    description:
      '프로젝트 멤버의 역할 변경(OWNER/MEMBER)을 제안합니다. 직접 바꾸지 않고 확인 카드용 제안만 만듭니다. 프로젝트 OWNER 만 할 수 있고, ' +
      '마지막 OWNER 는 강등할 수 없습니다. username 은 get_project 의 members 중 한 명입니다.',
    inputSchema: proposeUpdateProjectMemberRoleInput,
    async handler(args) {
      const { projectKey, username, role, summary } = proposeUpdateProjectMemberRoleInput.parse(args);
      const { member, error } = await requireMemberFor(username);
      if (error) return error;
      return await writeProposal('project.update_member_role', summary, {
        key: projectKey,
        userId: member!.userId,
        role,
      });
    },
  };

  const proposeRemoveProjectMemberTool: McpTool = {
    name: 'propose_remove_project_member',
    description:
      '프로젝트 멤버 제거를 제안합니다. 직접 제거하지 않고 확인 카드용 제안만 만듭니다. 프로젝트 OWNER 만 할 수 있고 마지막 OWNER 는 제거할 수 없습니다. ' +
      '제거되면 그 사람이 담당한 이 프로젝트 이슈의 담당자 지정도 함께 풀립니다. username 은 get_project 의 members 중 한 명입니다.',
    inputSchema: proposeRemoveProjectMemberInput,
    async handler(args) {
      const { projectKey, username, summary } = proposeRemoveProjectMemberInput.parse(args);
      const { member, error } = await requireMemberFor(username);
      if (error) return error;
      return await writeProposal(
        'project.remove_member',
        `${summary}\n(${member!.name}(${username}) 이 담당한 이 프로젝트 이슈의 담당자 지정도 해제됩니다)`,
        { key: projectKey, userId: member!.userId },
      );
    },
  };

  const proposeAddChannelMemberTool: McpTool = {
    name: 'propose_add_channel_member',
    description:
      '채널에 구성원 초대를 제안합니다. 직접 초대하지 않고 확인 카드용 제안만 만듭니다. 채널 OWNER/ADMIN 만 초대할 수 있고 DM 에는 초대할 수 없습니다. ' +
      'channelId 는 list_channels 결과의 channelId, username 은 search_members 결과의 값입니다.',
    inputSchema: proposeAddChannelMemberInput,
    async handler(args) {
      const { channelId, username, summary } = proposeAddChannelMemberInput.parse(args);
      const { member, error } = await requireActiveMember(username);
      if (error) return error;
      return await writeProposal('messaging.add_channel_member', summary, { id: channelId, userId: member!.userId });
    },
  };

  const proposeLeaveChannelTool: McpTool = {
    name: 'propose_leave_channel',
    description:
      '비공개 채널에서 나가기를 제안합니다. 직접 나가지 않고 확인 카드용 제안만 만듭니다. 비공개 채널은 나가면 다시 초대받아야 돌아올 수 있습니다. ' +
      '공개 채널은 leave_channel 로 바로 나가세요. 채널 OWNER 는 소유권을 넘기기 전에는 나갈 수 없습니다. channelId 는 list_channels 결과의 channelId 입니다.',
    inputSchema: proposeLeaveChannelInput,
    async handler(args) {
      const { channelId, summary } = proposeLeaveChannelInput.parse(args);
      // #860 확인이 필요한 건 되돌릴 수 없는 비공개 채널뿐 — 공개 채널은 확인 없는 leave_channel 한 경로로 모은다.
      const channel = await sc.getChannel(channelId);
      if (channel.visibility === 'PUBLIC') {
        return `'${channel.name ?? channelId}' 은(는) 공개 채널이라 확인 없이 leave_channel 로 나갈 수 있습니다.`;
      }
      return await writeProposal(
        'messaging.leave_channel',
        `${summary}\n(비공개 채널 '${channel.name ?? channelId}' — 나가면 다시 초대받아야 돌아올 수 있습니다)`,
        { id: channelId },
      );
    },
  };

  const proposeDeleteIssueTool: McpTool = {
    name: 'propose_delete_issue',
    description:
      '이슈 삭제를 제안합니다. 직접 삭제하지 않고 확인 카드용 제안만 만듭니다. 복원 기능이 없고 하위 이슈도 함께 삭제됩니다. ' +
      '작성자(reporter)나 프로젝트 OWNER 만 삭제할 수 있습니다. summary 에 어떤 이슈를 지우는지 한 줄로 넣으세요.',
    inputSchema: proposeDeleteIssueInput,
    async handler(args) {
      const { issueKey, summary } = proposeDeleteIssueInput.parse(args);
      const { projectKey, number } = parseIssueKey(issueKey);
      // 카드에 함께 지워질 하위 이슈 수를 보인다 — 사용자가 모르는 채 연쇄 삭제를 승인하지 않게.
      const detail = (await sc.getIssueDetail(issueKey)) as { summary?: { title?: string; childCount?: number } };
      const children = detail.summary?.childCount ?? 0;
      const note = children > 0 ? `하위 이슈 ${children}건도 함께 삭제됩니다. ` : '';
      return await writeProposal(
        'issue.delete',
        `${summary}\n(${issueKey} "${detail.summary?.title ?? ''}" — ${note}복원할 수 없습니다)`,
        { key: projectKey, number },
      );
    },
  };

  const proposeDeleteCommentTool: McpTool = {
    name: 'propose_delete_comment',
    description:
      '이슈 코멘트 삭제를 제안합니다. 직접 삭제하지 않고 확인 카드용 제안만 만듭니다. 복원 기능이 없습니다. 작성자나 프로젝트 OWNER 만 삭제할 수 있습니다. ' +
      'commentId 는 get_issue_detail 의 comments 에서 확인하세요(최근 30건만 오므로 대상이 안 보이면 allComments:true, 최근 200건까지).',
    inputSchema: proposeDeleteCommentInput,
    async handler(args) {
      const { issueKey, commentId, summary } = proposeDeleteCommentInput.parse(args);
      const { projectKey, number } = parseIssueKey(issueKey);
      return await writeProposal('issue.delete_comment', summary, { key: projectKey, number, commentId });
    },
  };

  const proposeDeleteWikiPageTool: McpTool = {
    name: 'propose_delete_wiki_page',
    description:
      '노트 페이지 삭제를 제안합니다. 직접 삭제하지 않고 확인 카드용 제안만 만듭니다. 휴지통 없이 영구 삭제되며 하위 페이지도 모두 함께 지워집니다. ' +
      '공간 EDITOR 이상만 할 수 있습니다. pageId 는 list_wiki_pages/search_wiki 결과의 id 입니다.',
    inputSchema: proposeDeleteWikiPageInput,
    async handler(args) {
      const { pageId, summary } = proposeDeleteWikiPageInput.parse(args);
      // 하위 페이지 수를 트리에서 세어 카드에 보인다 — 영구 삭제라 승인 전에 범위를 알아야 한다.
      const page = (await sc.getWikiPage(pageId)) as { spaceId?: number; title?: string };
      let descendants = 0;
      if (page.spaceId != null) {
        const childrenOf = new Map<number, number[]>();
        for (const r of await sc.listWikiPages(page.spaceId)) {
          if (r.parentId != null) childrenOf.set(r.parentId, [...(childrenOf.get(r.parentId) ?? []), r.id]);
        }
        const stack = [pageId];
        for (let id = stack.pop(); id !== undefined; id = stack.pop()) {
          const kids = childrenOf.get(id) ?? [];
          descendants += kids.length;
          stack.push(...kids);
        }
      }
      const note = descendants > 0 ? `하위 페이지 ${descendants}개 포함, ` : '';
      return await writeProposal('wiki.delete_page', `${summary}\n("${page.title ?? ''}" — ${note}영구 삭제)`, {
        id: pageId,
      });
    },
  };

  // #333 M4: 드라이브 삭제 제안 도구 — 파일/폴더 삭제는 soft-delete 이나 비가역 작업으로 분류되어 confirm 필요.
  const proposeDeleteFileTool: McpTool = {
    name: 'propose_delete_file',
    description: '파일 삭제를 제안합니다. 직접 삭제하지 않고 사용자 확인 카드용 제안만 만듭니다. 삭제는 복구 가능한 soft-delete 이지만 확인이 필요합니다. summary 에 어떤 파일을 지우는지 한 줄로 넣으세요. driveFileId 는 list_drive_items/search_drive 파일 항목의 driveFileId 입니다. 승인 시 서버가 삭제합니다.',
    inputSchema: proposeDeleteFileInput,
    async handler(args) {
      const { summary, driveFileId } = proposeDeleteFileInput.parse(args);
      // 실행기(drive.delete_file)는 params.id 를 읽는다 — 도구 표면만 driveFileId 로 명시하고 여기서 매핑.
      return await writeProposal('drive.delete_file', summary, { id: driveFileId });
    },
  };
  const proposeDeleteFolderTool: McpTool = {
    name: 'propose_delete_folder',
    description: '폴더 삭제를 제안합니다. 직접 삭제하지 않고 사용자 확인 카드용 제안만 만듭니다. 삭제는 복구 가능한 soft-delete 이지만 하위 파일·폴더가 포함될 수 있어 확인이 필요합니다. summary 에 어떤 폴더를 지우는지 한 줄로 넣으세요. folderId 는 list_drive_items/search_drive 폴더 항목의 folderId 입니다. 승인 시 서버가 삭제합니다.',
    inputSchema: proposeDeleteFolderInput,
    async handler(args) {
      const { summary, folderId } = proposeDeleteFolderInput.parse(args);
      // 실행기(drive.delete_folder)는 params.id 를 읽는다 — 도구 표면만 folderId 로 명시하고 여기서 매핑.
      return await writeProposal('drive.delete_folder', summary, { id: folderId });
    },
  };

  // #381: 서브에이전트 최종 답변 제출 도구 — 위임된 서브에이전트가 작업을 마치고 사용자에게 보여줄 최종 답변을 제출한다.
  // Agent tool_result 는 stream-json 에서 collapsed(축약) 되어 추출 불가하므로(run-ai-compose 주석),
  // 서브에이전트가 직접 WORKPLACE_SUBAGENT_RESPONSE_PATH 사이드카에 답을 기록하고 run-ai-compose 가 권위 답으로 읽는다.
  // #467: 과거 first-write-guard(existsSync 면 덮지 않음)는 한 턴에 ≥2개 서브에이전트로 위임되면
  // 두 번째 이후 답을 조용히 버렸다. writeProposal 의 NDJSON append 패턴을 미러해 모든 서브에이전트
  // 답을 줄 단위로 보존한다(호출 측이 전부 읽어 결합).
  const submitResponseTool: McpTool = {
    name: 'submit_response',
    description:
      '작업을 마치고 사용자에게 보여줄 최종 답변을 제출합니다. 서브에이전트는 작업 완료 후 반드시 이 도구를 호출해 답변을 제출해야 합니다. 자유 텍스트로 끝내지 마세요. text 에 사용자에게 보여줄 한국어 최종 답변을 넣습니다.',
    inputSchema: z.object({ text: z.string().min(1) }),
    async handler(args) {
      const { text } = z.object({ text: z.string().min(1) }).parse(args);
      // #462 슬라이스4: 브리지가 있으면 호스트 콜백으로 답 제출(다중 위임 결합은 호스트가 수행, #467).
      if (hostBridge) {
        hostBridge.onSubmitResponse(text);
        return '답변을 제출했습니다.';
      }
      // 폴백(stdio MCP 경로): 사이드카 NDJSON append — 한 줄당 서브에이전트 답 1건(#467).
      const sidecarPath = process.env.WORKPLACE_SUBAGENT_RESPONSE_PATH;
      if (!sidecarPath) {
        return '답변을 제출했습니다.';
      }
      const { appendFileSync } = await import('node:fs');
      appendFileSync(sidecarPath, JSON.stringify({ text }) + '\n', 'utf8');
      return '답변을 제출했습니다.';
    },
  };

  // #333: assistant — 서브에이전트가 상속하는 전 앱 도구 union(M1: 이슈+위키읽기+표시, M2: 캘린더 읽기+제안, M3: 메시징+위키쓰기+메일+드라이브읽기, M4: 드라이브쓰기+삭제제안).
  // 도구 경계는 각 서브에이전트 .claude/agents/<name>.md frontmatter 가 강제하므로 union 노출은 안전.
  if (profile === 'assistant') {
    return [
      sharedTool('get_issue_detail'),
      listIssuesTool,            // #371: 이슈 목록 조회(내 담당/필터) — issue-agent 위임용
      sharedTool('list_wiki_spaces'),
      sharedTool('search_wiki'),
      sharedTool('get_wiki_page'),
      sharedTool('list_wiki_pages'), sharedTool('list_wiki_backlinks'), // #850: 페이지 트리·백링크
      sharedTool('create_wiki_page'),        // #333 M3: 위키 쓰기(내부)
      sharedTool('update_wiki_page'),        // #333 M3: 위키 쓰기(내부)
      sharedTool('restore_wiki_revision'),   // WP-357: 이전 판 복원 — 확인 카드가 없어 직접 실행(wiki-agent)
      sharedTool('add_comment'),
      sharedTool('update_comment'),
      sharedTool('create_issue'),
      sharedTool('update_issue'),
      unassignSelfTool,
      sharedTool('add_issue_dependency'),
      sharedTool('remove_issue_dependency'),
      sharedTool('list_events'),
      sharedTool('get_event'),              // #333 M2: 캘린더 읽기
      proposeCreateEventTool,    // #333 M2: 일정 생성 제안(사이드카 쓰기)
      proposeUpdateEventTool, proposeDeleteEventTool, // #333 M4: 일정 수정/삭제 제안
      sharedTool('list_channel_messages'), // #333 M3: 메시징 읽기
      sharedTool('list_thread_replies'),   // #850: 스레드 답글 조회
      sharedTool('add_channel_message'),  // #333 M3: 메시징 쓰기(내부 쓰기 직접 실행)
      sharedTool('list_channels'), // #350: 채널 목록/탐색(q — 이름→channelId 해석)
      sharedTool('list_mail'), sharedTool('get_mail'), proposeSendMailTool, // #333 M3: 메일 읽기 + 발송 제안
      sharedTool('list_mail_accounts'), sharedTool('sync_mail'), // #333 M4: 메일 계정 목록 + 수동 동기화
      sharedTool('list_contacts'), sharedTool('get_external_contact'), sharedTool('create_external_contact'), sharedTool('update_external_contact'), proposeDeleteContactTool, // #333 M3: 연락처
      // #839: 연락처 facets·즐겨찾기·사용자 그룹. AI Chat 은 요청자 신원으로 호출하므로 개인 그룹·즐겨찾기는 사람의 것이 된다
      // (에이전트 신원 프로필엔 두지 않는다 — 에이전트 계정의 개인 그룹이 생긴다).
      sharedTool('get_contact_facets'), sharedTool('add_contact_favorite'), sharedTool('remove_contact_favorite'),
      sharedTool('list_user_groups'), sharedTool('get_user_group'), sharedTool('create_user_group'), sharedTool('update_user_group'),
      sharedTool('add_user_group_member'), sharedTool('remove_user_group_member'), proposeDeleteUserGroupTool,
      sharedTool('search_members'), sharedTool('get_member'), sharedTool('get_member_contact'), // #833: 구성원(설정>구성원) 조회 — 연락처와 분리된 도메인
      proposeSetMemberRoleTool, proposeSetMemberActiveTool, // #833: 구성원 쓰기 제안(확인 카드 경유)
      sharedTool('list_projects'), sharedTool('get_project'), // 멤버는 get_project.members 로 함께 온다(list_project_members 폐지, WP-343)
      proposeCreateProjectTool, proposeDeleteProjectTool, proposeAddProjectMemberTool, // #333 M3: 프로젝트
      sharedTool('list_drive_spaces'), sharedTool('list_drive_items'), sharedTool('search_drive'), // #333 M3: 드라이브 읽기
      sharedTool('get_drive_file_summary'), sharedTool('search_drive_content'), // #850: 파일 요약·내용 검색
      // #850: 알림 인박스 — AI Chat 은 요청자(userId) 신원으로 호출하므로 사람의 알림을 본다(에이전트 신원 프로필엔 두지 않는다).
      sharedTool('list_notifications'), sharedTool('mark_notification_read'), sharedTool('mark_all_notifications_read'),
      sharedTool('get_home_overview'), // WP-357: 홈 현황 읽기 — 라우터 직접 도구(ASSISTANT_ROUTER_TOOLS)
      // #333 M4: 드라이브 쓰기(직접 실행). WP-369: 파일·폴더 이름변경·이동은 rename_drive_item·move_drive_item 하나씩으로 합쳐졌다.
      sharedTool('create_drive_folder'), sharedTool('rename_drive_item'), sharedTool('move_drive_item'),
      // WP-354: 복사·첨부 가져오기 — 확인 카드가 없는 되돌릴 수 있는 쓰기라 직접 실행(공유). 롤백은 확인 카드 대상이라 도구로 두지 않는다.
      sharedTool('copy_drive_item'), sharedTool('import_attachment_to_drive'),
      // WP-369: 다운로드 링크·파일 올리기(공유) — 확인 카드가 없는 되돌릴 수 있는 쓰기라 직접 실행. write 라 라우터에 두지 않고 drive-agent 에만 둔다.
      sharedTool('create_drive_download_link'), createDriveFileTool, // create_drive_file 은 content 모드만(R6)
      proposeDeleteFileTool, proposeDeleteFolderTool, // #333 M4: 드라이브 삭제 제안(confirm 필요)
      // #856: 참석자·프로젝트 멤버·채널 초대·이슈/코멘트/노트 삭제 제안(confirm 필요)
      proposeAddAttendeesTool, proposeRemoveAttendeeTool,
      proposeUpdateProjectMemberRoleTool, proposeRemoveProjectMemberTool, proposeAddChannelMemberTool, proposeLeaveChannelTool,
      proposeDeleteIssueTool, proposeDeleteCommentTool, proposeDeleteWikiPageTool,
      // #854·#855: 되돌릴 수 있는 쓰기(공유) — 이슈 워치·프로젝트 수정·노트 이동·휴지통 복원·RSVP·채널/DM·메일 AI.
      // WP-421: 이슈 워치·해제는 watch_issue(watching) 하나로 합쳐졌다.
      sharedTool('watch_issue'), sharedTool('update_project'), sharedTool('move_wiki_page'),
      // WP-356: 라벨·마일스톤·사이클 생성·수정 — 대응 확인 카드가 없는 되돌릴 수 있는 쓰기라 직접 실행(project-agent 전용). 삭제는 도구로 두지 않는다.
      sharedTool('create_project_meta'), sharedTool('update_project_meta'),
      sharedTool('list_drive_trash'), sharedTool('restore_drive_item'), sharedTool('rsvp_event'),
      sharedTool('create_channel'), sharedTool('open_dm'), sharedTool('leave_channel'),
      // WP-355: 채널 참여·리액션·내 메시지 수정·채널 읽음 처리 — 사용자 신원으로 하는 되돌릴 수 있는 쓰기(직접 실행, 확인 카드 없음). 메시지 삭제는 되돌릴 수 없어 도구로 두지 않는다(확인 카드도 아직 없음).
      // 채널에서 멘션된 에이전트 신원의 messaging 프로필에는 싣지 않는다(에이전트가 사람 이름으로 리액션·수정하는 정책은 별도 결정).
      // WP-421: 리액션 추가·제거는 react_to_message(reacted) 하나로 합쳐졌다.
      sharedTool('join_channel'), sharedTool('react_to_message'), sharedTool('update_channel_message'), sharedTool('mark_channel_read'),
      // WP-421: 첨부용 텍스트 파일 올려 두기(content 모드만) — 쓰기라 라우터가 아니라 issue-agent·messaging-agent 에만 둔다(wiki-agent 는 텍스트가 노트 이미지가 될 수 없어 싣지 않는다).
      sharedTool('upload_file'),
      sharedTool('get_mail_summary'), sharedTool('draft_mail_reply'), sharedTool('draft_issue_from_mail'),
      sharedTool('create_issue_from_mail'), sharedTool('mark_mail_read'),
      buildReadChatAttachmentTool(client, agentId, homeSessionId, imageInput), // WP-234: 메인 AI 채팅 첨부 읽기(세션 바인딩)
      ...buildMemoryTools(client, agentId, homeSessionId), // WP-55: 메모리 도구(라우터 전용 쓰기 예외) — 요청자 신원·이 대화 세션
      buildSharedMemoryTool(client, agentId, homeSessionId), // WP-386: 공용 메모리 직접 요청(라우터 전용 쓰기 예외) — 요청자 신원·이 대화 세션(지금 공간 근거)
      buildMemorySearchTool(client, agentId), // WP-383: 메모리 찾기(라우터 전용 읽기) — 요청자 신원
      buildConversationSearchTool(client, agentId, homeSessionId), // WP-384: 지난 대화 찾기(라우터 전용 읽기) — 지금 대화는 도구가 뺀다
      // WP-346: 이슈 첨부·드라이브 파일 내용 읽기(공유) — AI Chat 은 요청자 신원이라 사람의 권한으로 읽는다(위의 세션 첨부와 다른 대상).
      sharedTool('read_file'),
      submitResponseTool,        // #381: 서브에이전트 전용 — 최종 답변 구조화 제출(사이드카 기록)
      ...buildShowTools(),
      // #460 Layer2: 도메인 단순 조회 표시 위젯 — 위임(서브에이전트 nested loop, 느림) 대신 직접 표시.
      // buildShowTools() 내부 displayed 와 동일 시맨틱 — 데이터 미반환, 프론트가 params 로 fetch.
      ...((): McpTool[] => {
        const displayed = async () => JSON.stringify({ displayed: true });
        return [
      { name: 'show_calendar', description: '지정 기간(기본 오늘)의 내 일정 목록을 화면에 표시합니다. 일정 조회/확인 요청에 사용. 생성·수정·삭제는 calendar-agent 에 위임.', inputSchema: showCalendarInput, handler: displayed },
      { name: 'show_event', description: '단일 일정 상세(eventId 지정)를 화면에 표시합니다. eventId 를 모르면 먼저 list_events 로 확보하세요.', inputSchema: showEventInput, handler: displayed },
      { name: 'show_channels', description: '내가 속한 채널·DM 목록을 화면에 표시합니다. 채널 목록/확인 요청에 사용.', inputSchema: showChannelsInput, handler: displayed },
      { name: 'show_wiki', description: '노트 페이지 목록/검색 결과를 화면에 표시합니다. query 로 검색, spaceId 로 특정 스페이스 트리.', inputSchema: showWikiInput, handler: displayed },
      { name: 'show_wiki_page', description: '단일 노트 페이지 본문(pageId 지정)을 화면에 표시합니다. pageId 를 모르면 먼저 search_wiki 로 확보하세요.', inputSchema: showWikiPageInput, handler: displayed },
      { name: 'show_contacts', description: '연락처 목록을 화면에 표시합니다. search/org/title/type 로 좁힙니다. 단순 조회 전용 — 생성·수정·삭제는 contacts-agent 위임.', inputSchema: showContactsInput, handler: displayed },
      { name: 'show_contact', description: '외부 연락처 1건의 상세를 화면에 표시합니다. externalId 는 list_contacts 의 EXTERNAL 항목이 주는 값입니다 — 구성원(MEMBER) 항목은 표시할 수 없습니다.', inputSchema: showContactInput, handler: displayed },
      { name: 'show_projects', description: '프로젝트 목록을 화면에 표시합니다. 단순 조회 전용 — 생성·삭제·멤버추가는 project-agent 위임.', inputSchema: showProjectsInput, handler: displayed },
      { name: 'show_project', description: '단일 프로젝트 상세·멤버(projectKey 지정)를 화면에 표시합니다.', inputSchema: showProjectInput, handler: displayed },
      { name: 'show_drive', description: '드라이브 스페이스/폴더의 파일·폴더 목록을 화면에 표시합니다. spaceId/folderId 로 좁힙니다. 단순 조회 전용 — 이동·삭제는 drive-agent 위임.', inputSchema: showDriveInput, handler: displayed },
        ];
      })(),
    ];
  }

  // issue 프로파일(기본) — 이슈 읽기/쓰기 + 위키 읽기 그라운딩.
  // get_project: create_issue/update_issue 의 유형·라벨·마일스톤·사이클·담당자 이름이 이 도구의 결과(프로젝트 설정·members)에서 오므로 함께 둔다.
  return [
    sharedTool('get_issue_detail'),
    sharedTool('get_project'),
    sharedTool('list_wiki_spaces'),
    sharedTool('search_wiki'),
    sharedTool('get_wiki_page'),
    sharedTool('add_comment'),
    sharedTool('update_comment'),
    sharedTool('create_issue'),
    sharedTool('update_issue'),
    unassignSelfTool,
    sharedTool('add_issue_dependency'),
    sharedTool('remove_issue_dependency'),
  ];
}
