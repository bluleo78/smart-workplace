// apps/workplace-web/src/pages/settings/components/SetPasswordCard.tsx
// WP-48 비밀번호 없는(SSO 전용) 계정의 "비밀번호 설정" — SSO 로 본인 확인된 세션이라 현재 비밀번호를 묻지 않는다.
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'

import { usersApi } from '@/api/users'
import { settingsFieldClass, SettingsSection } from '@/components/layout/SettingsSection'
import { Button } from '@/components/ui/button'
import { FormField } from '@/components/ui/form-field'
import { PasswordInput } from '@/components/ui/password-input'
import { extractApiError } from '@/lib/api-error'
import { cn } from '@/lib/utils'
import { passwordRule } from '@/lib/validations/user'

const schema = z
  .object({
    newPassword: passwordRule,
    confirmPassword: z.string(),
  })
  .refine((v) => v.newPassword === v.confirmPassword, { path: ['confirmPassword'], message: '비밀번호가 일치하지 않습니다' })

type FormData = z.infer<typeof schema>

// 설정 성공 시 onDone(refreshUser) 으로 hasPassword 를 갱신해 기존 "비밀번호 변경" 섹션으로 전환한다.
export function SetPasswordCard({ onDone }: { onDone: () => Promise<void> }) {
  const form = useForm<FormData>({ resolver: zodResolver(schema), mode: 'onChange', defaultValues: { newPassword: '', confirmPassword: '' } })

  const onSubmit = async (data: FormData) => {
    try {
      await usersApi.changePassword({ newPassword: data.newPassword })
      form.reset()
      toast.success('비밀번호를 설정했습니다.')
      await onDone()
    } catch (error) {
      form.setError('root', { message: extractApiError(error, '비밀번호 설정에 실패했습니다.') })
    }
  }

  return (
    // 프로필 화면의 다른 섹션과 같은 주석 섹션 틀 — 입력 묶음은 448px 상한(WP-397).
    <SettingsSection
      title="비밀번호 설정"
      description="이 계정은 SSO 로만 로그인해요. 비밀번호를 설정하면 아이디/비밀번호로도 로그인할 수 있어요."
    >
      <form onSubmit={form.handleSubmit(onSubmit)} className={cn('space-y-4', settingsFieldClass)}>
        <FormField label="새 비밀번호" htmlFor="set-new-password" error={form.formState.errors.newPassword?.message}>
          <PasswordInput id="set-new-password" {...form.register('newPassword')} autoComplete="new-password" />
        </FormField>
        <FormField label="비밀번호 확인" htmlFor="set-confirm-password" error={form.formState.errors.confirmPassword?.message}>
          <PasswordInput id="set-confirm-password" {...form.register('confirmPassword')} autoComplete="new-password" />
        </FormField>
        {form.formState.errors.root && <p className="text-sm text-destructive">{form.formState.errors.root.message}</p>}
        <Button type="submit" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? '설정 중...' : '비밀번호 설정'}
        </Button>
      </form>
    </SettingsSection>
  )
}
