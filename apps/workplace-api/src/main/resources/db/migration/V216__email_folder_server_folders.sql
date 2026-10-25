-- V216: 서버 메일함 목록(WP-960) — email_folder 에 서버 폴더 표시·계층·안 읽은 수·폴더별 동기화 경계 컬럼을 더한다.
--
-- 메일 앱 사이드바가 서버(IMAP·M365 Graph)의 「보관」과 사용자가 만든 메일함을 트리로 보여 주려면, 동기화 때 받아 온 서버 폴더 목록을
-- 저장해 둘 곳이 필요하다. 기존 행(INBOX·SENT)은 role 이 NULL 로 남아 그대로 동작하고, 새로 저장하는 서버 폴더만 role 을 가진다.
--
-- 롤링 배포 규칙(expand-only): 모든 컬럼은 NULL 허용이거나 기본값이 있어, 아직 이 컬럼을 모르는 구버전 인스턴스의 INSERT 도 그대로 성공한다.
ALTER TABLE email_folder
  ADD COLUMN remote_id        TEXT,                            -- 서버 식별자: Graph 폴더 id, IMAP 은 전체 경로
  ADD COLUMN display_name     VARCHAR(255),                    -- 표시 이름(IMAP 마지막 경로 조각 / Graph displayName)
  ADD COLUMN parent_id        BIGINT REFERENCES email_folder(id) ON DELETE SET NULL, -- 보이는 부모 폴더(없으면 최상위)
  ADD COLUMN role             VARCHAR(16),                     -- 'ARCHIVE' | 'USER' (기존 INBOX·SENT 행은 NULL)
  ADD COLUMN selectable       BOOLEAN NOT NULL DEFAULT TRUE,   -- IMAP \Noselect(메일을 담지 못하는 묶음 폴더)면 false
  ADD COLUMN server_unread    INT,                             -- 서버가 알려 준 안 읽은 메일 수
  ADD COLUMN server_total     INT,                             -- 서버가 알려 준 전체 메일 수
  ADD COLUMN listed_at        TIMESTAMPTZ,                     -- 마지막으로 서버 목록에서 본 시각
  ADD COLUMN synced_since     TIMESTAMPTZ,                     -- 이 폴더를 가져온 가장 오래된 수신일 경계(NULL=아직 안 가져옴)
  ADD COLUMN folder_synced_at TIMESTAMPTZ;                     -- 이 폴더 메일을 마지막으로 가져온 시각

-- role 은 서버 폴더 두 가지만 허용한다(시스템 폴더는 저장하지 않는다).
ALTER TABLE email_folder
  ADD CONSTRAINT ck_email_folder_role CHECK (role IS NULL OR role IN ('ARCHIVE', 'USER'));

-- 부모 폴더 삭제 시 ON DELETE SET NULL 이 자식을 빠르게 찾도록.
CREATE INDEX idx_email_folder_parent ON email_folder(parent_id);
