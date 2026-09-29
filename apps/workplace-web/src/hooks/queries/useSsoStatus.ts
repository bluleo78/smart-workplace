import { useQuery } from '@tanstack/react-query'

import { authApi } from '../../api/auth'

/** WP-48 SSO 사용 가능 여부 — 운영자 env 설정 상태라 거의 바뀌지 않는다. 실패 시 버튼을 숨긴다(재시도 없음). */
export function useSsoStatus() {
  return useQuery({
    queryKey: ['auth', 'sso-status'],
    queryFn: authApi.ssoStatus,
    staleTime: 5 * 60_000,
    retry: false,
  })
}
