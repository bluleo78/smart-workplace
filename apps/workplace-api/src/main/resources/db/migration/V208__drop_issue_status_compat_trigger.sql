-- WP-868: 롤링 배포 호환용 status ↔ status_id 동기화 트리거를 걷어낸다.
-- V204 의 trg_issue_status_id_sync 는 status_id 를 모르는 구 파드가 status(범주)만 쓸 때 범주 기본 상태로 맞추던 임시 장치였다.
-- 운영(0.9.16+)의 모든 이슈 쓰기 경로(생성·수정·상태 이전·재오픈)가 status_id 를 함께 쓰므로 더는 필요 없다.
-- 이제 status_id 없이 INSERT 하면 NOT NULL 이, 범주만 바꾸면 복합 FK(status_id, project_id, status) 가 거절한다.
-- 새 프로젝트 4상태 시드 트리거(trg_project_seed_statuses / project_seed_statuses, V206 재정의)는 영구 경로라 남긴다.
DROP TRIGGER IF EXISTS trg_issue_status_id_sync ON issue;
DROP FUNCTION IF EXISTS issue_status_id_sync();
-- 트리거 전용 헬퍼 — V204 의 시그니처(BIGINT, TEXT) 그대로 지정해야 IF EXISTS 가 조용히 건너뛰지 않는다.
DROP FUNCTION IF EXISTS project_status_default_id(BIGINT, TEXT);
