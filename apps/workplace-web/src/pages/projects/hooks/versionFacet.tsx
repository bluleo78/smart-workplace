// 이슈 필터 바의 「수정 버전」·「영향 버전」 facet(WP-888) — 데스크톱 필터 바·모바일 필터 시트가 같은 정의를 쓴다.
// 구성요소 facet 과 같은 모양: 보관 안 된 버전(목록 순서) → 「… 버전 없음」 → 보관된 것은 아래 「보관됨」 묶음.
// 「없음」은 facet 값 'none'(URL 의 none 토큰)으로 담아, 배지 수·칩 문구가 특별 처리 없이 맞게 한다.

import type { FacetDef, FacetValue } from '@/components/filter';

import { VersionChip } from '../../../components/versions/VersionChip';
import { hasActiveVersions, isArchived, partitionByStatus } from '../../../lib/issueVersions';
import type { VersionResponse } from '../../../types/version';

/** 「버전 없음」 facet 값 — URL·서버의 none 토큰과 같은 글자. */
export const VERSION_NONE = 'none';

/** 두 필터의 facet 키·라벨 — URL 키(fixVersion·affectsVersion)와 같다. */
const VERSION_FACET = {
  fix: { key: 'fixVersion', label: '수정 버전', noneLabel: '수정 버전 없음' },
  affects: { key: 'affectsVersion', label: '영향 버전', noneLabel: '영향 버전 없음' },
} as const;

/**
 * 보관 안 된 버전이 없으면 null — facet 을 넣지 않는다(버전을 쓰지 않는 프로젝트의 필터 바는 그대로).
 * 단, 그 필터가 이미 걸려 있으면(링크·저장 뷰가 실어 온 뒤 모두 보관됨) facet 을 남긴다 — 숨기면 걸린 필터를 풀 곳이 없다.
 */
export function buildVersionFacet(kind: 'fix' | 'affects', list: VersionResponse[], filterActive = false): FacetDef | null {
  if (!hasActiveVersions(list) && !filterActive) return null;
  const { key, label, noneLabel } = VERSION_FACET[kind];
  const option = (v: VersionResponse) => ({
    value: v.id,
    label: v.name,
    render: <VersionChip version={v} size="sm" />,
    ...(isArchived(v) ? { group: '보관됨' } : {}),
  });
  const { active, archived } = partitionByStatus(list);
  return {
    key,
    label,
    options: [
      ...active.map(option),
      { value: VERSION_NONE, label: noneLabel },
      ...archived.map(option),
    ],
  };
}

/** 필터 값(버전 id + 「없음」) → facet 선택값. */
export function versionFacetValue(ids: number[], none: boolean): FacetValue[] {
  return [...ids, ...(none ? [VERSION_NONE] : [])];
}

/** facet 선택값 → 필터 값. 숫자는 버전 id, 'none' 은 「없음」. */
export function versionFilterFromFacet(values: FacetValue[] | undefined): { ids: number[]; none: boolean } {
  const vs = values ?? [];
  return { ids: vs.filter((v): v is number => typeof v === 'number'), none: vs.includes(VERSION_NONE) };
}
