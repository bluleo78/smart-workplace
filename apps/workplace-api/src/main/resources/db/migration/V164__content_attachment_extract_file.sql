-- WP-358: 메일 첨부 추출 텍스트 캐시 링크. 메일 첨부는 코어 file 행이 없어(IMAP 온디맨드·암호화 blob 캐시) 공용 추출 파이프라인
-- (file_extraction → file FK, 워커는 평문 storage_path 를 읽음)에 태울 수 없다. 첫 /text 요청 때 바이트를 평문 코어 file(만료 TTL)로
-- 복사해 추출하고, 그 file id 를 content(공유 manifest) 단위로 여기 기록한다.
-- ON DELETE SET NULL: 만료 정리(FileCleanupService)가 file 을 지우면 링크만 풀리고 다음 요청이 다시 만든다. 추가만 하므로 롤링 배포 호환.
ALTER TABLE content_attachment
  ADD COLUMN extract_file_id BIGINT REFERENCES file(id) ON DELETE SET NULL;

-- file 삭제마다 SET NULL 대상 행을 찾는 FK 조회가 content_attachment 전수 스캔이 되지 않게 한다(대부분 NULL 이라 부분 인덱스).
CREATE INDEX IF NOT EXISTS idx_content_attachment_extract_file
  ON content_attachment(extract_file_id) WHERE extract_file_id IS NOT NULL;
