// 4 MCP 도구 정의 — 모든 호출에 agentId 가 closure 로 바인딩 (#34).
import { z } from 'zod';

import type { WorkplaceApiClient } from '../clients/workplace-api.js';

export interface McpTool {
  name: string;
  description: string;
  inputSchema: z.ZodTypeAny;
  handler: (args: unknown) => Promise<string>;
}

const issueKey = z.object({ issueKey: z.string().min(1) });
const addCommentInput = z.object({
  issueKey: z.string().min(1),
  body: z.string().min(1),
});
const updateStatusInput = z.object({
  issueKey: z.string().min(1),
  status: z.enum(['TODO', 'IN_PROGRESS', 'DONE', 'CANCELED']),
});
// 6c: chat 프로필 도구 입력.
const addChatMessageInput = z.object({
  threadId: z.number().int().positive(),
  body: z.string().min(1),
});
const getChatThreadInput = z.object({
  threadId: z.number().int().positive(),
});

// S2: 위키 읽기 그라운딩 도구 입력.
const searchWikiInput = z.object({ query: z.string().min(1) });
const getWikiPageInput = z.object({ pageId: z.number().int().positive() });

// #333 M3: 위키 쓰기 도구 입력.
const createWikiPageInput = z.object({
  spaceId: z.number().int().positive(),
  title: z.string().min(1).max(255),
  parentId: z.number().int().positive().optional(),
});
const updateWikiPageInput = z.object({
  pageId: z.number().int().positive(),
  version: z.number().int().min(1), // 낙관적 동시성 — get_wiki_page 의 version 을 그대로 넣는다.
  title: z.string().max(255).optional(),
  body: z.string().optional(),
});

// #393/#394: 타임존 오프셋이 없는 naive datetime에 Asia/Seoul(+09:00) 오프셋을 강제로 보정한다.
// haiku가 agent.md 규칙을 무시하고 "2026-06-20T14:00:00" 형태를 내보내는 비결정적 동작을
// 핸들러 레이어에서 결정론적으로 차단한다. Z(UTC)가 있으면 그대로 유지.
// 주의: Zod 4의 z.toJSONSchema 는 transform 을 지원하지 않으므로 스키마가 아닌 핸들러에서 적용.
function normalizeTimezone(val: string): string {
  // 이미 오프셋(+HH:MM 또는 Z)이 있으면 그대로 반환
  if (/[Zz]$/.test(val) || /[+-]\d{2}:\d{2}$/.test(val)) return val;
  // naive datetime → Asia/Seoul 오프셋 추가
  return val + '+09:00';
}

// #333 M2: 캘린더 읽기 도구 입력.
const listEventsInput = z.object({ from: z.string().min(1), to: z.string().min(1) });
const getEventInput = z.object({ id: z.number().int().positive() });

// #333 M3: 연락처 입력.
const listContactsInput = z.object({
  search: z.string().optional(),
  type: z.enum(['MEMBER', 'EXTERNAL']).optional(),
  limit: z.number().int().min(1).max(100).default(20),
});
const getExternalContactInput = z.object({ id: z.number().int().positive() });
const externalContactFields = {
  name: z.string().min(1).max(120),
  email: z.string().max(255).optional(),
  phone: z.string().max(40).optional(),
  organization: z.string().max(120).optional(),
  title: z.string().max(100).optional(),
  notes: z.string().optional(),
  visibility: z.enum(['SHARED', 'PERSONAL']),
};
const createExternalContactInput = z.object(externalContactFields);
const updateExternalContactInput = z.object({ id: z.number().int().positive(), ...externalContactFields });
const proposeDeleteContactInput = z.object({ id: z.number().int().positive(), summary: z.string().min(1) });

// #333 M3: 프로젝트 읽기/제안 입력.
const listProjectsInput = z.object({ page: z.number().int().min(0).default(0), size: z.number().int().min(1).max(100).default(20) });
const getProjectInput = z.object({ key: z.string().min(1) });
const listProjectMembersInput = z.object({ key: z.string().min(1) });
const proposeCreateProjectInput = z.object({
  key: z.string().regex(/^[A-Z][A-Z0-9]{1,9}$/),
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
  type: z.string().optional(),
  summary: z.string().min(1),
});
const proposeDeleteProjectInput = z.object({ key: z.string().min(1), summary: z.string().min(1) });
const proposeAddProjectMemberInput = z.object({
  key: z.string().min(1),
  userId: z.number().int().positive(),
  role: z.enum(['OWNER', 'MEMBER']),
  summary: z.string().min(1),
});

// #333 M3: 드라이브 읽기 입력(v1 — 읽기 전용).
const listDriveItemsInput = z.object({ spaceId: z.number().int().positive(), parentId: z.number().int().positive().optional() });
const searchDriveInput = z.object({ spaceId: z.number().int().positive(), q: z.string().min(1) });

// #333 M4: 드라이브 쓰기/삭제 입력.
const createFolderInput = z.object({ spaceId: z.number().int().positive(), parentId: z.number().int().positive().nullable().optional(), name: z.string().min(1).max(255) });
const renameFolderInput = z.object({ folderId: z.number().int().positive(), name: z.string().min(1).max(255) });
const moveFolderInput = z.object({ folderId: z.number().int().positive(), targetParentId: z.number().int().positive().nullable().optional() });
const moveFileInput = z.object({ fileId: z.number().int().positive(), targetFolderId: z.number().int().positive().nullable().optional() });
const proposeDeleteFileInput = z.object({ summary: z.string().min(1), id: z.number().int().positive() });
const proposeDeleteFolderInput = z.object({ summary: z.string().min(1), id: z.number().int().positive() });

// #333 M4: 메일 계정 목록 + 수동 동기화 입력.
const syncMailInput = z.object({ accountId: z.number().int().positive() });

// #333 M3: 메일 읽기 입력.
const listMailInput = z.object({
  accountId: z.number().int().positive(),
  folder: z.string().default('INBOX'),
  query: z.string().optional(),
  limit: z.number().int().min(1).max(100).default(20),
});
const getMailInput = z.object({ messageId: z.number().int().positive() });
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
// #402: attendees 추가 — 참석자 이메일 목록(선택). 스키마에 없으면 haiku가 params에서 생략함(create와 동일).
const proposeUpdateEventInput = z.object({
  summary: z.string().min(1),
  id: z.number().int().positive(),
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
  attendees: z.array(z.string().email()).optional(), // #402: 참석자 이메일 목록(수정 시에도 필수)
});
// #333 M4: 일정 삭제 제안 입력 — id + 반복 scope/occurrenceDate + summary.
const proposeDeleteEventInput = z.object({
  summary: z.string().min(1),
  id: z.number().int().positive(),
  scope: z.enum(['THIS', 'THIS_AND_FOLLOWING', 'ALL']).default('ALL'),
  occurrenceDate: z.string().optional(),
});

// #333 M2: 일정 생성 제안 입력 — CalendarEventRequest 와 1:1(서버 매핑 단순화) + summary(카드 본문).
// #393: attendees 추가 — 참석자 이메일 목록(선택). 스키마에 없으면 haiku가 params에서 생략함.
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
  attendees: z.array(z.string().email()).optional(), // #393: 참석자 이메일 목록
  summary: z.string().min(1),    // 사람이 읽는 카드 요약
});

// 7: messaging 프로필 도구 입력.
const getChannelMessagesInput = z.object({
  channelId: z.number().int().positive(),
});
const addChannelMessageInput = z.object({
  channelId: z.number().int().positive(),
  body: z.string().min(1),
});
// #350: 채널 목록/탐색 도구 입력 — channelId 를 모를 때 채널 이름 → id 해석용.
const discoverChannelsInput = z.object({ q: z.string().min(1) });

// 7b: home 컴포저 표시 지시 도구 — 모든 도구가 균일한 {params?, layout?} 봉투를 받는다.
// layout: 캔버스 배치 규칙(프론트 7c 가 해석). page/replace/pageLabel 모두 선택.
const layoutSchema = z
  .object({
    page: z.enum(['new', 'current']).optional(),
    replace: z.string().optional(),
    pageLabel: z.string().optional(),
  })
  .optional();
// issue_list 필터(스펙 §4.1 검증 완료 범위). 전부 선택 — AI 가 의도에 맞는 것만 채운다.
// #403: priority 는 반드시 영어 대문자 열거값만 허용 — 한국어("높음" 등) 비결정적 입력 차단.
const issueListParams = z
  .object({
    projectKey: z.string().optional(),
    status: z.string().optional(),
    priority: z.array(z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'])).optional(),
    label: z.string().optional(),
    type: z.string().optional(),
    dueFrom: z.string().optional(),
    dueTo: z.string().optional(),
    q: z.string().optional(),
    blocked: z.boolean().optional(),
    topLevel: z.boolean().optional(),
    assignee: z.string().optional(), // 'me' | '<id>'
    size: z.number().int().positive().optional(),
  })
  .optional();
const showMyTasksInput = z.object({ params: z.object({}).optional(), layout: layoutSchema });
const showIssueListInput = z.object({ params: issueListParams, layout: layoutSchema });
const showIssueDetailInput = z.object({
  params: z.object({ number: z.number().int().positive(), projectKey: z.string().optional() }),
  layout: layoutSchema,
});
const showActivityInput = z.object({
  params: z.object({ actorKind: z.enum(['HUMAN', 'AGENT']).optional() }).optional(),
  layout: layoutSchema,
});

// #333: assistant 프로파일 추가 — 전 앱 도구 union(M1).
export type McpProfile = 'issue' | 'chat' | 'home' | 'messaging' | 'assistant';

// profile 기본값 'issue' — 이슈 핸들러는 기존 4 도구, chat 핸들러는 읽기+chat 쓰기 도구만.
export function buildTools(
  client: WorkplaceApiClient,
  agentId: number,
  profile: McpProfile = 'issue',
): McpTool[] {
  const getIssueDetailTool: McpTool = {
    name: 'get_issue_detail',
    description: '이슈의 본문·상태·담당자·코멘트 등 전체 컨텍스트를 JSON 으로 반환합니다.',
    inputSchema: issueKey,
    async handler(args) {
      const { issueKey: k } = issueKey.parse(args);
      const detail = await client.getIssueDetail(agentId, k);
      return JSON.stringify(detail);
    },
  };

  // 위키 읽기 그라운딩 도구(S2) — issue·chat 프로필 공용
  const searchWikiTool: McpTool = {
    name: 'search_wiki',
    description:
      '위키 페이지를 제목·본문으로 검색합니다. 접근 가능한 스페이스만 대상이며, 결과 JSON 배열(id·spaceName·title·snippet)을 반환합니다. 근거가 필요하면 먼저 검색하세요.',
    inputSchema: searchWikiInput,
    async handler(args) {
      const { query } = searchWikiInput.parse(args);
      return JSON.stringify(await client.searchWikiPages(agentId, query));
    },
  };
  const getWikiPageTool: McpTool = {
    name: 'get_wiki_page',
    description:
      '위키 페이지 본문 전체를 JSON(title·body·version 등)으로 반환합니다. search_wiki 결과의 id 로 호출하세요.',
    inputSchema: getWikiPageInput,
    async handler(args) {
      const { pageId } = getWikiPageInput.parse(args);
      return JSON.stringify(await client.getWikiPage(agentId, pageId));
    },
  };

  if (profile === 'chat') {
    return [
      getIssueDetailTool,
      searchWikiTool,
      getWikiPageTool,
      {
        name: 'get_chat_thread',
        description: '현재 chat thread 의 최근 메시지 목록을 JSON 으로 반환합니다(과거 흐름 확인용).',
        inputSchema: getChatThreadInput,
        async handler(args) {
          const { threadId } = getChatThreadInput.parse(args);
          return JSON.stringify(await client.getChatMessages(agentId, threadId, 50));
        },
      },
      {
        name: 'add_chat_message',
        description:
          'chat thread 에 답변 메시지를 작성합니다. 본문은 마크다운 지원. 정확히 한 번만 호출하세요.',
        inputSchema: addChatMessageInput,
        async handler(args) {
          const { threadId, body } = addChatMessageInput.parse(args);
          await client.addChatMessage(agentId, threadId, body);
          return 'ok';
        },
      },
    ];
  }

  // #333 M3: 채널 읽기/쓰기 도구 — messaging/assistant 프로파일 공유.
  const getChannelMessagesTool: McpTool = {
    name: 'get_channel_messages',
    description: '현재 채널/DM 의 최근 메시지 목록을 JSON 으로 반환합니다(대화 흐름 확인용).',
    inputSchema: getChannelMessagesInput,
    async handler(args) {
      const { channelId } = getChannelMessagesInput.parse(args);
      return JSON.stringify(await client.getChannelMessages(agentId, channelId, 50));
    },
  };
  const addChannelMessageTool: McpTool = {
    name: 'add_channel_message',
    description:
      '채널/DM 에 답변 메시지를 작성합니다. 본문은 마크다운 지원. 정확히 한 번만 호출하세요.',
    inputSchema: addChannelMessageInput,
    async handler(args) {
      const { channelId, body } = addChannelMessageInput.parse(args);
      await client.addChannelMessage(agentId, channelId, body);
      return 'ok';
    },
  };

  // #350: 채널 목록/탐색 도구 — channelId 를 모를 때 채널 이름 → id 해석 전용 읽기 도구.
  // add_channel_message / get_channel_messages 호출 전 channelId 를 확보하는 데 사용한다.
  const listChannelsTool: McpTool = {
    name: 'list_channels',
    description:
      '내가 속한 채널·DM 목록을 JSON 배열로 반환합니다(id·name·kind·visibility 포함). 채널 이름만 알 때 channelId 를 확보한 뒤 get_channel_messages / add_channel_message 에 사용하세요.',
    inputSchema: z.object({}),
    async handler() {
      return JSON.stringify(await client.listChannels(agentId));
    },
  };
  const discoverChannelsTool: McpTool = {
    name: 'discover_channels',
    description:
      '공개 채널을 이름·키워드로 검색해 JSON 배열로 반환합니다(id·name·kind 포함). list_channels 에 없는 공개 채널을 찾아 channelId 를 확보한 뒤 메시지 조회/작성에 사용하세요.',
    inputSchema: discoverChannelsInput,
    async handler(args) {
      const { q } = discoverChannelsInput.parse(args);
      return JSON.stringify(await client.discoverChannels(agentId, q));
    },
  };

  if (profile === 'messaging') {
    return [getChannelMessagesTool, addChannelMessageTool, listChannelsTool, discoverChannelsTool];
  }

  // 7b: home 표시 지시 도구(데이터 조회 X). home/assistant 프로파일이 공유한다.
  // 핸들러는 모두 {displayed:true} — 실제 렌더링은 프론트엔드가 담당.
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
          '필터(params)에 맞는 이슈 목록을 화면에 표시합니다. assignee="me" 로 내 담당만, priority/status/dueTo 등으로 좁힙니다.',
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
    ];
  };

  // 기존 이슈 쓰기 도구 — issue/assistant 프로파일이 공유한다.
  const addCommentTool: McpTool = {
    name: 'add_comment',
    description: '이슈에 코멘트를 작성합니다. 본문은 마크다운을 지원합니다.',
    inputSchema: addCommentInput,
    async handler(args) {
      const { issueKey: k, body } = addCommentInput.parse(args);
      await client.addIssueComment(agentId, k, body);
      return 'ok';
    },
  };
  const updateStatusTool: McpTool = {
    name: 'update_status',
    description: '이슈의 상태를 변경합니다. 허용값: TODO / IN_PROGRESS / DONE / CANCELED.',
    inputSchema: updateStatusInput,
    async handler(args) {
      const { issueKey: k, status } = updateStatusInput.parse(args);
      await client.updateIssueStatus(agentId, k, status);
      return 'ok';
    },
  };
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
        // #406: 성공 사이드카 기록 — run-ai-compose 가 "이미 처리됨" 여부 판단에 사용.
        // 에러 사이드카와 대칭 구조: 성공 시 WORKPLACE_UNASSIGN_SUCCESS_PATH 에 이슈 키를 씀.
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
        // 사이드카에 오류 기록 — run-ai-compose 가 최종 응답 override 에 사용.
        const sidecarPath = process.env.WORKPLACE_UNASSIGN_ERROR_PATH;
        if (sidecarPath) {
          const { writeFileSync } = await import('node:fs');
          try {
            writeFileSync(sidecarPath, JSON.stringify({ error: errMsg, canonical }), 'utf8');
          } catch {
            // 사이드카 쓰기 실패 — 무시(2차 방어선인 도구 반환 문구로 커버)
          }
        }
        // LLM 에게 재해석 없이 그대로 전달할 고정 문구 반환.
        return canonical;
      }
    },
  };

  // 7b: home 컴포저 — 표시 지시만(데이터 조회 X).
  if (profile === 'home') {
    return buildShowTools();
  }

  // #333 M2: 캘린더 읽기 도구 — assistant 프로파일 전용(일정 충돌 확인·요약).
  // #394: from/to 에 타임존 오프셋이 없으면 normalizeTimezone 으로 +09:00 보정.
  //       haiku 가 naive datetime 으로 호출 시 API 가 OffsetDateTime 형식 오류를 반환하는 것을 차단.
  const listEventsTool: McpTool = {
    name: 'list_events',
    description: '[from,to) 기간(ISO-8601)의 내 일정 목록을 JSON 으로 반환합니다. 일정 충돌 확인·요약에 사용하세요.',
    inputSchema: listEventsInput,
    async handler(args) {
      const parsed = listEventsInput.parse(args);
      const from = normalizeTimezone(parsed.from);
      const to = normalizeTimezone(parsed.to);
      return JSON.stringify(await client.listEvents(agentId, from, to));
    },
  };
  const getEventTool: McpTool = {
    name: 'get_event',
    description: '단일 일정 상세를 JSON 으로 반환합니다. list_events 결과의 id 로 호출하세요.',
    inputSchema: getEventInput,
    async handler(args) {
      const { id } = getEventInput.parse(args);
      return JSON.stringify(await client.getEvent(agentId, id));
    },
  };

  // #333 M4: propose 공통 — 사이드카 단일-제안 하드 가드. propose 는 위임 서브에이전트 안에서 실행되어
// 라우터의 "한 턴 한 제안" 프롬프트 규칙이 전파되지 않으므로, 핸들러에서 프롬프트-독립으로 강제한다.
// 사이드카는 run-home-compose 가 사전 생성하지 않으므로 파일 존재 = 이번 턴에 이미 제안됨.
  async function writeProposal(
    actionType: string,
    summary: string,
    params: Record<string, unknown>,
  ): Promise<string> {
    const sidecarPath = process.env.WORKPLACE_PENDING_ACTION_PATH;
    if (!sidecarPath) {
      return '확인 플로우가 설정되지 않아 제안을 등록하지 못했습니다.';
    }
    const { existsSync, writeFileSync } = await import('node:fs');
    if (existsSync(sidecarPath)) {
      return '이미 대기 중인 제안이 있습니다. 먼저 그 작업을 확인(승인/취소)한 뒤 다음 제안을 해주세요.';
    }
    writeFileSync(sidecarPath, JSON.stringify({ actionType, summary, params }), 'utf8');
    return '제안을 등록했습니다. 사용자 확인을 기다립니다.';
  }

  // #333 M2: 일정 생성 제안 도구 — API 미호출, 사이드카에 제안 객체를 쓰고 ack 반환.
  // #393: attendees 파라미터를 명시하지 않으면 스키마에 없는 것으로 간주해 haiku가 생략함.
  // #394: startsAt/endsAt 타임존 보정 — 핸들러에서 normalizeTimezone 으로 처리.
  const proposeCreateEventTool: McpTool = {
    name: 'propose_create_event',
    description:
      '일정 생성을 제안합니다. 직접 생성하지 않고 사용자 확인 카드용 제안만 만듭니다. summary 에 사람이 읽을 한 줄 요약(일시·제목)을 넣으세요. 참석자가 있으면 attendees 배열(이메일 문자열 목록)을 반드시 포함하세요. startsAt/endsAt 은 반드시 타임존 오프셋 포함 ISO-8601(예: 2026-06-20T14:00:00+09:00)로 채우세요. 승인 시 서버가 실제로 생성합니다.',
    inputSchema: proposeCreateEventInput,
    async handler(args) {
      const { summary, ...params } = proposeCreateEventInput.parse(args);
      // #394: startsAt/endsAt 에 타임존 오프셋이 없으면 +09:00 보정.
      params.startsAt = normalizeTimezone(params.startsAt as string);
      params.endsAt = normalizeTimezone(params.endsAt as string);
      return await writeProposal('calendar.create_event', summary, params);
    },
  };

  // #397: 일정 존재 여부를 서버에서 직접 확인한다. haiku가 get_event 도구 호출 없이 환각으로
  // "존재하지 않는다"고 응답하는 비결정적 동작을 제안 핸들러 안에서 결정론적으로 차단한다.
  async function verifyEventExists(id: number): Promise<string | null> {
    try {
      await client.getEvent(agentId, id);
      return null; // 존재함 — 제안 진행 가능
    } catch {
      return `해당 일정(id: ${id})을 찾을 수 없습니다. 일정 id 를 다시 확인해주세요.`;
    }
  }

  // #333 M4: 일정 수정 제안 도구 — API 미호출, 사이드카에 수정 제안을 쓰고 ack 반환.
  // scope: THIS=이 회차, THIS_AND_FOLLOWING=이후 전체, ALL=시리즈 전체. occurrenceDate=대상 회차 시작시각.
  // #397: 수정 전 get_event 로 존재 여부 서버 확인 — haiku 환각(no tool call, "not found") 결정론적 차단.
  const proposeUpdateEventTool: McpTool = {
    name: 'propose_update_event',
    description:
      '일정 수정을 제안합니다. 직접 수정하지 않고 사용자 확인 카드용 제안만 만듭니다. summary 에 사람이 읽을 한 줄 요약을 넣으세요. 참석자를 추가/변경할 때는 attendees 배열(이메일 문자열 목록)을 반드시 포함하세요. 반복 일정은 scope 로 범위를 지정합니다(THIS=이 회차, THIS_AND_FOLLOWING=이후 전체, ALL=시리즈 전체). occurrenceDate 는 대상 회차 시작시각(ISO-8601). 승인 시 서버가 실제로 수정합니다.',
    inputSchema: proposeUpdateEventInput,
    async handler(args) {
      const { summary, ...params } = proposeUpdateEventInput.parse(args);
      // #397: 제안 전 존재 여부 확인 — 존재하지 않으면 에러 메시지 반환, 환각 차단.
      const notFound = await verifyEventExists(params.id);
      if (notFound) return notFound;
      return await writeProposal('calendar.update_event', summary, params);
    },
  };

  // #333 M4: 일정 삭제 제안 도구 — API 미호출, 사이드카에 삭제 제안을 쓰고 ack 반환.
  // scope/occurrenceDate 는 수정 제안과 동일 의미. 승인 시 서버가 실제로 삭제합니다.
  // #397: 삭제 전 get_event 로 존재 여부 서버 확인 — haiku 환각(no tool call, "not found") 결정론적 차단.
  const proposeDeleteEventTool: McpTool = {
    name: 'propose_delete_event',
    description:
      '일정 삭제를 제안합니다. 직접 삭제하지 않고 사용자 확인 카드용 제안만 만듭니다. summary 에 사람이 읽을 한 줄 요약을 넣으세요. 반복 일정은 scope 로 범위를 지정합니다(THIS=이 회차, THIS_AND_FOLLOWING=이후 전체, ALL=시리즈 전체). occurrenceDate 는 대상 회차 시작시각(ISO-8601). 승인 시 서버가 실제로 삭제합니다.',
    inputSchema: proposeDeleteEventInput,
    async handler(args) {
      const { summary, ...params } = proposeDeleteEventInput.parse(args);
      // #397: 제안 전 존재 여부 확인 — 존재하지 않으면 에러 메시지 반환, 환각 차단.
      const notFound = await verifyEventExists(params.id);
      if (notFound) return notFound;
      return await writeProposal('calendar.delete_event', summary, params);
    },
  };

  // #333 M3: 위키 쓰기 도구 — 스페이스 멤버십 가드는 서버가 강제하므로 propose/confirm 없이 직접 노출.
  const createWikiPageTool: McpTool = {
    name: 'create_wiki_page',
    description: '위키 스페이스에 새 페이지를 생성합니다. parentId 를 주면 그 하위에 만듭니다. 생성된 페이지(id·version)를 JSON 으로 반환합니다.',
    inputSchema: createWikiPageInput,
    async handler(args) {
      const { spaceId, title, parentId } = createWikiPageInput.parse(args);
      return JSON.stringify(await client.createWikiPage(agentId, spaceId, title, parentId));
    },
  };
  const updateWikiPageTool: McpTool = {
    name: 'update_wiki_page',
    description:
      '위키 페이지 제목·본문을 저장합니다. version 은 반드시 get_wiki_page 로 읽은 현재 version 을 넣어야 합니다(낙관적 동시성). 충돌(409)이면 다시 읽고 재시도 여부를 사용자에게 확인하세요.',
    inputSchema: updateWikiPageInput,
    async handler(args) {
      const { pageId, version, title, body } = updateWikiPageInput.parse(args);
      return JSON.stringify(await client.updateWikiPage(agentId, pageId, version, title, body));
    },
  };

  // #333 M3: 메일 읽기 도구 — assistant 프로파일 전용.
  const listMailTool: McpTool = {
    name: 'list_mail',
    description: '메일 계정의 폴더 메시지 목록을 JSON 으로 반환합니다. query 로 검색, folder 기본 INBOX. accountId 는 사용자의 메일 계정 id 입니다.',
    inputSchema: listMailInput,
    async handler(args) {
      const { accountId, folder, query, limit } = listMailInput.parse(args);
      return JSON.stringify(await client.listMail(agentId, accountId, folder, query, limit));
    },
  };
  const getMailTool: McpTool = {
    name: 'get_mail',
    description: '단일 메일 본문(텍스트/HTML)을 JSON 으로 반환합니다. list_mail 결과의 id 로 호출하세요.',
    inputSchema: getMailInput,
    async handler(args) {
      const { messageId } = getMailInput.parse(args);
      return JSON.stringify(await client.getMail(agentId, messageId));
    },
  };
  // #333 M3: 메일 발송 제안 도구 — propose_create_event 미러. API 미호출, 사이드카에 제안 기록 후 ack 반환.
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

  // #333 M4: 메일 계정 목록 + 수동 동기화 도구 — assistant 프로파일 전용.
  // list_mail_accounts: accountId 가 없을 때 먼저 호출해 계정 식별자를 확보한다.
  const listMailAccountsTool: McpTool = {
    name: 'list_mail_accounts',
    description:
      '사용자의 메일 계정 목록을 JSON 으로 반환합니다. list_mail 또는 propose_send_mail 호출 전 accountId 를 모를 때 먼저 호출해 계정 id 를 확인하세요.',
    inputSchema: z.object({}),
    async handler(_args) {
      return JSON.stringify(await client.listMailAccounts(agentId));
    },
  };
  // sync_mail: 서버 소유권 검증 통과 — 호출자 계정만 동기화 가능(직접 실행 안전).
  const syncMailTool: McpTool = {
    name: 'sync_mail',
    description:
      '지정 메일 계정의 새 메일을 수동으로 가져옵니다(받은편지함 동기화). accountId 는 list_mail_accounts 로 확인하세요.',
    inputSchema: syncMailInput,
    async handler(args) {
      const { accountId } = syncMailInput.parse(args);
      await client.syncMail(agentId, accountId);
      return '동기화를 완료했습니다.';
    },
  };

  // #333 M3: 연락처 읽기/쓰기/삭제제안 도구 — assistant 프로파일 전용.
  const listContactsTool: McpTool = {
    name: 'list_contacts',
    description: '연락처(멤버+외부) 목록을 JSON 으로 반환합니다. search 로 이름·이메일 검색, type 으로 MEMBER/EXTERNAL 한정.',
    inputSchema: listContactsInput,
    async handler(args) {
      const { search, type, limit } = listContactsInput.parse(args);
      return JSON.stringify(await client.listContacts(agentId, search, type, limit));
    },
  };
  const getExternalContactTool: McpTool = {
    name: 'get_external_contact',
    description: '외부 연락처 단건 상세를 JSON 으로 반환합니다.',
    inputSchema: getExternalContactInput,
    async handler(args) {
      const { id } = getExternalContactInput.parse(args);
      return JSON.stringify(await client.getExternalContact(agentId, id));
    },
  };
  const createExternalContactTool: McpTool = {
    name: 'create_external_contact',
    description: '외부 연락처를 생성합니다. visibility 는 SHARED(공유)/PERSONAL(개인). 생성 결과를 JSON 으로 반환합니다.',
    inputSchema: createExternalContactInput,
    async handler(args) {
      const input = createExternalContactInput.parse(args);
      return JSON.stringify(await client.createExternalContact(agentId, input));
    },
  };
  const updateExternalContactTool: McpTool = {
    name: 'update_external_contact',
    description: '외부 연락처를 수정합니다(전체 교체). 모든 필드를 현재 값 기준으로 채워 보내세요.',
    inputSchema: updateExternalContactInput,
    async handler(args) {
      const { id, ...input } = updateExternalContactInput.parse(args);
      return JSON.stringify(await client.updateExternalContact(agentId, id, input));
    },
  };
  const proposeDeleteContactTool: McpTool = {
    name: 'propose_delete_contact',
    description: '외부 연락처 삭제를 제안합니다. 직접 삭제하지 않고 확인 카드용 제안만 만듭니다. summary 에 어떤 연락처를 지우는지 한 줄로 넣으세요. 승인 시 서버가 삭제합니다.',
    inputSchema: proposeDeleteContactInput,
    async handler(args) {
      const { summary, ...params } = proposeDeleteContactInput.parse(args);
      return await writeProposal('contacts.delete_contact', summary, params);
    },
  };

  // #333 M3: 프로젝트 읽기 도구 — assistant 프로파일 전용. 쓰기는 confirm 실행기(에이전트는 propose 만).
  const listProjectsTool: McpTool = {
    name: 'list_projects',
    description: '프로젝트 목록을 JSON 으로 반환합니다. page/size 로 페이지네이션합니다.',
    inputSchema: listProjectsInput,
    async handler(args) {
      const { page, size } = listProjectsInput.parse(args);
      return JSON.stringify(await client.listProjects(agentId, page, size));
    },
  };
  const getProjectTool: McpTool = {
    name: 'get_project',
    description: '프로젝트 상세(key·name·description·type)를 JSON 으로 반환합니다.',
    inputSchema: getProjectInput,
    async handler(args) {
      const { key } = getProjectInput.parse(args);
      return JSON.stringify(await client.getProject(agentId, key));
    },
  };
  const listProjectMembersTool: McpTool = {
    name: 'list_project_members',
    description: '프로젝트 멤버 목록(userId·name·role)을 JSON 으로 반환합니다.',
    inputSchema: listProjectMembersInput,
    async handler(args) {
      const { key } = listProjectMembersInput.parse(args);
      return JSON.stringify(await client.listProjectMembers(agentId, key));
    },
  };

  // #333 M3: 프로젝트 제안 도구 — API 미호출, 사이드카에 제안 객체를 쓰고 ack 반환.
  const proposeCreateProjectTool: McpTool = {
    name: 'propose_create_project',
    description: '프로젝트 생성을 제안합니다. 직접 생성하지 않고 확인 카드용 제안만 만듭니다. summary 에 한 줄 요약(이름·key)을 넣으세요. 승인 시 서버가 생성합니다.',
    inputSchema: proposeCreateProjectInput,
    async handler(args) {
      const { summary, ...params } = proposeCreateProjectInput.parse(args);
      return await writeProposal('project.create_project', summary, params);
    },
  };
  const proposeDeleteProjectTool: McpTool = {
    name: 'propose_delete_project',
    description: '프로젝트 삭제(소프트)를 제안합니다. 직접 삭제하지 않고 확인 카드용 제안만 만듭니다. summary 에 어떤 프로젝트인지 한 줄로 넣으세요. 승인 시 서버가 삭제합니다.',
    inputSchema: proposeDeleteProjectInput,
    async handler(args) {
      const { summary, ...params } = proposeDeleteProjectInput.parse(args);
      return await writeProposal('project.delete_project', summary, params);
    },
  };
  const proposeAddProjectMemberTool: McpTool = {
    name: 'propose_add_project_member',
    description: '프로젝트 멤버 추가를 제안합니다. 직접 추가하지 않고 확인 카드용 제안만 만듭니다. summary 에 누구를 어떤 role 로 추가하는지 한 줄로 넣으세요. 승인 시 서버가 추가합니다.',
    inputSchema: proposeAddProjectMemberInput,
    async handler(args) {
      const { summary, ...params } = proposeAddProjectMemberInput.parse(args);
      return await writeProposal('project.add_member', summary, params);
    },
  };

  // #333 M3: 드라이브 읽기 도구(v1 — 쓰기 연기).
  const listDriveSpacesTool: McpTool = {
    name: 'list_drive_spaces',
    description: '내가 접근 가능한 드라이브 스페이스 목록을 JSON 으로 반환합니다.',
    inputSchema: z.object({}),
    async handler() { return JSON.stringify(await client.listMySpaces(agentId)); },
  };
  const listDriveItemsTool: McpTool = {
    name: 'list_drive_items',
    description: '드라이브 스페이스(또는 parentId 하위)의 폴더/파일 목록을 JSON 으로 반환합니다.',
    inputSchema: listDriveItemsInput,
    async handler(args) {
      const { spaceId, parentId } = listDriveItemsInput.parse(args);
      return JSON.stringify(await client.listSpaceItems(agentId, spaceId, parentId));
    },
  };
  const searchDriveTool: McpTool = {
    name: 'search_drive',
    description: '드라이브 스페이스에서 파일/폴더를 이름으로 검색해 JSON 으로 반환합니다.',
    inputSchema: searchDriveInput,
    async handler(args) {
      const { spaceId, q } = searchDriveInput.parse(args);
      return JSON.stringify(await client.searchDrive(agentId, spaceId, q));
    },
  };

  // #333 M4: 드라이브 폴더/파일 쓰기 도구 — 비가역성이 낮은 정리 작업(폴더 생성·이름변경·이동)은 직접 실행.
  const createFolderTool: McpTool = {
    name: 'create_folder',
    description: '드라이브 스페이스에 새 폴더를 생성합니다. parentId 를 주면 그 하위에 만들고, 생략하면 스페이스 루트에 생성합니다. 생성된 폴더를 JSON 으로 반환합니다.',
    inputSchema: createFolderInput,
    async handler(args) {
      const { spaceId, parentId, name } = createFolderInput.parse(args);
      return JSON.stringify(await client.createFolder(agentId, spaceId, parentId ?? null, name));
    },
  };
  const renameFolderTool: McpTool = {
    name: 'rename_folder',
    description: '폴더 이름을 변경합니다. 변경된 폴더를 JSON 으로 반환합니다.',
    inputSchema: renameFolderInput,
    async handler(args) {
      const { folderId, name } = renameFolderInput.parse(args);
      return JSON.stringify(await client.renameFolder(agentId, folderId, name));
    },
  };
  const moveFolderTool: McpTool = {
    name: 'move_folder',
    description: '폴더를 다른 상위 폴더로 이동합니다. targetParentId 를 생략하면 스페이스 루트로 이동합니다.',
    inputSchema: moveFolderInput,
    async handler(args) {
      const { folderId, targetParentId } = moveFolderInput.parse(args);
      await client.moveFolder(agentId, folderId, targetParentId ?? null);
      return 'ok';
    },
  };
  const moveFileTool: McpTool = {
    name: 'move_file',
    description: '파일을 다른 폴더로 이동합니다. targetFolderId 를 생략하면 스페이스 루트로 이동합니다.',
    inputSchema: moveFileInput,
    async handler(args) {
      const { fileId, targetFolderId } = moveFileInput.parse(args);
      await client.moveFile(agentId, fileId, targetFolderId ?? null);
      return 'ok';
    },
  };

  // #333 M4: 드라이브 삭제 제안 도구 — 파일/폴더 삭제는 soft-delete 이나 비가역 작업으로 분류되어 confirm 필요.
  const proposeDeleteFileTool: McpTool = {
    name: 'propose_delete_file',
    description: '파일 삭제를 제안합니다. 직접 삭제하지 않고 사용자 확인 카드용 제안만 만듭니다. 삭제는 복구 가능한 soft-delete 이지만 확인이 필요합니다. summary 에 어떤 파일을 지우는지 한 줄로 넣으세요. 승인 시 서버가 삭제합니다.',
    inputSchema: proposeDeleteFileInput,
    async handler(args) {
      const { summary, ...params } = proposeDeleteFileInput.parse(args);
      return await writeProposal('drive.delete_file', summary, params);
    },
  };
  const proposeDeleteFolderTool: McpTool = {
    name: 'propose_delete_folder',
    description: '폴더 삭제를 제안합니다. 직접 삭제하지 않고 사용자 확인 카드용 제안만 만듭니다. 삭제는 복구 가능한 soft-delete 이지만 하위 파일·폴더가 포함될 수 있어 확인이 필요합니다. summary 에 어떤 폴더를 지우는지 한 줄로 넣으세요. 승인 시 서버가 삭제합니다.',
    inputSchema: proposeDeleteFolderInput,
    async handler(args) {
      const { summary, ...params } = proposeDeleteFolderInput.parse(args);
      return await writeProposal('drive.delete_folder', summary, params);
    },
  };

  // #333: assistant — 서브에이전트가 상속하는 전 앱 도구 union(M1: 이슈+위키읽기+표시, M2: 캘린더 읽기+제안, M3: 메시징+위키쓰기+메일+드라이브읽기, M4: 드라이브쓰기+삭제제안).
  // 도구 경계는 각 서브에이전트 .claude/agents/<name>.md frontmatter 가 강제하므로 union 노출은 안전.
  if (profile === 'assistant') {
    return [
      getIssueDetailTool,
      searchWikiTool,
      getWikiPageTool,
      createWikiPageTool,        // #333 M3: 위키 쓰기(내부)
      updateWikiPageTool,        // #333 M3: 위키 쓰기(내부)
      addCommentTool,
      updateStatusTool,
      unassignSelfTool,
      listEventsTool,
      getEventTool,              // #333 M2: 캘린더 읽기
      proposeCreateEventTool,    // #333 M2: 일정 생성 제안(사이드카 쓰기)
      proposeUpdateEventTool, proposeDeleteEventTool, // #333 M4: 일정 수정/삭제 제안
      getChannelMessagesTool,    // #333 M3: 메시징 읽기
      addChannelMessageTool,     // #333 M3: 메시징 쓰기(내부 쓰기 직접 실행)
      listChannelsTool, discoverChannelsTool, // #350: 채널 목록/탐색(이름→channelId 해석)
      listMailTool, getMailTool, proposeSendMailTool, // #333 M3: 메일 읽기 + 발송 제안
      listMailAccountsTool, syncMailTool, // #333 M4: 메일 계정 목록 + 수동 동기화
      listContactsTool, getExternalContactTool, createExternalContactTool, updateExternalContactTool, proposeDeleteContactTool, // #333 M3: 연락처
      listProjectsTool, getProjectTool, listProjectMembersTool,
      proposeCreateProjectTool, proposeDeleteProjectTool, proposeAddProjectMemberTool, // #333 M3: 프로젝트
      listDriveSpacesTool, listDriveItemsTool, searchDriveTool, // #333 M3: 드라이브 읽기
      createFolderTool, renameFolderTool, moveFolderTool, moveFileTool, // #333 M4: 드라이브 쓰기(직접 실행)
      proposeDeleteFileTool, proposeDeleteFolderTool, // #333 M4: 드라이브 삭제 제안(confirm 필요)
      ...buildShowTools(),
    ];
  }

  // issue 프로파일(기본) — 이슈 읽기/쓰기 + 위키 읽기 그라운딩.
  return [
    getIssueDetailTool,
    searchWikiTool,
    getWikiPageTool,
    addCommentTool,
    updateStatusTool,
    unassignSelfTool,
  ];
}
