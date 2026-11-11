// 업무 프로파일(WP-1485) 응답 팩토리 — vitest 화면 테스트(src/pages/me/myOverview.test.tsx)와 E2E 기본 모킹(auth.fixture)이 같이 쓴다.
import type { WorkProfile } from '../../src/types/meOverview'

/** 이번 달(11-01~11-11) 분석이 끝난 프로파일 — 11-11 08:00(서울) 분석, 37건. */
export function createWorkProfile(over: Partial<WorkProfile> = {}): WorkProfile {
  return {
    period: 'MONTH',
    status: 'READY',
    periodFrom: '2026-11-01',
    periodTo: '2026-11-11',
    analyzedAt: '2026-11-10T23:00:00Z',
    totalCount: 37,
    analyzedCount: 37,
    summary: '이번 달에는 이슈 트래커 기능 개발과 결함 수정을 주로 했어요. AI 와 함께 검토를 거쳐 끝낸 일이 많았어요.',
    tasks: [
      { name: '기능 개발', count: 12 },
      { name: '결함 수정', count: 19 },
    ],
    areas: [
      { name: '이슈 트래커', count: 9 },
      { name: '메일', count: 4 },
    ],
    skills: ['React', 'Spring Boot'],
    error: null,
    ...over,
  }
}

/** 끝낸 이슈가 없는 기간 — 분석할 것이 없어 NONE·0건(다른 화면 테스트·E2E 의 기본 응답). */
export function createEmptyWorkProfile(): WorkProfile {
  return createWorkProfile({
    status: 'NONE',
    analyzedAt: null,
    totalCount: 0,
    analyzedCount: 0,
    summary: null,
    tasks: [],
    areas: [],
    skills: [],
  })
}
