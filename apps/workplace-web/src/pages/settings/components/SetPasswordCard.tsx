// apps/workplace-web/src/pages/settings/components/SetPasswordCard.tsx
// WP-48 비밀번호 없는(SSO 전용) 계정의 "비밀번호 설정" — SSO 로 본인 확인된 세션이라 현재 비밀번호를 묻지 않는다.
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'

import { usersApi } from '@/api/users'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { FormField } from '@/components/ui/form-field'
import { PasswordInput } from '@/components/ui/password-input'
import { extractApiError } from '@/lib/api-error'

const schema = z
  .object({
    newPassword: z
      .string()
      .min(8, '비밀번호는 8자 이상이어야 합니다')
      .max(128, '비밀번호는 128자 이하여야 합니다')
      .regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/, '영문 대문자·소문자·숫자를 각각 1자 이상 포함해야 합니다'),
    confirmPassword: z.string(),
  })
  .refine((v) => v.newPassword === v.confirmPassword, { path: ['confirmPassword'], message: '비밀번호가 일치하지 않습니다' })

type FormData = z.infer<typeof schema>

// 설정 성공 시 onDone(refreshUser) 으로 hasPassword 를 갱신해 기존 "비밀번호 변경" 카드로 전환한다.
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
    <Card>
      <CardHeader>
        <CardTitle>비밀번호 설정</CardTitle>
        <CardDescription>이 계정은 SSO 로만 로그인합니다. 비밀번호를 설정하면 아이디/비밀번호로도 로그인할 수 있습니다.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
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
      </CardContent>
    </Card>
  )
}
