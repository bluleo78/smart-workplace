// src/member-tools.ts — 구성원 디렉터리·연락처 읽기 도구 5종. 두 앱 공유(#833 → #846).
//
// 구성원(user.id)과 외부 연락처(externalId = contact_entry.id)는 네임스페이스가 다르다. 이전에는 연락처 id 를
// userId 로 오용하는 사고가 있었으므로 도구 표면에서 이름을 분리한다. 사람은 username 으로만 가리키고 숫자 user id 는 내보내지 않는다(WP-353).
// 외부 연락처 생성·수정·삭제와 구성원 역할·활성 변경은 ai-agent 쪽에만 있다(삭제·구성원 변경은 확인 카드).
// 즐겨찾기·facets·사용자 그룹(#839)은 contact-tools.ts — 사용자 본인 범위의 되돌릴 수 있는 쓰기라 공유 도구로 둔다.
import { z } from 'zod';
import { cursorPageView, dropEmpty, numberedPageView } from './compact.js';
import type { SharedTool } from './mcp-tool.js';
import { isMeAlias, type CurrentUserClient } from './resolve.js';
import type { MemberRow, MemberToolClient } from './tool-client.js';

/** 연락처 목록 항목 원형 — type 에 따라 id 의 의미가 다르다(MEMBER=user.id, EXTERNAL=contact_entry.id). */
export interface ContactRow {
  type: 'MEMBER' | 'EXTERNAL';
  id: number;
  /** MEMBER 항목의 로그인 아이디(서버 ContactSummary, WP-353). EXTERNAL 은 null. */
  username?: string | null;
  name: string;
  email?: string | null;
  title?: string | null;
  organization?: string | null;
  isFavorite?: boolean;
}

/**
 * 구성원 행 → LLM 뷰. 숫자 userId 는 빼고 사람을 가리키는 username 만 준다(#833, WP-353). 쓰기 도구는 username 을 받아
 * 서버 쪽 id 로 해석하므로(requireMember 등) LLM 이 userId 를 알 필요가 없다. 나머지 필드(kind·active·email 등)는 그대로 둔다.
 * AI 의 설명(역할)·실행 방식(WP-455)·지시(WP-1077, 서버가 AI 본인 단건 조회에만 싣는다)는 값이 있을 때만 싣는다 — 사람 행마다 빈 칸이
 * 붙지 않게 한다.
 */
export function toMemberView({
  userId: _userId,
  description,
  agentRuntime,
  instructions,
  ...rest
}: MemberRow): Omit<MemberRow, 'userId'> {
  return { ...rest, ...dropEmpty({ description, agentRuntime, instructions }) };
}

/**
 * 연락처 LLM 뷰 — 공용 `id` 를 없애고 타입별 식별자로 나눠 오용을 막는다. 구성원은 숫자 user id 가 아니라 username 으로 가리키고(#833, WP-353 —
 * 서버가 목록 행에 username 을 싣는다), 외부 연락처만 externalId 를 쓴다. 구성원 id 를 외부 연락처 도구에 넣는 혼용은 구성원에게 숫자 식별자가 없어 구조적으로 막힌다.
 */
export function toContactView(item: ContactRow) {
  const base = {
    type: item.type,
    name: item.name,
    email: item.email ?? null,
    title: item.title ?? null,
    organization: item.organization ?? null,
    isFavorite: Boolean(item.isFavorite),
  };
  return item.type === 'MEMBER' ? { ...base, username: item.username ?? null } : { ...base, externalId: item.id };
}

/** 구성원 검색 한 페이지 크기 — 결과가 이만큼 차면 뒤에 더 있을 수 있다(linkMentions 의 구절 재검색 판정, WP-1041). */
export const MEMBER_SEARCH_PAGE_SIZE = 50;

/**
 * 구성원 부분일치 검색(테넌트 스코프). 서버가 정확일치 행을 맨 앞에 정렬하므로(#844) 같은 조각을 가진 사람이 많아도
 * 정확일치 대상은 첫 페이지에 들어온다 — 호출측은 이 결과에서 정확일치만 골라 쓴다.
 */
export function searchMembersByTerm(
  client: Pick<MemberToolClient, 'searchMembers'>,
  term: string,
  includeInactive: boolean,
): Promise<MemberRow[]> {
  return client.searchMembers({ search: term, kind: 'ALL', includeInactive, page: 0, size: MEMBER_SEARCH_PAGE_SIZE });
}

/** username → 구성원. username 은 전역 UNIQUE 라 정확일치가 곧 유일 매치다. 조회가 테넌트 스코프라 찾히면 곧 현재 테넌트 구성원이다. */
export async function findMemberByUsername(
  client: Pick<MemberToolClient, 'searchMembers'>,
  username: string,
): Promise<MemberRow | undefined> {
  return (await searchMembersByTerm(client, username, true)).find((m) => m.username === username);
}

/** 대상 구성원 확정 결과 — 구성원, 또는 에이전트가 바로 교정할 수 있는 오류 문구. */
export type RequiredMember = { member: MemberRow } | { error: string };

/**
 * username → 대상 구성원(#833). 확인 카드(propose_*)와 직접 실행 도구(add_project_member·add_channel_member, WP-349)가 같은 판정·문구를
 * 쓴다 — 카드는 문구를 결과로 돌려주고, 직접 실행 도구는 throw 해 isError 로 전달한다. 도구 표면은 username 만 다루고(숫자 id 미노출)
 * 여기서 user.id 로 해석한다 — LLM 이 숫자 식별자를 만지지 않으면 "연락처 id 를 userId 로 넣는" 사고가 구조적으로 불가능해진다.
 */
export async function requireMember(client: Pick<MemberToolClient, 'searchMembers'>, username: string): Promise<RequiredMember> {
  const found = await findMemberByUsername(client, username);
  if (!found) {
    return {
      error: `오류: username='${username}' 인 구성원을 찾을 수 없습니다. search_members 로 대상을 다시 찾아 정확한 username 을 확인하세요.`,
    };
  }
  return { member: found };
}

/**
 * username → 활성 구성원. 없거나 비활성이면 교정 가능한 오류 문구. 멤버 추가·채널 초대처럼 새로 들이는 작업이 쓴다 —
 * 서버 채널 초대는 비활성 계정을 막지 않으므로(ChannelMemberService.checkAdd) 두 경로 모두 여기서 거른다.
 */
export async function requireActiveMember(
  client: Pick<MemberToolClient, 'searchMembers'>,
  username: string,
): Promise<RequiredMember> {
  const r = await requireMember(client, username);
  if ('error' in r) return r;
  if (r.member.active === false) return { error: `오류: ${r.member.name}(${username}) 은 비활성 계정입니다.` };
  return r;
}

/** username 으로 구성원을 못 찾았을 때의 오류 — isError 로 LLM 에 전달돼 search_members 로 자가교정하게 한다(contact-tools 와 같은 방식). */
function memberNotFound(username: string): Error {
  return new Error(`구성원을 찾을 수 없습니다: ${username}. search_members 로 정확한 username 을 확인하세요.`);
}

export const searchMembersInput = z.object({
  search: z.string().optional(),
  kind: z.enum(['HUMAN', 'AGENT', 'ALL']).default('HUMAN'),
  // 기본은 활성 구성원만 — 퇴사 처리된 계정이 섞이면 담당자 지정 등에서 오작동한다.
  includeInactive: z.boolean().optional(),
  page: z.number().int().min(0).default(0),
  size: z.number().int().min(1).max(100).default(20),
  // WP-355: 주면 그 채널의 멤버만 본다(서버 /members 에는 채널 필터가 없어 /channels/{id}/members 를 읽는다).
  channelId: z.number().int().positive().optional(),
});
export const memberInput = z.object({ username: z.string().min(1) });
export const listContactsInput = z.object({
  search: z.string().optional(),
  type: z.enum(['MEMBER', 'EXTERNAL']).optional(),
  organization: z.string().optional(),
  title: z.string().optional(),
  favorite: z.boolean().optional(),
  // #833: 커서 페이지네이션 — 이전 호출이 돌려준 nextCursor 를 그대로 넘긴다.
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(100).default(20),
});
export const externalContactInput = z.object({ externalId: z.number().int().positive() });

/**
 * 채널 멤버 목록 → search_members 와 같은 출력 모양 { items, total, hasMore?, nextPage? }(WP-355). 서버 /channels/{id}/members 는 페이지·검색이 없는
 * 전체 목록이라 search(이름·username 부분일치)·kind(기본 HUMAN, 구성원 검색과 같다)·page 를 여기서 적용한다. 숫자 userId·가입 시각은 내보내지 않고
 * username·name·kind·role 만 싣는다. 이 목록에는 활성 여부가 없어 includeInactive 는 적용하지 않는다.
 */
async function channelMembersView(client: MemberToolClient, input: z.infer<typeof searchMembersInput> & { channelId: number }) {
  const term = input.search?.trim().toLowerCase();
  const rows = (await client.listChannelMembers(input.channelId)).filter(
    (m) =>
      (input.kind === 'ALL' || m.kind === input.kind) &&
      (!term || m.name.toLowerCase().includes(term) || m.username.toLowerCase().includes(term)),
  );
  const start = input.page * input.size;
  const items = rows.slice(start, start + input.size).map((m) => ({ username: m.username, name: m.name, kind: m.kind, role: m.role }));
  return numberedPageView(items, { total: rows.length, hasMore: start + input.size < rows.length, page: input.page });
}

/** 구성원 3종 + 연락처 2종 읽기 도구. */
export function buildMemberTools(client: MemberToolClient & CurrentUserClient): SharedTool[] {
  return [
    {
      name: 'search_members',
      // username 을 받는 도구(일정 참석자·프로젝트/채널 멤버·DM·멘션·그룹 멤버)가 설명에서 이 도구로 확인하라고 하므로 그 앱들에도 싣는다(README "앱 분류").
      // mail·issue 는 제외 — create_issue(_from_mail) 의 assignees 는 선택이고("me" 가능) 안내가 get_project 의 members 를 가리킨다.
      app: ['member', 'calendar', 'project', 'messaging', 'contacts'],
      kind: 'read',
      description:
        'Searches workspace members (구성원) by name, username or email. Pass username to tools that take a person (no numeric ids). kind HUMAN ' +
        '(default), AGENT (AI) or ALL; active only unless includeInactive. With channelId (a channel I belong to), lists its members with ' +
        'role; search matches name or username, includeInactive is ignored. Without channelId, AI rows add description (its role — read it ' +
        'to choose whom to hand work to) and agentRuntime (INTERNAL|EXTERNAL). Returns {items, total, hasMore?, nextPage?}; if hasMore, ' +
        'pass nextPage as page, narrow search, or say the list is partial.',
      inputSchema: searchMembersInput,
      async handler(args) {
        const { channelId, ...query } = searchMembersInput.parse(args);
        if (channelId !== undefined) return JSON.stringify(await channelMembersView(client, { ...query, channelId }));
        const result = await client.searchMembersPage(query);
        return JSON.stringify(numberedPageView(result.items.map(toMemberView), result));
      },
    },
    {
      name: 'get_member',
      app: 'member',
      kind: 'read',
      description:
        'Returns one member by username ("me" = the caller): name, email, title, kind, active, membershipRole, membershipStatus; ' +
        'AI members add description and agentRuntime; "me" adds instructions and slots (work cap).',
      inputSchema: memberInput,
      async handler(args) {
        const { username } = memberInput.parse(args);
        // "me" 는 호출자 본인 — 접속 신원(사람/AI, kind)을 스스로 확인할 때 쓴다(work-loop 1번). getMe 는 PAT·ak_ 키의 주인을 돌려준다.
        // username 으로 다시 검색하지 않고 id 로 단건을 읽는다 — 부분일치 검색은 첫 페이지(50건)만 보므로 짧은 username 이면 밖으로 밀려
        // "없음" 이 될 수 있고, 그러면 work-loop 가 신원 확인에서 매번 멈춘다.
        if (isMeAlias(username)) return JSON.stringify(toMemberView(await client.getMember((await client.getMe()).id)));
        const found = await findMemberByUsername(client, username);
        // 성공 문자열로 돌려주면 "없음" 이 정상 결과로 읽힌다 — contact-tools 처럼 throw 해 isError 로 전달되게 한다.
        if (!found) throw memberNotFound(username);
        return JSON.stringify(toMemberView(found));
      },
    },
    {
      name: 'get_member_contact',
      app: 'member',
      kind: 'read',
      description:
        'Returns the contact card of a member by username: email, title, kind, groups (names) and isFavorite. For external contacts use ' +
        'get_external_contact.',
      inputSchema: memberInput,
      async handler(args) {
        const { username } = memberInput.parse(args);
        const found = await findMemberByUsername(client, username);
        if (!found) throw memberNotFound(username);
        // 응답의 공용 `id` 는 user.id(숫자 사용자 ID)라 내보내지 않는다 — 사람은 응답에 함께 오는 username 으로 가리킨다(#833, WP-353).
        const { id: _userId, groups, ...rest } = (await client.getMemberContact(found.userId)) as { id?: number; groups?: unknown[] };
        return JSON.stringify({ ...rest, groups: groups ?? [] });
      },
    },
    {
      name: 'list_contacts',
      app: 'contacts',
      kind: 'read',
      description:
        'Lists contacts (연락처): MEMBER items (workspace members, by username) and EXTERNAL items (customers, partners; externalId for ' +
        'external-contact tools only); for members search_members is more complete. search: name or email; organization and title: exact values ' +
        'from get_contact_facets. Returns {items, hasMore?, nextCursor?}; if hasMore, pass nextCursor as cursor, or say the list is partial.',
      inputSchema: listContactsInput,
      async handler(args) {
        // 서버 응답은 { items, nextCursor } 래퍼(ContactPage)다.
        const { items = [], nextCursor } = ((await client.listContacts(listContactsInput.parse(args))) ?? {}) as {
          items?: ContactRow[];
          nextCursor?: string | null;
        };
        return JSON.stringify(cursorPageView(items.map(toContactView), { nextCursor }));
      },
    },
    {
      name: 'get_external_contact',
      app: 'contacts',
      kind: 'read',
      description:
        'Returns an external contact by externalId (from list_contacts EXTERNAL items), all fields incl. editable and isFavorite. Members have ' +
        'no externalId: use get_member_contact.',
      inputSchema: externalContactInput,
      async handler(args) {
        const { externalId } = externalContactInput.parse(args);
        return JSON.stringify(await client.getExternalContact(externalId));
      },
    },
  ];
}
