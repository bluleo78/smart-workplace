// src/project-tools.ts — 프로젝트 조회 2종 + 이슈 목록 조회 + 프로젝트 정보 수정·생성·멤버 추가. 두 앱 공유(#846, #854, WP-349).
// 생성·멤버 추가는 외부 MCP 에 직접 실행 도구로 노출하고, AI Chat 은 같은 작업을 propose_create_project·propose_add_project_member
// 확인 카드로 한다(경로마다 도구 하나 — ai-agent 프로필에는 싣지 않는다). 두 경로가 입력 스키마(createProjectInput·addProjectMemberInput)와
// 대상 해석(requireActiveMember)·요청 본문 변환(toCreateProjectBody)을 같이 쓴다. 직접 실행 멤버 추가는 MEMBER 로만 한다 — OWNER 로
// 들이는 것은 권한 부여(README "계속 빼 둘 것: 구성원 권한 변경")라 카드만 한다. 삭제·멤버 역할 변경·제거도 계속 확인 카드만 한다.
import { z } from 'zod';
import type { SharedTool } from './mcp-tool.js';
import { requireActiveMember } from './member-tools.js';
import { defaultListAssignee, resolveCycleFilter } from './resolve.js';
import { formatIssueKey } from './parse.js';
import { cursorPageView, dropEmpty, numberedPageView, omitKeys } from './compact.js';
import { labelNames, toChildrenView, toParentView, toPeopleView, toSeoulIso, typeName } from './issue-view.js';
import { listIssuesInput } from './schemas.js';
import type { CreateProjectBody, IssueListQuery, IssueRow, MemberToolClient, ProjectToolClient } from './tool-client.js';

export const listProjectsInput = z.object({
  page: z.number().int().min(0).default(0),
  size: z.number().int().min(1).max(100).default(50),
});
export const projectKeyInput = z.object({ projectKey: z.string().min(1) });
export const updateProjectInput = z
  .object({
    projectKey: z.string().min(1),
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().max(2000).nullable().optional(), // null=설명 비우기, 생략=유지
  })
  .refine((v) => v.name !== undefined || v.description !== undefined, { message: 'name 이나 description 중 하나는 주세요.' });

/**
 * 프로젝트 생성 입력(WP-349) — create_project 와 확인 카드 propose_create_project(이 스키마 + summary)가 같이 쓴다.
 * #846: 프로젝트는 조회 도구와 같은 이름 projectKey 로 가리킨다(서버 필드 key 로는 toCreateProjectBody 가 옮긴다).
 * 형식은 서버 CreateProjectRequest 의 @Pattern 과 같다. type 은 서버가 TEAM·OPEN·PERSONAL 외를 409 로 거절한다.
 */
export const createProjectInput = z.object({
  projectKey: z.string().regex(/^[A-Z][A-Z0-9]{1,9}$/),
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
  type: z.string().optional(),
});
/**
 * 프로젝트 멤버 추가 입력(WP-349) — add_project_member 와 확인 카드 propose_add_project_member 가 같이 쓰는 기반.
 * role 은 없다: 직접 실행 도구는 늘 MEMBER 로 추가하고, OWNER 를 고를 수 있는 것은 카드(이 스키마 + role + summary)뿐이다 —
 * OWNER 는 멤버 관리·프로젝트 삭제까지 넘기는 권한 부여라 확인 없이 실행되는 도구에 두지 않는다.
 * #833: 숫자 id 대신 username 을 받는다. 이슈 도구(create_issue 의 assignees)와 같은 방식이며,
 * LLM 표면에 숫자 식별자를 노출하지 않으면 "연락처 id 를 userId 로 넣는" 사고 자체가 불가능해진다.
 */
export const addProjectMemberInput = z.object({
  projectKey: z.string().min(1),
  username: z.string().min(1),
});

/** 생성 입력 → 서버 본문. 확인 카드 실행기(project.create_project)와 POST /projects 가 같은 CreateProjectRequest 로 받는다. */
export function toCreateProjectBody({ projectKey, ...rest }: z.infer<typeof createProjectInput>): CreateProjectBody {
  return { key: projectKey, ...rest };
}

/**
 * GET /me/issues 이슈 행 → LLM 뷰. 사람은 username 으로만 노출한다(#833 — 숫자 id 를 쓰기 도구로 흘려보내지 않게).
 * WP-307: 날짜(시작·생성·수정·종료)·라벨·마일스톤·부모·하위 진행률을 싣는다. 본문·코멘트·이력은 상세(get_issue_detail)에만 둔다.
 */
export function toIssueListItem(it: IssueRow) {
  const { projectKey, number } = it;
  return {
    issueKey: it.issueKey ?? (formatIssueKey(projectKey, number) ?? String(it.id ?? '')),
    title: it.title ?? '',
    status: it.status ?? '',
    priority: it.priority ?? '',
    type: typeName(it.type),
    assignees: toPeopleView(it.assignees),
    dueDate: it.dueDate ?? null,
    startDate: it.startDate ?? null,
    createdAt: toSeoulIso(it.createdAt),
    updatedAt: toSeoulIso(it.updatedAt),
    closedAt: toSeoulIso(it.closedAt),
    labels: labelNames(it.labels),
    milestone: it.milestoneName ?? null,
    parent: toParentView(it.parent, projectKey),
    children: toChildrenView(it.childCount, it.childDoneCount),
    blocked: Boolean(it.blocked),
  };
}

/**
 * 프로젝트 응답 → LLM 뷰. 소유자 ownerId 는 숫자 사용자 ID 라 내보내지 않는다(#833, WP-353). 서버 응답에는 소유자 이름이 없지만
 * 소유자는 get_project 의 members 에 role: OWNER 로 username·name 과 함께 나오므로(이미 함께 조회하는 값) 정보가 사라지지 않는다.
 * 크기 정리(WP-353): 프로젝트 도구는 모두 projectKey 로 가리키므로 숫자 id 를 빼고(서버 필드 key 는 projectKey 로 이름을 바꾼다), 상위 3명 이름(memberNames — 프론트 아바타용)과
 * 기본 프로젝트가 아닐 때의 isDefault:false, 값이 없는 키(설명 null 등)를 뺀다. 프로젝트마다 반복되는 필드라 목록에서 효과가 크다.
 */
export function toProjectView(project: Record<string, unknown>) {
  // 서버 필드 key 는 출력에서 projectKey 로 부른다 — 이 값을 받는 입력(get_project·list_issues·create_issue 등)과 같은 이름(README 파라미터 명명 규칙 2).
  const { isDefault, key, ...rest } = omitKeys(project, 'ownerId', 'id', 'memberNames');
  return dropEmpty({ ...(key !== undefined && { projectKey: key }), ...rest, ...(isDefault === true && { isDefault: true }) });
}

/** 프로젝트 멤버 → LLM 뷰. 숫자 userId 는 빼고 사람을 가리키는 username 만 준다(#833). get_project 의 members 에 쓴다. */
export function toProjectMemberView({ username, name, role }: { username: string; name?: string; role?: string }) {
  return { username, name, role };
}

/** 프로젝트·이슈 목록 조회 도구 3종(list_projects/get_project/list_issues) + 프로젝트 쓰기(update_project/create_project/add_project_member). */
export function buildProjectTools(client: ProjectToolClient & Pick<MemberToolClient, 'searchMembers'>): SharedTool[] {
  return [
    {
      name: 'list_projects',
      app: ['project', 'issue'],
      kind: 'read',
      description:
        '접근 가능한 프로젝트 목록을 JSON({items, total, hasMore?, nextPage?})으로 반환합니다(항목: projectKey·name·description·type·issueTotal·issueDone·memberCount·viewerIsMember 등, 값이 없는 키는 생략). ' +
        'total 은 전체 프로젝트 수입니다. ' +
        'page/size 로 페이지네이션합니다(기본 0/50, size 최대 100). hasMore 가 있으면(true) 뒤에 더 있다는 뜻이니 nextPage 를 page 로 넘겨 이어 조회하거나, ' +
        '이어 조회하지 않고 답한다면 목록이 일부만 담겼다고 밝히세요.',
      inputSchema: listProjectsInput,
      async handler(args) {
        const { page, size } = listProjectsInput.parse(args);
        const result = await client.listProjects(page, size);
        return JSON.stringify(numberedPageView((result.items as Record<string, unknown>[]).map(toProjectView), result));
      },
    },
    {
      name: 'get_project',
      app: ['project', 'issue'],
      kind: 'read',
      description:
        '프로젝트 상세(projectKey·name·description·type)와 이 프로젝트에서 쓸 수 있는 이슈 유형(issueTypes)·라벨(labels)·마일스톤(milestones) 이름, ' +
        '사이클(cycles: name·status), 멤버(members: username·name·role)를 JSON 으로 반환합니다. ' +
        'create_issue/update_issue 의 type·labels·milestone·cycles 는 이 목록의 이름만, assignees 는 members 의 username 만 사용하세요.',
      inputSchema: projectKeyInput,
      async handler(args) {
        const { projectKey } = projectKeyInput.parse(args);
        // #844: 이슈 쓰기 도구의 type·labels·assignees(#854: milestone·cycles) 값을 조회로 조달하게 한다(추측 방지). 모두 독립 조회라 병렬.
        const [project, types, labels, milestones, cycles, members] = await Promise.all([
          client.getProject(projectKey),
          client.getProjectTypes(projectKey),
          client.getProjectLabels(projectKey),
          client.getProjectMilestones(projectKey),
          client.getProjectCycles(projectKey),
          client.getProjectMembers(projectKey),
        ]);
        return JSON.stringify({
          ...toProjectView(project as Record<string, unknown>),
          issueTypes: types.map((t) => t.name),
          labels: labels.map((l) => l.name),
          milestones: milestones.map((m) => m.name),
          cycles: cycles.map(({ name, status }) => ({ name, status })),
          members: members.map(toProjectMemberView),
        });
      },
    },
    {
      name: 'list_issues',
      app: 'issue',
      kind: 'read',
      description:
        '이슈 목록을 JSON({items, hasMore?, nextCursor?})으로 반환합니다. 한 번에 size 건(기본 30, 최대 100)만 담기므로, 끝이 아니면 hasMore:true 와 nextCursor 가 옵니다 — ' +
        '그 값을 cursor 로 넘겨(필터·size 는 같게) 이어 조회하거나, 이어 조회하지 않고 답한다면 목록이 일부만 담겼다고 밝히세요(전부로 오해해 집계하지 마세요). ' +
        'hasMore 가 있어도 다음 페이지가 비어 있을 수 있고, 그러면 끝입니다. 이 키들이 없으면 전부 담긴 것입니다. ' +
        'assignee·reporter 둘 다 생략 시 내 담당("me")이고, 담당자와 무관하게 보려면 assignee="any". ' +
        'projectKey·status·priority·label·type·cycle·q·dueFrom/dueTo·blocked·topLevel 로 좁힙니다. ' +
        '사람은 username, 라벨·유형은 이름으로 지정하고(get_project 가 목록 제공), 없는 값이면 사용 가능 목록을 담은 오류가 옵니다. ' +
        'closedFrom/closedTo(종료일)·createdFrom/createdTo(생성일)는 Asia/Seoul 날짜(yyyy-MM-dd, 양끝 포함)이며, 종료일 범위는 DONE·CANCELED 모두 걸리니 ' +
        '"완료한 이슈"는 status=DONE 을 함께 주세요. ' +
        '각 항목은 issueKey·title·status·priority·type·assignees·dueDate·startDate·createdAt·updatedAt·closedAt(시각은 +09:00)·labels·milestone·' +
        'parent·children(하위 진행률)·blocked 를 포함하며, 값이 없는 키(null·빈 배열)는 생략됩니다. 본문·코멘트·변경 이력은 issueKey 로 get_issue_detail 을 호출하세요.',
      inputSchema: listIssuesInput,
      async handler(args) {
        const { priority, size, cycle: cycleCsv, ...p } = listIssuesInput.parse(args);
        const assignee = defaultListAssignee(p);
        // WP-176: 사이클 이름·active·none·backlog → 서버 토큰(id·none·null). 해석 실패는 조회 전에 throw.
        const cycle = cycleCsv ? await resolveCycleFilter(client, p.projectKey, cycleCsv) : undefined;
        // undefined 필드는 쿼리에서 뺀다 — 서버는 빈 값과 미지정을 다르게 볼 수 있다.
        const query: IssueListQuery = Object.fromEntries(
          Object.entries({ ...p, assignee, cycle }).filter((e): e is [string, string | boolean] => e[1] !== undefined),
        );
        if (priority?.length) query.priority = priority.join(',');
        query.size = size ?? 30;
        const page = await client.listIssues(query);
        // #850: 행마다 반복되는 null·빈 배열 키는 빼 토큰을 줄인다(빠진 키 = 값 없음).
        // WP-352: size 를 안 줘도 기본 30건에서 잘리므로, 다음 페이지가 있으면 hasMore·nextCursor 로 알린다(없으면 생략).
        return JSON.stringify(cursorPageView(page.items.map((it) => dropEmpty(toIssueListItem(it))), page));
      },
    },
    {
      name: 'update_project',
      app: 'project',
      kind: 'write',
      hints: { destructive: true, idempotent: true },
      description:
        '프로젝트 이름·설명을 바꿉니다. 준 필드만 바뀌고 나머지는 유지됩니다(description: null 은 설명 비우기). 프로젝트 OWNER 만 할 수 있습니다.',
      inputSchema: updateProjectInput,
      async handler(args) {
        const { projectKey, name, description } = updateProjectInput.parse(args);
        // 서버 PATCH 는 부분 수정(#858) — 준 필드만 보낸다. 설명 비우기(null)는 clearDescription 플래그로 표현한다.
        const updated = await client.updateProject(
          projectKey,
          description === null ? { name, clearDescription: true } : { name, description },
        );
        return JSON.stringify(toProjectView(updated as Record<string, unknown>));
      },
    },
    {
      name: 'create_project',
      app: 'project',
      kind: 'write',
      // 새 프로젝트를 추가만 한다. 같은 키로 다시 부르면 409(이미 사용 중인 key — ProjectService.validateCreatable),
      // PERSONAL 은 키를 서버가 정해 하나 더 생기므로 멱등이 아니다. 워크스페이스 밖에 닿지 않는다.
      hints: { destructive: false, idempotent: false },
      description:
        '새 프로젝트를 만들고 내가 OWNER 가 됩니다. 프로젝트 생성 권한이 있어야 합니다. projectKey 는 대문자로 시작하는 대문자·숫자 2~10자이며' +
        '(이슈 키의 접두, 예: WP) 이미 쓰이는 키면 충돌 오류가 납니다. type 은 TEAM(기본)·OPEN(공개 접수함)·PERSONAL(나만 보는 개인 프로젝트, ' +
        'projectKey 는 무시되고 키를 자동으로 정함)입니다. 다른 사람에게 알림은 가지 않습니다. 만든 프로젝트를 JSON 으로 반환합니다. ' +
        '다시 부르면 같은 키는 충돌 오류가 나고, PERSONAL 은 프로젝트가 하나 더 생깁니다.',
      inputSchema: createProjectInput,
      async handler(args) {
        return JSON.stringify(toProjectView((await client.createProject(toCreateProjectBody(createProjectInput.parse(args)))) as Record<string, unknown>));
      },
    },
    {
      name: 'add_project_member',
      app: 'project',
      kind: 'write',
      // 멤버를 추가만 한다. 이미 멤버면 409(이미 멤버입니다 — ProjectService.checkAddMember)라 같은 결과를 오류 없이 돌려주지 않으므로
      // 멱등이 아니다. 워크스페이스 밖에 닿지 않는다.
      hints: { destructive: false, idempotent: false },
      description:
        '프로젝트에 구성원을 MEMBER(이슈 보기·쓰기) 역할로 추가합니다. 프로젝트 OWNER 만 할 수 있습니다. username 은 search_members 결과의 값입니다(활성 구성원만). ' +
        'OWNER 로 추가하거나 역할을 바꾸는 것, 멤버 제거는 이 도구로 할 수 없습니다(권한 변경은 사용자가 웹에서 직접 합니다). ' +
        '이미 멤버이거나 개인 프로젝트에 사람을 넣으면 오류가 납니다(개인 프로젝트에는 AI 에이전트만 추가됩니다). ' +
        '추가된 사람에게 인박스·푸시 알림은 가지 않고, 그 사람의 프로젝트 목록에 바로 나타납니다. 결과는 { projectKey, member: { username, name, role } } 입니다.',
      inputSchema: addProjectMemberInput,
      async handler(args) {
        const { projectKey, username } = addProjectMemberInput.parse(args);
        // 확인 카드(propose_add_project_member)와 같은 대상 판정·문구 — 없거나 비활성이면 서버를 부르지 않는다.
        const target = await requireActiveMember(client, username);
        if ('error' in target) throw new Error(target.error);
        // 직접 실행은 MEMBER 고정 — OWNER 부여는 확인 카드(propose_add_project_member)만 한다.
        const added = await client.addProjectMember(projectKey, { userId: target.member.userId, role: 'MEMBER' });
        // 숫자 userId 는 돌려주지 않는다(#833).
        return JSON.stringify({ projectKey, member: toProjectMemberView(added) });
      },
    },
  ];
}
