-- WP-1986: 끝난 서버 AI 실행을 지우지 않고 끝남을 표시한다(finished_at).
-- 같은 실행의 STARTED 가 FINISHED 보다 늦게 반영되면(이슈 잠금 대기로 ai-agent 쪽 보고가 시간 초과 뒤 재시도 등) 지운 행이 다시 들어가
-- 끝난 실행이 도는 실행으로 남았다. 끝난 run_id 를 기억해 두면 늦은 STARTED 는 그 행을 도는 실행으로 바꾸지 않는다.
-- failed_note: 같은 AI 의 다른 실행이 아직 돌아 실패 끝을 미뤘을 때 그 사유 — 마지막 실행이 끝날 때 꺼내 노드를 멈추고 비운다.
-- 롤링 배포 중 옛 api 파드는 finished_at 을 몰라 끝난 행을 최대 30분(RUN_STALE_AFTER) 도는 실행으로 볼 수 있다 — 같은 릴리스 안의 짧은 창이라 받아들인다.
ALTER TABLE agent_server_run ADD COLUMN finished_at TIMESTAMPTZ NULL;
ALTER TABLE agent_server_run ADD COLUMN failed_note TEXT NULL;

COMMENT ON TABLE  agent_server_run IS '서버 AI 의 이슈 실행 — STARTED 에 넣고 FINISHED 에 끝남(finished_at)을 표시한다(끝 보고가 마지막 도는 실행의 것인지 가르고, 끝난 실행의 늦은 STARTED 를 무시하는 데 쓴다)';
COMMENT ON COLUMN agent_server_run.finished_at IS 'FINISHED 를 받은 서버 시각 — null 이면 도는 실행. STARTED 없이 FINISHED 가 먼저 오면 이 값을 채운 행(묘비)을 넣는다. 끝난 행은 RUN_STALE_AFTER(30분) 동안 늦은 STARTED 를 막다가 같은 이슈·AI 의 다음 보고 때 지운다';
COMMENT ON COLUMN agent_server_run.failed_note IS '미뤄 둔 실패 사유 — 워크플로우 이슈에서 같은 AI 의 다른 실행이 돌아 실패 끝이 노드를 멈추지 않았을 때 남긴다. 마지막 실행이 노드에 머문 채 끝나면(정상 끝이어도) 이 사유로 노드를 멈추고, 처리·담당 해제·노드를 떠난 끝에서 비운다';
