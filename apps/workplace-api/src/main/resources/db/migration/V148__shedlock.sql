-- V148: 스케줄러 분산 잠금 테이블(ShedLock, WP-165).
-- 롤링 배포로 신·구 api 파드가 겹치는 동안(또는 replicas ≥ 2) @Scheduled 작업이 파드마다 동시에 돌지 않도록,
-- 작업 이름별 잠금 1행을 두고 먼저 잡은 파드만 실행한다. 스키마는 ShedLock JdbcTemplateLockProvider 기본 형식.
-- 시각 컬럼은 TIMESTAMP(시간대 없음) — usingDbTime() 이 timezone('utc', CURRENT_TIMESTAMP) 로 UTC 기준 값을 쓰고 비교하므로,
-- TIMESTAMPTZ 로 두면 세션 TimeZone(KST 등)으로 해석돼 잠금 만료 시각이 어긋난다.
-- 글로벌(비-RLS): 잠금은 테넌트와 무관한 작업 단위다. app_tenant 권한은 V44 DEFAULT PRIVILEGES 로 자동.
CREATE TABLE shedlock (
  name       VARCHAR(64)  NOT NULL PRIMARY KEY,  -- @SchedulerLock(name)
  lock_until TIMESTAMP(3) NOT NULL,              -- 이 시각(UTC)까지 잠금 유지(작업 종료 시 lockAtLeastFor 만큼으로 당김)
  locked_at  TIMESTAMP(3) NOT NULL,
  locked_by  VARCHAR(255) NOT NULL               -- 잠금을 잡은 호스트(파드 이름)
);
