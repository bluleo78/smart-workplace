-- 노트 버전 기록(WP-297, 스펙 §6.1): 판별 편집자·AI 적용 귀속·스냅샷 사유·그 판 본문이 바뀐 시각을 남긴다.
-- expand 단계 — 컬럼 추가만 하므로 구버전 앱과 공존한다(이전 행은 reason/edited_at NULL, editor_ids 빈 배열 → author_id 로 표시).
ALTER TABLE wiki_revision
    ADD COLUMN editor_ids  BIGINT[]    NOT NULL DEFAULT '{}',
    ADD COLUMN ai_actor_id BIGINT      NULL,
    ADD COLUMN reason      VARCHAR(16) NULL CHECK (reason IN ('SESSION', 'PERIODIC', 'AI', 'RESTORE')),
    ADD COLUMN edited_at   TIMESTAMPTZ NULL;

-- 스냅샷 판단 기준(본문 저장 때만 갱신 — 제목만 바꾸는 저장은 건드리지 않는다)과 마지막 스냅샷 이후 편집자 누적.
ALTER TABLE wiki_page_doc
    ADD COLUMN body_changed_at    TIMESTAMPTZ NULL,
    ADD COLUMN pending_editor_ids BIGINT[]    NOT NULL DEFAULT '{}';

-- 목록 조회(페이지별 최신순).
CREATE INDEX IF NOT EXISTS idx_wiki_revision_page_created ON wiki_revision (page_id, created_at DESC);
