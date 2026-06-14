import type { PlatformLoginRequest, PlatformTokenResponse, PlatformUser } from '../types/platform'
import { client } from './client'

// 플랫폼(운영자) 인증 API.
export const platformAuth = {
  login: (req: PlatformLoginRequest) => client.post<PlatformTokenResponse>('/auth/login', req),
  refresh: () => client.post<PlatformTokenResponse>('/auth/refresh'),
  me: () => client.get<PlatformUser>('/auth/me'),
  logout: () => client.post<void>('/auth/logout'),
}
