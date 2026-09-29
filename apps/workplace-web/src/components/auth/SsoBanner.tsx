// WP-48 로그인 화면 상단 SSO 결과 배너 — 오류(role=alert)와 관리자 동의 완료 안내(role=status).
import { ssoErrorMessage } from '../../lib/sso'

export function SsoBanner({ error, notice }: { error: string | null; notice: string | null }) {
  const message = ssoErrorMessage(error)
  if (message) {
    return (
      <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
        {message}
      </p>
    )
  }
  if (notice === 'consented') {
    return (
      <p role="status" className="rounded-md bg-primary/10 px-3 py-2 text-sm text-primary">
        관리자 승인이 완료되었습니다.
      </p>
    )
  }
  return null
}
