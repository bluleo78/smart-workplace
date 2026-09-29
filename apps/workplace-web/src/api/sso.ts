// WP-48 워크스페이스 SSO 설정 API (관리자 전용, sso:manage).
import { client } from './client'

export interface SsoSettings {
  available: boolean
  enabled: boolean
  adminConsentUrl: string | null
  passwordlessMemberCount: number
}

export const ssoApi = {
  getSettings: () => client.get<SsoSettings>('/admin/sso').then((r) => r.data),
  setEnabled: (enabled: boolean) => client.put('/admin/sso/enabled', { enabled }),
}
