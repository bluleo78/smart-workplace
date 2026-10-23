-- WP-886: 이슈 우선순위를 3단계(LOW·MID·HIGH)에서 5단계로 넓힌다 — HIGHEST(매우 높음)·LOWEST(매우 낮음) 추가.
-- 모든 프로젝트 공통 고정 값이다(프로젝트별 정의 아님). Jira 이전(Highest·Lowest)과 긴급 결함을 「높음」과 따로 거르기 위함.
-- 기존 저장값(LOW·MID·HIGH)은 그대로라 데이터 이전은 없다. 컬럼은 VARCHAR(8) 이라 'HIGHEST'(7자)도 들어간다.
-- 제약을 넓히기만 하므로 롤링 배포에 안전하다 — 구 버전 앱은 새 값을 쓰지 않을 뿐 기존 값 읽기·쓰기는 그대로 된다.
-- 제약 이름 issue_priority_check 는 V5 의 이름 없는 CHECK 에 PostgreSQL 이 붙인 기본 이름이다(jOOQ 코드젠 Issue.getChecks 로 확인).
-- NOT VALID: 기존 행은 더 좁은 옛 제약(LOW·MID·HIGH)이 이미 보장했으므로 전체 행 재검증 스캔을 건너뛴다(V196 과 같은 판단).
-- 새로 쓰는 행에는 곧바로 적용된다.
ALTER TABLE issue DROP CONSTRAINT issue_priority_check;
ALTER TABLE issue ADD CONSTRAINT issue_priority_check
    CHECK (priority IN ('HIGHEST', 'HIGH', 'MID', 'LOW', 'LOWEST')) NOT VALID;
