import { useMutation } from '@tanstack/react-query'
import axios from 'axios'
import { useState } from 'react'
import { z } from 'zod'

import { platformUsers } from '../api/platformUsers'
import type { PlatformUserLookup } from '../types/platform'
import { ExistingTenantMemberForm } from './ExistingTenantMemberForm'
import { NewTenantMemberForm } from './NewTenantMemberForm'
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

const emailSchema = z.email('올바른 이메일 형식이 아닙니다')

interface AddTenantMemberDialogProps {
  // 대상 테넌트 — useParams 의 string id. invalidate 키를 byte-identical 하게 맞추기 위해 string 으로 받는다.
  tenantId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

type LookupState =
  | { status: 'idle' }
  | { status: 'found'; user: PlatformUserLookup }
  | { status: 'not-found' }

// 테넌트 멤버 추가 다이얼로그 — 이메일 확인 후 기존/신규 사용자로 분기한다.
// 1) 이메일 입력 + "확인" 클릭 → GET /users/lookup 조회
// 2) 찾음(200): ExistingTenantMemberForm — 계정 생성 없이 멤버십만 추가
//    못 찾음(404): NewTenantMemberForm — 기존과 동일한 신규 계정 생성 폼
// 확인 후 이메일을 다시 수정하면 조회 상태를 초기화해 재확인을 요구한다(오래된 조회 결과로
// 잘못된 사용자에게 추가되는 것 방지).
export function AddTenantMemberDialog({
  tenantId,
  open,
  onOpenChange,
}: AddTenantMemberDialogProps) {
  const [email, setEmail] = useState('')
  const [checkedEmail, setCheckedEmail] = useState('')
  const [emailError, setEmailError] = useState('')
  const [lookup, setLookup] = useState<LookupState>({ status: 'idle' })

  const resetAll = () => {
    setEmail('')
    setCheckedEmail('')
    setEmailError('')
    setLookup({ status: 'idle' })
  }

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      resetAll()
    }
    onOpenChange(next)
  }

  const handleEmailChange = (value: string) => {
    setEmail(value)
    setEmailError('')
    // 확인 후 이메일을 다시 수정하면 재확인을 요구한다.
    if (value !== checkedEmail) {
      setLookup({ status: 'idle' })
    }
  }

  const checkMutation = useMutation({
    mutationFn: async (value: string): Promise<LookupState> => {
      try {
        const user = await platformUsers.lookup(value)
        return { status: 'found', user }
      } catch (error) {
        if (axios.isAxiosError(error) && error.response?.status === 404) {
          return { status: 'not-found' }
        }
        throw error
      }
    },
    onSuccess: (result, checkedValue) => {
      // 확인 중엔 이메일 입력을 비활성화하지만, 방어적으로 한 번 더 확인한 값과 현재 값이
      // 같을 때만 결과를 반영한다(오래된 결과가 다른 이메일에 적용되는 것 방지).
      if (checkedValue === email) {
        setCheckedEmail(checkedValue)
        setLookup(result)
      }
    },
    onError: () => {
      setEmailError('사용자 확인에 실패했습니다.')
    },
  })

  const handleCheck = () => {
    const parsed = emailSchema.safeParse(email)
    if (!parsed.success) {
      setEmailError(parsed.error.issues[0]?.message ?? '올바른 이메일 형식이 아닙니다')
      return
    }
    setEmailError('')
    checkMutation.mutate(email)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>멤버 추가</DialogTitle>
          <DialogDescription>
            이메일을 확인해 기존 사용자면 바로 추가하고, 신규 사용자면 계정을 생성해 추가합니다.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <FormField label="이메일" htmlFor="member-email" required error={emailError}>
            <div className="flex gap-2">
              <Input
                id="member-email"
                type="email"
                data-testid="add-member-email"
                value={email}
                disabled={checkMutation.isPending}
                onChange={(e) => handleEmailChange(e.target.value)}
              />
              <Button
                type="button"
                variant="outline"
                onClick={handleCheck}
                disabled={checkMutation.isPending}
                data-testid="add-member-check"
              >
                {checkMutation.isPending ? '확인 중...' : '확인'}
              </Button>
            </div>
          </FormField>

          {lookup.status === 'found' && (
            <ExistingTenantMemberForm
              tenantId={tenantId}
              user={lookup.user}
              onCancel={() => handleOpenChange(false)}
              onSuccess={() => handleOpenChange(false)}
            />
          )}

          {lookup.status === 'not-found' && (
            <NewTenantMemberForm
              tenantId={tenantId}
              email={checkedEmail}
              onCancel={() => handleOpenChange(false)}
              onSuccess={() => handleOpenChange(false)}
            />
          )}

          {lookup.status === 'idle' && (
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
                취소
              </Button>
            </DialogFooter>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
