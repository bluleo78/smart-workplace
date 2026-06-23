-- V85: 메시징 어텐션 — AI 발굴(암묵적 채널 관련성) 결과를 per-(대화,사용자) 로 영속.
-- 기계적 신호(DM·@멘션·스레드답글)는 저장하지 않음(요약 시점 라이브 쿼리). 도착 시 비동기로 기록되며
-- read 시점 재현이 불가하므로 이 테이블이 유일한 영속처. tenant_id + FORCE RLS 로 테넌트 격리.
CREATE TABLE conversation_attention (
  channel_id            BIGINT      NOT NULL,
  user_id               BIGINT      NOT NULL,
  reason                TEXT,
  classified_message_id BIGINT      NOT NULL,
  classified_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  tenant_id             BIGINT      NOT NULL DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint,
  PRIMARY KEY (channel_id, user_id)
);

CREATE INDEX idx_conversation_attention_user ON conversation_attention (user_id, tenant_id);

ALTER TABLE conversation_attention ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_attention FORCE ROW LEVEL SECURITY;
CREATE POLICY conversation_attention_tenant_isolation ON conversation_attention
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

-- per-채널 분류 watermark — "이 채널을 메시지 N 까지 분류했다"(결과 유무 무관). AI 호출 게이트의 핵심:
-- maxMessageId(channel) <= last_classified_message_id 면 새 메시지 없음 → 호출 0(변함없는 대화). 또한
-- 버스트 시 첫 태스크가 watermark 를 올리면 후속 태스크는 maxId<=wm 로 스킵(디바운스 효과). conversation_attention
-- 은 양성 결과만 담으므로, "관련자 없음(relevant=[])" 도 watermark 전진으로 재분류 방지(never-relevant 영구재분류 차단).
CREATE TABLE messaging_classify_watermark (
  channel_id                BIGINT      NOT NULL PRIMARY KEY,
  last_classified_message_id BIGINT     NOT NULL,
  classified_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  tenant_id                 BIGINT      NOT NULL DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint
);
ALTER TABLE messaging_classify_watermark ENABLE ROW LEVEL SECURITY;
ALTER TABLE messaging_classify_watermark FORCE ROW LEVEL SECURITY;
CREATE POLICY messaging_classify_watermark_tenant_isolation ON messaging_classify_watermark
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);
