import { zodResolver } from '@hookform/resolvers/zod'
import axios from 'axios'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Navigate, useNavigate } from 'react-router-dom'
import { z } from 'zod'

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
  const { login, isAuthenticated } = useAuth()
  const navigate = useNavigate()
  const [serverError, setServerError] = useState('')

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
  })

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
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Smart Workplace 운영자 콘솔</CardTitle>
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
