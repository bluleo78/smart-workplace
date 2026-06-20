-- V76__messaging_thread_read_state.sql
-- #65 1단계: 스레드별 읽음 watermark + 팔로우 레지스트리.
-- 행 존재 = 그 스레드를 팔로우. last_read_reply_id = 읽은 마지막 답글 id(NULL = 0개 읽음).
-- 멀티테넌트: 기존 messaging 테이블(V49/V50)과 동일한 tenant_id + fail-closed RLS 패턴.

CREATE TABLE thread_read_state (
  thread_root_id     BIGINT      NOT NULL REFERENCES message(id) ON DELETE CASCADE,  -- 스레드 식별자(top-level 메시지)
  user_id            BIGINT      NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  last_read_reply_id BIGINT,                                                          -- watermark(읽은 마지막 답글)
  followed_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  tenant_id          BIGINT      NOT NULL DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint REFERENCES tenant(id),
  PRIMARY KEY (thread_root_id, user_id)
);

-- 2단계 크로스채널 인박스 집계 진입점(user 기준).
CREATE INDEX idx_thread_read_state_user ON thread_read_state(user_id);

-- RLS: GUC 미설정 시 NULL → 모든 행 차단(fail-closed). app_tenant 롤에만 강제, 소유자 app 는 BYPASSRLS.
ALTER TABLE thread_read_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY thread_read_state_tenant_isolation ON thread_read_state
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);
