-- WP-1913 진입점 차단 보고 — 칸을 띄우지 못한 사실·이유. runner 관찰 칸과 분리해 읽을 때만 합친다(덮어쓰기 없음).
ALTER TABLE agent_runtime_setting
  ADD COLUMN pane_blocked_message VARCHAR(500),
  ADD COLUMN pane_blocked_at      TIMESTAMPTZ;
