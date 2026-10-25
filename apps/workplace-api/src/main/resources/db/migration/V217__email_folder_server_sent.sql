-- V217 — WP-950: 서버 보낸편지함 동기화 — 외부 메일 클라이언트(웹메일·Outlook)에서 보낸 메일도 앱 보낸편지함에 보이게 한다.
-- server_sent: 서버의 보낸편지함을 그대로 동기화하는 폴더 행 표시. 이름은 서버 폴더 이름(IMAP 「Sent」·「Sent Items」 등,
--   Graph 는 sentitems)이라, 본문·첨부·읽음 반영이 폴더 이름으로 서버 폴더를 그대로 연다. 앱이 보낸 기록은 지금처럼 'SENT' 행.
-- 기본값 false 의 NOT NULL 추가라 구 버전 앱은 새 컬럼을 모를 뿐 그대로 동작한다(롤링 배포 안전).
ALTER TABLE email_folder ADD COLUMN server_sent BOOLEAN NOT NULL DEFAULT false;

-- 보낸편지함 목록에서 앱이 보낸 행과 같은 서버 사본을 Message-ID 로 가린다 — 꺾쇠 유무(IMAP 은 벗기고 Graph 는 둠)를 무시한 식으로 찾는다.
CREATE INDEX idx_email_message_account_msgid
    ON email_message (account_id, btrim(message_id, '<>'))
    WHERE message_id IS NOT NULL;
