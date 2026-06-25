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

/** 테넌트 상태 — 활성/정지. */
export type TenantStatus = 'ACTIVE' | 'SUSPENDED'

/** 테넌트 목록 항목 요약. */
export interface TenantSummary {
  id: number
  slug: string | null
  name: string
  status: TenantStatus
  memberCount: number
  createdAt: string
}

/** 테넌트 상세 — 목록 항목에 드라이브 용량 한도(quotaBytes) 를 추가. */
export interface TenantDetail extends TenantSummary {
  quotaBytes: number
}

/** 테넌트 생성 요청 — name 필수, slug 선택, ownerUserId 선택(#496).
 *  ownerUserId 를 생략하면 소유자 없는 빈 테넌트가 생성된다. */
export interface CreateTenantRequest {
  name: string
  slug?: string
  ownerUserId?: number
}

/** 테넌트 멤버(계정) 추가 요청(#497).
 *  email 은 로그인 아이디로도 쓰인다. role 에 따라 멤버십/RBAC 역할이 결정된다
 *  (OWNER → 멤버십 OWNER + RBAC ADMIN, MEMBER → 멤버십 MEMBER + RBAC USER). */
export interface AddTenantMemberRequest {
  email: string
  name: string
  password: string
  role: 'OWNER' | 'MEMBER'
}

/** 테넌트 멤버(상세 화면). 일반 멤버의 name/username/email 은 서버측 부분 마스킹됨.
 *  isPlatformOperator=true(플랫폼 운영자 계정)인 멤버만 원본 노출 + 핀 표시. */
export interface TenantMember {
  userId: number
  username: string
  name: string
  email: string | null
  role: 'OWNER' | 'ADMIN' | 'MEMBER'
  status: string
  isPlatformOperator: boolean
}
