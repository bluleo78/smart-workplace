// src/resolve.ts — 사람 친화 자연키(유형명/라벨명/username)를 백엔드 숫자 ID로 변환한다.
// 유형명·라벨명은 프로젝트당 UNIQUE, username 은 전역 UNIQUE 이므로 첫 매치가 곧 유일 매치다.
// 매치 실패 시 유효 목록을 담아 throw → 호출측(도구 레이어)이 그대로 전파하거나 래핑한다.
// workplace-mcp(PatApiClient)와 workplace-ai-agent(WorkplaceApiClient 어댑터) 양쪽에서 공유한다.

/** 리졸브에 필요한 최소 구조적 인터페이스. 양쪽 앱의 API 클라이언트가 이 시그니처를 만족하면 된다. */
export interface ProjectMetaClient {
  getProjectTypes(projectKey: string): Promise<{ id: number; name: string }[]>;
  getProjectMembers(projectKey: string): Promise<{ userId: number; username: string; name?: string; role?: string }[]>;
  getProjectLabels(projectKey: string): Promise<{ id: number; name: string; colorToken?: string }[]>;
  getProjectMilestones(projectKey: string): Promise<{ id: number; name: string; dueDate?: string | null; description?: string | null }[]>;
  getProjectCycles(projectKey: string): Promise<
    { id: number; name: string; status?: string; goal?: string | null; startDate?: string | null; endDate?: string | null }[]
  >;
  /** GET /projects/{key}/fields — 커스텀 필드 정의(WP-356). options 는 SELECT·MULTI_SELECT 만. */
  getProjectFields(projectKey: string): Promise<ProjectFieldDef[]>;
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

/** 호출자 본인 조회(GET /auth/me) — 담당자 "me" 를 호출자로 치환할 때 쓴다. */
export interface CurrentUserClient {
  getMe(): Promise<{ id: number; username: string }>;
}

/** 담당자 리졸브에 필요한 클라이언트 — 프로젝트 멤버 + 호출자 조회. */
export type AssigneeResolverClient = Pick<ProjectMetaClient, 'getProjectMembers'> & CurrentUserClient;

/** 담당자 값이 "me"(호출자 본인) 별칭인지 — list_issues 의 assignee="me" 와 같은 어휘. 대소문자·앞뒤 공백 무시. */
const isMeAlias = (u: string) => u.trim().toLowerCase() === 'me';

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

/** 라벨 이름 배열 → labelId 배열. */
export async function resolveLabelIds(client: Pick<ProjectMetaClient, 'getProjectLabels'>, projectKey: string, labelNames: string[]): Promise<number[]> {
  const labels = await client.getProjectLabels(projectKey);
  return labelNames.map((n) => idByName(labels, n, '라벨'));
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

/** 마일스톤 이름 CSV → 서버 milestone 쿼리(id CSV, WP-356). 서버는 숫자가 아닌 토큰을 조용히 버리므로 이름은 여기서 해석·검증한다. */
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
export function defaultListAssignee(p: { assignee?: string; reporter?: string; watching?: boolean; parent?: string }): string | undefined {
  // WP-176: "any" 는 담당자 조건 없음 — 기본값 "me" 를 끄고 프로젝트 전체 이슈를 대상으로 한다.
  if (p.assignee?.trim().toLowerCase() === 'any') return undefined;
  // WP-356: 워치 중 이슈·특정 부모의 하위 이슈는 담당자와 무관한 질문이다 — 기본 "me" 가 끼면 내 담당분만 남는다.
  return p.assignee ?? (p.reporter || p.watching || p.parent ? undefined : 'me');
}
