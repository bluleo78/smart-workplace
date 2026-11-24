-- WP-2032 리뷰 반려 ① — 기준 없이 밝힌 정체 자리의 회복 근거를 **같은 시계**로 견주게 한다.
-- 앞 수정은 회복 근거를 max(started_at, reported_pod_started_at) 과 견볐는데, clockSkewFiltered 보고는 걸리기 전 시작(raw)이 서버 시각보다
-- 30초 넘게 앞서고 그 기준값은 서버 시각 이하라 검사가 늘 참이었다 — 죽은 옛 Pod 의 늦은 시계 이상 보고가 잠금 지난 뒤 정체를 가져 살아 있는
-- Pod 가 previous 로 박히는 WP-1968 6차 반려 ① 교착이 그대로 열려 있었다.
-- 그래서 표시(basisless_pod_uid)를 남길 때 그 보고의 **걸리기 전 시작(raw)** 을 함께 저장하고, 회복은 새 보고의 raw 가 그 값보다 늦을 때만
-- 받는다 — 둘 다 같은 노드 시계라 견줄 수 있다. 같은 빠른 노드의 옛 Pod 는 raw 가 더 이르러 막히고, 뒤에 뜬 새 Pod 만 통과한다.
ALTER TABLE agent_runtime_setting
  ADD COLUMN basisless_pod_started_raw TIMESTAMP WITH TIME ZONE;

COMMENT ON COLUMN agent_runtime_setting.basisless_pod_started_raw IS
  'basisless_pod_uid 표시를 남긴 그 보고의 걸리기 전 Pod 시작(raw) — 회복 근거다. 표시 자리의 재시작 회복(WP-2032)은 새 보고의 걸리기 전 시작이 이 값보다 늦을 때만 받는다(같은 노드 시계). 표시와 함께 지워지고, 회복 ADOPT 때 새 값으로 갱신된다. null 이면 마이그레이션 전 표시라 첫 회복 보고로 값을 세운다.';
