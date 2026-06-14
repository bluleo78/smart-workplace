// 플랫폼(운영자 콘솔) 인증 관련 타입.
// 플랫폼 토큰은 tenant 클레임이 없다 — web 의 2단계 테넌트 선택 흐름은 불필요.

/** 로그인 요청 — 운영자 username/password. */
export interface PlatformLoginRequest {
  username: string
  password: string
}

/** 로그인/refresh 응답 — access token 과 메타. refresh 토큰은 HttpOnly 쿠키로 전달된다. */
export interface PlatformTokenResponse {
  accessToken: string
  tokenType: string
  expiresIn: number
}

/** 현재 운영자 정보(/auth/me). */
export interface PlatformUser {
  id: number
  username: string
  name: string
  email: string | null
}

/** 백엔드 공통 에러 응답. */
export interface ErrorResponse {
  status: number
  error: string
  message: string
  errors?: Record<string, string>
}
