// 프로젝트 상태 mock 팩토리 (WP-808) — E2E 에서 /projects/{key}/statuses 응답과 이슈의 statusId·statusName 을 만들 때 쓴다.

import type { IssueStatus } from '../../src/types/issue';
import type { ColorToken } from '../../src/types/label';
import type { ProjectStatus } from '../../src/types/projectStatus';

// 범주 기본 색(WP-809) — src/lib/projectStatuses CATEGORY_DEFAULT_COLOR 와 같다. 그 모듈은 @/ 별칭 import 를 끌고 와 여기선 값을 둔다.
const CATEGORY_DEFAULT_COLOR: Record<IssueStatus, ColorToken> = {
  TODO: 'GRAY',
  IN_PROGRESS: 'BLUE',
  DONE: 'GREEN',
  CANCELED: 'GRAY',
};

// 서버 V204 가 프로젝트마다 심는 기본 4상태와 같은 이름·순서 — id 는 범주 순서대로 1~4 로 고정한다. 색은 범주 기본 색(V206 백필).
const SEED: readonly ProjectStatus[] = [
  { id: 1, name: '할 일', category: 'TODO', position: 0, color: 'GRAY' },
  { id: 2, name: '진행 중', category: 'IN_PROGRESS', position: 1, color: 'BLUE' },
  { id: 3, name: '완료', category: 'DONE', position: 2, color: 'GREEN' },
  { id: 4, name: '취소', category: 'CANCELED', position: 3, color: 'GRAY' },
];

let nextId = 100;

// 상태 단건 — id 미지정 시 100 부터 자동 증가(시드 1~4·withCustomStatuses 11~ 와 겹치지 않게). 색 미지정이면 범주 기본 색.
export function makeProjectStatus(over: Partial<ProjectStatus> = {}): ProjectStatus {
  const id = over.id ?? nextId++;
  const category = over.category ?? 'TODO';
  return { id, name: `상태${id}`, category, position: 99, color: CATEGORY_DEFAULT_COLOR[category], ...over };
}

// 기본 4상태(id 1~4) — 매번 새 객체를 돌려줘 스펙이 고쳐도 다른 스펙에 새지 않는다.
export function seedStatuses(): ProjectStatus[] {
  return SEED.map((s) => ({ ...s }));
}

// 범주의 기본 시드 상태 — issue.factory 가 status 에서 statusId·statusName 을 유도할 때 쓴다.
export function seedStatusOf(category: IssueStatus): ProjectStatus {
  return { ...SEED.find((s) => s.category === category)! };
}

// PATCH 본문의 statusId 를 서버처럼 이슈 요약에 반영할 필드 — 목이 statusId 만 병합하면 범주·이름이 옛 값으로 남는다.
// 시드 상태(id 1~4)만 안다. 모르는 id 는 statusId 만 돌려준다.
export function statusFieldsOf(statusId: number): {
  statusId: number;
  status?: IssueStatus;
  statusName?: string;
  statusColor?: string | null;
} {
  const s = SEED.find((x) => x.id === statusId);
  return s ? { statusId, status: s.category, statusName: s.name, statusColor: s.color } : { statusId };
}

// 기본 4상태 + 「진행 중」 범주에 이름 붙인 상태들을 덧붙인다.
// id 는 11, 12, … 순서로 고정 — 스펙이 id 를 하드코딩해 단언할 수 있게 결정적으로 둔다.
// position 은 서버처럼 프로젝트 전체 순번: 기본 「진행 중」(1) 바로 뒤에 2, 3, … 을 넣고 완료·취소는 그만큼 뒤로 민다.
// 다른 범주에 넣으려면 반환값을 고치거나 makeProjectStatus 를 쓴다.
export function withCustomStatuses(...names: string[]): ProjectStatus[] {
  const seed = seedStatuses().map((s) => (s.position > 1 ? { ...s, position: s.position + names.length } : s));
  const custom = names.map((name, i) => ({
    id: 11 + i,
    name,
    category: 'IN_PROGRESS' as const,
    position: 2 + i,
    color: CATEGORY_DEFAULT_COLOR.IN_PROGRESS,
  }));
  return [...seed.slice(0, 2), ...custom, ...seed.slice(2)];
}

// 범주 순서 — 서버 ProjectStatusRepository.DISPLAY_ORDER 와 같은 순서.
const CATEGORY_RANK: Record<IssueStatus, number> = { TODO: 0, IN_PROGRESS: 1, DONE: 2, CANCELED: 3 };

// 서버가 목록을 돌려주는 순서(범주 → position → id)로 정렬한 복사본 — 클라이언트는 다시 정렬하지 않으므로(WP-808)
// 목 GET 도 서버처럼 정렬해 돌려줘야 한다. 추가(POST)한 상태를 끝에 push 하는 목도 이것으로 제자리에 둔다.
export function inServerOrder(list: readonly ProjectStatus[]): ProjectStatus[] {
  return [...list].sort(
    (a, b) => CATEGORY_RANK[a.category] - CATEGORY_RANK[b.category] || a.position - b.position || a.id - b.id,
  );
}
