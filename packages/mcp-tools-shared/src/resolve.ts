// src/resolve.ts — 사람 친화 자연키(유형명/라벨명/username)를 백엔드 숫자 ID로 변환한다.
// 유형명·라벨명은 프로젝트당 UNIQUE, username 은 전역 UNIQUE 이므로 첫 매치가 곧 유일 매치다.
// 매치 실패 시 유효 목록을 담아 throw → 호출측(도구 레이어)이 그대로 전파하거나 래핑한다.
// workplace-mcp(PatApiClient)와 workplace-ai-agent(WorkplaceApiClient 어댑터) 양쪽에서 공유한다.

/** 리졸브에 필요한 최소 구조적 인터페이스. 양쪽 앱의 API 클라이언트가 이 시그니처를 만족하면 된다. */
export interface ProjectMetaClient {
  getProjectTypes(projectKey: string): Promise<{ id: number; name: string }[]>;
  getProjectMembers(projectKey: string): Promise<{ userId: number; username: string; name?: string; role?: string }[]>;
  getProjectLabels(projectKey: string): Promise<{ id: number; name: string }[]>;
  getProjectMilestones(projectKey: string): Promise<{ id: number; name: string }[]>;
  getProjectCycles(projectKey: string): Promise<{ id: number; name: string; status?: string }[]>;
}

/**
 * 이름 → id 공통 조회. 없으면 사용 가능한 이름 목록을 담아 throw — LLM 이 그 목록으로 스스로 고칠 수 있게 한다.
 * 유형·라벨·마일스톤·사이클 리졸브가 같은 규칙(정확일치)·같은 문구를 쓰도록 한 곳에 둔다.
 */
function idByName(rows: { id: number; name: string }[], name: string, what: string): number {
  const match = rows.find((r) => r.name === name);
  if (!match) {
    throw new Error(`${what} '${name}' 을(를) 찾을 수 없습니다. 사용 가능: ${rows.map((r) => r.name).join(', ') || '(없음)'}`);
  }
  return match.id;
}

/** 유형 이름 → typeId. */
export async function resolveTypeId(client: ProjectMetaClient, projectKey: string, typeName: string): Promise<number> {
  return idByName(await client.getProjectTypes(projectKey), typeName, '유형');
}

/** username 배열 → userId 배열. 하나라도 없으면 사용 가능한 username 을 담아 throw. */
export async function resolveAssigneeIds(
  client: Pick<ProjectMetaClient, 'getProjectMembers'>,
  projectKey: string,
  usernames: string[],
): Promise<number[]> {
  const members = await client.getProjectMembers(projectKey);
  return usernames.map((u) => {
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
}

/** 라벨 이름 배열 → labelId 배열. */
export async function resolveLabelIds(client: ProjectMetaClient, projectKey: string, labelNames: string[]): Promise<number[]> {
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

/**
 * 이슈 목록 조회의 assignee 기본값(#841). assignee·reporter 가 둘 다 없을 때만 "me"(내 담당) —
 * reporter 만 준 "내가 만든" 조회에 담당 조건이 끼면 교집합이 되어 결과가 줄어든다.
 * ai-agent·workplace-mcp 의 list_issues 가 같은 규칙을 쓰도록 공유한다.
 */
export function defaultListAssignee(p: { assignee?: string; reporter?: string }): string | undefined {
  return p.assignee ?? (p.reporter ? undefined : 'me');
}
