import type { PlatformUserLookup } from '../types/platform'
import { client } from './client'

// 운영자 콘솔 — 전역 사용자 이메일 조회. 없으면 404(axios 에러) — 호출부에서 catch 하여 "신규 생성" 분기로 처리한다.
export const platformUsers = {
  lookup: (email: string) =>
    client
      .get<PlatformUserLookup>('/users/lookup', { params: { email } })
      .then((res) => res.data),
}
