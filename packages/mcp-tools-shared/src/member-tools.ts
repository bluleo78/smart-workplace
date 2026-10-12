// src/member-tools.ts — 구성원 디렉터리·연락처 읽기 도구 5종. 두 앱 공유(#833 → #846).
//
// 구성원(userId = user.id)과 외부 연락처(externalId = contact_entry.id)는 네임스페이스가 다르다. 이전에는 연락처 id 를
// userId 로 오용하는 사고가 있었으므로 도구 표면에서 이름을 분리한다. 사람은 username 으로 가리키고 숫자 id 는 노출을 최소화한다.
// 외부 연락처 생성·수정·삭제와 구성원 역할·활성 변경은 ai-agent 쪽에만 있다(삭제·구성원 변경은 확인 카드).
// 즐겨찾기·facets·사용자 그룹(#839)은 contact-tools.ts — 사용자 본인 범위의 되돌릴 수 있는 쓰기라 공유 도구로 둔다.
import { z } from 'zod';
import { numberedPageView } from './compact.js';
import type { SharedTool } from './mcp-tool.js';
import type { MemberRow, MemberToolClient } from './tool-client.js';

/** 연락처 목록 항목 원형 — type 에 따라 id 의 의미가 다르다(MEMBER=user.id, EXTERNAL=contact_entry.id). */
export interface ContactRow {
  type: 'MEMBER' | 'EXTERNAL';
  id: number;
  name: string;
  email?: string | null;
  title?: string | null;
  organization?: string | null;
  isFavorite?: boolean;
}

/**
 * 구성원 행 → LLM 뷰. 숫자 userId 는 빼고 사람을 가리키는 username 만 준다(#833, WP-353). 쓰기 도구는 username 을 받아
 * 서버 쪽 id 로 해석하므로(requireMember 등) LLM 이 userId 를 알 필요가 없다. 나머지 필드(kind·active·email 등)는 그대로 둔다.
 */
export function toMemberView({ userId: _userId, ...rest }: MemberRow): Omit<MemberRow, 'userId'> {
  return rest;
}

/** 연락처 LLM 뷰 — 공용 `id` 를 없애고 타입별 식별자(userId / externalId)로 나눠 오용을 막는다. */
export function toContactView(item: ContactRow) {
  const base = {
    type: item.type,
    name: item.name,
    email: item.email ?? null,
    title: item.title ?? null,
    organization: item.organization ?? null,
    isFavorite: Boolean(item.isFavorite),
  };
  return item.type === 'MEMBER' ? { ...base, userId: item.id } : { ...base, externalId: item.id };
}

/**
 * 구성원 부분일치 검색(테넌트 스코프). 서버가 정확일치 행을 맨 앞에 정렬하므로(#844) 같은 조각을 가진 사람이 많아도
 * 정확일치 대상은 첫 페이지에 들어온다 — 호출측은 이 결과에서 정확일치만 골라 쓴다.
 */
export function searchMembersByTerm(
  client: Pick<MemberToolClient, 'searchMembers'>,
  term: string,
  includeInactive: boolean,
): Promise<MemberRow[]> {
  return client.searchMembers({ search: term, kind: 'ALL', includeInactive, page: 0, size: 50 });
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

/** 구성원 3종 + 연락처 2종 읽기 도구. */
export function buildMemberTools(client: MemberToolClient): SharedTool[] {
  return [
    {
      name: 'search_members',
      // username 을 받는 도구(일정 참석자·프로젝트/채널 멤버·DM·멘션·그룹 멤버)가 설명에서 이 도구로 확인하라고 하므로 그 앱들에도 싣는다(README "앱 분류").
      // mail·issue 는 제외 — create_issue(_from_mail) 의 assignees 는 선택이고("me" 가능) 안내가 get_project 의 members 를 가리킨다.
      app: ['member', 'calendar', 'project', 'messaging', 'contacts'],
      kind: 'read',
      description:
        '우리 워크스페이스의 구성원을 검색해 JSON 으로 반환합니다. 사람을 찾을 때 쓰는 표준 도구입니다. ' +
        '각 항목의 username 을 담당자(assignees)·멤버 추가·get_member 등 사람을 가리키는 도구에 그대로 넘기세요(응답에 숫자 id 는 없습니다). ' +
        'search 로 이름·아이디·이메일 검색, kind 로 HUMAN(사람, 기본)/AGENT(AI)/ALL 한정. 기본은 활성 구성원만이며 includeInactive=true 로 비활성까지 봅니다. ' +
        '결과는 JSON({items, total, hasMore?, nextPage?})이고 한 번에 size 명(기본 20, 최대 100)만 담깁니다. hasMore 가 있으면(true) 뒤에 더 있으니 ' +
        'nextPage 를 page 로 넘겨 이어 조회하거나, search 를 더 좁히거나, 일부만 본 것이라고 밝히세요.',
      inputSchema: searchMembersInput,
      async handler(args) {
        const result = await client.searchMembersPage(searchMembersInput.parse(args));
        return JSON.stringify(numberedPageView(result.items.map(toMemberView), result));
      },
    },
    {
      name: 'get_member',
      app: 'member',
      kind: 'read',
      description: '구성원 단건(아이디·이메일·직책·활성여부·멤버십 역할)을 JSON 으로 반환합니다. username 은 search_members 로 확보하세요.',
      inputSchema: memberInput,
      async handler(args) {
        const { username } = memberInput.parse(args);
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
        '사내 구성원의 연락처 상세(직책·소속 그룹·즐겨찾기 여부)를 JSON 으로 반환합니다. 조직/소속을 묻는 질문에 적합합니다. ' +
        '외부 연락처가 아니라 구성원용입니다 — 외부 연락처는 get_external_contact 를 쓰세요.',
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
        '연락처 목록을 JSON 으로 반환합니다. type=EXTERNAL 은 외부 연락처(거래처·고객 등), type=MEMBER 는 사내 구성원입니다. ' +
        '**식별자 주의**: MEMBER 항목은 userId(= 사내 구성원 id), EXTERNAL 항목은 externalId(= 외부 연락처 id)를 가지며 둘은 서로 호환되지 않습니다. ' +
        'externalId 는 외부 연락처 도구에만 사용하세요. 사내 구성원을 찾는 것이 목적이면 이 도구 대신 search_members 를 사용하세요(username·활성여부 등 더 정확한 정보를 줍니다). ' +
        'search 로 이름·이메일 검색, organization/title 로 좁히기, favorite=true 로 즐겨찾기만, nextCursor 를 cursor 로 넘겨 다음 페이지.',
      inputSchema: listContactsInput,
      async handler(args) {
        // 서버 응답은 { items, nextCursor } 래퍼(ContactPage)다.
        const { items = [], nextCursor = null } = ((await client.listContacts(listContactsInput.parse(args))) ?? {}) as {
          items?: ContactRow[];
          nextCursor?: string | null;
        };
        return JSON.stringify({ items: items.map(toContactView), nextCursor });
      },
    },
    {
      name: 'get_external_contact',
      app: 'contacts',
      kind: 'read',
      description:
        '외부 연락처 단건 상세를 JSON 으로 반환합니다. externalId 는 list_contacts 의 EXTERNAL 항목이 주는 값입니다. ' +
        '구성원(MEMBER)의 userId 를 넣으면 안 됩니다 — 전혀 다른 사람의 연락처가 나옵니다. 구성원 상세는 get_member_contact 를 쓰세요.',
      inputSchema: externalContactInput,
      async handler(args) {
        const { externalId } = externalContactInput.parse(args);
        return JSON.stringify(await client.getExternalContact(externalId));
      },
    },
  ];
}
