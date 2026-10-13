// src/home-tools.ts — 홈 개요 읽기 도구(WP-357). 두 앱 공유.
// 웹 홈 화면이 보여 주는 우선순위·메일 요약·대화 요약·활동 피드·스레드 인박스를 한 도구로 읽는다. 지금까지 ai-agent 는 show_activity·show_my_tasks 로
// 화면에만 띄울 수 있어 모델이 내용을 읽지 못했다. 모든 엔드포인트는 읽기 전용이고 AI 를 새로 부르지 않는다(저장된 우선순위 배치·집계·키셋 목록).
// 앱 태그는 notify(알림·인박스 계열) — 새 앱 이름을 만들지 않고, 도구 개수가 가득 찬 messaging 에는 싣지 않는다.
import { z } from 'zod';
import { cursorPageView, dropEmpty, omitKeys, truncatedView } from './compact.js';
import { toMailListItem } from './mail-tools.js';
import { toMessageView } from './messaging-tools.js';
import type { SharedTool } from './mcp-tool.js';
import { errText, formatIssueKey } from './parse.js';
import type { HomeToolClient } from './tool-client.js';

const HOME_SECTIONS = ['priority', 'mail', 'messaging', 'activity', 'threads'] as const;
type HomeSection = (typeof HOME_SECTIONS)[number];
/** 기본 섹션 — 크기가 작고 상한이 있는 것만(우선순위 최대 20·메일 5·대화 5). 활동·스레드는 페이지가 크므로 요청해야 읽는다. */
const DEFAULT_SECTIONS: readonly HomeSection[] = ['priority', 'mail', 'messaging'];
/** 커서로 이어 읽는 섹션 — 서버가 keyset 페이지를 준다. */
const PAGED_SECTIONS: readonly HomeSection[] = ['activity', 'threads'];
/** 우선순위 항목 출력 상한 — 서버는 최대 80건 안팎(소스 4종 × 20)을 점수순으로 주는데 위쪽만 쓸모 있다. */
const MAX_PRIORITY_ITEMS = 20;
/** activity·threads 한 번에 가져오는 건수 — 서버 기본(활동 20·인박스 50)은 홈 개요에 크다. 이어 읽는 것은 cursor 가 한다. */
const PAGE_SIZE = 10;
/** 스레드 루트 본문 미리보기 길이 — 전체는 channelId·id 로 이어서 읽는다. */
const THREAD_PREVIEW_CHARS = 200;

export const getHomeOverviewInput = z.object({
  sections: z.array(z.enum(HOME_SECTIONS)).optional(),
  cursor: z.string().optional(),
});

type Raw = Record<string, unknown>;

/** 딥링크 `/projects/{key}/issues/{n}` 에서 이슈 키를 뽑는다(우선순위 항목의 sourceId 는 이슈 내부 id 라 쓸 수 없다). */
function issueKeyFromLink(deepLink: unknown): string | undefined {
  const m = typeof deepLink === 'string' ? /^\/projects\/([^/]+)\/issues\/(\d+)/.exec(deepLink) : null;
  return m ? formatIssueKey(m[1], Number(m[2])) : undefined;
}

/** 숫자 문자열 sourceId → 숫자(다른 도구의 입력 이름과 같은 값). 숫자가 아니면 그대로 둔다. */
const numericId = (v: unknown) => (typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : v);

/**
 * 우선순위 항목(PriorityItemResponse) → LLM 뷰. sourceId 의 뜻이 종류마다 달라 후속 도구가 받는 이름으로 풀어 낸다:
 * ISSUE_DUE → issueKey(딥링크에서), MENTION → notificationId + issueKey, MAIL_NEEDS_REPLY → messageId, MESSAGE_ATTENTION → channelId.
 * 점수는 서버가 이미 정렬한 순서로 반영돼 있고 딥링크는 화면 이동용이라 뺀다. 모르는 종류는 sourceId 를 그대로 둔다.
 */
export function toPriorityItemView(row: Raw): Raw {
  const { sourceType, sourceId, title, deepLink, reason } = row;
  const base = { type: sourceType, title, reason };
  switch (sourceType) {
    case 'ISSUE_DUE':
      return dropEmpty({ ...base, issueKey: issueKeyFromLink(deepLink) });
    case 'MENTION':
      return dropEmpty({ ...base, issueKey: issueKeyFromLink(deepLink), notificationId: numericId(sourceId) });
    case 'MAIL_NEEDS_REPLY':
      return dropEmpty({ ...base, messageId: numericId(sourceId) });
    case 'MESSAGE_ATTENTION':
      return dropEmpty({ ...base, channelId: numericId(sourceId) });
    default:
      return dropEmpty({ ...base, sourceId });
  }
}

/** 메일 요약 → {unreadCount, needsReplyCount, recent}. recent 는 list_mail 과 같은 행 뷰. 분류가 꺼져 있으면 회신 필요 수가 0 이라 뜻이 없어 알린다. */
export function toHomeMailView(raw: unknown): Raw {
  const r = (raw ?? {}) as Raw;
  return {
    unreadCount: r.unreadCount,
    needsReplyCount: r.needsReplyCount,
    ...(r.classificationActive === false && { aiClassification: false }),
    recent: Array.isArray(r.recent) ? (r.recent as Raw[]).map(toMailListItem) : [],
  };
}

/**
 * 대화 요약 → 카운트 넷 + recent. 서버의 conversationId 는 채널 id 라 다른 메시징 도구의 입력 이름(channelId)으로 바꾼다.
 * 신호 배지(mentioned·needsReply)는 true 일 때만 싣고 0·null 은 지운다. 사용자 ID 필드는 서버에 없다.
 */
export function toHomeMessagingView(raw: unknown): Raw {
  const r = (raw ?? {}) as Raw;
  const recent = Array.isArray(r.recent) ? (r.recent as Raw[]) : [];
  return {
    unreadConversationCount: r.unreadConversationCount,
    needsReplyCount: r.needsReplyCount,
    aiAttentionCount: r.aiAttentionCount,
    attentionCount: r.attentionCount,
    recent: recent.map(({ conversationId, mentioned, needsReply, unreadCount, newThreadReplyCount, ...rest }) =>
      dropEmpty({
        channelId: conversationId,
        ...rest,
        unreadCount: unreadCount || undefined,
        mentioned: mentioned === true ? true : undefined,
        needsReply: needsReply === true ? true : undefined,
        newThreadReplyCount: newThreadReplyCount || undefined,
      }),
    ),
  };
}

/** 활동 피드 한 건 → LLM 뷰. 이슈는 숫자 id·프로젝트 키·번호 대신 issueKey 하나로, 행위자의 숫자 id(actorId)와 이력 id 는 뺀다(#833). */
export function toActivityView({ id: _id, issueId: _issueId, actorId: _actorId, projectKey, issueNumber, ...rest }: Raw): Raw {
  return dropEmpty({ issueKey: formatIssueKey(projectKey as string, issueNumber as number), ...rest });
}

/**
 * 스레드 인박스 한 건 → LLM 뷰. 루트 메시지는 toMessageView(사용자 ID·멘션 토큰 정리)를 쓰되, 그 뷰가 지우는 channelId 는 되살린다 —
 * 채널을 가로지르는 목록이라 channelId 가 있어야 이어서 읽을 수 있다(스레드 전체는 루트의 id 로, 채널 맥락은 channelId 로).
 * 인박스는 팔로우 중인 스레드만 주므로 followed 는 노이즈다. 본문은 미리보기 길이로 자른다.
 */
export function toThreadInboxItemView(item: Raw): Raw {
  const root = (item.rootMessage ?? {}) as Raw;
  const view = omitKeys(toMessageView(root), 'followed');
  const body = typeof view.body === 'string' && view.body.length > THREAD_PREVIEW_CHARS ? `${view.body.slice(0, THREAD_PREVIEW_CHARS)}…` : view.body;
  return dropEmpty({ channelId: root.channelId, channelName: item.channelName, lastReplyAt: item.lastReplyAt, ...view, body });
}

/** 홈 개요 도구(get_home_overview). 모두 내 데이터만 읽는다. */
export function buildHomeTools(client: HomeToolClient): SharedTool[] {
  return [
    {
      name: 'get_home_overview',
      app: 'notify',
      kind: 'read',
      description:
        'Reads my home (홈) overview; sections default to priority, mail, messaging. priority: AI-ranked items needing me ' +
        'with issueKey, notificationId, messageId or channelId. mail, messaging: counts + recent unread items. activity: recent ' +
        'changes on issues I am assigned or watch. threads: followed threads with unread replies (id = thread root messageId). activity, ' +
        'threads: if hasMore, call again with only that section and nextCursor as cursor, or say it is partial.',
      inputSchema: getHomeOverviewInput,
      async handler(args) {
        const { sections: requested, cursor } = getHomeOverviewInput.parse(args);
        const sections = requested?.length ? [...new Set(requested)] : [...DEFAULT_SECTIONS];
        if (cursor && !(sections.length === 1 && PAGED_SECTIONS.includes(sections[0]))) {
          throw new Error('cursor 는 activity 또는 threads 섹션 하나만 요청할 때 쓰세요(그 섹션의 nextCursor).');
        }
        const load: Record<HomeSection, () => Promise<unknown>> = {
          async priority() {
            const rows = (await client.getPriorityItems()) as Raw[];
            return truncatedView(rows.slice(0, MAX_PRIORITY_ITEMS).map(toPriorityItemView), rows.length > MAX_PRIORITY_ITEMS);
          },
          async mail() {
            return toHomeMailView(await client.getHomeMailSummary());
          },
          async messaging() {
            return toHomeMessagingView(await client.getMessagingSummary());
          },
          async activity() {
            const page = (await client.getHomeActivity({ cursor, size: PAGE_SIZE })) as { items?: Raw[]; nextCursor?: string | null };
            return cursorPageView((page.items ?? []).map(toActivityView), page);
          },
          async threads() {
            const page = (await client.getThreadInbox({ cursor, limit: PAGE_SIZE })) as { items?: Raw[]; nextCursor?: string | null; hasMore?: boolean };
            return cursorPageView((page.items ?? []).map(toThreadInboxItemView), page);
          },
        };
        // 섹션은 서로 독립이라 병렬로 읽고, 하나가 실패해도 나머지는 돌려준다(권한·모듈 꺼짐으로 한 엔드포인트만 403 인 경우 등).
        const settled = await Promise.allSettled(sections.map((s) => load[s]()));
        const failures = settled.flatMap((r, i) => (r.status === 'rejected' ? [`${sections[i]}: ${errText(r.reason)}`] : []));
        if (failures.length === sections.length) throw new Error(`홈 개요를 읽지 못했습니다 — ${failures.join(' / ')}`);
        return JSON.stringify(
          Object.fromEntries(
            settled.map((r, i) => [sections[i], r.status === 'fulfilled' ? r.value : { error: `조회하지 못했습니다: ${errText(r.reason)}` }]),
          ),
        );
      },
    },
  ];
}
