-- saved_view 고정(pin): per-user(owner_id) 뷰라 불리언 컬럼으로 충분 (조인 테이블 불필요)
ALTER TABLE saved_view ADD COLUMN is_pinned BOOLEAN NOT NULL DEFAULT FALSE;

-- 사이드바 전역 고정뷰 조회(owner_id + is_pinned) 가속
CREATE INDEX idx_saved_view_owner_pinned ON saved_view(owner_id) WHERE is_pinned;
