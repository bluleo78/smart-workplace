// src/resolve.ts — 사람 친화 자연키(유형명/라벨명/username)를 백엔드 숫자 ID로 변환한다.
// 유형명·라벨명은 프로젝트당 UNIQUE, username 은 전역 UNIQUE 이므로 첫 매치가 곧 유일 매치다.
// 매치 실패 시 유효 목록을 담아 throw → 호출측(도구 레이어)이 그대로 전파하거나 래핑한다.
// workplace-mcp(PatApiClient)와 workplace-ai-agent(WorkplaceApiClient 어댑터) 양쪽에서 공유한다.

/** 리졸브에 필요한 최소 구조적 인터페이스. 양쪽 앱의 API 클라이언트가 이 시그니처를 만족하면 된다. */
export interface ProjectMetaClient {
  getProjectTypes(projectKey: string): Promise<{ id: number; name: string }[]>;
  getProjectMembers(projectKey: string): Promise<{ userId: number; username: string }[]>;
  getProjectLabels(projectKey: string): Promise<{ id: number; name: string }[]>;
}

/** 유형 이름 → typeId. 없으면 사용 가능한 유형명을 담아 throw. */
export async function resolveTypeId(
  client: ProjectMetaClient,
  projectKey: string,
  typeName: string,
): Promise<number> {
  const types = await client.getProjectTypes(projectKey);
  const match = types.find((t) => t.name === typeName);
  if (!match) {
    throw new Error(
      `유형 '${typeName}' 을(를) 찾을 수 없습니다. 사용 가능: ${types.map((t) => t.name).join(', ')}`,
    );
  }
  return match.id;
}

/** username 배열 → userId 배열. 하나라도 없으면 사용 가능한 username 을 담아 throw. */
export async function resolveAssigneeIds(
  client: ProjectMetaClient,
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

/** 라벨 이름 배열 → labelId 배열. 하나라도 없으면 사용 가능한 라벨명을 담아 throw. */
export async function resolveLabelIds(
  client: ProjectMetaClient,
  projectKey: string,
  labelNames: string[],
): Promise<number[]> {
  const labels = await client.getProjectLabels(projectKey);
  return labelNames.map((n) => {
    const l = labels.find((x) => x.name === n);
    if (!l) {
      throw new Error(
        `라벨 '${n}' 을(를) 찾을 수 없습니다. 사용 가능: ${labels.map((x) => x.name).join(', ')}`,
      );
    }
    return l.id;
  });
}
