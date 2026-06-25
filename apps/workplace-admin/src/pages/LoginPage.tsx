import { zodResolver } from '@hookform/resolvers/zod'
import axios from 'axios'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Navigate, useNavigate } from 'react-router-dom'
import { z } from 'zod'

import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { useAuth } from '../hooks/useAuth'
import type { ErrorResponse } from '../types/platform'

// 운영자 로그인 폼 스키마. username 은 이메일이 아닌 운영자 계정명일 수 있어 string 검증.
const loginSchema = z.object({
  username: z.string().min(1, '아이디를 입력하세요'),
  password: z.string().min(1, '비밀번호를 입력하세요'),
})

type LoginFormData = z.infer<typeof loginSchema>

export default function LoginPage() {
  const { login, isAuthenticated, isLoading } = useAuth()
  const navigate = useNavigate()
  const [serverError, setServerError] = useState('')

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
  })

  // 세션 복원 중에는 로그인 폼을 그리지 않는다(복원 후 인증되면 리다이렉트되므로 폼 깜빡임 방지).
  if (isLoading) {
    return null
  }
  if (isAuthenticated) {
    return <Navigate to="/" replace />
  }

  const onSubmit = async (data: LoginFormData) => {
    try {
      setServerError('')
      await login(data.username, data.password)
      navigate('/')
    } catch (error) {
      if (axios.isAxiosError(error)) {
        // 403 = 운영자 권한 없음, 401 = 자격 오류.
        if (error.response?.status === 403) {
          setServerError('운영자 권한이 없습니다.')
          return
        }
        if (error.response?.status === 401) {
          setServerError('아이디 또는 비밀번호가 올바르지 않습니다.')
          return
        }
        const errData = error.response?.data as ErrorResponse | undefined
        setServerError(errData?.message ?? '로그인에 실패했습니다.')
        return
      }
      setServerError('로그인에 실패했습니다.')
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-md">
        {/*
          타이틀 위계로 한·영 혼합("Smart Workplace 운영자 콘솔" 한 줄)을 해소하고 고객 포탈과 구분한다.
          - Platform 배지: 고객 포탈(Smart Workplace 로그인)엔 없는 플랫폼 전용 마커 → 잘못 들어온 화면임을 즉시 인지.
          - "플랫폼 콘솔"(주인공): 테넌트-레벨 관리자(ADMIN)와 층위가 다른 플랫폼 운영 surface 임을 명확히.
          - "Smart Workplace"(보조·뮤트): 브랜드는 부제로 내려 혼합을 제거.
        */}
        <CardHeader className="items-center space-y-2 text-center">
          <Badge variant="secondary" className="uppercase tracking-wider" data-testid="login-platform-badge">
            Platform
          </Badge>
          <CardTitle className="text-2xl">플랫폼 콘솔</CardTitle>
          <p className="text-sm text-muted-foreground">Smart Workplace</p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="username">아이디</Label>
              <Input
                id="username"
                type="text"
                autoComplete="username"
                data-testid="login-username"
                {...register('username')}
              />
              {errors.username && (
                <p className="text-sm text-destructive">{errors.username.message}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">비밀번호</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                data-testid="login-password"
                {...register('password')}
              />
              {errors.password && (
                <p className="text-sm text-destructive">{errors.password.message}</p>
              )}
            </div>
            {serverError && (
              <p className="text-sm text-destructive" data-testid="login-error">
                {serverError}
              </p>
            )}
            <Button
              type="submit"
              className="w-full"
              disabled={isSubmitting}
              data-testid="login-submit"
            >
              {isSubmitting ? '로그인 중...' : '로그인'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
