import { zodResolver } from '@hookform/resolvers/zod';
import axios from 'axios';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, Navigate } from 'react-router-dom';

import { WorkspaceSelectCard } from '../components/auth/WorkspaceSelectCard';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { PasswordInput } from '../components/ui/password-input';
import { useSignupAvailable } from '../hooks/queries/useSignupAvailable';
import { useAuth } from '../hooks/useAuth';
import type { LoginFormData } from '../lib/validations/auth';
import { loginSchema } from '../lib/validations/auth';
import type { ErrorResponse } from '../types/auth';

export default function LoginPage() {
  const { login, isAuthenticated, tenantOptions } = useAuth();
  const [serverError, setServerError] = useState('');
  // 가입이 잠긴 상태면 회원가입 링크를 숨긴다(부트스트랩 이후).
  const { data: signupAvailable } = useSignupAvailable();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
  });

  if (isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  // 다중소속 로그인 직후 — 폼 대신 워크스페이스 선택 카드를 렌더.
  if (tenantOptions) {
    return <WorkspaceSelectCard options={tenantOptions} />;
  }

  const onSubmit = async (data: LoginFormData) => {
    try {
      setServerError('');
      await login(data);
    } catch (error) {
      // 자격증명은 맞지만 소속 워크스페이스가 없는 경우(백엔드 0-membership) — 전용 안내
      if (error instanceof Error && error.message === 'NO_WORKSPACE') {
        setServerError('접속 가능한 워크스페이스가 없습니다. 관리자에게 문의하세요.');
        return;
      }
      if (axios.isAxiosError(error) && error.response?.data) {
        // 401 응답은 서버 영문 메시지 대신 한국어 고정 메시지로 교체
        // (서버가 "Invalid username or password" 영문 메시지를 반환하기 때문)
        if (error.response.status === 401) {
          setServerError('이메일 또는 비밀번호가 올바르지 않습니다.');
        } else {
          const errData = error.response.data as ErrorResponse;
          setServerError(errData.message || '로그인에 실패했습니다.');
        }
      } else {
        setServerError('로그인에 실패했습니다.');
      }
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Smart Workplace</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="username">아이디 (이메일)</Label>
              <Input
                id="username"
                type="text"
                placeholder="email@example.com"
                autoComplete="username"
                {...register('username')}
              />
              {errors.username && (
                <p className="text-sm text-destructive">{errors.username.message}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">비밀번호</Label>
              <PasswordInput
                id="password"
                autoComplete="current-password"
                {...register('password')}
              />
              {errors.password && (
                <p className="text-sm text-destructive">{errors.password.message}</p>
              )}
            </div>
            {serverError && (
              <p className="text-sm text-destructive">{serverError}</p>
            )}
            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? '로그인 중...' : '로그인'}
            </Button>
          </form>
          {/* 가입이 명시적으로 잠긴 경우(false)만 링크를 숨긴다. 로딩/조회실패(undefined)에는 기본 노출. */}
          {signupAvailable !== false && (
            <div className="mt-4 text-center text-sm">
              <Link to="/signup" className="text-primary underline-offset-4 hover:underline">
                계정이 없으신가요? 회원가입
              </Link>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
