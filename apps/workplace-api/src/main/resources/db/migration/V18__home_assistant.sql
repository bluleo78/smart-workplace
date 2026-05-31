-- V18__home_assistant.sql
-- 홈 AI 비서(Assistant) 지정 재설계 (#50 후속).
-- 공용 비서(싱글톤) + 개인 비서(user FK) + agent 단위 튜닝(assistant_config).

-- 1) 공용 비서: 워크스페이스 1개. id=1 싱글톤.
CREATE TABLE workspace_assistant (
  id             SMALLINT     PRIMARY KEY DEFAULT 1,
  agent_user_id  BIGINT       NOT NULL REFERENCES "user"(id),
  updated_by     BIGINT       NOT NULL REFERENCES "user"(id),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT workspace_assistant_singleton CHECK (id = 1)
);

-- 2) 개인 비서 지정: NULL=없음(공용 폴백). 가리키는 대상은 자동 생성된 개인 AGENT.
ALTER TABLE "user"
  ADD COLUMN personal_assistant_agent_id BIGINT REFERENCES "user"(id);

-- 3) 비서 튜닝(공용·개인 공통, agent 단위). 모든 컬럼 NULL=시스템 디폴트.
CREATE TABLE assistant_config (
  agent_user_id   BIGINT       PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  model           VARCHAR(64),
  thinking_depth  VARCHAR(16),
  max_turns       INT,
  timeout_ms      INT,
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT assistant_config_thinking_depth_check
    CHECK (thinking_depth IS NULL OR thinking_depth IN ('NONE','NORMAL','DEEP'))
);

-- 4) 무중단 시드: 기존 운영의 홈 컴포저 AGENT(id=5, kind='AGENT')를 공용 비서로 등록.
--    해당 AGENT 가 없는 환경(신규)에서는 건너뛴다(서브쿼리가 0행이면 INSERT 0건).
INSERT INTO workspace_assistant (id, agent_user_id, updated_by)
SELECT 1, u.id, u.id
FROM "user" u
WHERE u.id = 5 AND u.kind = 'AGENT'
ON CONFLICT (id) DO NOTHING;
