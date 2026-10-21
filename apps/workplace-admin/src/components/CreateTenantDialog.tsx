import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import axios from 'axios'
import { CheckIcon } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'

import { platformTenants } from '../api/platformTenants'
import { useUserEmailLookup } from '../hooks/useUserEmailLookup'
import { tenantNameField, tenantSlugField } from '../lib/tenantFormSchema'
import type { CreateTenantRequest, ErrorResponse } from '../types/platform'
import { FoundUserCard } from './FoundUserCard'
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
import { UserEmailLookupField } from './UserEmailLookupField'

// 테넌트 생성 폼 스키마.
// - name: 필수(255자 이하)
// - slug: 선택(빈 문자열은 미전송 → 서버가 이름에서 자동 생성, #695). 값이 있으면 수정 폼과 같은 형식 규칙(WP-669)
// 소유자(#496)는 폼 스키마 밖에서 "이메일 + 확인" 정확일치 조회로 지정한다(WP-337, useUserEmailLookup).
// 비우면 소유자 없는 빈 테넌트를 생성한다.
const createTenantSchema = z.object({
  name: tenantNameField,
  slug: tenantSlugField.optional(),
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
  const owner = useUserEmailLookup()

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
      owner.reset()
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

  // 소유자 칸 오류 — 입력칸 안내(형식·미확인·조회 실패) 또는 찾지 못함.
  const ownerError =
    owner.error ||
    (owner.status === 'not-found'
      ? '해당 이메일의 사용자가 없습니다. 소유자 없이 만든 뒤 구성원 화면에서 계정을 만들어 추가하세요.'
      : owner.user && !owner.user.ownerEligible
        ? '에이전트나 비활성 계정은 소유자로 지정할 수 없습니다.'
        : undefined)

  const onSubmit = (data: CreateTenantFormData) => {
    setServerError('')
    const slug = data.slug?.trim()
    // 소유자 이메일을 썼으면 확인으로 찾은 사용자여야 한다 — 쳤지만 확인 안 했거나 못 찾은 채 소유자 없이 생성되지 않게 막는다.
    const confirmed = owner.requireConfirmed()
    if (!confirmed.ok || (confirmed.user && !confirmed.user.ownerEligible)) return
    // 소유자를 지정하지 않았으면 ownerUserId 를 payload 에서 생략 — 소유자 없는 빈 테넌트로 생성된다.
    mutation.mutate({
      name: data.name,
      ...(slug ? { slug } : {}),
      ...(confirmed.user ? { ownerUserId: confirmed.user.userId } : {}),
    })
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>테넌트 생성</DialogTitle>
          <DialogDescription>새 테넌트의 정보를 입력하세요.</DialogDescription>
        </DialogHeader>
        {/* noValidate — 소유자 칸(type=email)의 브라우저 기본 검증이 제출을 가로채 앱의 안내 문구가 안 보이는 것을 막는다. */}
        <form noValidate onSubmit={handleSubmit(onSubmit)} className="space-y-4">
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
          <FormField label="소유자 이메일 (선택)" htmlFor="tenant-owner" error={ownerError}>
            <UserEmailLookupField
              lookup={owner}
              id="tenant-owner"
              invalid={!!ownerError}
              inputTestId="create-tenant-owner"
              checkTestId="create-tenant-owner-check"
            />
            {owner.user && (
              <FoundUserCard
                user={owner.user}
                testId="create-tenant-owner-found"
                trailing={
                  owner.user.ownerEligible && (
                    <CheckIcon className="text-success size-4 shrink-0" aria-label="확인됨" />
                  )
                }
              />
            )}
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
            <Button
              type="submit"
              // 소유자 확인 중에는 결과가 나올 때까지 제출을 막는다.
              disabled={mutation.isPending || owner.isChecking}
              data-testid="create-tenant-submit"
            >
              {mutation.isPending ? '생성 중...' : '생성'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
