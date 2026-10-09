// 병합 워커(mergeJob)와 메인 스레드(server)가 함께 쓰는 값 — 워커가 실행기 모듈(mergeRunner)을 런타임에 불러오지 않게 따로 둔다.

/** 빈 AI본 거부 사유 — 워커(기준본이 있음)와 메인 스레드(기준본은 비고 현재본에 내용이 있음)가 같은 사유·코드(empty_body)로 답한다. */
export const EMPTY_BODY_REJECTION = 'empty body: refusing to merge an empty body into a non-empty note'
