-- V300: 메일 휴지통 보기·되살리기(WP-1681) — 서버 휴지통을 email_folder 역할 'TRASH' 행으로 저장하고, 휴지통으로 옮긴 메일이 원래 있던
-- 메일함을 email_message.original_folder_id 에 남긴다(되살리기 대상).
--
-- 롤링 배포 판단(expand-only):
--  * CHECK 를 넓히는 것은 완화라 기존 행이 모두 통과한다. 옛 서버는 role 을 문자열로만 읽고(FolderRole.valueOf 없음) 옛 웹은 ARCHIVE·USER 만
--    고르므로 'TRASH' 행을 읽어도 실패하지 않는다.
--  * 옛 서버의 목록 반영(MailFolderService.apply)은 자기 목록에 없는 역할 행을 지운다 — 롤링 중 옛 인스턴스가 새 휴지통 행과 그 메일을 지울 수
--    있다. 실패는 아니고 새 인스턴스의 다음 목록 갱신·휴지통 동기화가 다시 만든다(그 몇 분 사이 휴지통으로 옮긴 메일의 첨부·AI 판정만 잃을 수 있음 —
--    받아들인다).
--  * original_folder_id 는 NULL 허용 새 열이라 옛 인스턴스의 INSERT 가 그대로 성공한다.

-- role 에 휴지통을 더한다(DROP + ADD — 같은 이름으로 다시 만든다).
ALTER TABLE email_folder DROP CONSTRAINT ck_email_folder_role;
ALTER TABLE email_folder
  ADD CONSTRAINT ck_email_folder_role CHECK (role IS NULL OR role IN ('ARCHIVE', 'USER', 'TRASH'));

-- 휴지통은 계정당 하나 — 「삭제」가 옮길 곳·휴지통 보기 대상이 하나로 정해지게.
CREATE UNIQUE INDEX uq_email_folder_trash ON email_folder(account_id) WHERE role = 'TRASH';

-- 휴지통으로 옮기기 전 메일함(되살리기 대상). 원래 메일함 행이 지워지면 NULL — 되살리기는 받은편지함으로 간다.
ALTER TABLE email_message
  ADD COLUMN original_folder_id BIGINT NULL REFERENCES email_folder(id) ON DELETE SET NULL;

-- 메일함 행을 지울 때 FK 동작(ON DELETE SET NULL)이 email_message 전체를 훑지 않게 한다(WP-1681). 값이 있는 행(휴지통 메일)만 담는 부분 인덱스.
CREATE INDEX idx_email_message_original_folder ON email_message(original_folder_id)
  WHERE original_folder_id IS NOT NULL;
