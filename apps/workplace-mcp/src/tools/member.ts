// src/tools/member.ts — 구성원 디렉터리·연락처 읽기 도구 (#833).
//
// 도메인 경계가 이 파일의 존재 이유다. 이전에는 구성원 도구가 없어 "사내 사람 찾기"의 유일한 경로가
// 연락처 목록(type=MEMBER)이었고, 그 결과 연락처 id 를 userId 로 오용하는 사고가 났다.
// 구성원(userId = user.id)과 외부 연락처(externalId = contact_entry.id)는 네임스페이스가 다르므로
// 도구 표면에서 이름을 분리해 노출한다.
//
// 쓰기(역할 변경·활성 토글·계정 생성)는 여기 없다 — PAT 컨텍스트에는 확인 카드가 없어 즉시 실행되므로
// 의도적으로 조회 전용으로 둔다(tools/index.ts 의 "직접 실행 의미론만" 원칙과 동일 선상).
//
// 구성원 조회는 계정 관리 API(/users, ADMIN 전용)가 아니라 구성원 디렉터리(/members, member:read)를
// 쓴다. 일반 구성원의 PAT 로도 사람을 찾을 수 있어야 하고, "디렉터리를 본다"와 "계정을 관리한다"는
// 다른 일이기 때문이다.
import { z } from 'zod';
import type { PatApiClient } from '../clients/workplace-api.js';
import type { McpTool } from './types.js';

/** 연락처 목록 항목 — type 에 따라 id 의 의미가 다르다(MEMBER=user.id, EXTERNAL=contact_entry.id). */
interface ContactSummary {
  type: 'MEMBER' | 'EXTERNAL';
  id: number;
  name: string;
  email: string | null;
  title: string | null;
  organization: string | null;
  isFavorite: boolean;
}

/** ContactSummary → 식별자를 타입별로 분리한 뷰. 공용 `id` 를 없애 오용을 원천 차단한다. */
function toContactView(item: ContactSummary) {
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

/** 구성원 디렉터리 항목 중 username 이 정확히 일치하는 사람. username 은 전역 UNIQUE 라 첫 매치가 유일 매치다. */
async function resolveMember(client: PatApiClient, username: string) {
  const rows = (await client.searchMembers({
    search: username,
    kind: 'ALL',
    includeInactive: true,
    page: 0,
    size: 50,
  })) as { username: string; userId: number }[];
  return rows.find((m) => m.username === username);
}

/** 구성원 3종 + 연락처 2종 도구를 구성한다. */
export function buildMemberTools(client: PatApiClient): McpTool[] {
  const searchMembersInput = z.object({
    search: z.string().optional(),
    kind: z.enum(['HUMAN', 'AGENT', 'ALL']).default('HUMAN'),
    includeInactive: z.boolean().optional(),
    page: z.number().int().min(0).default(0),
    size: z.number().int().min(1).max(100).default(20),
  });
  // #833: 사람은 username 으로 가리킨다. 도구 표면에 숫자 id 를 노출하지 않으면 다른 도메인의 id 를
  // 잘못 넘기는 사고가 구조적으로 불가능해진다(ai-agent 쪽 도구와 동일 계약).
  const memberInput = z.object({ username: z.string().min(1) });
  const listContactsInput = z.object({
    search: z.string().optional(),
    type: z.enum(['MEMBER', 'EXTERNAL']).optional(),
    organization: z.string().optional(),
    title: z.string().optional(),
    favorite: z.boolean().optional(),
    cursor: z.string().optional(),
    limit: z.number().int().min(1).max(100).default(20),
  });
  const externalContactInput = z.object({ externalId: z.number().int().positive() });

  return [
    {
      name: 'search_members',
      description:
        '우리 워크스페이스의 구성원을 검색해 JSON 으로 반환합니다. 사람을 이름으로 찾아 userId 를 확보할 때 쓰는 표준 도구입니다. ' +
        'userId 는 프로젝트 멤버·담당자 지정 등 사람을 가리켜야 하는 곳에 그대로 사용합니다. ' +
        'search 로 이름·아이디·이메일 검색, kind 로 HUMAN(사람, 기본)/AGENT(AI)/ALL 한정. 기본은 활성 구성원만이며 includeInactive=true 로 비활성까지 봅니다.',
      inputSchema: searchMembersInput,
      async handler(args) {
        const params = searchMembersInput.parse(args);
        return JSON.stringify(await client.searchMembers(params));
      },
    },
    {
      name: 'get_member',
      description:
        '구성원 단건(아이디·이메일·직책·활성여부·멤버십 역할)을 JSON 으로 반환합니다. username 은 search_members 로 확보하세요.',
      inputSchema: memberInput,
      async handler(args) {
        const { username } = memberInput.parse(args);
        const found = await resolveMember(client, username);
        return found ? JSON.stringify(found) : `구성원을 찾을 수 없습니다: ${username}`;
      },
    },
    {
      name: 'get_member_contact',
      description:
        '사내 구성원의 연락처 상세(직책·소속 그룹)를 JSON 으로 반환합니다. 조직/소속을 묻는 질문에 적합합니다. ' +
        '외부 연락처는 get_external_contact 를 쓰세요.',
      inputSchema: memberInput,
      async handler(args) {
        const { username } = memberInput.parse(args);
        const found = await resolveMember(client, username);
        if (!found) return `구성원을 찾을 수 없습니다: ${username}`;
        const detail = (await client.getMemberContact(found.userId)) as { id?: number };
        // 응답의 공용 `id` 는 user.id 다 — ai-agent 쪽과 같이 userId 로 이름을 바꿔 모호함을 없앤다.
        const { id, ...rest } = detail;
        return JSON.stringify({ userId: id, ...rest });
      },
    },
    {
      name: 'list_contacts',
      description:
        '연락처 목록을 JSON 으로 반환합니다. type=EXTERNAL 은 외부 연락처(거래처·고객 등), type=MEMBER 는 사내 구성원입니다. ' +
        '**식별자 주의**: MEMBER 항목은 userId, EXTERNAL 항목은 externalId 를 가지며 둘은 서로 호환되지 않습니다. ' +
        '사내 구성원을 찾는 것이 목적이면 이 도구 대신 search_members 를 사용하세요. ' +
        'search/organization/title 로 좁히고, favorite=true 로 즐겨찾기만, nextCursor 를 cursor 로 넘겨 다음 페이지.',
      inputSchema: listContactsInput,
      async handler(args) {
        const params = listContactsInput.parse(args);
        const data = (await client.listContacts(params)) as {
          items?: ContactSummary[];
          nextCursor?: string | null;
        };
        return JSON.stringify({
          items: (data?.items ?? []).map(toContactView),
          nextCursor: data?.nextCursor ?? null,
        });
      },
    },
    {
      name: 'get_external_contact',
      description:
        '외부 연락처 단건 상세를 JSON 으로 반환합니다. externalId 는 list_contacts 의 EXTERNAL 항목이 주는 값입니다. ' +
        '구성원의 userId 를 넣으면 안 됩니다 — 전혀 다른 사람의 연락처가 나옵니다. 구성원 상세는 get_member_contact 를 쓰세요.',
      inputSchema: externalContactInput,
      async handler(args) {
        const { externalId } = externalContactInput.parse(args);
        return JSON.stringify(await client.getExternalContact(externalId));
      },
    },
  ];
}
