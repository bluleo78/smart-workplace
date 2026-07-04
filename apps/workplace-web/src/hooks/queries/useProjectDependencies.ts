// 타임라인 간트 의존 화살표용 프로젝트 전체 이슈 의존 엣지 조회 (#620).

import { useQuery } from '@tanstack/react-query';

import { getProjectDependencyEdges } from '../../api/issues';

export function useProjectDependencies(projectKey: string) {
  return useQuery({
    queryKey: ['issue-dependencies', projectKey],
    queryFn: () => getProjectDependencyEdges(projectKey),
    enabled: !!projectKey,
  });
}
