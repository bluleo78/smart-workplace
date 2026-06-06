// apps/workplace-web/src/pages/settings/ProfileSettingsPage.tsx
// 설정 > 개인 > 프로필 — 프로필 정보 수정 + 비밀번호 변경. (구 ProfilePage 에서 이전)
import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'

import { usersApi } from '@/api/users'
import { pageTitleClass } from '@/components/layout/sidebar-link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { FormField } from '@/components/ui/form-field'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { useAuth } from '@/hooks/useAuth'
import { extractApiError } from '@/lib/api-error'
import type { ChangePasswordFormData, UpdateProfileFormData } from '@/lib/validations/user'
import { changePasswordSchema, updateProfileSchema } from '@/lib/validations/user'

export default function ProfileSettingsPage() {
  const { user, refreshUser } = useAuth()

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
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <h1 className={pageTitleClass}>프로필</h1>

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
              <Input id="current-password" type="password" {...passwordForm.register('currentPassword')} />
            </FormField>
            <FormField
              label="새 비밀번호"
              htmlFor="new-password"
              error={passwordForm.formState.errors.newPassword?.message}
            >
              <Input id="new-password" type="password" {...passwordForm.register('newPassword')} />
            </FormField>
            <FormField
              label="비밀번호 확인"
              htmlFor="confirm-password"
              error={passwordForm.formState.errors.confirmPassword?.message}
            >
              <Input id="confirm-password" type="password" {...passwordForm.register('confirmPassword')} />
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
    </div>
  )
}
