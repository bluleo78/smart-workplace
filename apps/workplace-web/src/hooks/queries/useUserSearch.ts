// 사용자 검색 (멤버 picker 등) — 기존 GET /api/v1/users?search= 재사용.
// query.length < 1 이면 호출 안 함. staleTime 30초로 연속 타이핑/필터 토글 중 재요청 억제.

import { useQuery } from '@tanstack/react-query';

import { usersApi } from '../../api/users';
import type { UserResponse } from '../../types/auth';
import type { PageResponse } from '../../types/common';

export const userSearchKeys = {
  search: (query: string) => ['users', 'search', query] as const,
};

export function useUserSearch(query: string) {
  const trimmed = query.trim();
  return useQuery<PageResponse<UserResponse>>({
    queryKey: userSearchKeys.search(trimmed),
    queryFn: async () => {
      const res = await usersApi.getUsers({ search: trimmed, size: 20 });
      return res.data;
    },
    enabled: trimmed.length >= 1,
    staleTime: 30_000,
  });
}
