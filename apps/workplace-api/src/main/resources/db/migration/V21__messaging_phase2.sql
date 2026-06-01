-- Messaging Phase 2: 채널 멤버 역할 + 탐색 인덱스
-- visibility / archived_at 컬럼은 Phase 1(V19)에 이미 존재 → 신규 추가 없음.

-- 채널 멤버 역할: OWNER(소유자, 채널당 1명) / ADMIN(관리자) / MEMBER(일반)
ALTER TABLE channel_member
  ADD COLUMN role VARCHAR(16) NOT NULL DEFAULT 'MEMBER';

-- 백필: 기존 채널의 생성자를 OWNER 로 승격 (그 외는 DEFAULT 'MEMBER' 유지)
UPDATE channel_member cm
  SET role = 'OWNER'
  FROM channel c
  WHERE cm.channel_id = c.id AND cm.user_id = c.created_by;

-- 탐색 성능: 공개·비아카이브 채널 목록 조회용 부분 인덱스
CREATE INDEX idx_channel_discover ON channel (visibility) WHERE archived_at IS NULL;
