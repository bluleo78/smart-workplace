import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import axios from 'axios'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'

import { platformTenants } from '../api/platformTenants'
import type { AddTenantMemberRequest, ErrorResponse } from '../types/platform'
import { Button } from './ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog'
import { FormField } from './ui/form-field'
import { Input } from './ui/input'

// 멤버(계정) 추가 폼 스키마(#497).
// - email: 필수 이메일(로그인 아이디로도 사용)
// - name: 필수
// - password: 8~128자, 영문 대문자·소문자·숫자 각 1자 이상(백엔드 규칙과 동일)
// - role: 'OWNER'(소유자/대표관리자) | 'MEMBER'(멤버). API 로는 이 원시값을 그대로 전송한다.
const addMemberSchema = z.object({
  email: z.email('올바른 이메일 형식이 아닙니다'),
  name: z.string().min(1, '이름을 입력하세요'),
  password: z
    .string()
    .min(8, '비밀번호는 8자 이상이어야 합니다')
    .max(128, '비밀번호는 128자 이하여야 합니다')
    .regex(/[A-Z]/, '대문자를 1자 이상 포함해야 합니다')
    .regex(/[a-z]/, '소문자를 1자 이상 포함해야 합니다')
    .regex(/[0-9]/, '숫자를 1자 이상 포함해야 합니다'),
  role: z.enum(['OWNER', 'MEMBER']),
})

type AddMemberFormData = z.infer<typeof addMemberSchema>

interface AddTenantMemberDialogProps {
  // 대상 테넌트 — useParams 의 string id. invalidate 키를 byte-identical 하게 맞추기 위해 string 으로 받는다.
  tenantId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

// 테넌트 멤버(소유자/일반) 추가 다이얼로그(#497).
// 제출 성공(201) 시 ['tenant', id] + ['tenant', id, 'members'] 무효화 → 멤버 목록/카운트 재조회 반영,
// 성공 토스트 + 닫기. 서버 에러(409 중복/400 검증/403)는 폼 상단 에러로 표시하고 다이얼로그를 유지한다.
export function AddTenantMemberDialog({ tenantId, open, onOpenChange }: AddTenantMemberDialogProps) {
  const queryClient = useQueryClient()
  const [serverError, setServerError] = useState('')

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<AddMemberFormData>({
    resolver: zodResolver(addMemberSchema),
    // 역할 기본값은 멤버 — 라디오가 항상 한쪽을 선택한 상태로 시작한다.
    defaultValues: { role: 'MEMBER' },
  })

  // 닫힐 때 폼/에러 초기화(effect 내 setState 대신 이벤트 핸들러에서 처리해 cascading render 회피).
  const handleOpenChange = (next: boolean) => {
    if (!next) {
      reset({ role: 'MEMBER' })
      setServerError('')
    }
    onOpenChange(next)
  }

  const mutation = useMutation({
    mutationFn: (req: AddTenantMemberRequest) => platformTenants.addMember(Number(tenantId), req),
    onSuccess: () => {
      // 멤버 목록과 단건(멤버수 memberCount) 둘 다 재조회.
      // 키는 상세 화면의 useParams string id 와 byte-identical 해야 한다.
      queryClient.invalidateQueries({ queryKey: ['tenant', tenantId] })
      queryClient.invalidateQueries({ queryKey: ['tenant', tenantId, 'members'] })
      toast.success('멤버를 추가했습니다.')
      handleOpenChange(false)
    },
    onError: (error) => {
      if (axios.isAxiosError(error)) {
        const data = error.response?.data as ErrorResponse | undefined
        setServerError(data?.message ?? '멤버 추가에 실패했습니다.')
        return
      }
      setServerError('멤버 추가에 실패했습니다.')
    },
  })

  const onSubmit = (data: AddMemberFormData) => {
    setServerError('')
    mutation.mutate(data)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>멤버 추가</DialogTitle>
          <DialogDescription>
            계정을 새로 생성해 이 테넌트의 멤버로 추가합니다. 이메일이 로그인 아이디로 쓰입니다.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {serverError && (
            <p className="text-sm text-destructive" data-testid="add-member-error">
              {serverError}
            </p>
          )}
          <FormField label="이메일" htmlFor="member-email" required error={errors.email?.message}>
            <Input
              id="member-email"
              type="email"
              data-testid="add-member-email"
              {...register('email')}
            />
          </FormField>
          <FormField label="이름" htmlFor="member-name" required error={errors.name?.message}>
            <Input id="member-name" data-testid="add-member-name" {...register('name')} />
          </FormField>
          <FormField
            label="초기 비밀번호"
            htmlFor="member-password"
            required
            error={errors.password?.message}
          >
            <Input
              id="member-password"
              type="password"
              placeholder="8자 이상, 영문 대/소문자·숫자 포함"
              data-testid="add-member-password"
              {...register('password')}
            />
          </FormField>
          <FormField label="역할" required error={errors.role?.message}>
            {/* 한국어 라벨로 표시하되 API 로는 OWNER/MEMBER 원시값을 전송한다. */}
            <div className="flex flex-col gap-2" data-testid="add-member-role">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  value="MEMBER"
                  data-testid="add-member-role-member"
                  {...register('role')}
                />
                멤버
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  value="OWNER"
                  data-testid="add-member-role-owner"
                  {...register('role')}
                />
                소유자(대표관리자)
              </label>
            </div>
          </FormField>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={mutation.isPending}
            >
              취소
            </Button>
            <Button type="submit" disabled={mutation.isPending} data-testid="add-member-submit">
              {mutation.isPending ? '추가 중...' : '추가'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
