-- DM member_key 유니크를 테넌트별로 — 같은 사용자쌍이 여러 테넌트에서 각각 DM 을 가질 수 있게(전역 충돌 방지).
-- (유니크 인덱스는 RLS 를 우회해 전역 적용되므로 tenant_id 를 포함해야 한다.)
DROP INDEX IF EXISTS uq_channel_dm_member_key;
CREATE UNIQUE INDEX uq_channel_dm_member_key ON channel (tenant_id, member_key) WHERE kind = 'DM';
