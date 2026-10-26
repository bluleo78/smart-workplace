// 프로젝트 버전(WP-888) 모킹 팩토리.
// src/types/version.ts 의 VersionResponse / VersionSummary 와 1:1.

import type { VersionResponse, VersionSummary } from '../../src/types/version';

let nextId = 1;

/** 테스트용 버전 — 기본은 미출시·날짜 없음·이슈 0건. */
export function createVersion(overrides: Partial<VersionResponse> = {}): VersionResponse {
  const id = overrides.id ?? nextId++;
  return {
    id,
    name: `v${id}`,
    description: null,
    startDate: null,
    releaseDate: null,
    status: 'UNRELEASED',
    releasedAt: null,
    progress: { done: 0, inProgress: 0, todo: 0 },
    affectsCount: 0,
    ...overrides,
  };
}

/** VersionResponse → 이슈에 임베드되는 VersionSummary. */
export function toVersionSummary(v: VersionResponse): VersionSummary {
  return { id: v.id, name: v.name, status: v.status };
}
