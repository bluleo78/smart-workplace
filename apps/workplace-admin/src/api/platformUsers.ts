import type { PlatformUserLookup, PlatformUserSearchItem } from '../types/platform'
import { client } from './client'

// 운영자 콘솔 — 전역 사용자 API.
// - lookup: 이메일 정확일치 조회. 없으면 404(axios 에러) — 호출부에서 catch 하여 "신규 생성" 분기로 처리한다.
// - search: 이메일·이름·아이디 부분일치 자동완성(WP-337). 2글자 미만이면 서버가 빈 목록을 준다.
export const platformUsers = {
  lookup: (email: string) =>
    client
      .get<PlatformUserLookup>('/users/lookup', { params: { email } })
      .then((res) => res.data),
  search: (q: string) =>
    client
      .get<PlatformUserSearchItem[]>('/users/search', { params: { q } })
      .then((res) => res.data),
}
