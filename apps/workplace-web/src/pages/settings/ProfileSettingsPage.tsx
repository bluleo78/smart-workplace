// apps/workplace-web/src/pages/settings/ProfileSettingsPage.tsx
// 설정 > 개인 > 프로필 — 프로필 정보 수정 + 비밀번호 변경. (구 ProfilePage 에서 이전)
import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { useForm } from 'react-hook-form'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'

import { usersApi } from '@/api/users'
import { SettingsPage } from '@/components/layout/SettingsPage'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { FormField } from '@/components/ui/form-field'
import { Input } from '@/components/ui/input'
import { PasswordInput } from '@/components/ui/password-input'
import { Separator } from '@/components/ui/separator'
import { useAuth } from '@/hooks/useAuth'
import { extractApiError } from '@/lib/api-error'
import type { ChangePasswordFormData, UpdateProfileFormData } from '@/lib/validations/user'
import { changePasswordSchema, updateProfileSchema } from '@/lib/validations/user'

export default function ProfileSettingsPage() {
  const { user, refreshUser } = useAuth()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  // StrictMode 이중 실행 방어 — toast+navigate를 한 번만 실행하는 가드 ref
  const mailConnectedHandled = useRef(false)

  // OAuth 콜백 복귀 감지 — 백엔드가 /profile?mail_connected=1 또는 ?mail_connected=error 로 리다이렉트.
  // React Router Navigate(/profile → /settings/profile)가 쿼리스트링을 보존하므로 여기서 감지.
  useEffect(() => {
    const mailConnected = searchParams.get('mail_connected')
    if (!mailConnected || mailConnectedHandled.current) return
    mailConnectedHandled.current = true

    if (mailConnected === '1') {
      toast.success('Outlook 메일 계정이 연결되었습니다.')
      // 메일 계정 목록 캐시 무효화 — /settings/mail 진입 시 즉시 최신 목록 표시
      void queryClient.invalidateQueries({ queryKey: ['mail-accounts'] })
    } else {
      toast.error('Outlook 계정 연결에 실패했습니다. 다시 시도해 주세요.')
    }

    // 쿼리스트링 제거(replace: 히스토리 오염 방지)
    void navigate('/settings/profile', { replace: true })
  }, [searchParams, navigate, queryClient])

  const profileForm = useForm<UpdateProfileFormData>({
    resolver: zodResolver(updateProfileSchema),
    defaultValues: { name: '', email: '' },
  })

  // 비밀번호 변경 폼은 onChange 모드 — 새/확인 비밀번호 불일치를 입력 시점에 즉시 인라인으로 노출 (이슈 #70)
  const passwordForm = useForm<ChangePasswordFormData>({
    resolver: zodResolver(changePasswordSchema),
    mode: 'onChange',
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  })

  useEffect(() => {
    if (user) {
      // email 이 null 이어도 username(로그인 이메일)으로 초기값을 채운다.
      profileForm.reset({ name: user.name, email: user.email ?? user.username ?? '' })
    }
  }, [user, profileForm])

  const onProfileSubmit = async (data: UpdateProfileFormData) => {
    try {
      profileForm.clearErrors()
      await usersApi.updateMe({ name: data.name, email: data.email || undefined })
      await refreshUser()
      toast.success('프로필이 업데이트되었습니다.')
    } catch (error) {
      const msg = extractApiError(error, '')
      profileForm.setError('root', {
        message: msg && msg !== 'Validation failed' ? msg : '입력값을 확인하세요.',
      })
    }
  }

  const onPasswordSubmit = async (data: ChangePasswordFormData) => {
    try {
      passwordForm.clearErrors()
      await usersApi.changePassword({
        currentPassword: data.currentPassword,
        newPassword: data.newPassword,
      })
      passwordForm.reset()
      toast.success('비밀번호가 변경되었습니다.')
    } catch (error) {
      const msg = extractApiError(error, '')
      passwordForm.setError('root', {
        message: msg && msg !== 'Validation failed' ? msg : '현재 비밀번호가 올바르지 않습니다.',
      })
    }
  }

  return (
    <SettingsPage title="프로필" width="form">
      <Card>
        <CardHeader>
          <CardTitle>프로필 정보</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={profileForm.handleSubmit(onProfileSubmit)} className="space-y-4">
            {/* 로그인 계정(username)은 변경 불가 — 읽기 전용 표시 */}
            <FormField label="로그인 계정" htmlFor="profile-username">
              <Input
                id="profile-username"
                type="text"
                value={user?.username ?? ''}
                readOnly
                disabled
                className="bg-muted cursor-not-allowed"
              />
            </FormField>
            <FormField label="이름" htmlFor="profile-name" error={profileForm.formState.errors.name?.message}>
              <Input id="profile-name" type="text" maxLength={100} {...profileForm.register('name')} />
            </FormField>
            <FormField label="이메일" htmlFor="profile-email" error={profileForm.formState.errors.email?.message}>
              <Input
                id="profile-email"
                type="email"
                placeholder="email@example.com"
                {...profileForm.register('email')}
              />
            </FormField>
            {profileForm.formState.errors.root && (
              <p className="text-sm text-destructive">{profileForm.formState.errors.root.message}</p>
            )}
            <Button type="submit" disabled={profileForm.formState.isSubmitting}>
              {profileForm.formState.isSubmitting ? '저장 중...' : '저장'}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Separator />

      <Card>
        <CardHeader>
          <CardTitle>비밀번호 변경</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={passwordForm.handleSubmit(onPasswordSubmit)} className="space-y-4">
            <FormField
              label="현재 비밀번호"
              htmlFor="current-password"
              error={passwordForm.formState.errors.currentPassword?.message}
            >
              <PasswordInput id="current-password" {...passwordForm.register('currentPassword')} autoComplete="current-password" />
            </FormField>
            <FormField
              label="새 비밀번호"
              htmlFor="new-password"
              error={passwordForm.formState.errors.newPassword?.message}
            >
              <PasswordInput id="new-password" {...passwordForm.register('newPassword')} autoComplete="new-password" />
            </FormField>
            <FormField
              label="비밀번호 확인"
              htmlFor="confirm-password"
              error={passwordForm.formState.errors.confirmPassword?.message}
            >
              <PasswordInput id="confirm-password" {...passwordForm.register('confirmPassword')} autoComplete="new-password" />
            </FormField>
            {passwordForm.formState.errors.root && (
              <p className="text-sm text-destructive">{passwordForm.formState.errors.root.message}</p>
            )}
            <Button type="submit" disabled={passwordForm.formState.isSubmitting}>
              {passwordForm.formState.isSubmitting ? '변경 중...' : '비밀번호 변경'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </SettingsPage>
  )
}
