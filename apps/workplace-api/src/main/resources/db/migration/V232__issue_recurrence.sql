-- V232 (WP-989): 개인 작업의 「반복 AI 작업」.
--
-- 개인 작업(PERSONAL 프로젝트) 이슈 하나에 반복 규칙을 붙이면, 정한 시각(KST)마다 서버 스케줄러가 담당 AI 비서에게
-- 「이번 회차를 실행하라」는 이벤트를 보내고, AI 는 결과를 이슈 챗에 남긴다. 이슈당 반복은 하나라 issue_id 가 PK 다.
-- 새 테이블만 더한다(롤링 배포 호환 — 기존 코드는 모른다).
--
-- - rrule: FREQ=DAILY | FREQ=WEEKLY;BYDAY=.. | FREQ=MONTHLY;BYMONTHDAY=.. (하루 1회가 가장 짧은 주기 — 서버가 검증)
-- - run_time: KST 벽시계 시각(분 단위)
-- - agent_user_id: 등록 당시 해석한 실행 AI(소유자의 개인 비서, 없으면 공용 비서)
-- - next_run_at: 다음 회차 시각. 꺼진(enabled=false) 반복은 스케줄러가 집지 않는다
-- - consecutive_failures: 연속 실패 수 — 3 이상이면 반복을 끈다
-- - run_count: 지금까지 보낸 회차 수 — 실행 지시문의 「N회차」에 쓴다
-- - pending_run_id: 보냈지만 아직 결과 보고가 오지 않은 회차 id. 결과 보고는 이 값과 같을 때만 반영한다(같은 runId 두 번째·지난 회차 보고는 무시).
--   보낸 지 30분이 지나도 결과가 없으면 스케줄러가 실패로 센다
-- - deleted: 회차 실행 중에 지운 반복의 묘비 — 진행 중 회차 결과가 오면 글로 남기고 행을 지운다(조회·목록에서는 없는 반복이다)
-- - 테넌트 패턴은 V89·V220 과 같다(tenant_id 기본값 GUC, FK, ENABLE+FORCE RLS, USING+WITH CHECK 정책).
CREATE TABLE issue_recurrence (
  issue_id              BIGINT       PRIMARY KEY REFERENCES issue(id) ON DELETE CASCADE,
  tenant_id             BIGINT       NOT NULL DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint,
  rrule                 VARCHAR(200) NOT NULL,
  run_time              TIME         NOT NULL,
  agent_user_id         BIGINT       NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  created_by            BIGINT       NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  enabled               BOOLEAN      NOT NULL DEFAULT TRUE,
  next_run_at           TIMESTAMPTZ,
  consecutive_failures  INT          NOT NULL DEFAULT 0,
  run_count             INT          NOT NULL DEFAULT 0,
  pending_run_id        VARCHAR(64),
  deleted               BOOLEAN      NOT NULL DEFAULT FALSE,
  last_run_at           TIMESTAMPTZ,
  created_at            TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT fk_issue_recurrence_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id)
);
-- 스케줄러가 매분 「켜져 있고 시각이 된」 행을 찾는다.
CREATE INDEX idx_issue_recurrence_due ON issue_recurrence(enabled, next_run_at);
-- 결과를 오래 못 받은 회차를 찾는다(30분 넘게 대기 중인 회차).
CREATE INDEX idx_issue_recurrence_pending ON issue_recurrence(last_run_at) WHERE pending_run_id IS NOT NULL;
-- 사용자 삭제 CASCADE 가 agent_user_id·created_by 로 찾는다.
CREATE INDEX idx_issue_recurrence_agent ON issue_recurrence(agent_user_id);
CREATE INDEX idx_issue_recurrence_created_by ON issue_recurrence(created_by);

ALTER TABLE issue_recurrence ENABLE ROW LEVEL SECURITY;
ALTER TABLE issue_recurrence FORCE ROW LEVEL SECURITY;
CREATE POLICY issue_recurrence_tenant_isolation ON issue_recurrence
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);
