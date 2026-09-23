-- V133 (#843): 홈 AI 채팅 확인카드(propose_*) 영속화.
-- 기존엔 제안이 웹 React state 에만 있어 새로고침 시 소실되고, 승인 성공/실패가 어디에도 남지 않았다.
-- 제안 1건 = 행 1개. 소유자(user_id)만 승인/거부. 상태 전이는 PENDING → DONE|FAILED|REJECTED|EXPIRED (모두 종결).
--   EXPIRED: 같은 세션에서 새 질문을 보내면 미처리 카드는 폐기(기존 UX 패리티 — AI 가 필요하면 다시 제안).
-- 결과 서술은 home_message(role=ACTION_DONE|ACTION_FAILED|ACTION_REJECTED)로 남아 다음 턴 AI 맥락에 포함된다. 여기엔 상태·사유만 둔다.
CREATE TABLE home_action_proposal (
  id            BIGSERIAL   PRIMARY KEY,
  session_id    UUID        NOT NULL REFERENCES home_session(id) ON DELETE CASCADE,
  user_id       BIGINT      NOT NULL,
  action_type   TEXT        NOT NULL,
  summary       TEXT        NOT NULL,
  params        JSONB       NOT NULL,
  status        TEXT        NOT NULL DEFAULT 'PENDING'
                CHECK (status IN ('PENDING', 'DONE', 'FAILED', 'REJECTED', 'EXPIRED')),
  error_message TEXT,
  resolved_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  tenant_id     BIGINT      NOT NULL DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint
                REFERENCES tenant(id)
);

-- 세션 복원(미처리 카드 조회)·새 질문 시 일괄 만료가 모두 (session_id, status) 조건.
CREATE INDEX idx_home_action_proposal_session ON home_action_proposal (session_id, status);
CREATE INDEX idx_home_action_proposal_tenant ON home_action_proposal (tenant_id);

ALTER TABLE home_action_proposal ENABLE ROW LEVEL SECURITY;
ALTER TABLE home_action_proposal FORCE ROW LEVEL SECURITY;
CREATE POLICY home_action_proposal_tenant_isolation ON home_action_proposal
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);
