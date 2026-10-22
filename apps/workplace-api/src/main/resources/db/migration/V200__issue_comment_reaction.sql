-- WP-504: 이슈 코멘트 이모지 반응. 채팅 message_reaction(V27)과 같은 모양 — (코멘트, 사람, 이모지) 유니크라 토글은 insert/delete.
-- 새 표만 더하므로 구 파드에 영향이 없다(expand only).

CREATE TABLE issue_comment_reaction (
  comment_id BIGINT      NOT NULL REFERENCES issue_comment(id) ON DELETE CASCADE,
  user_id    BIGINT      NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  emoji      TEXT        NOT NULL CHECK (char_length(emoji) BETWEEN 1 AND 32),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  tenant_id  BIGINT      NOT NULL
               DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint
               REFERENCES tenant(id),
  PRIMARY KEY (comment_id, user_id, emoji)
);
-- 코멘트 목록의 반응 집계·반응자 조회는 PK (comment_id, user_id, emoji) 의 앞부분으로 탄다 — 따로 comment_id 인덱스를 두지 않는다.
CREATE INDEX idx_issue_comment_reaction_tenant ON issue_comment_reaction (tenant_id);

-- RLS: V182·V192·V197 패턴(NULLIF fail-closed). app_tenant 런타임에 FORCE, 소유자 app 은 BYPASSRLS.
ALTER TABLE issue_comment_reaction ENABLE ROW LEVEL SECURITY;
ALTER TABLE issue_comment_reaction FORCE ROW LEVEL SECURITY;
CREATE POLICY issue_comment_reaction_tenant_isolation ON issue_comment_reaction
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);
GRANT SELECT, INSERT, UPDATE, DELETE ON issue_comment_reaction TO app_tenant;
