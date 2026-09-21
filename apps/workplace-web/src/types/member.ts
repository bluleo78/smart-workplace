// 구성원(현재 테넌트 멤버) 타입 (#833).
//
// "구성원"은 계정(user)과 다른 개념이다. 계정은 여러 테넌트에 속할 수 있고, 계정 관리(생성·역할변경·
// 비활성화)는 ADMIN 전용 /users 의 몫이다. 구성원 디렉터리(/members)는 "우리 워크스페이스에 누가
// 있는가"를 답하는 조회 전용 표면이라 모든 구성원에게 열려 있다(member:read).

/** membership 역할 — RBAC 역할(ADMIN/USER/AGENT)과 다른 축이다. */
export type MembershipRole = 'OWNER' | 'ADMIN' | 'MEMBER'

export interface MemberSummary {
  /** 전역 user.id — 사람을 가리켜야 하는 모든 곳(담당자·프로젝트 멤버)에서 쓰는 값. */
  userId: number
  username: string
  name: string
  email: string | null
  title: string | null
  kind: 'HUMAN' | 'AGENT'
  active: boolean
  membershipRole: MembershipRole | null
  membershipStatus: string | null
}
