-- V49: messaging 5개 테이블(channel, channel_member, message, message_reaction, message_attachment)에
--      tenant_id 추가 + channel 경유 백필 + FK.
--      RLS는 V50에서 적용. DEFAULT는 백필 이후 설정 (Flyway=superuser, GUC 미설정 시 NULL 방지).

-- ────────────────────────────────────────────────────────────────────────────
-- 1. channel: 루트 테넌트(#1)로 직접 백필
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE channel ADD COLUMN tenant_id BIGINT;
UPDATE channel SET tenant_id = 1;
ALTER TABLE channel ALTER COLUMN tenant_id SET DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint;
ALTER TABLE channel ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE channel ADD CONSTRAINT fk_channel_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id);
CREATE INDEX idx_channel_tenant ON channel(tenant_id);

-- ────────────────────────────────────────────────────────────────────────────
-- 2. channel_member: channel.tenant_id 경유 백필
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE channel_member ADD COLUMN tenant_id BIGINT;
UPDATE channel_member c SET tenant_id = ch.tenant_id FROM channel ch WHERE c.channel_id = ch.id;
ALTER TABLE channel_member ALTER COLUMN tenant_id SET DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint;
ALTER TABLE channel_member ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE channel_member ADD CONSTRAINT fk_channel_member_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id);
CREATE INDEX idx_channel_member_tenant ON channel_member(tenant_id);

-- ────────────────────────────────────────────────────────────────────────────
-- 3. message: channel.tenant_id 경유 백필
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE message ADD COLUMN tenant_id BIGINT;
UPDATE message m SET tenant_id = ch.tenant_id FROM channel ch WHERE m.channel_id = ch.id;
ALTER TABLE message ALTER COLUMN tenant_id SET DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint;
ALTER TABLE message ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE message ADD CONSTRAINT fk_message_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id);
CREATE INDEX idx_message_tenant ON message(tenant_id);

-- ────────────────────────────────────────────────────────────────────────────
-- 4. message_reaction: message.tenant_id 경유 백필 (message 먼저 백필 필요)
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE message_reaction ADD COLUMN tenant_id BIGINT;
UPDATE message_reaction r SET tenant_id = m.tenant_id FROM message m WHERE r.message_id = m.id;
ALTER TABLE message_reaction ALTER COLUMN tenant_id SET DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint;
ALTER TABLE message_reaction ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE message_reaction ADD CONSTRAINT fk_message_reaction_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id);
CREATE INDEX idx_message_reaction_tenant ON message_reaction(tenant_id);

-- ────────────────────────────────────────────────────────────────────────────
-- 5. message_attachment: message.tenant_id 경유 백필 (message 먼저 백필 필요)
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE message_attachment ADD COLUMN tenant_id BIGINT;
UPDATE message_attachment a SET tenant_id = m.tenant_id FROM message m WHERE a.message_id = m.id;
ALTER TABLE message_attachment ALTER COLUMN tenant_id SET DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint;
ALTER TABLE message_attachment ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE message_attachment ADD CONSTRAINT fk_message_attachment_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id);
CREATE INDEX idx_message_attachment_tenant ON message_attachment(tenant_id);
