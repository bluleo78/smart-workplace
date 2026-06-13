-- V54: audit·notify 도메인 2개 테이블에 tenant_id 컬럼 추가 + 백필 + FK + 인덱스.
-- RLS 활성화는 V55 에서 수행 — 이 마이그레이션은 컬럼/백필/DEFAULT/FK/인덱스만.
-- 대상 테이블(2): notification(표준 NOT NULL), audit_log(NULLABLE 변형).
--
-- 백필 전략: 레거시 데이터는 단일 테넌트라 전부 tenant#1 고정(상수). 부모 join 백필이 아님.
--   notification 은 issue_id 가 nullable(캘린더 REMINDER 알림은 issue 없음, V40)이라 issue join 백필 시
--   NULL 잔존 → NOT NULL 위반. 따라서 상수 백필이 정확하고 안전하다.
--
-- DEFAULT 순서 주의(V47/V52 와 동일 함정 회피):
--   Flyway 는 소유자 롤(app)로 실행되며 GUC(app.tenant_id) 미설정이다. DEFAULT 를 먼저 붙이면
--   nullable→notnull 전환 시 current_setting 이 NULL 을 반환해 NOT NULL 위반이 발생한다.
--   따라서 [컬럼추가 → 백필 → DEFAULT → NOT NULL] 순서를 지킨다(notification 만 NOT NULL 단계 있음).
-- DEFAULT 식은 NULLIF(current_setting('app.tenant_id', true), '')::bigint
--   — 런타임 INSERT 시 트랜잭션-로컬 GUC 값을 자동으로 채운다(애플리케이션은 tenant_id 를 명시하지 않음).

-- ============================================================
-- 1) notification (표준 NOT NULL — 상수 tenant_id = 1)
-- ============================================================
ALTER TABLE notification ADD COLUMN tenant_id BIGINT;

UPDATE notification SET tenant_id = 1 WHERE tenant_id IS NULL;

ALTER TABLE notification ALTER COLUMN tenant_id SET DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint;
ALTER TABLE notification ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE notification ADD CONSTRAINT fk_notification_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id);
CREATE INDEX idx_notification_tenant ON notification(tenant_id);

-- ============================================================
-- 2) audit_log (NULLABLE 변형 — NOT NULL 단계 없음, 상수 tenant_id = 1 백필)
-- ============================================================
-- ★ audit_log.tenant_id 는 절대 NOT NULL 로 만들지 않는다.
--   로그인/가입/로그아웃 감사 기록은 테넌트 선택 *전*(TenantContext=null, GUC 미설정)에 일어난다.
--   NOT NULL 이면 이런 인증/시스템 감사 INSERT 가 NULL 위반으로 실패 → 로그인 자체가 깨진다.
--   따라서 nullable 로 두고, 요청 컨텍스트가 있으면 DEFAULT(GUC)가 채우고 없으면 NULL 로 기록된다.
ALTER TABLE audit_log ADD COLUMN tenant_id BIGINT;

UPDATE audit_log SET tenant_id = 1 WHERE tenant_id IS NULL;   -- 기존 행은 단일테넌트 시절

ALTER TABLE audit_log ALTER COLUMN tenant_id SET DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint;
-- (NOT NULL 설정하지 않음 — 위 주석 참조)
ALTER TABLE audit_log ADD CONSTRAINT fk_audit_log_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id);
CREATE INDEX idx_audit_log_tenant ON audit_log(tenant_id);
