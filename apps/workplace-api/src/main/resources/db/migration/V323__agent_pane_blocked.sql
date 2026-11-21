-- WP-1913 진입점 차단 보고 — 칸을 띄우지 못한 사실·이유. runner 관찰 칸과 분리해 읽을 때만 합친다(덮어쓰기 없음).
-- pane_blocked_generation 은 그 사유를 보고한 Pod 의 generation — 지금 generation 과 다를 때(설정을 고쳐 새 generation 이 뜬 뒤나
-- 끝나는 중인 옛 Pod 의 늦은 보고)는 읽지 않고 보고도 받지 않는다(리뷰 반려 ①).
ALTER TABLE agent_runtime_setting
  ADD COLUMN pane_blocked_message    VARCHAR(500),
  ADD COLUMN pane_blocked_at         TIMESTAMPTZ,
  ADD COLUMN pane_blocked_generation BIGINT;
