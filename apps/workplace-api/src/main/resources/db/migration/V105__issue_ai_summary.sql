-- 이슈 Instant Context 카드의 AI 생성 요약 저장(#517). 이슈당 1행(upsert).
-- 블로커 배지는 읽기 시 결정적 계산이라 저장하지 않는다. summary/next_action 만 LLM 생성물.
CREATE TABLE issue_ai_summary (
    issue_id     BIGINT      PRIMARY KEY REFERENCES issue(id) ON DELETE CASCADE,
    -- tenant_id: 런타임 INSERT 시 GUC 가 자동으로 채움(애플리케이션은 명시 안 함). V103 calendar 패턴.
    tenant_id    BIGINT      NOT NULL DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint,
    summary      TEXT        NOT NULL,
    next_action  TEXT,
    generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_issue_ai_summary_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id)
);

CREATE INDEX idx_issue_ai_summary_tenant ON issue_ai_summary (tenant_id);

-- RLS: V59 표준 fail-closed + FORCE. 마이그레이션은 소유자 롤(BYPASSRLS)이라 같은 V105 안전.
ALTER TABLE issue_ai_summary ENABLE ROW LEVEL SECURITY;
ALTER TABLE issue_ai_summary FORCE  ROW LEVEL SECURITY;
CREATE POLICY issue_ai_summary_tenant_isolation ON issue_ai_summary
  USING       (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK  (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);
