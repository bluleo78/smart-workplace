// 페이지 테스트용 MSW 서버(WP-971) — 네트워크 계층(XHR·fetch)에서 API 를 가로챈다.
// 훅을 vi.mock 으로 끊지 않고 실제 api → 훅 → 화면 경로를 그대로 지나게 해, payload·쿼리·에러 처리를
// E2E 와 같은 깊이로 검증한다. 수명 주기(listen·reset·close)와 모킹 누락 검사는 setup.ts 가 건다.
import { setupServer } from 'msw/node'

export const server = setupServer()

/** 이번 테스트에서 처리하지 못한 요청 — setup.ts 의 afterEach 가 비어 있지 않으면 실패시킨다. */
export const unhandledRequests: string[] = []
