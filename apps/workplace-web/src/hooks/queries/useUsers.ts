import { useMutation, useQueryClient } from '@tanstack/react-query';

import { usersApi } from '../../api/users';
import type { CreateMemberRequest } from '../../types/user';

// 구성원(계정) 추가 — 성공 시 구성원 디렉터리 캐시(['members', *])를 무효화해 새 구성원이 즉시 반영되게 한다.
export function useCreateMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateMemberRequest) => usersApi.createMember(data).then(r => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['members'] }); },
  });
}
