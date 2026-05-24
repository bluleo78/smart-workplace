export interface SignupRequest {
  username: string;
  password: string;
  name: string;
  email?: string;
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface TokenResponse {
  accessToken: string;
  tokenType: string;
  expiresIn: number;
}

// 사용자 종류 — Phase 5a 부터 백엔드 UserResponse 마지막 필드로 추가됨.
import type { UserKind } from './user';

export interface UserResponse {
  id: number;
  username: string;
  email: string | null;
  name: string;
  isActive: boolean;
  createdAt: string;
  kind: UserKind;
}

export interface ErrorResponse {
  status: number;
  error: string;
  message: string;
  errors?: Record<string, string>;
}
