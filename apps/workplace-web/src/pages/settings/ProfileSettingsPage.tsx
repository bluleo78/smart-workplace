// apps/workplace-web/src/pages/settings/ProfileSettingsPage.tsx
// 설정 > 개인 > 프로필 — 아바타(WP-1222) + 프로필 정보 수정 + 비밀번호 변경. (구 ProfilePage 에서 이전)
// WP-48: SSO 전용 계정이면 "비밀번호 설정" 섹션으로 대체.
import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { useLocation } from 'react-router-dom'
import { toast } from 'sonner'

import { usersApi } from '@/api/users'
import { SettingsPage } from '@/components/layout/SettingsPage'
import { settingsFieldClass, SettingsSection } from '@/components/layout/SettingsSection'
import { settingsGuides } from '@/components/settings-guide/settingsGuides'
import { Button } from '@/components/ui/button'
import { FormField } from '@/components/ui/form-field'
import { Input } from '@/components/ui/input'
import { PasswordInput } from '@/components/ui/password-input'
import { AvatarEditor } from '@/components/users/AvatarEditor'
import { useAfterAvatarChange } from '@/hooks/queries/useAvatars'
import { useAuth } from '@/hooks/useAuth'
import { extractApiError } from '@/lib/api-error'
import { cn } from '@/lib/utils'
import type { ChangePasswordFormData, UpdateProfileFormData } from '@/lib/validations/user'
import { changePasswordSchema, updateProfileSchema } from '@/lib/validations/user'

import { SetPasswordCard } from './components/SetPasswordCard'

/** 아바타 섹션 앵커 — 사용자 메뉴·다른 화면에서 `/settings/profile#avatar` 로 바로 찾아온다. */
const AVATAR_ANCHOR = 'avatar'

export default function ProfileSettingsPage() {
  const { user, refreshUser } = useAuth()
  const { hash } = useLocation()

  // `#avatar` 로 들어오면 아바타 섹션으로 내린다 — SPA 이동은 브라우저가 해시 위치로 스크롤해 주지 않는다.
  useEffect(() => {
    if (hash === `#${AVATAR_ANCHOR}`) document.getElementById(AVATAR_ANCHOR)?.scrollIntoView({ block: 'start' })
  }, [hash])

  // 아바타를 바꾸거나 지운 뒤 — 앱 곳곳이 읽는 아바타 목록과 내 정보(레일 메뉴·이 화면의 미리보기)를 함께 새로 받는다(실패는 삼킨다).
  const afterAvatarChange = useAfterAvatarChange(refreshUser)

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
    <SettingsPage
      title="프로필"
      width="form"
      guide={settingsGuides.profile}
      // WP-414: AI 화면 맥락 — 저장된 이름만(비밀번호 입력값은 절대 싣지 않는다).
      aiContext={user ? { facts: [['이름', user.name]] } : null}
    >
      {/* 아바타(WP-1222) — 맨 위에 둔다: 사용자 메뉴의 「프로필」로 들어오면 바로 보인다. */}
      {user && (
        <SettingsSection
          id={AVATAR_ANCHOR}
          data-testid="profile-avatar-section"
          title="아바타"
          description="앱 곳곳(채팅·이슈·댓글·노트 접속자)에 보입니다."
        >
          <AvatarEditor
            testId="profile-avatar"
            userId={user.id}
            name={user.name || user.username}
            avatarUrl={user.avatarUrl ?? null}
            upload={async (file, crop) => {
              await usersApi.uploadMyAvatar(file, crop)
              await afterAvatarChange()
            }}
            reset={async () => {
              await usersApi.deleteMyAvatar()
              await afterAvatarChange()
            }}
          />
        </SettingsSection>
      )}

      {/* 주석 섹션: 넓은 화면에선 왼쪽 제목·설명 / 오른쪽 입력(448px 상한), 좁으면 세로로 쌓인다(WP-397). */}
      <SettingsSection title="프로필 정보" description="다른 구성원에게 보이는 이름과 연락 이메일이에요.">
        {/* noValidate — 이메일 칸(type=email)의 브라우저 기본 검증이 제출을 먼저 막아 zod 의 한국어 안내 대신 말풍선만 뜨고 화면엔 문구가 남지 않았다(WP-912). 검증은 zod 스키마가 한다. */}
        <form noValidate onSubmit={profileForm.handleSubmit(onProfileSubmit)} className={cn('space-y-4', settingsFieldClass)}>
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
            <Input id="profile-name" type="text" maxLength={50} {...profileForm.register('name')} />
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
      </SettingsSection>

      {user?.hasPassword === false ? (
        <SetPasswordCard onDone={refreshUser} />
      ) : (
        <SettingsSection title="비밀번호 변경" description="현재 비밀번호를 확인한 뒤 새 비밀번호로 바꿔요.">
          <form onSubmit={passwordForm.handleSubmit(onPasswordSubmit)} className={cn('space-y-4', settingsFieldClass)}>
            <FormField
              label="현재 비밀번호"
              htmlFor="current-password"
              error={passwordForm.formState.errors.currentPassword?.message}
            >
              <PasswordInput id="current-password" fieldLabel="현재 비밀번호" {...passwordForm.register('currentPassword')} autoComplete="current-password" />
            </FormField>
            <FormField
              label="새 비밀번호"
              htmlFor="new-password"
              error={passwordForm.formState.errors.newPassword?.message}
            >
              <PasswordInput id="new-password" fieldLabel="새 비밀번호" {...passwordForm.register('newPassword')} autoComplete="new-password" />
            </FormField>
            <FormField
              label="비밀번호 확인"
              htmlFor="confirm-password"
              error={passwordForm.formState.errors.confirmPassword?.message}
            >
              <PasswordInput id="confirm-password" fieldLabel="비밀번호 확인" {...passwordForm.register('confirmPassword')} autoComplete="new-password" />
            </FormField>
            {passwordForm.formState.errors.root && (
              <p className="text-sm text-destructive">{passwordForm.formState.errors.root.message}</p>
            )}
            <Button type="submit" disabled={passwordForm.formState.isSubmitting}>
              {passwordForm.formState.isSubmitting ? '변경 중...' : '비밀번호 변경'}
            </Button>
          </form>
        </SettingsSection>
      )}
    </SettingsPage>
  )
}
