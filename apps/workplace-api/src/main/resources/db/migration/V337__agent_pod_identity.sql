-- WP-1968 반려 수정 — 보고가 관찰(약 60초)을 기다리지 않고 지금 Pod 정체를 정하게 한다.
-- previous_pod_uid : 바로 앞에 쓰이던 Pod 정체(metadata.uid) — 지연 도착한 옛 Pod 보고·관찰이
--   새 Pod 정체를 되돌리지 않게 한다(정체 하나를 두 번 되돌리지 않게도 한다).
-- agent_runtime_slot_state.pod_uid : 그 칸 보고를 보낸 Pod 정체 — 정체가 없는 칸(옛 플러그인)만
--   기존 시각 규칙으로 가른다. 노드 시계가 빨라 끝나는 중인 옛 Pod 의 칸이 남지 않는다.
ALTER TABLE agent_runtime_setting
  ADD COLUMN previous_pod_uid TEXT;

ALTER TABLE agent_runtime_slot_state
  ADD COLUMN pod_uid TEXT;
