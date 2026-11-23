-- WP-2010 — 마지막 상태 보고·칸 차단 보고가 어느 Pod 에서 왔는지 정체를 함께 남긴다.
-- agent_reported_pod_uid        : agent_reported_at 을 낸 칸의 Pod 정체(metadata.uid). 정체를 모르는 보고(옛 플러그인)는 NULL.
-- agent_reported_pod_started_at : agent_reported_at 을 낸 같은 칸의 Pod 시작 시각(노드 시계). 시각을 모르는 보고는 NULL.
--                                 같은 Pod 안 컨테이너 재시작(uid 같음)을 적용 판정이 같은 노드 시계끼리 가르는 데 쓴다.
-- pane_blocked_pod_uid          : pane_blocked_pod_started_at 을 보고한 Pod 의 정체. 차단이 풀리면 함께 NULL.
-- 모두 nullable 추가라 롤링 배포 중 옛 코드도 그대로 동작한다.
ALTER TABLE agent_runtime_setting
  ADD COLUMN agent_reported_pod_uid TEXT,
  ADD COLUMN agent_reported_pod_started_at TIMESTAMPTZ,
  ADD COLUMN pane_blocked_pod_uid TEXT;

COMMENT ON COLUMN agent_runtime_setting.agent_reported_pod_uid IS
  'agent_reported_at 을 낸 칸의 Pod 정체(metadata.uid) — 정체를 모르는 보고는 NULL';
COMMENT ON COLUMN agent_runtime_setting.agent_reported_pod_started_at IS
  'agent_reported_at 을 낸 같은 칸의 Pod 시작 시각 — 시각을 모르는 보고는 NULL';
COMMENT ON COLUMN agent_runtime_setting.pane_blocked_pod_uid IS
  '칸 차단(pane_blocked_*)을 보고한 Pod 정체(metadata.uid) — 차단이 풀리면 NULL';
