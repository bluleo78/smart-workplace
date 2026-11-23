-- WP-1968 서버가 지금 떠 있는 Pod 의 정체(metadata.uid)를 기억해,
-- 보고를 시각이 아니라 정체로 받고/버린다 — 노드 시계가 어긋나도 새 Pod 보고가 버려지지 않게.
ALTER TABLE agent_runtime_setting
  ADD COLUMN observed_pod_uid TEXT;
