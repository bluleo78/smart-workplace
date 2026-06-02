-- Messaging Phase 3 (DM): DM 채널 정체성 키.
-- 정렬된 참여자 ID 조합("3,7,12")을 채널 행에 저장 → 멤버셋 dedup·레이스 차단.
-- DM 전용 컬럼: kind='CHANNEL' 행은 NULL, kind='DM' 행만 값.
ALTER TABLE channel ADD COLUMN member_key VARCHAR(255);

-- kind='DM' 행에 한해 member_key 유니크 → 동일 멤버셋 중복 생성(동시 요청 포함) 차단.
CREATE UNIQUE INDEX uq_channel_dm_member_key ON channel (member_key) WHERE kind = 'DM';
