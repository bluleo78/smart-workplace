-- WP-1201: AI 작업 행의 「상태가 실제로 바뀐 시각」. AI 위임 작업 「AI별」 보기가 「답변 필요 · 38분째」처럼 그 상태로 있은 시간을 보인다.
-- updated_at 은 note 만 바뀌어도(보고·터치) 올라가 이 용도로 쓸 수 없다. 새 행은 기본값 now()(만든 순간이 첫 상태)이고,
-- 상태가 바뀌는 UPDATE 는 아래 트리거가 now() 로 올린다 — 상태를 바꾸는 쓰기 경로마다 손으로 맞추지 않고 한 곳에 둔다
-- (롤링 배포 중 이 컬럼을 모르는 옛 코드의 쓰기도 함께 맞는다).
-- expand-only: NULL 허용으로 더한다. 진행 중 행은 아래 백필과 기본값으로 늘 값이 있고, 끝난 행은 읽지 않는다.
ALTER TABLE agent_work ADD COLUMN state_changed_at TIMESTAMPTZ;

-- 진행 중 행만 마지막 보고 시각으로 채운다(정확한 상태 진입 시각은 남아 있지 않다 — 가장 가까운 값). 끝난 행은 전체를 다시 쓰지 않게 NULL 로 둔다.
UPDATE agent_work SET state_changed_at = updated_at WHERE ended_at IS NULL;

ALTER TABLE agent_work ALTER COLUMN state_changed_at SET DEFAULT now();

CREATE FUNCTION agent_work_state_changed_at() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  NEW.state_changed_at := now();
  RETURN NEW;
END;
$$;

-- 상태가 실제로 바뀐 UPDATE 에서만 — 같은 상태 재보고·note·진행률만 바뀐 보고는 시각을 그대로 둔다.
CREATE TRIGGER trg_agent_work_state_changed_at
  BEFORE UPDATE OF state ON agent_work
  FOR EACH ROW WHEN (OLD.state IS DISTINCT FROM NEW.state)
  EXECUTE FUNCTION agent_work_state_changed_at();

-- AI 마다 「마지막으로 작업을 끝낸 시각」(쉬는 중 n분째)을 30초마다 읽는다 — 끝난 행 전체를 모으지 않고 AI 마다 맨 앞 한 건만 읽게.
CREATE INDEX agent_work_worker_ended_idx ON agent_work (worker_id, ended_at DESC) WHERE ended_at IS NOT NULL;
