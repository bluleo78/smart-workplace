-- #735: 추출 지원 범위 확장에 따른 재개방.
-- ① octet-stream 으로 저장된 mime 을 파일명 확장자 기준으로 표준 mime 으로 보정한다.
--    (MimeNormalizer 와 동일 매핑 — 한쪽만 고치면 드리프트)
--    주의: .hwpx 분기는 .hwp 보다 먼저 와야 한다(LIKE '%.hwp' 가 hwpx 를 삼키지 않도록).
UPDATE file SET mime_type = CASE
  WHEN lower(original_name) LIKE '%.html' OR lower(original_name) LIKE '%.htm' THEN 'text/html'
  WHEN lower(original_name) LIKE '%.md'   THEN 'text/markdown'
  WHEN lower(original_name) LIKE '%.txt'  OR lower(original_name) LIKE '%.log' THEN 'text/plain'
  WHEN lower(original_name) LIKE '%.csv'  THEN 'text/csv'
  WHEN lower(original_name) LIKE '%.json' THEN 'application/json'
  WHEN lower(original_name) LIKE '%.xml'  THEN 'application/xml'
  WHEN lower(original_name) LIKE '%.yaml' OR lower(original_name) LIKE '%.yml' THEN 'application/x-yaml'
  WHEN lower(original_name) LIKE '%.pdf'  THEN 'application/pdf'
  WHEN lower(original_name) LIKE '%.docx' THEN 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  WHEN lower(original_name) LIKE '%.xlsx' THEN 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  WHEN lower(original_name) LIKE '%.pptx' THEN 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  WHEN lower(original_name) LIKE '%.doc'  THEN 'application/msword'
  WHEN lower(original_name) LIKE '%.xls'  THEN 'application/vnd.ms-excel'
  WHEN lower(original_name) LIKE '%.ppt'  THEN 'application/vnd.ms-powerpoint'
  WHEN lower(original_name) LIKE '%.hwpx' THEN 'application/hwp+zip'
  WHEN lower(original_name) LIKE '%.hwp'  THEN 'application/x-hwp'
  ELSE mime_type
END
WHERE mime_type = 'application/octet-stream';

-- ② 카테고리 게이트 때문에 SKIPPED 로 굳은 행을 PENDING 으로 재개방한다.
--    스케줄러(FileExtractionScheduler)가 배치 상한(resume-batch-size)만큼 나눠 재처리한다.
--    image 사유 SKIPPED 는 그대로 둔다.
UPDATE file_extraction fe
SET status = 'PENDING', error = NULL, attempts = 0
FROM file f
WHERE fe.file_id = f.id
  AND fe.status = 'SKIPPED'
  AND fe.error LIKE 'non-extractable:%'
  AND (
    f.mime_type LIKE 'text/%'
    OR f.mime_type IN (
      'application/pdf','application/json','application/xml','application/x-yaml','application/yaml',
      'application/javascript','application/x-sh',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/x-hwp','application/hwp+zip',
      'application/msword','application/vnd.ms-powerpoint','application/vnd.ms-excel'
    )
  );
