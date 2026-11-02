// 저장소 호스트 판정(WP-1268) — 연결해야 할 호스트(서버가 프로젝트 응답의 repositoryHost 로 계산해 준다)와 등록된 토큰을 한 목록으로 묶는다.
// 저장소 URL 해석은 서버(RepoHosts.hostOf)가 기준이라 화면은 URL 을 직접 읽지 않는다 — 「연결 안 됨」 판정이 서버의 실행 시작 막기와 어긋나지 않게 한다.

import type { AgentRepoCredential, AgentRuntimeProject, RepoKind } from '../types/agentRuntime';

/**
 * 호스트 이름 검증 — 서버와 같은 정규식(소문자 호스트만, 포트·스킴·경로 없음). 240자 상한은 runner 의 Secret 키
 * `repo-<kind>-<host>` 가 쿠버네티스 키 상한(253자)을 넘지 않게 한 것이다.
 */
const HOST_PATTERN = /^(?=.{1,240}$)[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/;

/** 입력을 trim+소문자로 맞춘 호스트 — 올바른 형식이 아니면 null. 대화상자의 「다른 호스트 추가」 검증에 쓴다. */
export function normalizeRepoHost(input: string): string | null {
  const host = input.trim().toLowerCase();
  return HOST_PATTERN.test(host) ? host : null;
}

/** 호스트 이름으로 종류를 짐작 — github 가 들어가면 GitHub, 아니면 GitLab(사내 GitLab 은 이름이 제각각이다). */
export function guessRepoKind(host: string): RepoKind {
  return host.toLowerCase().includes('github') ? 'GITHUB' : 'GITLAB';
}

/** 「저장소 연결」 묶음의 한 줄. */
export interface RepoConnectionRow {
  host: string;
  kind: RepoKind;
  /** 이 호스트 저장소를 가진 맡는 프로젝트 키들(없으면 필요 없는데 등록된 호스트). */
  projectKeys: string[];
  /** 연결돼 있으면 등록된 토큰 정보, 아니면 null. */
  credential: AgentRepoCredential | null;
}

/** 필요한 호스트(맡는 프로젝트 저장소에서, 프로젝트 키 목록과 함께). 호스트를 못 읽는 저장소(repositoryHost 없음)는 건너뛴다. */
function neededHosts(projects: AgentRuntimeProject[]): Map<string, string[]> {
  const needed = new Map<string, string[]>();
  for (const p of projects) {
    const host = p.repositoryHost;
    if (!host) continue;
    const keys = needed.get(host) ?? [];
    if (!keys.includes(p.projectKey)) keys.push(p.projectKey);
    needed.set(host, keys);
  }
  return needed;
}

/** 필요한 호스트 ∪ 등록된 호스트 — 필요한 것 먼저, 각각 호스트 순. */
export function repoConnectionRows(projects: AgentRuntimeProject[], credentials: AgentRepoCredential[]): RepoConnectionRow[] {
  const needed = neededHosts(projects);
  const byHost = new Map(credentials.map((c) => [c.host, c]));
  const row = (host: string): RepoConnectionRow => {
    const credential = byHost.get(host) ?? null;
    return { host, kind: credential?.kind ?? guessRepoKind(host), projectKeys: needed.get(host) ?? [], credential };
  };
  const neededRows = [...needed.keys()].sort().map(row);
  const extraRows = [...byHost.keys()].filter((h) => !needed.has(h)).sort().map(row);
  return [...neededRows, ...extraRows];
}

/** 맡는 프로젝트 저장소 호스트 중 토큰이 없는 것 — 켜기 전 확인이 쓴다. */
export function missingRepoHosts(projects: AgentRuntimeProject[], credentials: AgentRepoCredential[]): string[] {
  const have = new Set(credentials.map((c) => c.host));
  return [...neededHosts(projects).keys()].sort().filter((h) => !have.has(h));
}
