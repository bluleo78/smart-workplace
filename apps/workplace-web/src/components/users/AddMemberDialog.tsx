import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useSsoSettings } from '@/hooks/queries/useSsoSettings'
import { useCreateMember } from '@/hooks/queries/useUsers'
import { extractApiError } from '@/lib/api-error'
import { passwordRule } from '@/lib/validations/user'

// 구성원 추가 폼 — 아이디(로그인 ID)/이메일(선택)/이름/역할 + 로그인 방식(WP-48).
// SSO 전용이면 비밀번호를 받지 않고 아이디는 회사 SSO 계정 주소(이메일)여야 한다(첫 SSO 로그인 매칭 키).
const addMemberSchema = z
  .object({
    loginMethod: z.enum(['SSO', 'PASSWORD']),
    // trim 후 검사 — 공백만 입력한 값이 서버로 전송되는 것을 클라이언트에서 먼저 차단한다.
    username: z.string().trim().min(1, '아이디를 입력하세요').max(50, '아이디는 50자 이하여야 합니다'),
    email: z.email('올바른 이메일 형식이 아닙니다').optional().or(z.literal('')),
    name: z.string().trim().min(1, '이름을 입력하세요').max(50, '이름은 50자 이하여야 합니다'),
    password: z.string().optional(),
    role: z.enum(['ADMIN', 'USER']),
  })
  .superRefine((v, ctx) => {
    if (v.loginMethod === 'SSO') {
      if (!z.email().safeParse(v.username).success) {
        ctx.addIssue({ code: 'custom', path: ['username'], message: 'SSO 전용 구성원의 아이디는 이메일 형식이어야 합니다' })
      }
      return
    }
    const r = passwordRule.safeParse(v.password ?? '')
    if (!r.success) ctx.addIssue({ code: 'custom', path: ['password'], message: r.error.issues[0].message })
  })

type AddMemberFormData = z.infer<typeof addMemberSchema>

interface AddMemberDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

// 새 구성원 계정을 만들어 현재 워크스페이스에 추가하는 다이얼로그.
// 성공(201) 시 목록 무효화 + 토스트 + 닫기. 서버 에러(409/400)는 폼 상단에 표시하고 유지한다.
export function AddMemberDialog({ open, onOpenChange }: AddMemberDialogProps) {
  const createMember = useCreateMember()
  const [serverError, setServerError] = useState('')
  // 체크 시 추가 성공해도 다이얼로그를 닫지 않고 폼만 비워 연속 등록을 지원.
  const [keepOpenAfterSubmit, setKeepOpenAfterSubmit] = useState(false)
  // 동기적 in-flight 가드(#583) — ref 는 즉시(리렌더 없이) 반영되므로 같은 이벤트 루프
  // 틱 내에 "추가" 버튼이 두 번 클릭돼도(createMember.isPending 리렌더 반영 전) 두 번째
  // 제출을 차단한다. #581/#582 와 동일 패턴.
  const submittingRef = useRef(false)

  // WP-48: 워크스페이스 SSO 가 켜져 있을 때만 로그인 방식 선택을 노출(기본 SSO 전용).
  const { data: ssoSettings } = useSsoSettings(open)
  const ssoOn = ssoSettings?.enabled === true
  // 로그인 방식 기본값 — SSO 가 켜져 있으면 SSO 전용, 아니면 비밀번호.
  const defaultMethod = ssoOn ? 'SSO' : 'PASSWORD'

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors },
  } = useForm<AddMemberFormData>({
    resolver: zodResolver(addMemberSchema),
    defaultValues: { role: 'USER', loginMethod: 'PASSWORD' },
  })
  const loginMethod = watch('loginMethod')

  // SSO 가 켜져 있으면 다이얼로그를 열 때 SSO 전용을 기본 선택으로 맞춘다.
  useEffect(() => {
    if (open && ssoOn) setValue('loginMethod', defaultMethod)
  }, [open, ssoOn, defaultMethod, setValue])

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      // reset(partial) 은 명시한 필드만 초기화하고 나머지는 이전 값을 유지한다.
      // 인자 없이 호출해 defaultValues 전체로 되돌려야 재오픈 시 잔여 입력이 남지 않는다.
      reset()
      setServerError('')
      setKeepOpenAfterSubmit(false)
      submittingRef.current = false
    }
    onOpenChange(next)
  }

  const onSubmit = (data: AddMemberFormData) => {
    // 동기적 중복 제출 가드 — 이미 제출 중이면 no-op.
    if (submittingRef.current) return
    submittingRef.current = true
    setServerError('')
    // 이메일 빈 문자열은 전송에서 제외(백엔드 선택값). SSO 전용은 password 를 보내지 않는다(WP-48).
    const { loginMethod: method, password, ...rest } = data
    const payload = {
      ...rest,
      email: rest.email ? rest.email : undefined,
      ...(method === 'PASSWORD' ? { password } : {}),
    }
    createMember.mutate(payload, {
      onSuccess: () => {
        toast.success('구성원을 추가했습니다.')
        if (keepOpenAfterSubmit) {
          // 다이얼로그는 유지 — 폼만 비워 바로 다음 구성원을 입력할 수 있게 한다.
          // 부분 reset 은 명시하지 않은 필드를 이전 값으로 남기므로 모든 필드를 빈 값으로 명시한다.
          reset({
            username: '',
            email: '',
            name: '',
            password: '',
            role: 'USER',
            loginMethod: defaultMethod,
          })
          submittingRef.current = false
          return
        }
        // 닫기 경로(handleOpenChange)가 이미 ref 를 리셋하지만, 다음 오픈 전까지 안전하게
        // 유지되도록 여기서도 명시적으로 해제한다.
        submittingRef.current = false
        handleOpenChange(false)
      },
      onError: (e) => {
        // 서버 에러(409 중복/400 검증)는 폼 상단에 표시하고 다이얼로그를 유지한다(운영자 콘솔 패턴).
        // errors 필드 맵(필드별 로컬라이즈 메시지)을 최상위 message보다 우선 사용 —
        // 검증 오류는 message가 하드코딩된 영문("Validation failed")일 수 있다.
        setServerError(extractApiError(e, '구성원 추가에 실패했습니다.'))
        // 실패 시 다이얼로그가 유지되므로 재시도가 가능해야 한다.
        submittingRef.current = false
      },
    })
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>구성원 추가</DialogTitle>
          <DialogDescription>
            계정을 새로 만들어 이 워크스페이스의 구성원으로 추가합니다.
          </DialogDescription>
        </DialogHeader>
        {/* onSubmit 이 submittingRef.current 를 읽지만 handleSubmit 이 반환하는 핸들러는 폼
            제출 이벤트 시에만 비동기로 실행되고 렌더 중에는 호출되지 않아 안전하다
            (WikiEditor/RichInput 과 동일한 react-hooks/refs 보수적 false positive). */}
        {/* '계속 추가' 체크박스는 의도적으로 이 <form> 밖에 둔다(id 로 submit 버튼과 연결).
            Radix Checkbox 는 소속 form 의 reset 이벤트에 반응해 스스로 onCheckedChange(false) 를
            발화하는데, onSuccess 의 react-hook-form reset() 이 그 reset 을 유발한다 → 폼 안에 두면
            첫 저장 직후 체크가 풀려 '계속 추가'가 깨진다(#655 연속등록 flake 의 진짜 원인). */}
        <form id="add-member-form" onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {serverError && (
            <p className="text-sm text-destructive" data-testid="add-member-error">
              {serverError}
            </p>
          )}
          {ssoOn && (
            <div className="space-y-2">
              <Label>로그인 방식</Label>
              <div className="flex flex-col gap-2">
                <label className="flex items-center gap-2 text-sm">
                  <input type="radio" value="SSO" data-testid="add-member-login-sso" {...register('loginMethod')} />
                  SSO 전용 (비밀번호 없음)
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="radio" value="PASSWORD" data-testid="add-member-login-password" {...register('loginMethod')} />
                  비밀번호
                </label>
              </div>
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="member-username">아이디 (로그인 ID)</Label>
            <Input id="member-username" data-testid="add-member-username" {...register('username')} />
            {loginMethod === 'SSO' && (
              <p className="text-xs text-muted-foreground">회사 SSO 계정 주소(이메일)와 같게 입력하세요.</p>
            )}
            {errors.username && <p className="text-sm text-destructive">{errors.username.message}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="member-email">이메일 (선택)</Label>
            <Input id="member-email" type="email" data-testid="add-member-email" {...register('email')} />
            {errors.email && <p className="text-sm text-destructive">{errors.email.message}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="member-name">이름</Label>
            <Input id="member-name" data-testid="add-member-name" {...register('name')} />
            {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
          </div>
          {loginMethod === 'PASSWORD' && (
            <div className="space-y-2">
              <Label htmlFor="member-password">초기 비밀번호</Label>
              <Input
                id="member-password"
                type="password"
                placeholder="8자 이상, 영문 대/소문자·숫자 포함"
                data-testid="add-member-password"
                {...register('password')}
              />
              {errors.password && <p className="text-sm text-destructive">{errors.password.message}</p>}
            </div>
          )}
          <div className="space-y-2">
            <Label>역할</Label>
            <div className="flex flex-col gap-2" data-testid="add-member-role">
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" value="USER" data-testid="add-member-role-user" {...register('role')} />
                일반 구성원
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" value="ADMIN" data-testid="add-member-role-admin" {...register('role')} />
                관리자
              </label>
            </div>
          </div>
        </form>
        {/* form 밖 — reset 이벤트 비수신. submit 버튼은 form="add-member-form" 로 연결. */}
        <div className="mt-4 flex items-center gap-2">
          <Checkbox
            id="add-member-keep-open"
            data-testid="add-member-keep-open"
            checked={keepOpenAfterSubmit}
            onCheckedChange={(v) => setKeepOpenAfterSubmit(v === true)}
          />
          <Label htmlFor="add-member-keep-open" className="text-sm font-normal">
            계속 추가 (저장 후 다이얼로그 유지)
          </Label>
        </div>
        <DialogFooter className="mt-4">
          <Button
            type="button"
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={createMember.isPending}
          >
            취소
          </Button>
          <Button
            type="submit"
            form="add-member-form"
            disabled={createMember.isPending}
            data-testid="add-member-submit"
          >
            {createMember.isPending ? '추가 중...' : '추가'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
