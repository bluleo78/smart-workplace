import type { useUserEmailLookup } from '../hooks/useUserEmailLookup'
import { Button } from './ui/button'
import { Input } from './ui/input'

interface UserEmailLookupFieldProps {
  lookup: ReturnType<typeof useUserEmailLookup>
  id: string
  /** 입력칸 아래 오류와 별개로 붉은 테두리를 띄울지(예: 찾지 못함) — 오류 문구는 부모 FormField 가 보여준다. */
  invalid?: boolean
  inputTestId: string
  checkTestId: string
}

// "이메일 입력 + 확인" 입력줄 — 테넌트 소유자 지정·멤버 추가가 같은 조작을 쓰도록 공용화(WP-337).
// 이메일을 쳤고 아직 확인 전이면 Enter 는 폼 제출 대신 확인으로 동작한다. 비어 있거나 이미 확인됐으면 그대로 제출된다.
export function UserEmailLookupField({
  lookup,
  id,
  invalid,
  inputTestId,
  checkTestId,
}: UserEmailLookupFieldProps) {
  return (
    <div className="flex gap-2">
      <Input
        id={id}
        type="email"
        autoComplete="off"
        // 1Password 등 비밀번호 관리자가 계정 필드로 오인해 아이콘을 붙이지 않게 한다.
        data-1p-ignore
        aria-invalid={invalid || !!lookup.error || undefined}
        className="max-md:h-10"
        data-testid={inputTestId}
        value={lookup.email}
        // 확인 중엔 수정만 막는다(disabled 는 포커스를 잃게 해 키보드 흐름이 끊긴다).
        readOnly={lookup.isChecking}
        onChange={(e) => lookup.setEmail(e.target.value)}
        onKeyDown={(e) => {
          // 이미 확인된 사용자면 Enter 는 그대로 폼 제출로 흘려보낸다.
          if (e.key === 'Enter' && lookup.email.trim() && !lookup.user) {
            e.preventDefault()
            lookup.check()
          }
        }}
      />
      <Button
        type="button"
        variant="outline"
        className="max-md:h-10"
        onClick={lookup.check}
        disabled={lookup.isChecking || !lookup.email.trim()}
        data-testid={checkTestId}
      >
        {lookup.isChecking ? '확인 중...' : '확인'}
      </Button>
    </div>
  )
}
