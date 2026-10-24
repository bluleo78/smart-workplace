-- WP-938: 감사 로그 시각(action_time)을 접속 시간대와 상관없이 UTC 벽시계로 저장한다.
-- action_time 은 시간대 없는 TIMESTAMP 이고 기본값이 NOW() 였다. NOW() 를 TIMESTAMP 로 담으면 세션 TimeZone 의 벽시계가 되는데,
-- pgjdbc 는 세션 TimeZone 을 JVM 기본 시간대로 맞춘다 — KST JVM 이면 KST 시각이 들어가고, 웹은 이 값을 UTC 로 읽어(뒤에 Z)
-- +9시간 어긋나게 보였다. 운영 JVM 은 시간대 미설정(UTC)이라 지금까지 맞았지만 JVM 설정에 기대는 셈이었다.
-- 기간 필터도 UTC 순간(웹 toISOString)으로 비교하므로 저장도 UTC 로 못 박는다. 기존 행은 운영에서 이미 UTC 라 고치지 않는다.
ALTER TABLE audit_log ALTER COLUMN action_time SET DEFAULT (now() AT TIME ZONE 'UTC');
