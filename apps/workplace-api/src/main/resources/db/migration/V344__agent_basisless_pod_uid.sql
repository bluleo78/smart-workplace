-- WP-2026 리뷰 반려 ①·② → 3차 반려 ①로 해제 조건을 바꿈. 시계 이상으로 걸러진 첫 ADOPT 는 기준(시각) 없이 정체만 갈아끼운다.
-- 그 자리는 C1(지금 Pod 시작보다 이른 정체 거절)이 갈 수 없어, 정상 시각의 다른 정체가 정체를 갈아끼우면 살아 있는 Pod 가 previous 로 박혀
-- 영구 교착(상태 미저장·칸 409)이 되살아난다(WP-1968 6차 반려 ①) — 그래서 그 자리를 표시(basisless_pod_uid)로 지킨다.
-- 다만 표시 잠금을 「보고 기준(reported_pod_started_at)이 채워질 때까지」(1~2차 반려)로 두면 그 사건이 오지 않는 상태가 매번 새 교착이었다
-- (3차 반려 ① 시계가 계속 앞선 노드 → 정상 노드 새 Pod 로 교체해도 영구 409, ② MATCH 가 기준을 채워도 표시가 남아 관찰이 기준을 비운 뒤
-- 새 Pod ADOPT 를 다시 막음). 그래서 표시와 함께 그 표시를 남긴 **서버(DB) 시각**(아래 basisless_marked_at)을 남기고,
-- 셋 중 하나면 다른 정체의 ADOPT 를 막지 않는다 — (a) 서버 시각 60초 경과 · (b) 관찰이 표시 뒤에 생긴 시작을 started_at 에 비춤 ·
-- (c) 표시가 지금 정체와 다름. 노드 시계로 재면 이 이슈(시계 앞섬)와 같은 구멍이 나므로 경과는 서버 시각으로만 잰다.
-- 표시가 없는 자리(시각 없는 관찰 자리)는 애초에 막지 않는다 — 그 자리에서는 새 Pod 의 정상 시각 보고를 ADOPT 로 받아야 한다(2차 반려 ②).
ALTER TABLE agent_runtime_setting
  ADD COLUMN basisless_pod_uid TEXT;

COMMENT ON COLUMN agent_runtime_setting.basisless_pod_uid IS
  '기준(시각) 없이 ADOPT 로만 밝힌 Pod 정체 — 다른 정체의 ADOPT 를 막는 표시다. basisless_marked_at 로부터 60초(서버 시각 기준) 안에서만, 그리고 그 표시 정체가 지금 정체일 때만 막는다(WP-2026). 관찰이 표시 뒤에 생긴 시작을 started_at 에 비추거나 기준이 갱신되면 함께 지워진다. null 이면 그런 ADOPT 가 없다.';
-- 3차 반려 ①·② — 표시 잠금을 「앞으로 올 특정 사건 하나」가 아니라 「지금 행에 이미 있는 값」으로 풀게 바꾼다(WP-2026).
-- 표시가 선 서버 시각을 함께 남겨, (a) 서버 시각 기준 60초 경과 · (b) 관찰이 표시 뒤에 생긴 시작을 started_at 에 비춤 ·
-- (c) 표시가 지금 정체와 다름 — 셋 중 하나면 다른 정체의 ADOPT 를 막지 않는다. 노드 시계로 재면 이 이슈(시계 앞섬)와 같은 구멍이 나므로
-- 경과는 서버 시각(이 컬럼에 적은 값 vs 지금)으로 잰다. 표시를 지우는 곳(기준 갱신·정체 갈아끼움)은 이 열도 함께 지운다.
ALTER TABLE agent_runtime_setting
  ADD COLUMN basisless_marked_at TIMESTAMP WITH TIME ZONE;

COMMENT ON COLUMN agent_runtime_setting.basisless_marked_at IS
  'basisless_pod_uid 를 남긴 서버 시각 — 그 뒤 60초(서버 시각 기준)가 지나면 다른 정체의 ADOPT 를 막지 않는다(WP-2026 3차 반려 ①). 표시와 함께 지워진다.';
