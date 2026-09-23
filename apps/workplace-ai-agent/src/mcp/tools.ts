// 4 MCP 도구 정의 — 모든 호출에 agentId 가 closure 로 바인딩 (#34).
import { z } from 'zod';

import {
  buildSharedTools,
  findMemberByUsername,
  issueListFilterShape,
  normalizeTimezone,
  projectKeyInput,
  toProjectMemberView,
  type McpTool,
} from '@smart-workplace/mcp-tools-shared';
import type { WorkplaceApiClient } from '../clients/workplace-api.js';

// sdk-mcp-server.ts / stdio-entry.ts 가 './tools.js' 에서 McpTool 을 계속 import 하므로 재-export 유지.
export type { McpTool };

const issueKey = z.object({ issueKey: z.string().min(1) });
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
const updateExternalContactInput = z.object({ externalId: z.number().int().positive(), ...externalContactFields });
const proposeDeleteContactInput = z.object({ externalId: z.number().int().positive(), summary: z.string().min(1) });

// #333 M3: 프로젝트 제안 입력. #846: 프로젝트는 조회 도구(get_project 등)와 같은 이름 projectKey 로 가리킨다.
// 실행기(ConfirmActionDispatcher)는 params.key 를 읽으므로 핸들러가 key 로 옮겨 담는다.
const proposeCreateProjectInput = z.object({
  projectKey: z.string().regex(/^[A-Z][A-Z0-9]{1,9}$/),
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
  type: z.string().optional(),
  summary: z.string().min(1),
});
const proposeDeleteProjectInput = z.object({ projectKey: z.string().min(1), summary: z.string().min(1) });
const proposeAddProjectMemberInput = z.object({
  projectKey: z.string().min(1),
  // #833: 숫자 id 대신 username 을 받는다. 이슈 도구(create_issue 의 assignees)와 같은 방식이며,
  // LLM 표면에 숫자 식별자를 노출하지 않으면 "연락처 id 를 userId 로 넣는" 사고 자체가 불가능해진다.
  username: z.string().min(1),
  role: z.enum(['OWNER', 'MEMBER']),
  summary: z.string().min(1),
});

// #333 M4: 드라이브 쓰기/삭제 입력.
const createFolderInput = z.object({ spaceId: z.number().int().positive(), parentId: z.number().int().positive().nullable().optional(), name: z.string().min(1).max(255) });
const renameFolderInput = z.object({ folderId: z.number().int().positive(), name: z.string().min(1).max(255) });
const moveFolderInput = z.object({ folderId: z.number().int().positive(), targetParentId: z.number().int().positive().nullable().optional() });
// #840: 파일 식별자는 driveFileId(= drive_file.id)로 명명한다. 목록 응답의 core fileId 와 혼동되지 않도록
// 도구 표면 전체에서 하나의 이름만 쓰고, 폴더는 rename/move 와 같은 folderId 로 통일한다.
const moveFileInput = z.object({ driveFileId: z.number().int().positive(), targetFolderId: z.number().int().positive().nullable().optional() });
const proposeDeleteFileInput = z.object({ summary: z.string().min(1), driveFileId: z.number().int().positive() });
const proposeDeleteFolderInput = z.object({ summary: z.string().min(1), folderId: z.number().int().positive() });

// #333 M4: 메일 계정 목록 + 수동 동기화 입력.
const syncMailInput = z.object({ accountId: z.number().int().positive() });

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
  attendees: z.array(z.string().email()).optional(), // #402: 참석자 이메일 목록(수정 시에도 필수)
});
// #333 M4: 일정 삭제 제안 입력 — id + 반복 scope/occurrenceDate + summary.
const proposeDeleteEventInput = z.object({
  summary: z.string().min(1),
  eventId: z.number().int().positive(),
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
const showMyTasksInput = z.object({ params: z.object({}).optional(), layout: layoutSchema });
// #371/#846: show_issue_list(표시 지시)는 list_issues(데이터 조회, 공유)와 같은 필터 집합을 쓴다.
const showIssueListInput = z.object({ params: z.object(issueListFilterShape).optional(), layout: layoutSchema });
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
): McpTool[] {
  // #846: 두 앱 공유 도구(이슈·프로젝트·노트·캘린더·메일·구성원·메시징·드라이브 읽기) — 프로필이 이름으로 골라 쓴다.
  // 같은 이름의 도구를 여기서 따로 정의하지 않는다(tools.test.ts 패리티 테스트가 강제) — 정의가 두 벌이면 파라미터가 어긋난다.
  const sc = client.toolClient(agentId);
  const shared = buildSharedTools(sc, {
    // 스레드 mirror: 바인딩된 트리거 채널에 한해 그 스레드 parent 로 답한다(다른 채널은 인라인).
    parentMessageIdFor: (channelId) =>
      threadBinding && threadBinding.channelId === channelId ? threadBinding.parentMessageId : undefined,
  });
  const sharedTool = (name: string): McpTool => {
    const t = shared.find((x) => x.name === name);
    if (!t) throw new Error(`공유 도구 없음: ${name}`);
    return t;
  };

  /** 겹치는 일정을 제안 카드 충돌 표시 형태로 조회한다(messaging 위임·assistant 공용이라 프로필 분기보다 먼저 선언). */
  const listConflicts = async (from: string, to: string) =>
    (await sc.listEvents(from, to)).map(({ id, title, startsAt, endsAt }) => ({ id, title, startsAt, endsAt }));

  // #371: 이슈 목록 데이터 조회(공유본). ai-agent 에는 화면 표시 위젯(show_issue_list)이 있어 둘 중 고르는 기준을 덧붙인다.
  const listIssuesTool: McpTool = {
    ...sharedTool('list_issues'),
    description:
      '**네가 이슈 내용을 직접 읽고 분석/요약/판단해서 답해야 할 때만** 사용하세요(예: "이번 주 뭐부터 할까?", "내 업무량 어때?"). ' +
      '단순히 사용자가 목록을 "보고 싶어"하면(보여줘/찾아줘/뭐 있어/목록) 이 도구 대신 show_issue_list 로 화면에 표시하세요. ' +
      sharedTool('list_issues').description,
  };

  if (profile === 'chat') {
    // #433: 단일 이벤트 처리 중 add_chat_message 중복 호출 방지.
    // MCP 서버는 CLI run 당 하나의 프로세스로 실행되어 buildTools 클로저가 run 단위로 격리된다.
    // 시스템 프롬프트 지시를 AI가 무시하는 비결정적 동작을 코드 레벨에서 결정론적으로 차단한다.
    let addChatMessageCalled = false;
    return [
      sharedTool('get_issue_detail'),
      sharedTool('list_wiki_spaces'),
      sharedTool('search_wiki'),
      sharedTool('get_wiki_page'),
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
          // #433: 2번째 이후 호출 차단 — 중복 응답 방지.
          if (addChatMessageCalled) {
            console.error('[mcp:add_chat_message] 중복 호출 감지 — 차단됨 (threadId 참고: args)');
            return '이미 이 요청에 대한 답변을 등록했습니다. 추가 호출은 무시됩니다.';
          }
          addChatMessageCalled = true;
          const { threadId, body } = addChatMessageInput.parse(args);
          await client.addChatMessage(agentId, threadId, body);
          return 'ok';
        },
      },
    ];
  }

  // #350: 공개 채널 탐색 — list_channels 에 없는 채널 이름 → channelId 해석(ai-agent 전용).
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
    const tools: McpTool[] = [
      sharedTool('get_channel_messages'),
      sharedTool('add_channel_message'),
      sharedTool('list_channels'),
      discoverChannelsTool,
    ];
    // L3 위임: 위임 컨텍스트가 있을 때만 노출. channelId·위임자·parent 는 코드가 스탬프(AI 입력 아님).
    if (delegationContext) {
      const dc = delegationContext;
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
          '사용자가 대화 내용을 일정으로 잡아달라고 할 때 호출합니다. 일정 생성 "확인 카드"를 그 자리에 올립니다(실제 생성은 위임자 승인 후). title·startsAt·endsAt(타임존 오프셋 포함 ISO-8601, 예: 2026-06-20T14:00:00+09:00)을 채우고, 필요하면 location/reminderMinutes 를 넣으세요. 위치·위임자는 시스템이 정합니다. 호출 시 add_channel_message 는 호출하지 마세요(카드가 곧 응답).',
        inputSchema: proposeCreateEventInput,
        async handler(args) {
          if (eventProposed) return '이미 이 요청에 대한 일정 제안을 등록했습니다.';
          const { summary: _summary, attendees: _attendees, ...params } =
            proposeCreateEventInput.parse(args);
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

  // 기존 이슈 쓰기 도구 중 add_comment/edit_comment 는 공유본(sharedTool)으로 대체됨.
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
  // create_issue/update_issue/add_issue_dependency/remove_issue_dependency 는 공유본(sharedTool)으로 대체됨.
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
  // #393: attendees 파라미터를 명시하지 않으면 스키마에 없는 것으로 간주해 haiku가 생략함.
  // #394: startsAt/endsAt 타임존 보정 — 핸들러에서 normalizeTimezone 으로 처리.
  // #395: 새 일정 시간대 충돌을 서버에서 결정론적으로 확인한다. agent.md 는 propose 전 list_events 를
  //       MUST 로 규정하지만 모델이 비결정적으로 그 단계를 건너뛰는 회귀가 반복되므로, 핸들러가
  //       스스로 listEvents 로 겹치는 일정을 조회해 제안에 embed 한다(모델 호출에 의존하지 않음).
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

      // #395: 보정된 시간대 [startsAt, endsAt) 에 겹치는 기존 일정을 서버에서 조회한다.
      //       listEvents 는 [from,to) 기간 일정을 반환하므로(=window 와 겹치는 일정), 반환 목록을
      //       그대로 충돌로 본다. 조회 실패(네트워크/권한 등)는 fail-open — 충돌확인 실패가 제안 자체를
      //       막으면 안 되므로 try/catch 로 감싸고 실패 시 conflicts 없이 정상 진행한다.
      // params 는 zod 추론 타입이라 index signature 가 없어 새 키(conflicts) 할당이 타입 에러가 된다.
      // 충돌을 담을 수 있도록 Record 로 복사해 제안 params 를 구성한다.
      let finalSummary = summary;
      const proposalParams: Record<string, unknown> = { ...params };
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
      '일정 수정을 제안합니다. 직접 수정하지 않고 사용자 확인 카드용 제안만 만듭니다. summary 에 사람이 읽을 한 줄 요약을 넣으세요. 참석자를 추가/변경할 때는 attendees 배열(이메일 문자열 목록)을 반드시 포함하세요. 반복 일정은 scope 로 범위를 지정합니다(THIS=이 회차, THIS_AND_FOLLOWING=이후 전체, ALL=시리즈 전체). occurrenceDate 는 대상 회차 시작시각(ISO-8601). 승인 시 서버가 실제로 수정합니다.',
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

  // #333 M4: 메일 계정 목록 + 수동 동기화 도구 — assistant 프로파일 전용.
  // list_mail_accounts: accountId 가 없을 때 먼저 호출해 계정 식별자를 확보한다.
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

  /**
   * 제안 도구 공용 — 대상 구성원을 확정하거나 에이전트가 바로 교정할 수 있는 오류 문구를 돌려준다(#833).
   * 도구 표면은 username 만 다루고(숫자 id 미노출) 여기서 user.id 로 해석한다 — LLM 이 숫자 식별자를 만지지 않으면
   * "연락처 id 를 userId 로 넣는" 사고가 구조적으로 불가능해진다.
   */
  const requireMemberFor = async (username: string) => {
    const found = await findMemberByUsername(sc, username);
    if (!found) {
      return {
        error: `오류: username='${username}' 인 구성원을 찾을 수 없습니다. search_members 로 대상을 다시 찾아 정확한 username 을 확인하세요.`,
      };
    }
    return { member: found };
  };

  // #333 M3: 외부 연락처 쓰기(생성·수정은 직접 실행, 삭제는 제안) — assistant 프로파일 전용.
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
    description:
      '외부 연락처를 수정합니다(전체 교체). 모든 필드를 현재 값 기준으로 채워 보내세요. ' +
      'externalId 는 list_contacts 의 EXTERNAL 항목이 주는 값입니다 — 구성원의 userId 를 넣으면 엉뚱한 사람의 연락처가 바뀝니다.',
    inputSchema: updateExternalContactInput,
    async handler(args) {
      const { externalId, ...input } = updateExternalContactInput.parse(args);
      return JSON.stringify(await client.updateExternalContact(agentId, externalId, input));
    },
  };
  const proposeDeleteContactTool: McpTool = {
    name: 'propose_delete_contact',
    description:
      '외부 연락처 삭제를 제안합니다. 직접 삭제하지 않고 확인 카드용 제안만 만듭니다. summary 에 어떤 연락처를 지우는지 한 줄로 넣으세요. 승인 시 서버가 삭제합니다. ' +
      'externalId 는 list_contacts 의 EXTERNAL 항목이 주는 값입니다 — 구성원의 userId 를 넣으면 엉뚱한 사람의 연락처가 지워집니다.',
    inputSchema: proposeDeleteContactInput,
    async handler(args) {
      const { summary, externalId } = proposeDeleteContactInput.parse(args);
      // 실행기(contacts.delete_contact)는 params.id 를 읽는다 — 도구 표면만 externalId 로 명시하고 여기서 매핑.
      return await writeProposal('contacts.delete_contact', summary, { id: externalId });
    },
  };

  // #833: 구성원 쓰기 제안 2종 — 실행은 확인 카드 승인 후 서버(사람 권한)가 수행한다.
  // 계정 생성(POST /users)은 초기 비밀번호를 에이전트가 정하게 되는 문제가 있어 제외했다.
  const proposeSetMemberRoleTool: McpTool = {
    name: 'propose_set_member_role',
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
    name: 'propose_set_member_active',
    description:
      '사내 구성원 계정의 활성/비활성 전환을 제안합니다(비활성화는 사실상 퇴사 처리). 직접 변경하지 않고 확인 카드용 제안만 만듭니다. ' +
      'active=false 면 비활성화, true 면 재활성화. summary 에 대상과 이유를 한 줄로 넣으세요. username 은 search_members 로 확보하세요.',
    inputSchema: proposeSetMemberActiveInput,
    async handler(args) {
      const { summary, username, active } = proposeSetMemberActiveInput.parse(args);
      const { member, error } = await requireMemberFor(username);
      if (error) return error;
      return await writeProposal('user.set_active', summary, { userId: member!.userId, active });
    },
  };

  // #333 M3: 프로젝트 멤버 조회. #846: 사람은 username 으로만 노출한다(get_project 의 members 와 같은 형태 — #833).
  const listProjectMembersTool: McpTool = {
    name: 'list_project_members',
    description: '프로젝트 멤버 목록(username·name·role)을 JSON 으로 반환합니다.',
    inputSchema: projectKeyInput,
    async handler(args) {
      const { projectKey } = projectKeyInput.parse(args);
      return JSON.stringify((await sc.getProjectMembers(projectKey)).map(toProjectMemberView));
    },
  };

  // #333 M3: 프로젝트 제안 도구 — 실행하지 않고(사전검증만, #842) 사이드카에 제안 객체를 쓰고 ack 반환.
  const proposeCreateProjectTool: McpTool = {
    name: 'propose_create_project',
    description: '프로젝트 생성을 제안합니다. 직접 생성하지 않고 확인 카드용 제안만 만듭니다. summary 에 한 줄 요약(이름·key)을 넣으세요. 승인 시 서버가 생성합니다.',
    inputSchema: proposeCreateProjectInput,
    async handler(args) {
      const { summary, projectKey, ...params } = proposeCreateProjectInput.parse(args);
      return await writeProposal('project.create_project', summary, { key: projectKey, ...params });
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
      const { member, error } = await requireMemberFor(username);
      if (error) return error;
      if (!member!.active) {
        return `오류: ${member!.name}(${username}) 은 비활성 계정이라 프로젝트 멤버로 추가할 수 없습니다.`;
      }
      return await writeProposal('project.add_member', summary, {
        key: projectKey,
        userId: member!.userId,
        role,
      });
    },
  };

  // #333 M3: 드라이브 읽기 도구(v1 — 쓰기 연기).

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
    description: '파일을 다른 폴더로 이동합니다. driveFileId 는 list_drive_items/search_drive 파일 항목의 driveFileId 입니다. targetFolderId 를 생략하면 스페이스 루트로 이동합니다.',
    inputSchema: moveFileInput,
    async handler(args) {
      const { driveFileId, targetFolderId } = moveFileInput.parse(args);
      await client.moveFile(agentId, driveFileId, targetFolderId ?? null);
      return 'ok';
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
    description: '폴더 삭제를 제안합니다. 직접 삭제하지 않고 사용자 확인 카드용 제안만 만듭니다. 삭제는 복구 가능한 soft-delete 이지만 하위 파일·폴더가 포함될 수 있어 확인이 필요합니다. summary 에 어떤 폴더를 지우는지 한 줄로 넣으세요. folderId 는 list_drive_items/search_drive 폴더 항목의 id 입니다. 승인 시 서버가 삭제합니다.',
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
      sharedTool('create_wiki_page'),        // #333 M3: 위키 쓰기(내부)
      sharedTool('update_wiki_page'),        // #333 M3: 위키 쓰기(내부)
      sharedTool('add_comment'),
      sharedTool('edit_comment'),
      updateStatusTool,
      sharedTool('create_issue'),
      sharedTool('update_issue'),
      unassignSelfTool,
      sharedTool('add_issue_dependency'),
      sharedTool('remove_issue_dependency'),
      sharedTool('list_events'),
      sharedTool('get_event'),              // #333 M2: 캘린더 읽기
      proposeCreateEventTool,    // #333 M2: 일정 생성 제안(사이드카 쓰기)
      proposeUpdateEventTool, proposeDeleteEventTool, // #333 M4: 일정 수정/삭제 제안
      sharedTool('get_channel_messages'), // #333 M3: 메시징 읽기
      sharedTool('add_channel_message'),  // #333 M3: 메시징 쓰기(내부 쓰기 직접 실행)
      sharedTool('list_channels'), discoverChannelsTool, // #350: 채널 목록/탐색(이름→channelId 해석)
      sharedTool('list_mail'), sharedTool('get_mail'), proposeSendMailTool, // #333 M3: 메일 읽기 + 발송 제안
      sharedTool('list_mail_accounts'), syncMailTool, // #333 M4: 메일 계정 목록 + 수동 동기화
      sharedTool('list_contacts'), sharedTool('get_external_contact'), createExternalContactTool, updateExternalContactTool, proposeDeleteContactTool, // #333 M3: 연락처
      sharedTool('search_members'), sharedTool('get_member'), sharedTool('get_member_contact'), // #833: 구성원(설정>구성원) 조회 — 연락처와 분리된 도메인
      proposeSetMemberRoleTool, proposeSetMemberActiveTool, // #833: 구성원 쓰기 제안(확인 카드 경유)
      sharedTool('list_projects'), sharedTool('get_project'), listProjectMembersTool,
      proposeCreateProjectTool, proposeDeleteProjectTool, proposeAddProjectMemberTool, // #333 M3: 프로젝트
      sharedTool('list_drive_spaces'), sharedTool('list_drive_items'), sharedTool('search_drive'), // #333 M3: 드라이브 읽기
      createFolderTool, renameFolderTool, moveFolderTool, moveFileTool, // #333 M4: 드라이브 쓰기(직접 실행)
      proposeDeleteFileTool, proposeDeleteFolderTool, // #333 M4: 드라이브 삭제 제안(confirm 필요)
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
      { name: 'show_contact', description: '외부 연락처 1건의 상세를 화면에 표시합니다. externalId 는 list_contacts 의 EXTERNAL 항목이 주는 값입니다 — 구성원(userId)은 표시할 수 없습니다.', inputSchema: showContactInput, handler: displayed },
      { name: 'show_projects', description: '프로젝트 목록을 화면에 표시합니다. 단순 조회 전용 — 생성·삭제·멤버추가는 project-agent 위임.', inputSchema: showProjectsInput, handler: displayed },
      { name: 'show_project', description: '단일 프로젝트 상세·멤버(projectKey 지정)를 화면에 표시합니다.', inputSchema: showProjectInput, handler: displayed },
      { name: 'show_drive', description: '드라이브 스페이스/폴더의 파일·폴더 목록을 화면에 표시합니다. spaceId/folderId 로 좁힙니다. 단순 조회 전용 — 이동·삭제는 drive-agent 위임.', inputSchema: showDriveInput, handler: displayed },
        ];
      })(),
    ];
  }

  // issue 프로파일(기본) — 이슈 읽기/쓰기 + 위키 읽기 그라운딩.
  return [
    sharedTool('get_issue_detail'),
    sharedTool('list_wiki_spaces'),
    sharedTool('search_wiki'),
    sharedTool('get_wiki_page'),
    sharedTool('add_comment'),
    sharedTool('edit_comment'),
    updateStatusTool,
    sharedTool('create_issue'),
    sharedTool('update_issue'),
    unassignSelfTool,
    sharedTool('add_issue_dependency'),
    sharedTool('remove_issue_dependency'),
  ];
}
