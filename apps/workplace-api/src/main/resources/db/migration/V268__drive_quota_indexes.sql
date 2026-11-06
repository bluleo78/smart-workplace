-- WP-1391: 저장 공간 사용량·내역 집계(DriveQuotaRepository) 가속용 인덱스.
-- ① 내역은 drive_file_version 을 file_id 로 묶어 드라이브 파일 blob 을 가린다 — 지금 인덱스는 (drive_file_id, version_no)·tenant_id 뿐이다.
-- ② 사용량은 업로드마다 테넌트 file 전체의 size_bytes 를 SUM 하면서 category 로 내부 사본을 뺀다 — INCLUDE 로 힙을 읽지 않는 index-only 스캔을 노린다.
-- 추가만 하므로 롤링 배포 호환(구 코드는 인덱스를 몰라도 그대로 동작). 기존 idx_file_tenant 는 다른 조회가 쓸 수 있어 남긴다.
-- CONCURRENTLY 는 쓰지 않는다 — 이 저장소의 인덱스 마이그레이션(V84·V162 등)과 같이 일반 CREATE INDEX 로 둔다.
CREATE INDEX IF NOT EXISTS idx_drive_file_version_file_id ON drive_file_version(file_id);
CREATE INDEX IF NOT EXISTS idx_file_tenant_size_category ON file(tenant_id) INCLUDE (size_bytes, category);
