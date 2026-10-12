import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import axios from 'axios'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'

import { platformTenants } from '../api/platformTenants'
import type {
  CreateTenantRequest,
  ErrorResponse,
  PlatformUserSearchItem,
} from '../types/platform'
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
import { UserCombobox } from './UserCombobox'

// 테넌트 생성 폼 스키마.
// - name: 필수
// - slug: 선택(빈 문자열은 미전송 → 서버가 이름에서 자동 생성, #695)
// 소유자(#496)는 자동완성 콤보박스로 고른 사용자 객체라 폼 스키마 밖의 state 로 둔다(WP-337).
// 비우면 소유자 없는 빈 테넌트를 생성한다.
const createTenantSchema = z.object({
  name: z.string().min(1, '이름을 입력하세요'),
  slug: z.string().optional(),
})

type CreateTenantFormData = z.infer<typeof createTenantSchema>

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
  const [owner, setOwner] = useState<PlatformUserSearchItem | null>(null)
  // 소유자 칸에 입력 중인 검색어 — 쳤지만 목록에서 고르지 않았으면 제출을 막는다(소유자 없는 테넌트가 조용히 생기지 않게).
  const [ownerQuery, setOwnerQuery] = useState('')
  const [ownerError, setOwnerError] = useState('')

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
      setOwner(null)
      setOwnerQuery('')
      setOwnerError('')
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
    if (!owner && ownerQuery.trim()) {
      setOwnerError('목록에서 소유자를 고르거나, 소유자 없이 만들려면 입력을 지우세요.')
      return
    }
    const slug = data.slug?.trim()
    // 소유자를 고르지 않았으면 ownerUserId 를 payload 에서 생략 — 소유자 없는 빈 테넌트로 생성된다.
    mutation.mutate({
      name: data.name,
      ...(slug ? { slug } : {}),
      ...(owner ? { ownerUserId: owner.id } : {}),
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
          <FormField label="slug (선택)" htmlFor="tenant-slug" error={errors.slug?.message}>
            <Input
              id="tenant-slug"
              placeholder="비우면 이름에서 자동 생성"
              data-testid="create-tenant-slug"
              {...register('slug')}
            />
          </FormField>
          <FormField label="소유자 (선택)" htmlFor="tenant-owner" error={ownerError}>
            <UserCombobox
              id="tenant-owner"
              value={owner}
              onChange={(user) => {
                setOwner(user)
                setOwnerError('')
              }}
              onQueryChange={(q) => {
                setOwnerQuery(q)
                setOwnerError('')
              }}
              placeholder="이메일·이름으로 검색"
              invalid={!!ownerError}
              data-testid="create-tenant-owner"
            />
            {/* 모바일 폭에서 placeholder 가 잘리지 않게 "비우면" 안내는 도움말로 분리한다. */}
            <p className="text-muted-foreground text-xs">
              비워두면 소유자 없는 빈 테넌트로 만들고, 소유자는 나중에 구성원 화면에서 추가합니다.
            </p>
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
