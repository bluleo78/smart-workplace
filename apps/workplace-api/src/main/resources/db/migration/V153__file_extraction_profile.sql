-- WP-242: 추출 프로파일. FULL = 드라이브(추출→요약→임베딩), TEXT_ONLY = 첨부(추출만, 요약·임베딩 생략).
-- 기존 행은 모두 드라이브 파일이므로 기본값 FULL 로 채워진다.
ALTER TABLE file_extraction
  ADD COLUMN profile VARCHAR(16) NOT NULL DEFAULT 'FULL'
    CONSTRAINT file_extraction_profile_check CHECK (profile IN ('FULL', 'TEXT_ONLY'));
