-- 슬라이스③: 미매니페스트(content_attachment_id NULL, ordinal NULL) 레거시 첨부 행의 ordinal 을 보강한다.
-- V100 백필은 content_id 있는 행만 ordinal 을 채웠다 → content_id NULL 메시지의 첨부는 ordinal NULL.
-- ordinal NULL → 다운로드 시 0 으로 처리되어 IMAP 에서 잘못된 첨부를 서빙할 수 있다(404 보다 나쁨).
-- 런타임 파생식(message_id 내 id 오름차순 0-based)과 동일하게 전 행을 보강한다.
UPDATE email_attachment ea
SET ordinal = sub.ord
FROM (
  SELECT id, (ROW_NUMBER() OVER (PARTITION BY message_id ORDER BY id) - 1) AS ord
  FROM email_attachment
) sub
WHERE ea.id = sub.id AND ea.ordinal IS NULL;
