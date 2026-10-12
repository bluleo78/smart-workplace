import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import axios from 'axios'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'

import { platformTenants } from '../api/platformTenants'
import type { ErrorResponse, TenantDetail, UpdateTenantRequest } from '../types/platform'
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

// 테넌트 정보 편집 폼 스키마(WP-336).
// - name: 필수(공백만은 불가)
// - slug: 선택. 비우면 서버가 이름에서 자동 생성. 값이 있으면 서버 규칙과 같은 형식(영문 소문자·숫자·하이픈)만 허용.
const editTenantSchema = z.object({
  name: z.string().trim().min(1, '이름을 입력하세요').max(255, '255자 이하로 입력하세요'),
  slug: z
    .string()
    .trim()
    .max(64, '64자 이하로 입력하세요')
    .regex(/^$|^[a-z0-9]+(-[a-z0-9]+)*$/, '영문 소문자·숫자·하이픈만 사용할 수 있습니다'),
})

type EditTenantFormData = z.infer<typeof editTenantSchema>

interface EditTenantDialogProps {
  /** 상세 queryKey(['tenant', tenantKey]) 와 byte-identical 한 URL string id — 성공 시 이 키의 캐시를 갱신한다. */
  tenantKey: string
  tenant: TenantDetail
  onOpenChange: (open: boolean) => void
}

// 테넌트 정보(이름·slug) 편집 다이얼로그(WP-336) — CreateTenantDialog 와 같은 패턴.
// 부모가 열릴 때만 마운트하므로 defaultValues 로 그 시점 값을 한 번만 채운다 — 편집 중 백그라운드 재조회가
// 입력을 덮어쓰지 않는다. 성공 시 상세 캐시를 응답으로 갱신·목록을 무효화하고 닫는다.
// 서버 400(slug 중복 등)은 폼 상단 에러로 표시하고 다이얼로그를 유지한다.
export function EditTenantDialog({ tenantKey, tenant, onOpenChange }: EditTenantDialogProps) {
  const queryClient = useQueryClient()
  const [serverError, setServerError] = useState('')

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<EditTenantFormData>({
    resolver: zodResolver(editTenantSchema),
    defaultValues: { name: tenant.name, slug: tenant.slug ?? '' },
  })

  const mutation = useMutation({
    mutationFn: (req: UpdateTenantRequest) => platformTenants.update(tenant.id, req),
    // PATCH 응답이 갱신된 상세이므로 상세 캐시는 재조회 없이 바로 채우고, 목록만 무효화한다.
    onSuccess: (updated) => {
      queryClient.setQueryData(['tenant', tenantKey], updated)
      queryClient.invalidateQueries({ queryKey: ['tenants'] })
      toast.success('테넌트 정보를 저장했습니다.')
      onOpenChange(false)
    },
    onError: (error) => {
      const data = axios.isAxiosError(error)
        ? (error.response?.data as ErrorResponse | undefined)
        : undefined
      setServerError(data?.message ?? '테넌트 정보 저장에 실패했습니다.')
    },
  })

  const onSubmit = (data: EditTenantFormData) => {
    setServerError('')
    mutation.mutate(data)
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>테넌트 정보 편집</DialogTitle>
          <DialogDescription>이름과 slug 를 수정합니다.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {serverError && (
            <p className="text-sm text-destructive" data-testid="edit-tenant-error">
              {serverError}
            </p>
          )}
          <FormField label="이름" htmlFor="edit-tenant-name" required error={errors.name?.message}>
            <Input id="edit-tenant-name" data-testid="edit-tenant-name" {...register('name')} />
          </FormField>
          <FormField label="slug" htmlFor="edit-tenant-slug" error={errors.slug?.message}>
            <Input
              id="edit-tenant-slug"
              placeholder="비우면 이름에서 자동 생성"
              data-testid="edit-tenant-slug"
              {...register('slug')}
            />
          </FormField>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={mutation.isPending}
            >
              취소
            </Button>
            <Button type="submit" disabled={mutation.isPending} data-testid="edit-tenant-submit">
              {mutation.isPending ? '저장 중...' : '저장'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
