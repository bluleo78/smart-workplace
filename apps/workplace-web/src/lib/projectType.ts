import type { ProjectType } from '@/types/project'

/**
 * 프로젝트 유형 표시 이름 — 설정 「종류」·목록 유형 칩(데스크톱)·목록 보조줄(모바일)이 같은 이름을 쓴다.
 * 데스크톱 칩만 개인/팀 두 갈래로 따로 적어 공개 접수함(OPEN)이 「팀」으로 보였다(WP-1157).
 */
export const PROJECT_TYPE_LABEL: Record<ProjectType, string> = { TEAM: '팀', PERSONAL: '개인', OPEN: '접수함' }
