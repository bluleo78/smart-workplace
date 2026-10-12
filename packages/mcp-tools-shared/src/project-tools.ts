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
        'Lists projects (프로젝트) I can access as {items, total, hasMore?, nextPage?}; items carry projectKey, name, type, issue counts and ' +
        'viewerIsMember (empty keys omitted). If hasMore, pass nextPage as page to continue, or say the list is partial.',
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
        'Returns a project (프로젝트) plus the names issue writes accept: issueTypes, labels, milestones, cycles {name, status}, members {username, name, ' +
        'role}. Use only these in create_issue and update_issue.',
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
        'Lists issues (이슈) as {items, hasMore?, nextCursor?} (size default 30). If hasMore, pass nextCursor as cursor with the same filters, or say ' +
        'the list is partial; a next page may be empty. Unknown label, type or user names fail with the allowed values. Add status=DONE for finished ' +
        'work (a closed range also matches CANCELED). Items: issueKey plus the main fields, parent, children, blocked (dates +09:00; empty keys ' +
        'omitted). Body, comments, history: get_issue_detail.',
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
        'Changes a project name and/or description; omitted fields stay (description:null clears it). Project OWNER only.',
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
        'Creates a project (프로젝트) with me as OWNER (needs project write permission). projectKey is the issue key prefix; a taken key is a conflict. ' +
        'type: TEAM (default), OPEN (visible to all, for intake) or PERSONAL (only me; key assigned automatically, so each call creates another). ' +
        'Nobody is notified.',
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
        'Adds an active member (username from search_members) to a project as MEMBER; project OWNER only. Errors if already a member or for a ' +
        'PERSONAL project (AI agents only). No notification; the project just appears in their list.',
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
