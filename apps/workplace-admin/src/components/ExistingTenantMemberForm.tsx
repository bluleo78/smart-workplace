import { useMutation, useQueryClient } from '@tanstack/react-query'
import axios from 'axios'
import { useState } from 'react'
import { toast } from 'sonner'

import { platformTenants } from '../api/platformTenants'
import type { ErrorResponse, PlatformUserLookup } from '../types/platform'
import { Button } from './ui/button'
import { DialogFooter } from './ui/dialog'
import { FormField } from './ui/form-field'

interface ExistingTenantMemberFormProps {
  tenantId: string
  user: PlatformUserLookup
  onCancel: () => void
  onSuccess: () => void
}

// 기존(전역) 사용자를 테넌트 멤버로 추가하는 폼 — 이메일 조회 결과가 "찾음"일 때 렌더된다.
// 계정을 새로 만들지 않고 역할만 선택해 멤버십 + RBAC 역할을 추가한다.
export function ExistingTenantMemberForm({
  tenantId,
  user,
  onCancel,
  onSuccess,
}: ExistingTenantMemberFormProps) {
  const queryClient = useQueryClient()
  const [role, setRole] = useState<'OWNER' | 'MEMBER'>('MEMBER')
  const [serverError, setServerError] = useState('')

  const mutation = useMutation({
    mutationFn: () =>
      platformTenants.addExistingMember(Number(tenantId), { userId: user.userId, role }),
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

  return (
    <div className="space-y-4">
      {serverError && (
        <p className="text-sm text-destructive" data-testid="add-member-error">
          {serverError}
        </p>
      )}
      <div className="rounded-md border p-3 text-sm" data-testid="add-member-found-card">
        <p className="font-medium">{user.name}</p>
        <p className="text-muted-foreground">{user.email}</p>
        {user.isPlatformAdmin && (
          <span
            className="mt-1 inline-block rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800"
            data-testid="add-member-platform-admin-badge"
          >
            플랫폼 관리자
          </span>
        )}
      </div>
      <FormField label="역할" required>
        <div className="flex flex-col gap-2" data-testid="add-member-role">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              value="MEMBER"
              checked={role === 'MEMBER'}
              onChange={() => setRole('MEMBER')}
              data-testid="add-member-role-member"
            />
            멤버
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              value="OWNER"
              checked={role === 'OWNER'}
              onChange={() => setRole('OWNER')}
              data-testid="add-member-role-owner"
            />
            소유자(대표관리자)
          </label>
        </div>
      </FormField>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel} disabled={mutation.isPending}>
          취소
        </Button>
        <Button
          type="button"
          onClick={() => {
            setServerError('')
            mutation.mutate()
          }}
          disabled={mutation.isPending}
          data-testid="add-member-submit"
        >
          {mutation.isPending ? '추가 중...' : '추가'}
        </Button>
      </DialogFooter>
    </div>
  )
}
