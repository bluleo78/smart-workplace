// src/contact-tools.ts — 연락처 부가 기능 도구(#839): 필터 facets·즐겨찾기·사용자 그룹(조직도/개인 그룹). 두 앱 공유.
//
// 사람은 username(구성원) 또는 externalId(외부 연락처)로 가리킨다 — 숫자 user id 를 LLM 표면에 두지 않는다(#833).
// 그룹은 groupId 로 가리킨다(채널 channelId·노트 pageId 와 같은 급의 리소스 id — 이름은 형제 사이에서만 유일해 식별자가 못 된다).
//
// 권한은 서버가 강제한다: 개인(PERSONAL) 그룹은 소유자만, 공유(SHARED) 그룹 쓰기는 user-group:manage(또는 ADMIN) 만.
// 여기 있는 쓰기는 모두 되돌릴 수 있어(재추가·재생성·이름 되돌리기) write 등급이다. 그룹 삭제는 하위 그룹·멤버십까지
// 캐스케이드되고 복원 API 가 없어 여기 두지 않고, ai-agent 의 propose_delete_user_group 확인 카드로만 한다.
import { z } from 'zod';
import type { SharedTool } from './mcp-tool.js';
import { findMemberByUsername } from './member-tools.js';
import type {
  ContactTarget,
  ContactToolClient,
  MemberToolClient,
  UserGroupDetailRow,
  UserGroupMemberRow,
  UserGroupNodeRow,
} from './tool-client.js';

/** 대상 지정 필드 — username(구성원) 과 externalId(외부 연락처) 중 정확히 하나. */
const targetShape = {
  username: z.string().min(1).optional(),
  externalId: z.number().int().positive().optional(),
};

export const contactTargetInput = z.object(targetShape);
export const groupIdInput = z.object({ groupId: z.number().int().positive() });
export const createUserGroupInput = z.object({
  name: z.string().min(1).max(100),
  // 기본 PERSONAL — 공유 조직도(SHARED)는 모든 구성원에게 보이므로 명시할 때만 만든다(권한도 필요).
  visibility: z.enum(['SHARED', 'PERSONAL']).default('PERSONAL'),
  parentGroupId: z.number().int().positive().optional(),
  code: z.string().max(64).optional(),
  sortOrder: z.number().int().optional(),
});
export const updateUserGroupInput = z.object({
  groupId: z.number().int().positive(),
  name: z.string().min(1).max(100).optional(),
  // 생략=유지. 최상위 이동·코드 비우기는 null 대신 명시 플래그로 한다(서버 PATCH 계약과 1:1, #839).
  parentGroupId: z.number().int().positive().optional(),
  moveToRoot: z.boolean().optional(),
  code: z.string().min(1).max(64).optional(),
  clearCode: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});
// 외부 연락처 필드 — 서버 ExternalContactRequest 와 1:1(#839).
const externalContactFields = {
  name: z.string().min(1).max(120),
  email: z.string().max(255).optional(),
  phone: z.string().max(40).optional(),
  organization: z.string().max(120).optional(),
  title: z.string().max(100).optional(),
  notes: z.string().optional(),
  visibility: z.enum(['SHARED', 'PERSONAL']),
};
// 이름+이메일이 겹치는 연락처가 이미 있으면 서버가 409 경고를 준다 — 사용자가 그래도 저장하라고 확인했을 때만 true.
const forceField = { force: z.boolean().optional() };
export const createExternalContactInput = z.object({ ...externalContactFields, ...forceField });
// 수정은 부분 수정(서버 PATCH 가 null=유지) — 모든 필드 optional. 빈 문자열은 비우기(이름 제외).
export const updateExternalContactInput = z.object({
  externalId: z.number().int().positive(),
  ...z.object(externalContactFields).partial().shape,
  ...forceField,
});
export const userGroupMemberInput = z.object({ groupId: z.number().int().positive(), ...targetShape });

/**
 * username / externalId 중 정확히 하나를 서버 대상(targetType·targetId)으로 해석한다.
 * 구성원을 못 찾으면 안내 문구로 throw 한다 — 도구 핸들러 예외는 isError 결과로 LLM 에 그대로 전달돼 search_members 로 자가교정하게 한다.
 */
export async function resolveContactTarget(
  client: Pick<MemberToolClient, 'searchMembers'>,
  input: { username?: string; externalId?: number },
): Promise<ContactTarget> {
  const { username, externalId } = input;
  if ((username === undefined) === (externalId === undefined)) {
    // 둘 다 없거나 둘 다 있으면 어느 네임스페이스인지 모호하다 — 추측하지 않고 거절한다.
    throw new Error('username(구성원) 또는 externalId(외부 연락처) 중 정확히 하나를 지정하세요.');
  }
  if (externalId !== undefined) return { targetType: 'EXTERNAL', targetId: externalId };
  const member = await findMemberByUsername(client, username!);
  if (!member) {
    throw new Error(`구성원 '${username}' 을(를) 찾을 수 없습니다. search_members 로 정확한 username 을 확인하세요.`);
  }
  return { targetType: 'MEMBER', targetId: member.userId };
}

/** 그룹 트리 노드 LLM 뷰 — ownerId(숫자 user id)·parentId(중첩으로 표현됨)를 빼고 groupId 로 이름을 바꾼다. */
export function toUserGroupNodeView(node: UserGroupNodeRow): unknown {
  return {
    groupId: node.id,
    name: node.name,
    code: node.code ?? null,
    visibility: node.visibility,
    children: (node.children ?? []).map(toUserGroupNodeView),
  };
}

/** 그룹 멤버 LLM 뷰 — 구성원은 username, 외부 연락처는 externalId 로만 가리킨다(공용 targetId 제거, #833). */
export function toUserGroupMemberView(m: UserGroupMemberRow) {
  const base = { type: m.targetType, name: m.name, email: m.email ?? null, title: m.title ?? null };
  return m.targetType === 'MEMBER'
    ? { ...base, username: m.username ?? null }
    : { ...base, externalId: m.targetId, organization: m.organization ?? null };
}

/** 그룹 상세 LLM 뷰 — ownerId 제거, id 는 groupId/parentGroupId 로 명명. */
export function toUserGroupDetailView(g: UserGroupDetailRow) {
  return {
    groupId: g.id,
    name: g.name,
    code: g.code ?? null,
    parentGroupId: g.parentId ?? null,
    visibility: g.visibility,
    sortOrder: g.sortOrder ?? 0,
    members: (g.members ?? []).map(toUserGroupMemberView),
  };
}

/** 대상 지정 설명(여러 도구 공통). */
const TARGET_HINT =
  '대상은 username(사내 구성원 — search_members 가 주는 값) 또는 externalId(외부 연락처 — list_contacts 의 EXTERNAL 항목) 중 정확히 하나로 지정합니다.';

/** 연락처 facets·즐겨찾기·사용자 그룹 도구. */
export function buildContactTools(client: ContactToolClient & Pick<MemberToolClient, 'searchMembers'>): SharedTool[] {
  return [
    {
      name: 'get_contact_facets',
      app: 'contacts',
      kind: 'read',
      description:
        '외부 연락처에 쓰인 조직(organizations)·직책(titles) 목록을 JSON 으로 반환합니다. ' +
        'list_contacts 의 organization/title 필터는 정확일치이므로, 값을 추측하지 말고 이 목록에서 고르세요.',
      inputSchema: z.object({}),
      async handler() {
        return JSON.stringify(await client.getContactFacets());
      },
    },
    {
      name: 'add_contact_favorite',
      app: 'contacts',
      kind: 'write',
      hints: { destructive: false, idempotent: true },
      description: `연락처를 내 즐겨찾기에 추가합니다(이미 있으면 그대로). ${TARGET_HINT}`,
      inputSchema: contactTargetInput,
      async handler(args) {
        const target = await resolveContactTarget(client, contactTargetInput.parse(args));
        await client.addContactFavorite(target);
        return JSON.stringify({ favorite: true });
      },
    },
    {
      name: 'remove_contact_favorite',
      app: 'contacts',
      kind: 'write',
      hints: { destructive: true, idempotent: true },
      description: `연락처를 내 즐겨찾기에서 뺍니다(없어도 그대로). ${TARGET_HINT}`,
      inputSchema: contactTargetInput,
      async handler(args) {
        const target = await resolveContactTarget(client, contactTargetInput.parse(args));
        await client.removeContactFavorite(target);
        return JSON.stringify({ favorite: false });
      },
    },
    {
      name: 'list_user_groups',
      app: 'contacts',
      kind: 'read',
      description:
        '사용자 그룹 트리를 JSON 으로 반환합니다. shared 는 모두가 보는 공유 조직도, personal 은 내 개인 그룹입니다. ' +
        '각 노드의 groupId 를 get_user_group·그룹 수정/멤버 도구에 넘기세요(children 은 하위 그룹).',
      inputSchema: z.object({}),
      async handler() {
        const { shared = [], personal = [] } = (await client.listUserGroups()) ?? {};
        return JSON.stringify({ shared: shared.map(toUserGroupNodeView), personal: personal.map(toUserGroupNodeView) });
      },
    },
    {
      name: 'get_user_group',
      app: 'contacts',
      kind: 'read',
      description:
        '사용자 그룹 상세와 직속 멤버를 JSON 으로 반환합니다. 멤버 중 구성원은 username, 외부 연락처는 externalId 로 표시됩니다. ' +
        'groupId 는 list_user_groups 로 확보하세요.',
      inputSchema: groupIdInput,
      async handler(args) {
        const { groupId } = groupIdInput.parse(args);
        return JSON.stringify(toUserGroupDetailView(await client.getUserGroup(groupId)));
      },
    },
    {
      name: 'create_user_group',
      app: 'contacts',
      kind: 'write',
      hints: { destructive: false, idempotent: false },
      description:
        '사용자 그룹을 만듭니다. visibility 기본은 PERSONAL(나만 보는 개인 그룹)이고, SHARED(공유 조직도)는 조직도 관리 권한이 있어야 합니다. ' +
        'parentGroupId 를 주면 그 그룹의 하위로 만듭니다(같은 공개 범위의 그룹만, 개인 그룹은 내 것만). 같은 상위 아래 같은 이름은 만들 수 없습니다.',
      inputSchema: createUserGroupInput,
      async handler(args) {
        const { parentGroupId, ...rest } = createUserGroupInput.parse(args);
        return JSON.stringify(toUserGroupDetailView(await client.createUserGroup({ ...rest, parentId: parentGroupId })));
      },
    },
    {
      name: 'update_user_group',
      app: 'contacts',
      kind: 'write',
      hints: { destructive: true, idempotent: true },
      description:
        '사용자 그룹의 이름·상위 그룹·코드·정렬 순서를 바꿉니다. 준 필드만 바뀌고 나머지는 유지됩니다. ' +
        '최상위로 옮기려면 moveToRoot: true, 코드를 비우려면 clearCode: true 를 주세요(parentGroupId·code 와 함께 줄 수 없음). ' +
        '공개 범위(visibility)는 바꿀 수 없습니다. ' +
        '개인 그룹은 소유자만, 공유 그룹은 조직도 관리 권한이 있어야 합니다.',
      inputSchema: updateUserGroupInput,
      async handler(args) {
        const { groupId, parentGroupId, ...rest } = updateUserGroupInput.parse(args);
        if (Object.values({ parentGroupId, ...rest }).every((v) => v === undefined)) {
          throw new Error('바꿀 필드(name·parentGroupId·moveToRoot·code·clearCode·sortOrder) 중 하나 이상을 지정하세요.');
        }
        // 서버 PATCH 가 부분 수정(생략=유지)이라 준 필드만 그대로 넘긴다 — 병합은 서버가 한 트랜잭션에서 한다.
        const updated = await client.updateUserGroup(groupId, { ...rest, parentId: parentGroupId });
        return JSON.stringify(toUserGroupDetailView(updated));
      },
    },
    {
      name: 'add_user_group_member',
      app: 'contacts',
      kind: 'write',
      hints: { destructive: false, idempotent: true },
      description: `사용자 그룹에 구성원 또는 외부 연락처를 넣습니다(이미 있으면 그대로). ${TARGET_HINT} 갱신된 그룹 상세를 반환합니다.`,
      inputSchema: userGroupMemberInput,
      async handler(args) {
        const { groupId, ...who } = userGroupMemberInput.parse(args);
        const target = await resolveContactTarget(client, who);
        return JSON.stringify(toUserGroupDetailView(await client.addUserGroupMember(groupId, target)));
      },
    },
    {
      name: 'remove_user_group_member',
      app: 'contacts',
      kind: 'write',
      hints: { destructive: true, idempotent: true },
      description: `사용자 그룹에서 구성원 또는 외부 연락처를 뺍니다(사람·연락처 자체는 지워지지 않음). ${TARGET_HINT}`,
      inputSchema: userGroupMemberInput,
      async handler(args) {
        const { groupId, ...who } = userGroupMemberInput.parse(args);
        const target = await resolveContactTarget(client, who);
        await client.removeUserGroupMember(groupId, target);
        return JSON.stringify({ groupId, removed: true });
      },
    },
    {
      name: 'create_external_contact',
      app: 'contacts',
      kind: 'write',
      hints: { destructive: false, idempotent: false },
      description:
        '외부 연락처를 생성합니다. visibility 는 SHARED(공유)/PERSONAL(개인). 생성 결과를 JSON 으로 반환합니다. ' +
        '같은 이름+이메일의 연락처가 이미 있으면 중복 경고 오류가 납니다 — 사용자에게 알리고, 그래도 만들라고 확인받은 경우에만 force: true 로 다시 호출하세요.',
      inputSchema: createExternalContactInput,
      async handler(args) {
        const { force, ...input } = createExternalContactInput.parse(args);
        return JSON.stringify(await client.createExternalContact(input, force));
      },
    },
    {
      name: 'update_external_contact',
      app: 'contacts',
      kind: 'write',
      // 준 필드로 현재 값을 덮어쓴다(destructive). 병합 후 같은 값이면 저장 상태가 그대로이고, 중복 판정은 자기 자신을 제외해 다시 불러도 같은 결과(멱등).
      hints: { destructive: true, idempotent: true },
      description:
        '외부 연락처를 수정합니다. 준 필드만 바뀌고 나머지는 유지됩니다(빈 문자열 "" 은 그 값 비우기, 이름은 비울 수 없음). ' +
        '수정 결과 이름+이메일이 다른 연락처와 겹치면 중복 경고 오류가 납니다 — 사용자 확인 후에만 force: true 로 다시 호출하세요. ' +
        'externalId 는 list_contacts 의 EXTERNAL 항목이 주는 값입니다 — 구성원의 userId 를 넣으면 엉뚱한 사람의 연락처가 바뀝니다.',
      inputSchema: updateExternalContactInput,
      async handler(args) {
        const { externalId, force, ...patch } = updateExternalContactInput.parse(args);
        // 생략 필드는 JSON 에서 빠져 서버가 유지한다. 아무것도 안 바꾸는 호출은 LLM 의 실수라 조용히 성공시키지 않는다.
        if (Object.values(patch).every((v) => v === undefined)) {
          throw new Error('바꿀 필드(name·email·phone·organization·title·notes·visibility) 중 하나 이상을 지정하세요.');
        }
        return JSON.stringify(await client.updateExternalContact(externalId, patch, force));
      },
    },
  ];
}
