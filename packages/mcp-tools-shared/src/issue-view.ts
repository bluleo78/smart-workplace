// src/issue-view.ts — 이슈 목록·상세 LLM 뷰가 함께 쓰는 변환 조각(WP-307).
// 사람·시각·유형·부모·라벨을 목록과 상세가 같은 모양으로 내보내도록 한 곳에 둔다 — 두 뷰가 따로 가공하다 필드가 어긋난 것이 누락의 원인이었다.
import { formatIssueKey } from './parse.js';

type Raw = Record<string, unknown>;

/** 사람 뷰 — username 은 쓰기 도구(assignees 등)에 넣는 식별자, name 은 화면 표시 이름. 모르면 username 은 null(표시 이름으로 채우지 않는다). */
export interface PersonView {
  username: string | null;
  name: string;
  /** HUMAN | AGENT. 응답에 종류가 없는 작성자(첨부자)는 null. */
  kind: string | null;
}

/** {username,name,kind} 형태(UserSummary) → 사람 뷰. 숫자 id 는 빼고 사람은 username 으로만 가리킨다(#833). */
export function toPersonView(u: Raw | null | undefined): PersonView | null {
  if (!u) return null;
  const username = typeof u.username === 'string' ? u.username : null;
  const name = typeof u.name === 'string' && u.name ? u.name : (username ?? '');
  return { username, name, kind: typeof u.kind === 'string' ? u.kind : 'HUMAN' };
}

/**
 * 평평한 작성자 필드(코멘트 author*·이력 actor*·첨부 attachedBy*) → 사람 뷰. username 이 없으면 null 로 두고 표시 이름으로 채우지 않는다 —
 * 표시 이름을 username 자리에 넣으면 LLM 이 그 값을 담당자 지정에 써서 실패한다(WP-307). 종류를 모르는 작성자(첨부자)는 kind null.
 */
export function toAuthorView(username: unknown, name: unknown, kind: unknown): PersonView {
  const u = typeof username === 'string' && username ? username : null;
  return { username: u, name: typeof name === 'string' ? name : (u ?? ''), kind: typeof kind === 'string' ? kind : null };
}

/** 마일스톤 id 는 있는데 이름을 조회하지 못했을 때의 표시 — "마일스톤 없음"(null)과 구분한다. */
export const MILESTONE_UNRESOLVED = '(이름 조회 실패)';

/** 마일스톤 id → 이름 뷰. 미지정이면 null, 이름을 못 찾으면 MILESTONE_UNRESOLVED. */
export function milestoneView(milestoneId: unknown, nameById: ReadonlyMap<number, string>): string | null {
  if (typeof milestoneId !== 'number') return null;
  return nameById.get(milestoneId) ?? MILESTONE_UNRESOLVED;
}

/**
 * ISO 시각(UTC) → Asia/Seoul 오프셋 ISO("2026-10-08T09:20:06+09:00"). 비서가 날짜를 KST 로 계산하므로 같은 기준으로 보여
 * UTC 자정 전후 종료분을 하루 어긋나게 읽지 않게 한다. 날짜만 있는 값(yyyy-MM-dd)·빈 값은 그대로 둔다.
 */
export function toSeoulIso(v: unknown): string | null {
  if (typeof v !== 'string' || !v) return null;
  if (!v.includes('T')) return v;
  const ms = Date.parse(v);
  if (Number.isNaN(ms)) return v;
  return new Date(ms + 9 * 3600_000).toISOString().slice(0, 19) + '+09:00';
}

/** 유형 요약({id,name,colorToken,icon}) → 이름. 색·아이콘은 LLM 에 쓸모없는 토큰이라 뺀다. */
export function typeName(t: unknown): string | null {
  if (t && typeof t === 'object' && typeof (t as Raw).name === 'string') return (t as Raw).name as string;
  return typeof t === 'string' ? t : null;
}

/** 라벨 요약 배열 → 이름 배열(update_issue 의 labels 와 같은 값). */
export function labelNames(labels: unknown): string[] {
  return ((labels ?? []) as Raw[]).map((l) => l?.name).filter((n): n is string => typeof n === 'string');
}

/** 부모 요약(ParentRef: number·title·status) → issueKey 로 가리키는 뷰. 부모는 같은 프로젝트라 projectKey 를 빌린다. */
export function toParentView(parent: unknown, projectKey: unknown): { issueKey: string; title: string; status: string | null } | null {
  if (!parent || typeof parent !== 'object') return null;
  const p = parent as Raw;
  const number = typeof p.number === 'number' ? p.number : undefined;
  return {
    issueKey: formatIssueKey(typeof projectKey === 'string' ? projectKey : undefined, number) ?? String(number ?? ''),
    title: typeof p.title === 'string' ? p.title : '',
    status: typeof p.status === 'string' ? p.status : null,
  };
}

/** 하위 이슈 진행률 — 하위가 없으면 null(빈 0/0 을 싣지 않는다). */
export function toChildrenView(childCount: unknown, childDoneCount: unknown): { total: number; done: number } | null {
  const total = typeof childCount === 'number' ? childCount : 0;
  return total > 0 ? { total, done: typeof childDoneCount === 'number' ? childDoneCount : 0 } : null;
}
