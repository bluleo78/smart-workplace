-- WP-2019: runner 가 새 설정(새 desired generation)을 반영하다 실패했을 때 그 실패가 난 generation.
-- 옛 Pod 가 남아 있으면 관찰 보고의 observed_generation 은 옛 Pod 의 것이라 새 설정 실패가 옛 요청 실패로 가려진다 — 그 실패를 따로 싣는다.
-- NULL 허용 컬럼 추가(expand) — 옛 API 인스턴스는 이 칸을 모르고 둔다.
ALTER TABLE agent_runtime_setting ADD COLUMN failed_generation BIGINT;

COMMENT ON COLUMN agent_runtime_setting.failed_generation IS
  'runner 실패 기록이 있을 때 그 실패가 난 desired generation(WP-2019). 보고마다 그대로 덮어쓴다 — 없으면 NULL';
