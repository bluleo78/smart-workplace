import { useQuery } from '@tanstack/react-query';

import { authApi } from '../../api/auth';

/**
 * 회원가입 가용성 조회 훅.
 * 부트스트랩(시스템 사용자 0명) 단계에서만 true 이며, 첫 사용자 생성 이후 false 로 잠긴다.
 * SignupPage(폼 노출)·LoginPage(가입 링크 노출) 가 공유한다.
 * 공개 엔드포인트이므로 인증 없이 호출 가능.
 */
export function useSignupAvailable() {
  return useQuery({
    queryKey: ['auth', 'signup-available'],
    queryFn: authApi.signupAvailable,
    // 가용성은 부트스트랩 1회성 상태라 자주 바뀌지 않음 — 짧은 세션 동안 캐시 유지.
    staleTime: 60_000,
  });
}
