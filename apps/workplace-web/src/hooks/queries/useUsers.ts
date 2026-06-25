import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { usersApi } from '../../api/users';
import type { CreateMemberRequest } from '../../types/user';

export function useUsers(params: { search?: string; page?: number; size?: number }) {
  return useQuery({
    queryKey: ['users', params],
    queryFn: () => usersApi.getUsers(params).then(r => r.data),
  });
}

// 구성원(계정) 추가 — 성공 시 사용자 목록(['users', *])을 무효화해 새 구성원이 즉시 반영되게 한다.
export function useCreateMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateMemberRequest) => usersApi.createMember(data).then(r => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['users'] }); },
  });
}
