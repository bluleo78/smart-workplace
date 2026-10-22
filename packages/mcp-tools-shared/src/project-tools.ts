// src/project-tools.ts — 프로젝트 조회 2종 + 이슈 목록 조회 + 프로젝트 정보 수정·생성·멤버 추가. 두 앱 공유(#846, #854, WP-349).
// 생성·멤버 추가는 외부 MCP 에 직접 실행 도구로 노출하고, AI Chat 은 같은 작업을 propose_create_project·propose_add_project_member
// 확인 카드로 한다(경로마다 도구 하나 — ai-agent 프로필에는 싣지 않는다). 두 경로가 입력 스키마(createProjectInput·addProjectMemberInput)와
// 대상 해석(requireActiveMember)·요청 본문 변환(toCreateProjectBody)을 같이 쓴다. 직접 실행 멤버 추가는 MEMBER 로만 한다 — OWNER 로
// 들이는 것은 권한 부여(README "계속 빼 둘 것: 구성원 권한 변경")라 카드만 한다. 삭제·멤버 역할 변경·제거도 계속 확인 카드만 한다.
import { toAgentWorkView } from './agent-work-view.js';
import { z } from 'zod';
import type { SharedTool } from './mcp-tool.js';
import { requireActiveMember } from './member-tools.js';
import { nullAsOmitted } from './tool-definitions.js';
import { DEFAULT_LABEL_COLOR, defaultListAssignee, fieldDefByName, resolveCycleFilter, resolveMilestoneFilter, rowByName, splitStatusTokens, toFieldValue } from './resolve.js';
import { formatIssueKey, parseIssueKey } from './parse.js';
import { cursorPageView, dropEmpty, numberedPageView, omitKeys } from './compact.js';
import { labelNames, toChildrenView, toParentView, toPeopleView, toSeoulIso, typeName } from './issue-view.js';
import { listIssuesInput } from './schemas.js';
import type { CreateProjectBody, IssueListQuery, IssueRow, MemberToolClient, ProjectMetaKind, ProjectToolClient } from './tool-client.js';

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

/** 라벨 색 토큰 — 서버 ColorToken.ALL 과 같은 12색. */
const LABEL_COLORS = ['GRAY', 'RED', 'ORANGE', 'YELLOW', 'GREEN', 'TEAL', 'CYAN', 'BLUE', 'INDIGO', 'PURPLE', 'PINK', 'BROWN'] as const;

/**
 * 프로젝트 메타(라벨·마일스톤·사이클) 생성 입력(WP-356). kind 별로 다른 필드를 판별 유니온 대신 평평한 선택 필드로 받는다 —
 * 최상위가 z.object 여야 하고(서버 레이어가 .shape 를 꺼낸다) 유니온은 정의 크기가 커진다. kind 에 맞지 않는 필드는 핸들러가 쓰기 전에 거부한다.
 * 길이·날짜 형식은 서버(@Size·LocalDate)가 검증해 오류 사유를 돌려주므로 정의 크기를 아끼려 여기서 되풀이하지 않는다.
 */
export const createProjectMetaInput = z.object({
  projectKey: z.string().min(1),
  kind: z.enum(['label', 'milestone', 'cycle']),
  name: z.string().trim().min(1),
  // 모델은 쓰지 않는 인자를 null 로 채워 보내기도 한다(WP-346) — kind 별 선택 필드는 null 도 생략으로 받는다(정의에는 null 갈래가 보이지 않는다).
  // 색 12종을 enum 으로 실으면 두 도구 정의가 각각 ~40토큰 커진다 — 문자열로 받고 핸들러가 허용 목록을 담아 거부한다(#841 패턴).
  color: nullAsOmitted(z.string()),
  dueDate: nullAsOmitted(z.string()),
  description: nullAsOmitted(z.string()),
  goal: nullAsOmitted(z.string()),
  startDate: nullAsOmitted(z.string()),
  endDate: nullAsOmitted(z.string()),
  status: nullAsOmitted(z.enum(['PLANNED', 'ACTIVE', 'COMPLETED'])),
});

/**
 * 프로젝트 메타 수정 입력(WP-356) — name 은 지금 이름(대상), newName 은 바꿀 이름. 설명·목표·기간은 빈 문자열로 비운다
 * (null 갈래를 두면 필드마다 anyOf 가 붙어 정의가 커진다).
 */
export const updateProjectMetaInput = createProjectMetaInput.extend({
  newName: nullAsOmitted(z.string().trim().min(1)),
});

/** kind 별로 받는 필드 — 나머지를 주면 쓰기 전에 거부한다(조용히 버리면 모델이 반영됐다고 오해한다). */
const META_FIELDS: Record<ProjectMetaKind, readonly string[]> = {
  label: ['color'],
  milestone: ['dueDate', 'description'],
  cycle: ['goal', 'startDate', 'endDate', 'status'],
};
const META_KIND_LABEL: Record<ProjectMetaKind, string> = { label: '라벨', milestone: '마일스톤', cycle: '사이클' };

/**
 * 라벨 색 검증 — 서버 오류("허용되지 않은 색상 토큰")는 허용 값을 알려주지 않아 쓰기 전에 목록과 함께 거부한다. 대소문자는 맞춰 준다.
 * 빈 문자열은 생략과 같다(색은 필수라 비울 수 없다 — 생성은 GRAY, 수정은 지금 색 유지).
 */
function labelColor(color: string | undefined): string | undefined {
  if (color === undefined || color.trim() === '') return undefined;
  const upper = color.trim().toUpperCase();
  if (!(LABEL_COLORS as readonly string[]).includes(upper)) {
    throw new Error(`라벨 색 '${color}' 은(는) 쓸 수 없습니다. 사용 가능: ${LABEL_COLORS.join(', ')}`);
  }
  return upper;
}

/** kind 에 없는 필드를 준 경우 throw. */
function assertMetaFields(kind: ProjectMetaKind, given: Record<string, unknown>) {
  const allowed = META_FIELDS[kind];
  const extra = Object.keys(given).filter((k) => given[k] !== undefined && !allowed.includes(k));
  if (extra.length) {
    throw new Error(`${META_KIND_LABEL[kind]}에는 ${extra.join(', ')} 를 지정할 수 없습니다. 쓸 수 있는 필드: name, ${allowed.join(', ')}`);
  }
}

/** null 값(= 생략, nullAsOmitted)을 undefined 로 — kind 에 없는 필드 검사가 null 을 "준 값"으로 세지 않게. */
function omitNulls<T extends Record<string, unknown>>(input: T): { [K in keyof T]: Exclude<T[K], null> } {
  return Object.fromEntries(Object.entries(input).map(([k, v]) => [k, v === null ? undefined : v])) as { [K in keyof T]: Exclude<T[K], null> };
}

/** 빈 문자열 값을 대체값으로 바꾼 얕은 복사본 — 생성에서는 생략(undefined), 수정에서는 비우기(null)로 쓴다. */
function blankAs(fields: Record<string, unknown>, blank: null | undefined): Record<string, unknown> {
  return Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v === '' ? blank : v]));
}

/** 메타 응답(LabelResponse·MilestoneResponse·CycleResponse) → LLM 뷰. 숫자 id·projectId·시각은 빼고 색 토큰은 입력 이름(color)으로 부른다. */
function toProjectMetaView(kind: ProjectMetaKind, raw: Record<string, unknown>) {
  const { colorToken, ...rest } = omitKeys(raw, 'id', 'projectId', 'createdAt', 'updatedAt');
  return dropEmpty({ kind, ...rest, color: colorToken });
}

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
    // WP-807: 범주(status) 안의 프로젝트 상태 이름 — 없으면 dropEmpty 가 키를 뺀다.
    statusName: it.statusName ?? undefined,
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
    // WP-377: AI 가 이 이슈에서 하는 작업 — 없으면 키가 없다(dropEmpty 가 undefined 를 뺀다).
    agentWork: it.agentWork?.length ? it.agentWork.map(toAgentWorkView) : undefined,
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

/**
 * list_issues 의 field("이름=값") → 서버 fieldId·fieldValue(WP-356). 서버는 jsonb 를 텍스트로 캐스트해 같음을 비교하므로 값을 JSON 으로 직렬화한다
 * (문자열은 따옴표 포함). 복수 선택은 배열 전체가 같아야 맞아 "이 선택지를 가진 이슈" 질문에 쓸 수 없으므로 거부한다.
 */
async function resolveFieldFilter(client: Pick<ProjectToolClient, 'getProjectFields'>, projectKey: string | undefined, field: string) {
  const eq = field.indexOf('=');
  if (eq < 1) throw new Error(`커스텀 필드 필터는 "필드이름=값" 형식입니다: ${field}`);
  if (!projectKey) throw new Error('커스텀 필드로 거르려면 projectKey 를 함께 지정하세요.');
  const def = fieldDefByName(await client.getProjectFields(projectKey), field.slice(0, eq).trim());
  if (def.type === 'MULTI_SELECT') throw new Error(`복수 선택 필드 '${def.name}' 는 목록 필터로 쓸 수 없습니다.`);
  return { fieldId: def.id, fieldValue: JSON.stringify(toFieldValue(def, field.slice(eq + 1).trim())) };
}

/**
 * 프로젝트·이슈 목록 조회 도구 3종(list_projects/get_project/list_issues) + 프로젝트 쓰기(update_project/create_project/add_project_member)
 * + 라벨·마일스톤·사이클 생성·수정(create_project_meta/update_project_meta, WP-356 — 삭제는 계속 확인 카드만).
 */
export function buildProjectTools(client: ProjectToolClient & Pick<MemberToolClient, 'searchMembers'>): SharedTool[] {
  return [
    {
      name: 'list_projects',
      app: ['project', 'issue'],
      kind: 'read',
      description:
        'Lists projects (프로젝트) I can access as {items, total, hasMore?, nextPage?}; items: projectKey, name, type, issue counts, viewerIsMember. ' +
        'If hasMore, pass nextPage as page to continue, or say the list is partial.',
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
        'Returns a project (프로젝트) plus the names issue writes accept: issueTypes, labels, milestones (with dueDate), cycles (status, ' +
        'dates), fields (custom fields, with options), statuses, members (username, name, role).',
      inputSchema: projectKeyInput,
      async handler(args) {
        const { projectKey } = projectKeyInput.parse(args);
        // #844: 이슈 쓰기 도구의 type·labels·assignees(#854: milestone·cycles) 값을 조회로 조달하게 한다(추측 방지). 모두 독립 조회라 병렬.
        // WP-356: 마일스톤 기한·사이클 기간(계획 판단용)과 커스텀 필드 정의(update_issue 의 fields·list_issues 의 field 가 받는 이름·선택지)도 싣는다.
        // WP-807: 프로젝트 상태(이름·범주·순서)도 싣는다 — update_issue·list_issues 의 status 가 받는 이름이다.
        const [project, types, labels, milestones, cycles, fields, statuses, members] = await Promise.all([
          client.getProject(projectKey),
          client.getProjectTypes(projectKey),
          client.getProjectLabels(projectKey),
          client.getProjectMilestones(projectKey),
          client.getProjectCycles(projectKey),
          client.getProjectFields(projectKey),
          client.getProjectStatuses(projectKey),
          client.getProjectMembers(projectKey),
        ]);
        return JSON.stringify({
          ...toProjectView(project as Record<string, unknown>),
          issueTypes: types.map((t) => t.name),
          labels: labels.map((l) => l.name),
          milestones: milestones.map(({ name, dueDate }) => dropEmpty({ name, dueDate })),
          cycles: cycles.map(({ name, status, startDate, endDate }) => dropEmpty({ name, status, startDate, endDate })),
          fields: fields.map(({ name, type, options }) => dropEmpty({ name, type, options })),
          statuses: statuses.map(({ name, category, position }) => ({ name, category, position })),
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
        'the list is partial; a next page may be empty. due/closed/created From-To: yyyy-MM-dd, inclusive, closed/created in KST; for finished ' +
        'work add status=DONE (closed ranges also match CANCELED). Unknown names fail, listing allowed values. Items: issueKey, main fields, parent, children, blocked, ' +
        'agentWork (dates +09:00, empty keys omitted); body/comments: get_issue_detail.',
      inputSchema: listIssuesInput,
      async handler(args) {
        const { priority, size, cycle: cycleCsv, milestone: milestoneCsv, parent, field, watching, pendingForMe, ...p } = listIssuesInput.parse(args);
        // WP-356: 부모는 이슈 키로 받는다 — 서버 parent 는 프로젝트 안의 번호라 키의 프로젝트로 범위를 고정한다(없으면 모든 프로젝트의 같은 번호가 걸린다).
        let projectKey = p.projectKey;
        let parentNumber: number | undefined;
        if (parent) {
          const key = parseIssueKey(parent);
          if (projectKey && projectKey !== key.projectKey) {
            throw new Error(`부모 이슈 ${parent} 는 projectKey(${projectKey}) 와 다른 프로젝트입니다.`);
          }
          projectKey = key.projectKey;
          parentNumber = key.number;
        }
        const assignee = defaultListAssignee({ ...p, watching, parent });
        // WP-807: status CSV 의 범주는 서버 status, 그 밖의 값은 statusName 으로 나눈다 — 이름 해석(모르는 이름 400 + 사용 가능 목록)은 서버가 한다.
        // projectKey 가 없으면 서버가 볼 수 있는 모든 프로젝트의 같은 이름 상태를 OR 로 맞춘다.
        const statusTokens = p.status ? splitStatusTokens(p.status) : undefined;
        // WP-176: 사이클 이름·active·none·backlog → 서버 토큰(id·none·null). WP-356: 마일스톤 이름 → id, 필드 "이름=값" → fieldId + JSON 값.
        // 서버는 해석 못 한 토큰을 조용히 버리므로 해석 실패는 모두 조회 전에 throw 한다.
        const [cycle, milestone, fieldFilter] = await Promise.all([
          cycleCsv ? resolveCycleFilter(client, projectKey, cycleCsv) : undefined,
          milestoneCsv ? resolveMilestoneFilter(client, projectKey, milestoneCsv) : undefined,
          field ? resolveFieldFilter(client, projectKey, field) : undefined,
        ]);
        // undefined 필드는 쿼리에서 뺀다 — 서버는 빈 값과 미지정을 다르게 볼 수 있다.
        const query: IssueListQuery = Object.fromEntries(
          Object.entries({
            ...p,
            projectKey,
            status: statusTokens?.categories.join(',') || undefined,
            statusName: statusTokens?.names.join(',') || undefined,
            assignee,
            cycle,
            milestone,
            parent: parentNumber,
            ...fieldFilter,
            watching: watching || undefined,
            pendingForMe: pendingForMe || undefined,
          }).filter((e): e is [string, string | number | boolean] => e[1] !== undefined),
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
        'Creates a project (프로젝트) with me as OWNER (needs project write permission). projectKey is the issue key prefix. ' +
        'type: TEAM (default), OPEN (visible to all, for intake) or PERSONAL (only me; key auto-assigned, so each call creates another). ' +
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
        'Adds an active member (username from search_members) to a project as MEMBER; project OWNER only. Fails if already a member or for a ' +
        'PERSONAL project (AI agents only). Not notified.',
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
    {
      name: 'create_project_meta',
      app: 'project',
      kind: 'write',
      // 새 항목을 추가만 한다. 같은 이름이면 서버가 409(이름 중복)라 같은 호출을 되풀이해도 같은 결과가 아니다 — 비멱등. 알림 없음.
      hints: { destructive: false, idempotent: false },
      description:
        'Creates a label, milestone or cycle (라벨·마일스톤·사이클) by kind. Per kind (other fields rejected): label color (default GRAY); ' +
        'milestone dueDate (required), description; cycle goal, startDate, endDate, status (default PLANNED). Dates yyyy-MM-dd. Labels and ' +
        'milestones need any project member, cycles project OWNER.',
      inputSchema: createProjectMetaInput,
      async handler(args) {
        const { projectKey, kind, name, color, ...rest } = omitNulls(createProjectMetaInput.parse(args));
        assertMetaFields(kind, { color, ...rest });
        if (kind === 'milestone' && !rest.dueDate) throw new Error('마일스톤은 dueDate(yyyy-MM-dd)가 필요합니다.');
        // 서버 라벨 요청은 colorToken 이 필수다 — 색을 안 주면(빈 문자열 포함) 웹 기본값과 같은 GRAY. 다른 필드도 빈 문자열은 생략과 같다.
        const body = kind === 'label' ? { name, colorToken: labelColor(color) ?? DEFAULT_LABEL_COLOR } : { name, ...blankAs(rest, undefined) };
        return JSON.stringify(toProjectMetaView(kind, (await client.createProjectMeta(projectKey, kind, body)) as Record<string, unknown>));
      },
    },
    {
      name: 'update_project_meta',
      app: 'project',
      kind: 'write',
      // 기존 값을 덮어쓴다(이름·기한·기간 등) — 같은 입력을 다시 보내도 결과가 같다.
      hints: { destructive: true, idempotent: true },
      description:
        'Changes a label, milestone or cycle found by kind and current name (from get_project); newName renames. Only given fields change ' +
        '(per kind as in create_project_meta); "" clears description, goal or dates. Labels: project OWNER or whoever created the label; ' +
        'milestones and cycles: same roles as creating.',
      inputSchema: updateProjectMetaInput,
      async handler(args) {
        const { projectKey, kind, name, newName, color, ...rest } = omitNulls(updateProjectMetaInput.parse(args));
        assertMetaFields(kind, { color, ...rest });
        // 서버 PATCH 는 본문 전체로 덮어쓴다(빠진 설명·기간은 비워진다) — 지금 값을 읽어 준 필드만 바꾼 전체 본문을 보낸다.
        const rows = (
          kind === 'label'
            ? await client.getProjectLabels(projectKey)
            : kind === 'milestone'
              ? await client.getProjectMilestones(projectKey)
              : await client.getProjectCycles(projectKey)
        ) as ({ id: number; name: string } & Record<string, unknown>)[];
        const current = rowByName(rows, name, META_KIND_LABEL[kind]);
        // 빈 문자열은 비우기(null) — 서버 본문에서 null 이면 그 값이 지워진다. 마일스톤 기한은 서버 필수라 비울 수 없다(쓰기 전에 거부).
        const given: Record<string, unknown> = blankAs(rest, null);
        if (kind === 'milestone' && given.dueDate === null) throw new Error('마일스톤 dueDate 는 비울 수 없습니다(yyyy-MM-dd 로 바꾸세요).');
        const merged: Record<string, unknown> = { name: newName ?? current.name };
        if (kind === 'label') merged.colorToken = labelColor(color) ?? current.colorToken;
        else for (const k of META_FIELDS[kind]) merged[k] = given[k] === undefined ? current[k] : given[k];
        return JSON.stringify(toProjectMetaView(kind, (await client.updateProjectMeta(projectKey, kind, current.id, merged)) as Record<string, unknown>));
      },
    },
  ];
}
