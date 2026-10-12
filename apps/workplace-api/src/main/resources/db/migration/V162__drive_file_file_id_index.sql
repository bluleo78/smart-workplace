-- WP-339: 요약 문맥이 core 파일(file_id)로 드라이브 이름을 찾는다(WorkerJobRepository.findSummaryContext).
-- drive_file 에 file_id 인덱스가 없어 요약마다 테넌트 드라이브 전체를 훑지 않게 한다. 추가만 하므로 롤링 배포 호환.
CREATE INDEX IF NOT EXISTS idx_drive_file_file_id ON drive_file(file_id);
