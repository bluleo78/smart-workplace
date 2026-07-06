import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import axios from 'axios'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'

import { platformTenants } from '../api/platformTenants'
import type { ErrorResponse } from '../types/platform'
import { Button } from './ui/button'
import { DialogFooter } from './ui/dialog'
import { FormField } from './ui/form-field'
import { Input } from './ui/input'

// 신규 계정 생성 폼 스키마. email 은 상위(AddTenantMemberDialog)에서 확인 완료된 값을 props 로 받으므로 여기서는 다루지 않는다.
const newMemberSchema = z.object({
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

type NewMemberFormData = z.infer<typeof newMemberSchema>

interface NewTenantMemberFormProps {
  tenantId: string
  email: string
  onCancel: () => void
  onSuccess: () => void
}

// 신규 사용자 계정 생성 + 테넌트 멤버 추가 폼 — 이메일 조회 결과가 "못 찾음"일 때 렌더된다.
export function NewTenantMemberForm({
  tenantId,
  email,
  onCancel,
  onSuccess,
}: NewTenantMemberFormProps) {
  const queryClient = useQueryClient()
  const [serverError, setServerError] = useState('')

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<NewMemberFormData>({
    resolver: zodResolver(newMemberSchema),
    defaultValues: { role: 'MEMBER' },
  })

  const mutation = useMutation({
    mutationFn: (data: NewMemberFormData) =>
      platformTenants.addMember(Number(tenantId), { email, ...data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tenant', tenantId] })
      queryClient.invalidateQueries({ queryKey: ['tenant', tenantId, 'members'] })
      toast.success('멤버를 추가했습니다.')
      onSuccess()
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

  const onSubmit = (data: NewMemberFormData) => {
    setServerError('')
    mutation.mutate(data)
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      {serverError && (
        <p className="text-sm text-destructive" data-testid="add-member-error">
          {serverError}
        </p>
      )}
      <p className="text-sm text-muted-foreground">
        신규 계정을 생성합니다. 로그인 아이디는 <span className="font-medium">{email}</span> 입니다.
      </p>
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
        <Button type="button" variant="outline" onClick={onCancel} disabled={mutation.isPending}>
          취소
        </Button>
        <Button type="submit" disabled={mutation.isPending} data-testid="add-member-submit">
          {mutation.isPending ? '추가 중...' : '추가'}
        </Button>
      </DialogFooter>
    </form>
  )
}
