// src/resolve.ts — 사람 친화 자연키(유형명/라벨명/username)를 백엔드 숫자 ID로 변환한다.
// 유형명·라벨명은 프로젝트당 UNIQUE, username 은 전역 UNIQUE 이므로 첫 매치가 곧 유일 매치다.
// 매치 실패 시 유효 목록을 담아 throw → 호출측(도구 레이어)이 그대로 전파하거나 래핑한다.
// workplace-mcp(PatApiClient)와 workplace-ai-agent(WorkplaceApiClient 어댑터) 양쪽에서 공유한다.
import type { IssueRelationTypeRow } from './tool-client.js';

/** 리졸브에 필요한 최소 구조적 인터페이스. 양쪽 앱의 API 클라이언트가 이 시그니처를 만족하면 된다. */
export interface ProjectMetaClient {
  getProjectTypes(projectKey: string): Promise<{ id: number; name: string }[]>;
  getProjectMembers(projectKey: string): Promise<{ userId: number; username: string; name?: string; role?: string }[]>;
  getProjectLabels(projectKey: string): Promise<{ id: number; name: string; colorToken?: string }[]>;
  /** GET /projects/{key}/components — 구성요소 목록(WP-933). 보관된 것도 archived 로 함께 온다. */
  getProjectComponents(projectKey: string): Promise<ProjectComponentRow[]>;
  /** GET /projects/{key}/versions — 버전 목록(WP-888). 보관된 것도 status=ARCHIVED 로 함께 온다. */
  getProjectVersions(projectKey: string): Promise<ProjectVersionRow[]>;
  getProjectMilestones(projectKey: string): Promise<{ id: number; name: string; dueDate?: string | null; description?: string | null }[]>;
  getProjectCycles(projectKey: string): Promise<
    { id: number; name: string; status?: string; goal?: string | null; startDate?: string | null; endDate?: string | null }[]
  >;
  /** GET /projects/{key}/fields — 커스텀 필드 정의(WP-356). options 는 SELECT·MULTI_SELECT 만. */
  getProjectFields(projectKey: string): Promise<ProjectFieldDef[]>;
  /** GET /projects/{key}/statuses — 프로젝트 상태 목록(WP-807). category 는 범주(TODO·IN_PROGRESS·DONE·CANCELED). */
  getProjectStatuses(projectKey: string): Promise<{ id: number; name: string; category: string; position: number }[]>;
}

/** 프로젝트 구성요소 행(ComponentResponse) — 이름 해석·get_project 표시에 쓰는 필드만. 기본 담당자는 username 으로만 가리킨다. */
export interface ProjectComponentRow {
  id: number;
  name: string;
  archived?: boolean;
  defaultAssignee?: { username?: string | null } | null;
  /** 저장된 기본 담당자가 지금도 유효한지 — false 면 자동 지정에서 건너뛴다(WP-933). */
  defaultAssigneeValid?: boolean;
}

/** 프로젝트 버전 행(VersionResponse) — 이름 해석·get_project 표시에 쓰는 필드만(WP-888). */
export interface ProjectVersionRow {
  id: number;
  name: string;
  /** UNRELEASED·RELEASED·ARCHIVED. */
  status: string;
  releaseDate?: string | null;
}

/** 커스텀 필드 정의 행(IssueFieldDefResponse) — 이름 해석·값 검증에 쓰는 필드만. */
export interface ProjectFieldDef {
  id: number;
  name: string;
  /** TEXT·NUMBER·DATE·SELECT·MULTI_SELECT. */
  type: string;
  options?: string[] | null;
}

/**
 * 이름 → id 공통 조회. 없으면 사용 가능한 이름 목록을 담아 throw — LLM 이 그 목록으로 스스로 고칠 수 있게 한다.
 * 유형·라벨·마일스톤·사이클 리졸브가 같은 규칙(정확일치)·같은 문구를 쓰도록 한 곳에 둔다.
 */
function idByName(rows: { id: number; name: string }[], name: string, what: string): number {
  return rowByName(rows, name, what).id;
}

/** 이름 → 행(정확일치). 없으면 idByName 과 같은 문구로 throw — 행 전체가 필요한 곳(프로젝트 메타 수정의 병합, WP-356)이 쓴다. */
export function rowByName<T extends { name: string }>(rows: T[], name: string, what: string): T {
  const match = rows.find((r) => r.name === name);
  if (!match) {
    throw new Error(`${what} '${name}' 을(를) 찾을 수 없습니다. 사용 가능: ${rows.map((r) => r.name).join(', ') || '(없음)'}`);
  }
  return match;
}

/** 유형 이름 → typeId. */
export async function resolveTypeId(client: Pick<ProjectMetaClient, 'getProjectTypes'>, projectKey: string, typeName: string): Promise<number> {
  return idByName(await client.getProjectTypes(projectKey), typeName, '유형');
}

/**
 * 관계 유형 입력(코드 또는 이름) → 유형 행(WP-887). 앞뒤 공백은 무시한다.
 * 찾는 순서(서버 `resolveByCodeOrName`·가져오기와 같은 규칙 + 마지막 관용 한 단계):
 *  1) 코드 정확 일치(`RELATES`) — 기본 유형은 코드로 부르는 게 정식이다.
 *  2) 이름 대소문자 무시 일치 — 서버가 이름 중복을 대소문자 무시로 막으므로 한 행만 걸린다. 코드보다 뒤지만 「대소문자 무시 코드」보다는 앞이라,
 *     `relates` 처럼 코드와 철자만 같은 이름의 사용자 정의 유형도 정확한 이름으로 부를 수 있다.
 *  3) 코드 대소문자 무시 일치(`relates` → RELATES) — LLM 이 소문자로 쓴 코드를 받아 주는 관용 단계. 서버가 받는 입력(1·2)은 서버와 같은 행으로 풀린다.
 * 없으면 쓸 수 있는 이름 목록을 담아 throw 해 LLM 이 스스로 고치게 하고(다른 리졸브와 같은 규칙), 숨긴 유형은 새로 걸 수 없다고 거절한다(숨긴 유형의
 * 기존 관계는 그대로 보이지만 화면·MCP 로는 더 못 건다).
 */
export function resolveRelationType(types: IssueRelationTypeRow[], input: string): IssueRelationTypeRow {
  const wanted = input.trim();
  const lower = wanted.toLowerCase();
  const found =
    types.find((t) => t.code === wanted) ??
    types.find((t) => t.name.toLowerCase() === lower) ??
    types.find((t) => t.code?.toLowerCase() === lower);
  if (!found) {
    const usable = types.filter((t) => !t.hidden).map((t) => t.code ?? t.name);
    throw new Error(`관계 유형 '${input}' 을(를) 찾을 수 없습니다. 사용 가능: ${usable.join(', ') || '(없음)'}`);
  }
  if (found.hidden) throw new Error(`관계 유형 '${input}' 은(는) 숨겨져 있어 새로 걸 수 없습니다.`);
  return found;
}

/** 이슈 상태 범주(WP-807) — 프로젝트 상태는 모두 이 넷 중 하나에 속한다. 도구의 status 값이 이 중 하나면 범주로 본다. */
export const ISSUE_STATUS_CATEGORIES = ['TODO', 'IN_PROGRESS', 'DONE', 'CANCELED'] as const;

/** 값이 범주인지 — 대소문자·앞뒤 공백 무시. 범주를 이름보다 먼저 보므로 'DONE' 이라는 이름의 상태가 있어도 범주로 해석한다. */
const asCategory = (token: string): string | undefined => {
  const upper = token.trim().toUpperCase();
  return (ISSUE_STATUS_CATEGORIES as readonly string[]).includes(upper) ? upper : undefined;
};

/**
 * 상태 CSV → 범주·이름(WP-807). 대문자로 맞춘 토큰이 범주면 범주, 아니면 상태 이름(원문 trim). 빈 토큰은 버린다.
 * list_issues 가 범주는 서버 status, 이름은 statusName 으로 나눠 보낼 때 쓴다.
 */
export function splitStatusTokens(csv: string): { categories: string[]; names: string[] } {
  const categories: string[] = [];
  const names: string[] = [];
  for (const raw of csv.split(',')) {
    const token = raw.trim();
    if (!token) continue;
    const category = asCategory(token);
    if (category) categories.push(category);
    else names.push(token);
  }
  return { categories, names };
}

/**
 * update_issue 의 status 값 → PATCH 본문 조각(WP-870). 범주면 { status } — 서버가 범주 기본 상태로 옮긴다(이미 그 범주면 유지).
 * 그 밖의 값은 프로젝트 상태 이름으로 보고 { statusName } — 이름 해석(대소문자·공백 무시)과 모르는 이름 거절(사용 가능 목록을 담은 400)은
 * 서버가 한다. 여기서 상태 목록을 조회하지 않아 호출 한 번이 줄고, 이름 규칙이 서버 한 곳에만 있다.
 */
export function resolveStatusPatch(status: string): { status: string } | { statusName: string } {
  const category = asCategory(status);
  return category ? { status: category } : { statusName: status.trim() };
}

/**
 * 상태 이름이 프로젝트에 없으면 거절 문구, 있으면 null(update_issue 가 쓰기 전에 확인할 때만). 서버 해석과 같이 대소문자·앞뒤 공백을 무시한다.
 * 보통은 서버가 내용 PATCH 에서 확인하므로 부르지 않는다 — 내용 PATCH 보다 먼저 써야 하는 것(첨부·드라이브 링크)이 있을 때만 쓴다.
 */
export async function unknownStatusMessage(
  client: Pick<ProjectMetaClient, 'getProjectStatuses'>,
  projectKey: string,
  name: string,
): Promise<string | null> {
  const rows = await client.getProjectStatuses(projectKey);
  const key = name.trim().toLowerCase();
  if (rows.some((r) => r.name.trim().toLowerCase() === key)) return null;
  return `상태 '${name}' 을(를) 찾을 수 없습니다. 사용 가능: ${rows.map((r) => r.name).join(', ') || '(없음)'}`;
}

/** 호출자 본인 조회(GET /auth/me) — 담당자 "me" 를 호출자로 치환할 때 쓴다. */
export interface CurrentUserClient {
  getMe(): Promise<{ id: number; username: string }>;
}

/** 담당자 리졸브에 필요한 클라이언트 — 프로젝트 멤버 + 호출자 조회. */
export type AssigneeResolverClient = Pick<ProjectMetaClient, 'getProjectMembers'> & CurrentUserClient;

/** 담당자 값이 "me"(호출자 본인) 별칭인지 — list_issues 의 assignee="me" 와 같은 어휘. 대소문자·앞뒤 공백 무시. */
export const isMeAlias = (u: string) => u.trim().toLowerCase() === 'me';

/**
 * username 배열 → userId 배열. 하나라도 없으면 사용 가능한 username 을 담아 throw.
 * WP-53: "me" 는 호출자 본인(PAT 소유자 / X-On-Behalf-Of 대리 대상)으로 치환한다 — LLM 이 사용자의 username 을 몰라도
 * "나에게 할당해줘"를 처리하게 한다. 이슈 이벤트 경로(에이전트 신원)에서는 에이전트 자신이 된다. 호출자 조회는 "me" 가 있을 때만 한다.
 */
export async function resolveAssigneeIds(
  client: AssigneeResolverClient,
  projectKey: string,
  usernames: string[],
): Promise<number[]> {
  const [members, me] = await Promise.all([
    client.getProjectMembers(projectKey),
    usernames.some(isMeAlias) ? client.getMe() : undefined,
  ]);
  // 본인은 userId 로 한 번만 매칭한다. 멤버가 아니면 일반 "사용 가능 목록" 대신 본인 지정 불가 사유를 알린다.
  const self = me && members.find((x) => x.userId === me.id);
  if (me && !self) {
    throw new Error(`현재 사용자 '${me.username}' 은(는) 프로젝트 ${projectKey} 의 멤버가 아니라 담당자로 지정할 수 없습니다.`);
  }
  const ids = usernames.map((u) => {
    if (self && isMeAlias(u)) return self.userId;
    const m = members.find((x) => x.username === u);
    if (!m) {
      throw new Error(
        `멤버 '${u}' 을(를) 찾을 수 없습니다. 사용 가능 username: ${members
          .map((x) => x.username)
          .join(', ')}`,
      );
    }
    return m.userId;
  });
  // 기존 담당자 + "me" 를 함께 넘길 때 본인이 이미 담당자면 같은 id 가 두 번 나온다 — 순서를 지키며 중복 제거.
  return [...new Set(ids)];
}

/** 새 라벨 기본 색 — 웹 라벨 관리·create_project_meta·서버 이름 라벨 생성의 기본값과 같다. */
export const DEFAULT_LABEL_COLOR = 'GRAY';

/** 서버 라벨 이름 상한(label.name VARCHAR(40)) — 쓰기 전에 걸러 update_issue 가 일부만 저장되지 않게 한다. */
const LABEL_NAME_MAX = 40;

/** 이름들을 norm 으로 다듬은 뒤 대소문자만 다른 중복을 처음 나온 표기 하나로 합친다(순서 유지). */
function dedupeIgnoreCase(names: string[], norm: (x: string) => string): string[] {
  const byKey = new Map<string, string>();
  for (const n of names.map(norm)) if (!byKey.has(n.toLowerCase())) byKey.set(n.toLowerCase(), n);
  return [...byKey.values()];
}

/**
 * 이슈에 붙일 라벨 이름 → 요청 본문 조각(WP-394). 앞뒤 공백을 빼고 같은 이름은 하나로 친 뒤, 미리 읽은 프로젝트 라벨(existing)에 있는 이름은
 * labelIds 로, 없는 이름만 labelNames 로 나눈다 — 없는 라벨은 서버가 이슈 쓰기와 같은 트랜잭션에서 만든다(쓰기가 실패하면 라벨도 남지 않는다).
 * 있는 라벨을 id 로 보내는 이유: labelNames 를 모르는 구버전 API(롤링 배포)가 그 필드를 무시해도 기존 라벨이 지워지지 않게.
 * created(= 새로 만들 이름)는 오타로 생긴 라벨을 호출자가 알아챌 수 있게 결과에 싣는다. 이름은 대소문자를 무시해 맞춘다 — 「bug」 는 있는 「Bug」 를
 * 쓴다(서버 유일 제약 lower(name) 과 같은 기준, WP-911). 대소문자만 다른 이름을 함께 주면 하나로 친다.
 */
export function splitLabelNames(
  labelNames: string[],
  existing: { id: number; name: string }[],
): { ids: number[]; created: string[] } {
  // 대소문자만 다른 이름은 처음 나온 표기 하나로 친다(서버도 같은 라벨 하나로 붙인다).
  const names = dedupeIgnoreCase(labelNames, (x) => x.trim());
  if (names.some((n) => n.length === 0)) throw new Error('라벨 이름이 비어 있습니다.');
  const tooLong = names.find((n) => n.length > LABEL_NAME_MAX);
  if (tooLong) throw new Error(`라벨 이름은 ${LABEL_NAME_MAX}자 이하여야 합니다: '${tooLong}'`);
  const idOf = new Map(existing.map((l) => [l.name.toLowerCase(), l.id]));
  const ids: number[] = [];
  const created: string[] = [];
  for (const name of names) {
    const id = idOf.get(name.toLowerCase());
    if (id !== undefined) ids.push(id);
    else created.push(name);
  }
  return { ids, created };
}

/** 도구 결과에 붙일 createdLabels — 새로 만든 라벨이 있을 때만 키를 싣는다. */
export function createdLabelsField(part: { created: string[] } | undefined): { createdLabels?: string[] } {
  return part?.created.length ? { createdLabels: part.created } : {};
}

/**
 * 구성요소 이름 → id 분류(WP-933). 라벨(splitLabelNames)과 달리 없는 이름을 만들지 않는다 — 구성요소는 OWNER 가 관리하는 목록이라 오타가 새 항목이 되면 안 된다.
 * 앞뒤 공백을 빼고 NFC 로 맞춘 뒤 대소문자를 무시해 비교하며(저장 이름이 NFC 라 분해형 한글도 찾는다 · 서버 유일 제약 lower(name) 과 같은 기준), 대소문자만 다른 이름은 처음 표기 하나로 친다.
 * 없는 이름은 unknown, 보관된 구성요소는 archived 로 나눠 ids 에 넣지 않는다 — 호출자가 어느 쪽이든 쓰기 전에 거절할 수 있게.
 */
export function resolveComponentNames(
  names: string[],
  existing: ProjectComponentRow[],
): { ids: number[]; unknown: string[]; archived: string[] } {
  // 서버는 이름을 NFC 로 저장한다 — 분해형(NFD) 입력이 같은 구성요소로 풀리게 양쪽을 같은 규칙으로 맞춘다.
  const norm = (x: string) => x.normalize('NFC').trim();
  const deduped = dedupeIgnoreCase(names, norm);
  const rowOf = new Map(existing.map((c) => [norm(c.name).toLowerCase(), c]));
  const ids: number[] = [];
  const unknown: string[] = [];
  const archived: string[] = [];
  for (const name of deduped) {
    if (name.length === 0) throw new Error('구성요소 이름이 비어 있습니다.');
    const row = rowOf.get(name.toLowerCase());
    if (!row) unknown.push(name);
    else if (row.archived) archived.push(name);
    else ids.push(row.id);
  }
  return { ids, unknown, archived };
}

/**
 * 구성요소 이름 → id 목록. 없는 이름이면 쓸 수 있는(보관 안 된) 이름 목록을 담아 throw 하고(LLM 이 스스로 고친다), 보관된 이름은 새로 붙일 수 없다고 throw 한다.
 * allowArchivedIds 는 이 이슈에 이미 붙어 있는 보관 구성요소 id — update_issue 가 전체 교체라 그것을 빼먹지 않고 다시 보내야 하므로 통과시킨다(서버도 유지는 허용).
 */
export function resolveComponentIds(names: string[], existing: ProjectComponentRow[], allowArchivedIds: ReadonlySet<number> = new Set()): number[] {
  const usable = existing.filter((c) => !c.archived).map((c) => c.name);
  const part = resolveComponentNames(names, existing.map((c) => ({ ...c, archived: c.archived && !allowArchivedIds.has(c.id) })));
  if (part.unknown.length) {
    throw new Error(`구성요소 '${part.unknown[0]}' 을(를) 찾을 수 없습니다. 사용 가능: ${usable.join(', ') || '(없음)'}`);
  }
  if (part.archived.length) {
    throw new Error(`구성요소 '${part.archived[0]}' 은(는) 보관되어 새로 붙일 수 없습니다. 사용 가능: ${usable.join(', ') || '(없음)'}`);
  }
  return part.ids;
}

/**
 * 버전 이름 → id 분류(WP-888). 구성요소와 같은 규칙(NFC·대소문자 무시·중복 하나로)이고 보관(status=ARCHIVED)만 다르다.
 * allowArchivedIds 는 이 이슈에 같은 종류로 이미 붙어 있는 보관 버전 id — 유지는 허용이라 archived 로 치지 않는다.
 */
export function resolveVersionNames(
  names: string[],
  existing: ProjectVersionRow[],
  options: { allowArchivedIds?: ReadonlySet<number> } = {},
): { ids: number[]; unknown: string[]; archived: string[] } {
  const allow = options.allowArchivedIds ?? new Set<number>();
  const rows = existing.map((v) => ({ id: v.id, name: v.name, archived: v.status === 'ARCHIVED' && !allow.has(v.id) }));
  try {
    return resolveComponentNames(names, rows);
  } catch (e) {
    throw new Error((e as Error).message.replace('구성요소', '버전'));
  }
}

/** 버전 이름 → id 목록. 없는 이름이면 쓸 수 있는(보관 안 된) 목록을 담아 throw, 새로 붙일 보관 버전도 throw — 쓰기 전에 실패시키려는 것(WP-888). */
export function resolveVersionIds(names: string[], existing: ProjectVersionRow[], allowArchivedIds?: ReadonlySet<number>): number[] {
  const usable = existing.filter((v) => v.status !== 'ARCHIVED').map((v) => v.name);
  const part = resolveVersionNames(names, existing, { allowArchivedIds });
  if (part.unknown.length) throw new Error(`버전 '${part.unknown[0]}' 을(를) 찾을 수 없습니다. 사용 가능: ${usable.join(', ') || '(없음)'}`);
  if (part.archived.length) throw new Error(`버전 '${part.archived[0]}' 은(는) 보관되어 새로 붙일 수 없습니다. 사용 가능: ${usable.join(', ') || '(없음)'}`);
  return part.ids;
}

/**
 * list_issues 의 fixVersion·affectsVersion 이름 CSV → 서버 쿼리 토큰 CSV(WP-888). "none" 은 그대로, 나머지 이름은 id 로 바꾼다 —
 * 서버는 숫자 토큰을 id 로 보므로 이름이 "2026"·"10" 인 버전은 이름으로 찾을 수 없어서다. 거르는 것이라 보관 버전도 허용한다.
 * 이름 해석은 프로젝트 스코프라 projectKey 가 있을 때만 한다 — 프로젝트 없는 교차 검색은 이름을 그대로 넘긴다(숫자 이름은 서버가 id 로 읽는 한계).
 * 없는 이름은 조회 전에 사용 가능 목록과 함께 throw 한다.
 */
export async function resolveVersionFilter(
  client: Pick<ProjectMetaClient, 'getProjectVersions'>,
  projectKey: string | undefined,
  csv: string,
): Promise<string> {
  const tokens = csv.split(',').map((t) => t.trim()).filter(Boolean);
  const names = tokens.filter((t) => t.toLowerCase() !== 'none');
  if (!projectKey || names.length === 0) return csv;
  const existing = await client.getProjectVersions(projectKey);
  // 거르기라 보관 버전도 된다 — 보관 id 를 모두 허용 집합에 넣어 archived 로 치지 않게 한다.
  const allowArchived = new Set(existing.filter((v) => v.status === 'ARCHIVED').map((v) => v.id));
  const part = resolveVersionNames(names, existing, { allowArchivedIds: allowArchived });
  if (part.unknown.length) {
    throw new Error(`버전 '${part.unknown[0]}' 을(를) 찾을 수 없습니다. 사용 가능: ${existing.map((v) => v.name).join(', ') || '(없음)'}`);
  }
  const ids = [...part.ids.map(String)];
  return tokens.some((t) => t.toLowerCase() === 'none') ? [...ids, 'none'].join(',') : ids.join(',');
}

/** 마일스톤 이름 → milestoneId(#854). */
export async function resolveMilestoneId(client: ProjectMetaClient, projectKey: string, name: string): Promise<number> {
  return idByName(await client.getProjectMilestones(projectKey), name, '마일스톤');
}

/** 사이클 이름 배열 → cycleId 배열(#854). */
export async function resolveCycleIds(client: ProjectMetaClient, projectKey: string, names: string[]): Promise<number[]> {
  const cycles = await client.getProjectCycles(projectKey);
  return names.map((n) => idByName(cycles, n, '사이클'));
}

/** 마일스톤 이름 CSV → 서버 milestone 쿼리(id CSV, WP-356). 서버도 이름을 해석하지만(WP-735) 여기서 먼저 해석해 프로젝트별 안내 문구로 되묻는다. */
export async function resolveMilestoneFilter(
  client: Pick<ProjectMetaClient, 'getProjectMilestones'>,
  projectKey: string | undefined,
  csv: string,
): Promise<string> {
  if (!projectKey) throw new Error('마일스톤 이름으로 거르려면 projectKey 를 함께 지정하세요.');
  const milestones = await client.getProjectMilestones(projectKey);
  return csv
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
    .map((n) => String(idByName(milestones, n, '마일스톤')))
    .join(',');
}

/** 커스텀 필드 이름 → 정의(WP-356). 없으면 사용 가능한 필드 이름을 담아 throw. */
export function fieldDefByName(defs: ProjectFieldDef[], name: string): ProjectFieldDef {
  const def = defs.find((d) => d.name === name);
  if (!def) throw new Error(`커스텀 필드 '${name}' 을(를) 찾을 수 없습니다. 사용 가능: ${defs.map((d) => d.name).join(', ') || '(없음)'}`);
  return def;
}

/**
 * 커스텀 필드 값 → 서버가 받는 JSON 값(WP-356). 쓰기 전에 모양과 선택지를 확인해 실패를 미리 드러낸다(서버도 같은 검증을 한다).
 * TEXT·DATE·SELECT 는 문자열, NUMBER 는 숫자(숫자 문자열도 받는다), MULTI_SELECT 는 문자열 배열. 선택지 밖 값은 사용 가능 목록을 담아 throw.
 */
export function toFieldValue(def: ProjectFieldDef, value: unknown): string | number | string[] {
  const options = def.options ?? [];
  const checkOption = (v: string) => {
    if (!options.includes(v)) throw new Error(`필드 '${def.name}' 에 없는 선택지 '${v}' 입니다. 사용 가능: ${options.join(', ') || '(없음)'}`);
    return v;
  };
  switch (def.type) {
    case 'NUMBER': {
      const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
      if (!Number.isFinite(n)) throw new Error(`필드 '${def.name}' 는 숫자 필드입니다: ${JSON.stringify(value)}`);
      return n;
    }
    case 'MULTI_SELECT': {
      const arr = Array.isArray(value) ? value : [value];
      return arr.map((v) => checkOption(String(v)));
    }
    case 'SELECT':
      return checkOption(String(value));
    case 'DATE':
      if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        throw new Error(`필드 '${def.name}' 는 날짜 필드입니다(yyyy-MM-dd): ${JSON.stringify(value)}`);
      }
      return value;
    default:
      return String(value);
  }
}

/**
 * list_issues 의 cycle CSV → 서버 cycle 쿼리 토큰 CSV(WP-176). none → "none"(사이클 연결 전무), backlog → "null"(진행 중·예정 밖),
 * active → 진행 중 사이클 id 들, 그 외는 사이클 이름 → id. 이름·active 는 프로젝트 스코프라 projectKey 가 필요하다.
 * 서버는 해석 못 한 토큰을 조용히 버려 필터가 빠진 결과를 주므로, 해석 불가(없는 이름·활성 사이클 없음)는 여기서 throw 한다.
 */
export async function resolveCycleFilter(
  client: Pick<ProjectMetaClient, 'getProjectCycles'>,
  projectKey: string | undefined,
  csv: string,
): Promise<string> {
  const tokens = csv.split(',').map((t) => t.trim()).filter(Boolean);
  const isSpecial = (t: string) => ['none', 'backlog'].includes(t.toLowerCase());
  // 프로젝트 사이클 조회는 이름·active 토큰이 있을 때만, 한 번 한다.
  let cycles: Awaited<ReturnType<typeof client.getProjectCycles>> = [];
  if (!tokens.every(isSpecial)) {
    if (!projectKey) throw new Error('사이클 이름·active 로 거르려면 projectKey 를 함께 지정하세요.');
    cycles = await client.getProjectCycles(projectKey);
  }
  const out: string[] = [];
  for (const tok of tokens) {
    const lower = tok.toLowerCase();
    if (lower === 'none') out.push('none');
    else if (lower === 'backlog') out.push('null');
    else if (lower === 'active') {
      const active = cycles.filter((c) => c.status === 'ACTIVE');
      if (!active.length) {
        throw new Error(
          `프로젝트 ${projectKey} 에 진행 중(활성) 사이클이 없습니다. 사이클: ${cycles.map((c) => `${c.name}(${c.status})`).join(', ') || '(없음)'}`,
        );
      }
      out.push(...active.map((c) => String(c.id)));
    } else out.push(String(idByName(cycles, tok, '사이클')));
  }
  return out.join(',');
}

/**
 * 이슈 목록 조회의 assignee 기본값(#841). assignee·reporter 가 둘 다 없을 때만 "me"(내 담당) —
 * reporter 만 준 "내가 만든" 조회에 담당 조건이 끼면 교집합이 되어 결과가 줄어든다.
 * ai-agent·workplace-mcp 의 list_issues 가 같은 규칙을 쓰도록 공유한다.
 */
export function defaultListAssignee(p: {
  assignee?: string;
  reporter?: string;
  watching?: boolean;
  parent?: string;
  mentionsMe?: boolean;
}): string | undefined {
  // WP-176: "any" 는 담당자 조건 없음 — 기본값 "me" 를 끄고 프로젝트 전체 이슈를 대상으로 한다.
  if (p.assignee?.trim().toLowerCase() === 'any') return undefined;
  // WP-356: 워치 중 이슈·특정 부모의 하위 이슈는 담당자와 무관한 질문이다 — 기본 "me" 가 끼면 내 담당분만 남는다.
  // WP-719: 나를 멘션한 이슈도 담당이 아닌 이슈에서 받은 지시를 찾는 조회라 같다.
  return p.assignee ?? (p.reporter || p.watching || p.parent || p.mentionsMe ? undefined : 'me');
}
