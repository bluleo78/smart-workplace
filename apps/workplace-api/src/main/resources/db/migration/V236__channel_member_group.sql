-- V236 (WP-1058): 비공개 채널 멤버에 조직도 부서(부서 자체)를 둔다.
--
-- 노트·드라이브·프로젝트(V228·V230·V233)는 부서 행만 두고 소속을 판정할 때마다 다시 보지만, 채널은 사람 행을 펼쳐 저장한다(materialize).
-- 안 읽은 수·내 채널·멘션·SSE 수신자·연동 드라이브 공간 명단 등 20여 개 쿼리가 channel_member 를 직접 읽고, 사람마다 역할(OWNER/ADMIN/
-- MEMBER, V21)과 읽은 위치(last_read_message_id)를 들고 있어서다 — 사람 행이 한 사람에 한 줄로 남아야 그 쿼리들이 그대로 돈다.
-- 서버(ChannelMemberGroupSync)가 부서 행·조직도가 바뀌거나 정지·채널 보관이 풀릴 때 사람 행을 맞춘다(없는 활성 사람은 넣고, 부서로만 들어와 이제 안
-- 걸리는 사람은 뺀다 — 정지만으로는 빼지 않는다: 정지가 접근을 막고, 행을 남겨야 정지를 풀었을 때 읽은 위치가 그대로다. 보관된 채널에는 넣지 않는다).
--
-- 1) channel_member.direct — 직접 멤버(초대·참여·생성·DM·역할 승격)면 TRUE, 부서로만 들어온 사람이면 FALSE. 맞추기는 FALSE·MEMBER 행만
--    지운다 — 직접 멤버와 ADMIN/OWNER 는 부서가 빠져도 남는다. 기존 행은 모두 직접 멤버라 DEFAULT TRUE 로 채운다(PG11+ 상수 DEFAULT 는
--    테이블을 재작성하지 않는다). 롤링 배포 호환: 구 코드 insert 는 이 열을 모르므로 TRUE 가 들어간다 — 구 코드는 부서 행을 만들지 않는다.
ALTER TABLE channel_member ADD COLUMN direct BOOLEAN NOT NULL DEFAULT TRUE;

-- 2) channel_member_group — 채널 멤버로 둔 조직도 부서(user_group, visibility=SHARED). 그 부서나 하위 부서의 활성 사람 구성원이 MEMBER 로
--    채널에 들어온다. 비공개 채널(kind=CHANNEL, visibility=PRIVATE)만, 조직도 부서만 — 서버가 막는다(DB 는 채널 종류·visibility 를 모른다).
--    - 채널이 지워지면 함께(CASCADE). 부서가 지워지면 멤버에서도 빠진다(CASCADE — 하위 부서 삭제도 parent_id CASCADE 로 함께).
--    - 추가한 사람(added_by)이 지워지면 NULL(V228 과 같은 관례).
--    - V195·V228·V233 의 테넌트 패턴(tenant_id 기본값 GUC, RLS USING + WITH CHECK, app_tenant 권한 명시).
CREATE TABLE channel_member_group (
  channel_id BIGINT      NOT NULL REFERENCES channel(id) ON DELETE CASCADE,
  group_id   BIGINT      NOT NULL REFERENCES user_group(id) ON DELETE CASCADE,
  tenant_id  BIGINT      NOT NULL DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint
                         REFERENCES tenant(id),
  added_by   BIGINT      REFERENCES "user"(id) ON DELETE SET NULL,  -- NULL = 지운 사용자
  added_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (channel_id, group_id)
);
CREATE INDEX idx_channel_member_group_tenant ON channel_member_group(tenant_id);
-- 부서 삭제의 ON DELETE CASCADE 와 「부서 구성원이 바뀐 채널」 찾기가 group_id 로 찾는다.
CREATE INDEX idx_channel_member_group_group ON channel_member_group(group_id);
CREATE INDEX idx_channel_member_group_added_by ON channel_member_group(added_by);

ALTER TABLE channel_member_group ENABLE ROW LEVEL SECURITY;
CREATE POLICY channel_member_group_tenant_isolation ON channel_member_group
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

GRANT SELECT, INSERT, UPDATE, DELETE ON channel_member_group TO app_tenant;

-- 3) channel_member_group_exclusion — 개인 제외. 부서로 걸리는 사람을 내보냈거나 그 사람이 나갔으면 남긴다 — 맞추기가 그 사람을 다시 넣지 않게.
--    다시 초대하면(직접 멤버) 지운다. 채널이 지워지거나 사람이 지워지면 함께(CASCADE). 테넌트 패턴은 위와 같다.
CREATE TABLE channel_member_group_exclusion (
  channel_id BIGINT      NOT NULL REFERENCES channel(id) ON DELETE CASCADE,
  user_id    BIGINT      NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  tenant_id  BIGINT      NOT NULL DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint
                         REFERENCES tenant(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (channel_id, user_id)
);
CREATE INDEX idx_channel_member_group_exclusion_tenant ON channel_member_group_exclusion(tenant_id);
-- 사람 삭제의 ON DELETE CASCADE 가 user_id 로 찾는다.
CREATE INDEX idx_channel_member_group_exclusion_user ON channel_member_group_exclusion(user_id);

ALTER TABLE channel_member_group_exclusion ENABLE ROW LEVEL SECURITY;
CREATE POLICY channel_member_group_exclusion_tenant_isolation ON channel_member_group_exclusion
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

GRANT SELECT, INSERT, UPDATE, DELETE ON channel_member_group_exclusion TO app_tenant;
