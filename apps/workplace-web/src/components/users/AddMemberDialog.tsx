import { zodResolver } from '@hookform/resolvers/zod'
import axios from 'axios'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'

import { Button } from '@/components/ui/button'
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
import { useCreateMember } from '@/hooks/queries/useUsers'

// 구성원 추가 폼 — 아이디(로그인 ID)/이메일(선택)/이름/역할/초기 비밀번호.
// 비밀번호 규칙은 백엔드와 동일. role 라벨은 한국어, API 로는 ADMIN/USER 원시값 전송.
const addMemberSchema = z.object({
  username: z.string().min(1, '아이디를 입력하세요').max(50, '아이디는 50자 이하여야 합니다'),
  email: z.email('올바른 이메일 형식이 아닙니다').optional().or(z.literal('')),
  name: z.string().min(1, '이름을 입력하세요').max(50, '이름은 50자 이하여야 합니다'),
  password: z
    .string()
    .min(8, '비밀번호는 8자 이상이어야 합니다')
    .max(128, '비밀번호는 128자 이하여야 합니다')
    .regex(/[A-Z]/, '대문자를 1자 이상 포함해야 합니다')
    .regex(/[a-z]/, '소문자를 1자 이상 포함해야 합니다')
    .regex(/[0-9]/, '숫자를 1자 이상 포함해야 합니다'),
  role: z.enum(['ADMIN', 'USER']),
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

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<AddMemberFormData>({
    resolver: zodResolver(addMemberSchema),
    defaultValues: { role: 'USER' },
  })

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      reset({ role: 'USER' })
      setServerError('')
    }
    onOpenChange(next)
  }

  const onSubmit = (data: AddMemberFormData) => {
    setServerError('')
    // 이메일 빈 문자열은 전송에서 제외(백엔드 선택값).
    const payload = { ...data, email: data.email ? data.email : undefined }
    createMember.mutate(payload, {
      onSuccess: () => {
        toast.success('구성원을 추가했습니다.')
        handleOpenChange(false)
      },
      onError: (e) => {
        // 서버 에러(409 중복/400 검증)는 폼 상단에 표시하고 다이얼로그를 유지한다(운영자 콘솔 패턴).
        if (axios.isAxiosError(e)) {
          const msg = (e.response?.data as { message?: string } | undefined)?.message
          setServerError(msg ?? '구성원 추가에 실패했습니다.')
          return
        }
        setServerError('구성원 추가에 실패했습니다.')
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
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {serverError && (
            <p className="text-sm text-destructive" data-testid="add-member-error">
              {serverError}
            </p>
          )}
          <div className="space-y-2">
            <Label htmlFor="member-username">아이디 (로그인 ID)</Label>
            <Input id="member-username" data-testid="add-member-username" {...register('username')} />
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
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={createMember.isPending}
            >
              취소
            </Button>
            <Button type="submit" disabled={createMember.isPending} data-testid="add-member-submit">
              {createMember.isPending ? '추가 중...' : '추가'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
