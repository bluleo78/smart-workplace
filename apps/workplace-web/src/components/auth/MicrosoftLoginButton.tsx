// WP-48 "Microsoft 계정으로 로그인" — <a> 전체 이동(서버 302 → Microsoft). SPA 라우팅으로 처리하면 안 된다.
import { ssoStartHref } from '../../lib/sso'
import { Button } from '../ui/button'

function MicrosoftLogo() {
  return (
    <svg width="16" height="16" viewBox="0 0 21 21" aria-hidden="true">
      <rect x="1" y="1" width="9" height="9" fill="#f25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
      <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
      <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
    </svg>
  )
}

export function MicrosoftLoginButton({ returnTo = '/' }: { returnTo?: string }) {
  return (
    <Button asChild variant="outline" className="w-full gap-2">
      <a href={ssoStartHref(returnTo)}>
        <MicrosoftLogo />
        Microsoft 계정으로 로그인
      </a>
    </Button>
  )
}
