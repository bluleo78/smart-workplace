// 사용자 검색 (멤버 picker 등) — 기존 GET /api/v1/users?search= 재사용.
// 검색어가 비어 있어도 조회한다(#734) — picker 를 열자마자 해당 kind 로 조회 가능한 기본 후보 목록을 보여주기
// 위함. 백엔드는 search 가 blank 면 검색 조건을 걸지 않고 테넌트 멤버 전체를 id 순으로 페이지 반환한다.
// staleTime 30초로 연속 타이핑/필터 토글 중 재요청 억제.

import { useQuery } from '@tanstack/react-query';

import { usersApi } from '../../api/users';
import type { UserResponse } from '../../types/auth';
import type { PageResponse } from '../../types/common';

export const userSearchKeys = {
  search: (query: string, kind: string) => ['users', 'search', query, kind] as const,
};

// kind 기본값 'HUMAN' — 기존 호출부(프로젝트 멤버 추가 등) 동작 유지. DM 수신자 검색처럼 에이전트가 필요한
// 호출부만 'ALL'/'AGENT' 를 명시적으로 넘긴다(#691 — 백엔드가 kind 를 실제로 필터링하므로 여기서 넘긴 값이
// 곧 검색 결과 범위를 결정한다).
export function useUserSearch(query: string, kind: 'HUMAN' | 'AGENT' | 'ALL' = 'HUMAN') {
  const trimmed = query.trim();
  return useQuery<PageResponse<UserResponse>>({
    queryKey: userSearchKeys.search(trimmed, kind),
    queryFn: async () => {
      const res = await usersApi.getUsers({ search: trimmed, size: 20, kind });
      return res.data;
    },
    staleTime: 30_000,
  });
}
