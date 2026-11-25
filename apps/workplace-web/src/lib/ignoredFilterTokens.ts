// WP-2083 — 이슈 목록 주소(URLSearchParams)에서 화면이 알아듣지 못해 버려지는 필터 토큰을 골라낸다.
// parseFilters 는 모르는 토큰을 조용히 버려 「필터가 걸린 줄 모르고 전체 목록을 보는」 일이 생긴다 →
// 어떤 토큰이 무시됐는지 알려 주고(안내 배너), 그 토큰만 뺀 주소로 바꿀 수 있게 하는 순수 함수들이다.

import { ISSUE_SORT_KEYS } from '../types/issue';
import { parseClosedIn } from './closedRange';
import { csv, filtersToParams, parseFilters } from './issueFilters';

/** 버려진 토큰 하나 — key 는 주소 키, label 은 화면 칩과 같은 말, value 는 주소에 적힌 토큰 원문. */
export interface IgnoredFilterToken {
  key: string;
  label: string;
  value: string;
}

// 쉼표 목록 키 — 토큰마다 살아남는지 본다. 라벨은 화면 필터 칩과 같은 말.
const LIST_KEYS: Record<string, string> = {
  status: '상태 범주',
  statusId: '상태',
  priority: '우선순위',
  assignee: '담당자',
  label: '라벨',
  cycle: '사이클',
  milestone: '마일스톤',
  type: '유형',
  component: '구성요소',
  fixVersion: '수정 버전',
  affectsVersion: '영향 버전',
};

// 값 전체가 한 토큰인 키 — 통째로 살아남거나 통째로 버려진다.
const WHOLE_KEYS: Record<string, string> = {
  parent: '상위 이슈',
  dueFrom: '마감 시작',
  dueTo: '마감 끝',
  closedIn: '완료 기간',
};

const SORT_LABEL = '정렬';

// 키 하나만 든 주소를 parseFilters → filtersToParams 로 정규화한 값(그 키에 남는 것) — 규칙을 여기서 다시 쓰지 않고 파서를 그대로 거친다.
function normalizedValue(key: string, raw: string): string | null {
  const one = new URLSearchParams();
  one.set(key, raw);
  return filtersToParams(parseFilters(one), 'list', null).get(key);
}

// 대소문자를 무시하는 토큰은 null·none 뿐이다(파서 규칙) — 나머지는 HIGH 와 high 가 다르다.
const NULLISH = new Set(['null', 'none']);

// 비교용 정규화 — null·none 만 소문자로 접고 나머지는 원문 그대로.
const norm = (t: string): string => (NULLISH.has(t.toLowerCase()) ? t.toLowerCase() : t);

// 쉼표 목록 키에서 토큰 하나가 살아남는가.
function tokenSurvives(alive: Set<string>, t: string): boolean {
  return alive.has(norm(t));
}

// 쉼표 목록 키에 남는 토큰 집합(정규화된 값).
function survivingTokens(key: string, raw: string): Set<string> {
  return new Set(csv(normalizedValue(key, raw)).map(norm));
}

// 키 하나에서 버려진 토큰 원문들 — 검사 대상이 아닌 키는 빈 배열.
function ignoredOfKey(key: string, raw: string): string[] {
  if (key in LIST_KEYS) {
    const alive = survivingTokens(key, raw);
    return csv(raw).filter((t) => !tokenSurvives(alive, t));
  }
  if (key in WHOLE_KEYS) {
    // 빈 값 판정에만 다듬는다 — 판정은 원래 값 그대로(' 12' 같은 공백 낀 값은 화면이 그대로는 못 알아본다).
    if (!raw.trim()) return [];
    if (key === 'closedIn') return parseClosedIn(raw) ? [] : [raw];
    return normalizedValue(key, raw) === raw ? [] : [raw];
  }
  if (key === 'sort') {
    // 화면은 첫 기준만 쓴다(parseSort) — 그 기준이 모르는 값일 때만 버려진 것으로 본다.
    const first = csv(raw)[0];
    return first && !(ISSUE_SORT_KEYS as readonly string[]).includes(first) ? [first] : [];
  }
  return [];
}

function labelOf(key: string): string {
  return LIST_KEYS[key] ?? WHOLE_KEYS[key] ?? SORT_LABEL;
}

/** 주소에서 버려지는 필터 토큰들 — 주소에 나온 키 순서대로, 한 키 안에서는 토큰 순서대로. 불리언·보기·그룹 키는 보지 않는다. */
export function ignoredFilterTokens(params: URLSearchParams): IgnoredFilterToken[] {
  const out: IgnoredFilterToken[] = [];
  for (const key of new Set(params.keys())) {
    const raw = params.get(key);
    if (raw == null) continue;
    for (const value of ignoredOfKey(key, raw)) out.push({ key, label: labelOf(key), value });
  }
  return out;
}

/**
 * 버려지는 토큰만 뺀 새 주소 — 그 키에 남는 토큰이 없으면 키째 지운다. 다른 키(보기·열·aiChat 등)는 순서·값 그대로.
 * 「무시된 조건 지우기」가 쓴다 — 유효한 조건은 건드리지 않아야 한다.
 */
export function withoutIgnoredFilterTokens(params: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(params);
  // 키별로 버려진 값을 모은다(첫 값만 판정하는 ignoredFilterTokens 의 결과를 그대로 쓴다).
  const dropped = new Map<string, Set<string>>();
  for (const t of ignoredFilterTokens(params)) {
    const set = dropped.get(t.key) ?? new Set<string>();
    set.add(t.value);
    dropped.set(t.key, set);
  }
  for (const [key, bad] of dropped) {
    // 목록 키는 남는 토큰만 다시 쓰고, 없으면 키째 지운다. 통째 키·정렬은 키째 지운다.
    const kept = key in LIST_KEYS ? csv(params.get(key)).filter((t) => !bad.has(t)) : [];
    if (kept.length > 0) next.set(key, kept.join(','));
    else next.delete(key);
    // 버려진 정렬 기준에 딸린 direction 도 함께 지운다 — 기준 없이 방향만 남지 않게.
    if (key === 'sort') next.delete('direction');
  }
  return next;
}
