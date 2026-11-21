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

type SetPasswordCardProps = {
  /**
   * 쓰기가 성공한 뒤 부모가 이어 하는 일(세션에 hasPassword 반영·내 정보 갱신) — **throw 하지 않는다**.
   * 갱신 실패까지 설정 실패로 되돌리지 않기로 한 계약이라(WP-1912) 실패는 부모가 경고 토스트로만 알린다.
   */
  onDone: () => Promise<void>
}

// 설정 성공 시 onDone(부모 핸들러)을 불러 — 성공을 기억하고 기존 "비밀번호 변경" 섹션으로 전환한다(WP-1912).
export function SetPasswordCard({ onDone }: SetPasswordCardProps) {
  const form = useForm<FormData>({ resolver: zodResolver(schema), mode: 'onChange', defaultValues: { newPassword: '', confirmPassword: '' } })

  const onSubmit = async (data: FormData) => {
    try {
      await usersApi.changePassword({ newPassword: data.newPassword })
      form.reset()
      toast.success('비밀번호를 설정했습니다.')
    } catch (error) {
      form.setError('root', { message: extractApiError(error, '비밀번호 설정에 실패했습니다.') })
      return
    }
    // 쓰기가 성공하면 여기서 끝난다 — 갱신(onDone) 실패는 설정 실패로 되돌리지 않는다(WP-1912).
    // 계약(throw 하지 않음)을 카드도 함께 지켜, 혹시 넘겨받은 핸들러가 throw 해도 설정 성공 안내가 뒤에
    // 실패 안내로 덮이거나 처리 안 된 rejection 으로 남지 않게 한다.
    try {
      await onDone()
    } catch (error) {
      // 부모가 실패를 경고 토스트로 알리므로 여기서는 안내를 다시 띄우지 않는다 — 대신 원인만 콘솔에 남긴다
      // (`useAfterAvatarChange` 와 같은 방식 — 조용히 삼키면 다음에 디자인 단서가 없다).
      console.warn('비밀번호 설정 성공을 이어 반영하지 못했습니다', error)
    }
  }

  return (
    // 프로필 화면의 다른 섹션과 같은 주석 섹션 틀 — 입력 묶음은 448px 상한(WP-397).
    <SettingsSection
      // 「비밀번호 변경」 섹션과 같은 도움말 절 — 둘 중 하나만 그려지고 매뉴얼 설명(profile.password)도 같다(WP-1508).
      data-help="profile.password"
      title="비밀번호 설정"
      description="이 계정은 SSO 로만 로그인해요. 비밀번호를 설정하면 아이디/비밀번호로도 로그인할 수 있어요."
    >
      <form onSubmit={form.handleSubmit(onSubmit)} className={cn('space-y-4', settingsFieldClass)}>
        <FormField label="새 비밀번호" htmlFor="set-new-password" error={form.formState.errors.newPassword?.message}>
          <PasswordInput id="set-new-password" fieldLabel="새 비밀번호" {...form.register('newPassword')} autoComplete="new-password" />
        </FormField>
        <FormField label="비밀번호 확인" htmlFor="set-confirm-password" error={form.formState.errors.confirmPassword?.message}>
          <PasswordInput id="set-confirm-password" fieldLabel="비밀번호 확인" {...form.register('confirmPassword')} autoComplete="new-password" />
        </FormField>
        {/* 폼 루트 오류가 나타나는 순간 스크린리더가 읽게 role=alert (WP-1896, 로그인 WP-733 과 같은 방식) */}
        {form.formState.errors.root && <p role="alert" className="text-sm text-destructive">{form.formState.errors.root.message}</p>}
        <Button type="submit" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? '설정 중...' : '비밀번호 설정'}
        </Button>
      </form>
    </SettingsSection>
  )
}
