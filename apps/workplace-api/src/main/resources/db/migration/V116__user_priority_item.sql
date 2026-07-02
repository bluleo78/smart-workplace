-- AI 가 계산한 사용자별 항목(이슈/멘션/메일/메시지) 중요도·긴급도 점수 저장. 15분 주기 배치가 전량 재계산(#브레인스토밍
-- 2026-07-02). 표시용 분면(HIGH/LOW)은 조회 시점 임계값 계산이라 별도 컬럼 없음.
CREATE TABLE user_priority_item (
    id               BIGSERIAL   PRIMARY KEY,
    -- tenant_id: 런타임 INSERT 시 GUC 가 자동으로 채움(V105 issue_ai_summary 패턴). 애플리케이션은 명시 안 함.
    tenant_id        BIGINT      NOT NULL DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint,
    user_id          BIGINT      NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    source_type      VARCHAR(32) NOT NULL, -- ISSUE_DUE | MENTION | MAIL_NEEDS_REPLY | MESSAGE_ATTENTION
    source_id        VARCHAR(64) NOT NULL, -- 원본 식별자 문자열화(이슈ID·알림ID·메일ID·conversationId)
    title            TEXT        NOT NULL,
    deep_link        TEXT        NOT NULL,
    importance_score SMALLINT    NOT NULL, -- 0~100, AI 산출
    urgency_score    SMALLINT    NOT NULL, -- 0~100, AI 산출
    reason           TEXT        NOT NULL, -- AI 판단 근거 한 줄(한국어)
    computed_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_user_priority_item_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id),
    CONSTRAINT uq_user_priority_item UNIQUE (tenant_id, user_id, source_type, source_id)
);

CREATE INDEX idx_user_priority_item_user ON user_priority_item (tenant_id, user_id);

-- RLS: V59 표준 fail-closed + FORCE (V105 issue_ai_summary와 동일 정책).
ALTER TABLE user_priority_item ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_priority_item FORCE  ROW LEVEL SECURITY;
CREATE POLICY user_priority_item_tenant_isolation ON user_priority_item
  USING       (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK  (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);
