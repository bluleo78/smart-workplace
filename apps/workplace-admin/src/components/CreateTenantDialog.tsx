import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import axios from 'axios'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'

import { platformTenants } from '../api/platformTenants'
import type { CreateTenantRequest, ErrorResponse } from '../types/platform'
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

// 테넌트 생성 폼 스키마.
// - name: 필수
// - slug: 선택(빈 문자열은 미전송)
// - ownerUserId: 필수 양의 정수. input 은 문자열이므로 coerce 후 검증.
const createTenantSchema = z.object({
  name: z.string().min(1, '이름을 입력하세요'),
  slug: z.string().optional(),
  ownerUserId: z.coerce
    .number({ message: '소유자 사용자 ID를 입력하세요' })
    .int('정수를 입력하세요')
    .positive('올바른 사용자 ID를 입력하세요'),
})

// react-hook-form 폼 값 타입은 input(변환 전: ownerUserId 가 문자열 입력) 기준.
// zodResolver 가 제출 시 coerce 하므로, onSubmit 에서 Number() 로 명시 변환해 number 로 넘긴다.
type CreateTenantFormData = z.input<typeof createTenantSchema>

interface CreateTenantDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

// 테넌트 생성 다이얼로그.
// 제출 성공 시 ['tenants'] 무효화 + 성공 토스트 + 닫기.
// 검증 실패(중복 slug/없는 owner) 400 은 폼 상단 에러로 표시하고 다이얼로그를 유지한다.
export function CreateTenantDialog({ open, onOpenChange }: CreateTenantDialogProps) {
  const queryClient = useQueryClient()
  const [serverError, setServerError] = useState('')

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CreateTenantFormData>({
    resolver: zodResolver(createTenantSchema),
  })

  // 다이얼로그 열림 상태 변경 핸들러 — 닫힐 때 폼/에러를 초기화한다.
  // (effect 내 setState 대신 이벤트 핸들러에서 처리해 cascading render 를 피한다.)
  const handleOpenChange = (next: boolean) => {
    if (!next) {
      reset()
      setServerError('')
    }
    onOpenChange(next)
  }

  const mutation = useMutation({
    mutationFn: (req: CreateTenantRequest) => platformTenants.create(req),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tenants'] })
      toast.success('테넌트를 생성했습니다.')
      handleOpenChange(false)
    },
    onError: (error) => {
      if (axios.isAxiosError(error)) {
        const data = error.response?.data as ErrorResponse | undefined
        setServerError(data?.message ?? '테넌트 생성에 실패했습니다.')
        return
      }
      setServerError('테넌트 생성에 실패했습니다.')
    },
  })

  const onSubmit = (data: CreateTenantFormData) => {
    setServerError('')
    const slug = data.slug?.trim()
    mutation.mutate({
      name: data.name,
      ...(slug ? { slug } : {}),
      ownerUserId: Number(data.ownerUserId),
    })
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>테넌트 생성</DialogTitle>
          <DialogDescription>새 테넌트의 정보를 입력하세요.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {serverError && (
            <p className="text-sm text-destructive" data-testid="create-tenant-error">
              {serverError}
            </p>
          )}
          <FormField label="이름" htmlFor="tenant-name" required error={errors.name?.message}>
            <Input id="tenant-name" data-testid="create-tenant-name" {...register('name')} />
          </FormField>
          <FormField label="slug" htmlFor="tenant-slug" error={errors.slug?.message}>
            <Input
              id="tenant-slug"
              placeholder="(선택) 비우면 자동 생성"
              data-testid="create-tenant-slug"
              {...register('slug')}
            />
          </FormField>
          <FormField
            label="소유자 사용자 ID"
            htmlFor="tenant-owner"
            required
            error={errors.ownerUserId?.message}
          >
            <Input
              id="tenant-owner"
              type="number"
              data-testid="create-tenant-owner"
              {...register('ownerUserId')}
            />
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
            <Button type="submit" disabled={mutation.isPending} data-testid="create-tenant-submit">
              {mutation.isPending ? '생성 중...' : '생성'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
