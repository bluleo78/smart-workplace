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

/**
 * 평평한 작성자 필드(코멘트 author*·이력 actor*·첨부 attachedBy*) → 사람 뷰. username 이 없으면 null 로 두고 표시 이름으로 채우지 않는다 —
 * 표시 이름을 username 자리에 넣으면 LLM 이 그 값을 담당자 지정에 써서 실패한다(WP-307). 종류를 모르는 작성자(첨부자)는 kind null.
 */
export function toAuthorView(username: unknown, name: unknown, kind: unknown): PersonView {
  const u = typeof username === 'string' && username ? username : null;
  return { username: u, name: typeof name === 'string' && name ? name : (u ?? ''), kind: typeof kind === 'string' ? kind : null };
}

/** 중첩 사람 요약(UserSummary {username,name,kind}) → 사람 뷰. 숫자 id 는 빼고 사람은 username 으로만 가리킨다(#833). 종류가 없으면 HUMAN. */
export function toPersonView(u: Raw): PersonView {
  return toAuthorView(u.username, u.name, u.kind ?? 'HUMAN');
}

/** 사람 요약 배열(담당자 등) → 사람 뷰 배열. 배열이 아니면 빈 배열. */
export function toPeopleView(list: unknown): PersonView[] {
  return Array.isArray(list) ? (list as Raw[]).map(toPersonView) : [];
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
  const name = (t as Raw | null | undefined)?.name;
  return typeof name === 'string' ? name : null;
}

/** 라벨 요약 배열 → 이름 배열(update_issue 의 labels 와 같은 값). */
export function labelNames(labels: unknown): string[] {
  return ((labels ?? []) as Raw[]).map((l) => l?.name).filter((n): n is string => typeof n === 'string');
}

/** 부모 요약(ParentRef: number·title·status) → issueKey 로 가리키는 뷰. 부모는 같은 프로젝트라 projectKey 를 빌린다. 키를 못 만들면 null. */
export function toParentView(parent: unknown, projectKey: unknown): { issueKey: string; title: string; status: string | null } | null {
  const p = parent as Raw | null | undefined;
  const issueKey = formatIssueKey(projectKey as string | undefined, p?.number as number | undefined);
  if (!p || !issueKey) return null;
  return { issueKey, title: String(p.title ?? ''), status: (p.status as string | undefined) ?? null };
}

/** 하위 이슈 진행률 — 하위가 없으면 null(빈 0/0 을 싣지 않는다). */
export function toChildrenView(childCount: unknown, childDoneCount: unknown): { total: number; done: number } | null {
  const total = typeof childCount === 'number' ? childCount : 0;
  return total > 0 ? { total, done: typeof childDoneCount === 'number' ? childDoneCount : 0 } : null;
}
