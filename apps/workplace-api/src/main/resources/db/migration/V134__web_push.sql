-- V134: Web Push — 기기별 구독, 사용자 알림 종류 설정, 서버 VAPID 키.
-- 세 테이블 모두 글로벌(비-RLS): 한 기기가 여러 테넌트 알림을 받고(membership 과 같은 성격),
-- 발송 경로는 수신자 기준으로 테넌트와 무관하게 구독을 조회한다. app_tenant 권한은 V44 DEFAULT PRIVILEGES 로 자동.

-- 기기별 푸시 구독. endpoint 는 브라우저 푸시 서비스가 발급한 고유 URL — 같은 브라우저 재등록 시 소유자 이전.
CREATE TABLE push_subscription (
  id               BIGSERIAL   PRIMARY KEY,
  user_id          BIGINT      NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  endpoint         TEXT        NOT NULL UNIQUE,
  p256dh           TEXT        NOT NULL,   -- 브라우저 공개키(base64url, 65바이트 비압축점)
  auth             TEXT        NOT NULL,   -- 인증 비밀(base64url, 16바이트)
  user_agent       VARCHAR(512),
  failure_count    INT         NOT NULL DEFAULT 0,  -- 연속 일시 실패 수(5 이상이면 삭제)
  last_success_at  TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_push_subscription_user ON push_subscription(user_id);

-- 사용자 단위 알림 종류 설정. 행이 없으면 켜짐(enabled=true)으로 간주한다.
CREATE TABLE notification_preference (
  user_id   BIGINT      NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  category  VARCHAR(32) NOT NULL,   -- DM | MENTION | ISSUE | CALENDAR
  enabled   BOOLEAN     NOT NULL,
  PRIMARY KEY (user_id, category),
  CONSTRAINT notification_preference_category_check
    CHECK (category IN ('DM', 'MENTION', 'ISSUE', 'CALENDAR'))
);

-- 서버당 VAPID 키 1쌍(id=1 고정). 교체하면 기존 구독이 모두 무효가 되므로 한 번 생성 후 유지한다.
CREATE TABLE push_vapid_key (
  id               SMALLINT    PRIMARY KEY CHECK (id = 1),
  public_key       TEXT        NOT NULL,   -- base64url 65바이트 비압축점
  private_key_enc  TEXT        NOT NULL,   -- EncryptionService 로 암호화한 base64url 32바이트 스칼라
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
