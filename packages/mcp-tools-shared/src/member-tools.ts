// src/member-tools.ts — 구성원 디렉터리·연락처 읽기 도구 5종. 두 앱 공유(#833 → #846).
//
// 구성원(userId = user.id)과 외부 연락처(externalId = contact_entry.id)는 네임스페이스가 다르다. 이전에는 연락처 id 를
// userId 로 오용하는 사고가 있었으므로 도구 표면에서 이름을 분리한다. 사람은 username 으로 가리키고 숫자 id 는 노출을 최소화한다.
// 외부 연락처 생성·수정·삭제와 구성원 역할·활성 변경은 ai-agent 쪽에만 있다(삭제·구성원 변경은 확인 카드).
// 즐겨찾기·facets·사용자 그룹(#839)은 contact-tools.ts — 사용자 본인 범위의 되돌릴 수 있는 쓰기라 공유 도구로 둔다.
import { z } from 'zod';
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
      kind: 'read',
      description:
        '우리 워크스페이스의 구성원을 검색해 JSON 으로 반환합니다. 사람을 찾을 때 쓰는 표준 도구입니다. ' +
        '각 항목의 username 을 담당자(assignees)·멤버 추가·get_member 등 사람을 가리키는 도구에 그대로 넘기세요(숫자 userId 가 아님). ' +
        'search 로 이름·아이디·이메일 검색, kind 로 HUMAN(사람, 기본)/AGENT(AI)/ALL 한정. 기본은 활성 구성원만이며 includeInactive=true 로 비활성까지 봅니다.',
      inputSchema: searchMembersInput,
      async handler(args) {
        return JSON.stringify(await client.searchMembers(searchMembersInput.parse(args)));
      },
    },
    {
      name: 'get_member',
      kind: 'read',
      description: '구성원 단건(아이디·이메일·직책·활성여부·멤버십 역할)을 JSON 으로 반환합니다. username 은 search_members 로 확보하세요.',
      inputSchema: memberInput,
      async handler(args) {
        const { username } = memberInput.parse(args);
        const found = await findMemberByUsername(client, username);
        return found ? JSON.stringify(found) : `구성원을 찾을 수 없습니다: ${username}`;
      },
    },
    {
      name: 'get_member_contact',
      kind: 'read',
      description:
        '사내 구성원의 연락처 상세(직책·소속 그룹·즐겨찾기 여부)를 JSON 으로 반환합니다. 조직/소속을 묻는 질문에 적합합니다. ' +
        '외부 연락처가 아니라 구성원용입니다 — 외부 연락처는 get_external_contact 를 쓰세요.',
      inputSchema: memberInput,
      async handler(args) {
        const { username } = memberInput.parse(args);
        const found = await findMemberByUsername(client, username);
        if (!found) return `구성원을 찾을 수 없습니다: ${username}`;
        // 응답의 공용 `id` 는 user.id 다 — userId 로 이름을 바꿔 외부 연락처 id 와의 모호함을 없앤다.
        const { id, groups, ...rest } = (await client.getMemberContact(found.userId)) as { id?: number; groups?: unknown[] };
        return JSON.stringify({ userId: id, ...rest, groups: groups ?? [] });
      },
    },
    {
      name: 'list_contacts',
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
