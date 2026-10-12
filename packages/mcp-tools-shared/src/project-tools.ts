// src/project-tools.ts — 프로젝트 조회 2종 + 이슈 목록 조회 + 프로젝트 정보 수정·생성·멤버 추가. 두 앱 공유(#846, #854, WP-349).
// 생성·멤버 추가는 외부 MCP 에 직접 실행 도구로 노출하고, AI Chat 은 같은 작업을 propose_create_project·propose_add_project_member
// 확인 카드로 한다(경로마다 도구 하나 — ai-agent 프로필에는 싣지 않는다). 두 경로가 입력 스키마(createProjectInput·addProjectMemberInput)와
// 대상 해석(requireActiveMember)·요청 본문 변환(toCreateProjectBody)을 같이 쓴다. 삭제·멤버 역할 변경·제거는 계속 확인 카드만 한다.
import { z } from 'zod';
import type { SharedTool } from './mcp-tool.js';
import { requireActiveMember } from './member-tools.js';
import { defaultListAssignee, resolveCycleFilter } from './resolve.js';
import { formatIssueKey } from './parse.js';
import { dropEmpty } from './compact.js';
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
 * 프로젝트 멤버 추가 입력(WP-349) — add_project_member 와 확인 카드 propose_add_project_member(이 스키마 + summary)가 같이 쓴다.
 * #833: 숫자 id 대신 username 을 받는다. 이슈 도구(create_issue 의 assignees)와 같은 방식이며,
 * LLM 표면에 숫자 식별자를 노출하지 않으면 "연락처 id 를 userId 로 넣는" 사고 자체가 불가능해진다.
 */
export const addProjectMemberInput = z.object({
  projectKey: z.string().min(1),
  username: z.string().min(1),
  role: z.enum(['OWNER', 'MEMBER']),
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

/** 프로젝트 멤버 → LLM 뷰. 숫자 userId 는 빼고 사람을 가리키는 username 만 준다(#833). get_project 의 members 에 쓴다. */
export function toProjectMemberView({ username, name, role }: { username: string; name?: string; role?: string }) {
  return { username, name, role };
}

/** 프로젝트·이슈 목록 조회 도구 3종(list_projects/get_project/list_issues) + 프로젝트 쓰기(update_project/create_project/add_project_member). */
export function buildProjectTools(client: ProjectToolClient & Pick<MemberToolClient, 'searchMembers'>): SharedTool[] {
  return [
    {
      name: 'list_projects',
      kind: 'read',
      description: '접근 가능한 프로젝트 목록을 JSON 으로 반환합니다. page/size 로 페이지네이션합니다(기본 0/50).',
      inputSchema: listProjectsInput,
      async handler(args) {
        const { page, size } = listProjectsInput.parse(args);
        return JSON.stringify(await client.listProjects(page, size));
      },
    },
    {
      name: 'get_project',
      kind: 'read',
      description:
        '프로젝트 상세(key·name·description·type)와 이 프로젝트에서 쓸 수 있는 이슈 유형(issueTypes)·라벨(labels)·마일스톤(milestones) 이름, ' +
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
          ...project,
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
      kind: 'read',
      description:
        '이슈 목록을 JSON 배열로 반환합니다. assignee·reporter 둘 다 생략 시 내 담당("me")이고, 담당자와 무관하게 보려면 assignee="any". ' +
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
        const items = await client.listIssues(query);
        // #850: 행마다 반복되는 null·빈 배열 키는 빼 토큰을 줄인다(빠진 키 = 값 없음).
        return JSON.stringify(items.map((it) => dropEmpty(toIssueListItem(it))));
      },
    },
    {
      name: 'update_project',
      kind: 'write',
      hints: { destructive: true, idempotent: true },
      description:
        '프로젝트 이름·설명을 바꿉니다. 준 필드만 바뀌고 나머지는 유지됩니다(description: null 은 설명 비우기). 프로젝트 OWNER 만 할 수 있습니다.',
      inputSchema: updateProjectInput,
      async handler(args) {
        const { projectKey, name, description } = updateProjectInput.parse(args);
        // 서버 PATCH 는 부분 수정(#858) — 준 필드만 보낸다. 설명 비우기(null)는 clearDescription 플래그로 표현한다.
        return JSON.stringify(
          await client.updateProject(
            projectKey,
            description === null ? { name, clearDescription: true } : { name, description },
          ),
        );
      },
    },
    {
      name: 'create_project',
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
        return JSON.stringify(await client.createProject(toCreateProjectBody(createProjectInput.parse(args))));
      },
    },
    {
      name: 'add_project_member',
      kind: 'write',
      // 멤버를 추가만 한다. 이미 멤버면 409(이미 멤버입니다 — ProjectService.checkAddMember)라 같은 결과를 오류 없이 돌려주지 않으므로
      // 멱등이 아니다. 워크스페이스 밖에 닿지 않는다.
      hints: { destructive: false, idempotent: false },
      description:
        '프로젝트에 구성원을 멤버로 추가합니다. 프로젝트 OWNER 만 할 수 있습니다. username 은 search_members 결과의 값입니다(활성 구성원만). ' +
        'role 은 MEMBER(이슈 보기·쓰기) 또는 OWNER(멤버 관리·프로젝트 삭제까지 가능한 관리자)입니다. 이미 멤버이거나 개인 프로젝트에 사람을 넣으면 오류가 납니다' +
        '(개인 프로젝트에는 AI 에이전트만 MEMBER 로 추가됩니다). 추가된 사람에게 인박스·푸시 알림은 가지 않고, 그 사람의 프로젝트 목록에 바로 나타납니다. ' +
        '결과는 { projectKey, member: { username, name, role } } 입니다. 역할 변경·멤버 제거는 이 도구로 하지 않습니다.',
      inputSchema: addProjectMemberInput,
      async handler(args) {
        const { projectKey, username, role } = addProjectMemberInput.parse(args);
        // 확인 카드(propose_add_project_member)와 같은 대상 판정·문구 — 없거나 비활성이면 서버를 부르지 않는다.
        const target = await requireActiveMember(client, username);
        if ('error' in target) throw new Error(target.error);
        const added = await client.addProjectMember(projectKey, { userId: target.member.userId, role });
        // 숫자 userId 는 돌려주지 않는다(#833). 개인 프로젝트의 AI 에이전트는 서버가 MEMBER 로 고정하므로 응답의 role 을 그대로 쓴다.
        return JSON.stringify({ projectKey, member: toProjectMemberView(added) });
      },
    },
  ];
}
