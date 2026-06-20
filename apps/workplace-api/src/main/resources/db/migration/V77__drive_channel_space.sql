-- 채널 연동 드라이브 공간(#76): drive_space 에 채널 링크 + 보관 상태 추가.
-- type 에 CHANNEL 추가. 채널당 공간 1개(부분 UNIQUE). archived_at set 시 읽기전용.
ALTER TABLE drive_space
  ADD COLUMN linked_channel_id BIGINT REFERENCES channel(id) ON DELETE SET NULL,
  ADD COLUMN archived_at TIMESTAMPTZ;

-- type 도메인 확장(기존 PERSONAL|TEAM + CHANNEL). 기존 데이터는 PERSONAL/TEAM 이라 통과.
ALTER TABLE drive_space
  ADD CONSTRAINT chk_drive_space_type CHECK (type IN ('PERSONAL', 'TEAM', 'CHANNEL'));

-- 채널당 연동 공간 1개 — 동시 생성 경쟁 안전.
CREATE UNIQUE INDEX uq_drive_space_channel
  ON drive_space(linked_channel_id) WHERE type = 'CHANNEL';
