// 보고자 후보 조회(WP-967) — 오픈 프로젝트는 구성원이 아니어도 볼 수 있는 사람이 전부 후보라 워크스페이스
// 디렉터리(useMembers)를 검색하고, 그 밖(비공개·개인)은 지금처럼 프로젝트 멤버(useProjectMembers)만 본다.
// 두 소스·두 필터링 방식을 ReporterPicker 가 직접 알지 않도록 이 훅 하나로 감싼다.
import { useMemo } from 'react';

import { reporterCandidates, type ReporterOption } from '../../lib/reporterCandidates';
import { useDebounceValue } from '../useDebounceValue';
import { useMembers } from './useMembers';
import { useProjectMembers } from './useProjectMembers';

/** 후보 목록 상태 — loading·error 동안 피커는 목록 대신 안내 문구를 보여 고를 수 없게 한다. */
export type ReporterCandidatesStatus = 'loading' | 'error' | 'ready';

export function useReporterCandidates(
  projectKey: string,
  isOpenProject: boolean,
  search: string,
  currentReporterId: number | null | undefined,
  /** 팝오버가 열렸을 때만 디렉터리를 조회한다 — 피커는 늘 마운트돼 있어 상세를 열 때마다 조회가 나가지 않게. */
  open: boolean,
): { data: ReporterOption[]; status: ReporterCandidatesStatus } {
  const debouncedSearch = useDebounceValue(search, 300);
  // 이슈 상세가 같은 키로 이미 조회해 캐시를 함께 쓴다 — OPEN 일 때는 결과만 쓰지 않는다.
  const members = useProjectMembers(projectKey);
  const directory = useMembers(
    { search: debouncedSearch.trim(), kind: 'HUMAN', size: 20 },
    { enabled: isOpenProject && open },
  );

  const data = useMemo<ReporterOption[]>(() => {
    if (isOpenProject) {
      // 서버가 이미 검색어·kind(HUMAN)로 좁혀 주므로 활성·본인 제외만 거른다.
      return reporterCandidates(directory.data?.content, currentReporterId);
    }
    const q = search.toLowerCase();
    return reporterCandidates(members.data, currentReporterId).filter((m) =>
      `${m.name} ${m.username}`.toLowerCase().includes(q),
    );
  }, [isOpenProject, directory.data, members.data, search, currentReporterId]);

  const source = isOpenProject ? directory : members;
  // 오픈 프로젝트는 디바운스 동안 목록이 옛 검색어 기준이라, 입력이 따라잡기 전까지 로딩으로 다뤄 엉뚱한 사람을 못 고르게 한다.
  const pending = source.isLoading || (isOpenProject && search !== debouncedSearch);
  const status: ReporterCandidatesStatus = pending ? 'loading' : source.isError ? 'error' : 'ready';
  return { data, status };
}
