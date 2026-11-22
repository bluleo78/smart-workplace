-- WP-1958 끝나는 중인 옛 Pod 의 늦은 보고를 거르려고, 보고한 Pod 의 시작 시각을 함께 저장한다.
-- agent_runtime_slot_state.pod_started_at : 그 칸 보고를 보낸 Pod 의 시작 시각(보고에 없으면 NULL — 옛 플러그인).
-- agent_runtime_setting.reported_pod_started_at : 보고가 알려 준 가장 늦은 Pod 시작 시각(올라가기만 함, runner 가 새 started_at 을
--   관찰하면 비움). runner 관찰이 늦을 때 지금 Pod 시작의 근거로 쓴다.
-- agent_runtime_setting.pane_blocked_pod_started_at : 진입점 차단 보고를 보낸 Pod 의 시작 시각(차단이 풀리면 NULL).
ALTER TABLE agent_runtime_slot_state
  ADD COLUMN pod_started_at TIMESTAMPTZ;

ALTER TABLE agent_runtime_setting
  ADD COLUMN reported_pod_started_at     TIMESTAMPTZ,
  ADD COLUMN pane_blocked_pod_started_at TIMESTAMPTZ;
