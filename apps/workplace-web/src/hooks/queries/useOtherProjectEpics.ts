// 다른 프로젝트 에픽 찾기(WP-1039) — 상위 에픽을 고를 때 같은 프로젝트 에픽 아래에 읽을 수 있는 다른 프로젝트 에픽을 키·제목으로 찾는다.
// 관계 추가 창의 찾기(/issues/lookup, 최대 20건)에 type=EPIC·openOnly·excludeFrom 거름을 붙여 서버가 상한 전에 거르게 한다 — 화면에서
// 거르면 다른 유형·같은 프로젝트 이슈가 20건을 채워 에픽이 밀려났다. 번호만 친 입력(같은 프로젝트 번호 지정)은 묻지 않는다.
// 개인 프로젝트에서는 찾기가 그 프로젝트 안으로 좁혀져(서버) 다른 프로젝트 에픽이 나오지 않는다 — 개인 프로젝트는 다른 프로젝트 에픽을 둘 수 없다.

import { useDebounceValue } from '@/hooks/useDebounceValue';

import type { IssueLookupFilter } from '../../api/issueRelations';
import { isOtherProjectEpicQuery, otherProjectEpics } from '../../lib/epicCandidates';
import { LOOKUP_DEBOUNCE_MS, useIssueLookup } from './useIssueRelations';

/** 상위 에픽 후보 거름 — 다른 프로젝트의 열린 에픽만(모듈 상수라 쿼리 키가 렌더마다 같다). */
const OTHER_OPEN_EPICS: IssueLookupFilter = { type: 'EPIC', openOnly: true, excludeFrom: true };

export function useOtherProjectEpics(query: string, projectKey: string, enabled = true) {
  const trimmed = query.trim();
  const debounced = useDebounceValue(trimmed, LOOKUP_DEBOUNCE_MS);
  // 번호만 친 입력은 같은 프로젝트 번호 지정 — 다른 프로젝트를 찾지 않는다.
  const active = enabled && isOtherProjectEpicQuery(debounced);
  const lookup = useIssueLookup(debounced, projectKey, active, OTHER_OPEN_EPICS);
  return {
    epics: active ? otherProjectEpics(lookup.data ?? [], projectKey) : [],
    // 친 글자가 아직 디바운스 중이거나 찾는 중 — 「맞는 에픽이 없습니다」를 서둘러 띄우지 않게.
    searching: enabled && isOtherProjectEpicQuery(trimmed) && (debounced !== trimmed || lookup.isFetching),
  };
}
