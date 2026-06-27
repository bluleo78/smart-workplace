-- V97: per-envelope 본문 적재 마커 추가
--
-- 배경:
--   email_content.body_fetched_at 은 콘텐츠 수준(message_id 단위)에서 공유 본문 적재를 표시한다.
--   같은 message_id 를 CC 등으로 수신한 두 번째 수신자 envelope 는 첫 번째 수신자의 body_fetched_at 이 설정되는 순간
--   listMissingBody / countMissingBody 에서 영구 제외된다 — 두 번째 수신자의 per-envelope 첨부(email_attachment)
--   행이 생성되지 않아 "첨부 있음" 표시는 있으나 첨부 목록이 빈다.
--
-- 해결책:
--   email_message.fetched_at: envelope 별 "이 봉투의 본문/첨부가 적재됐다" 마커.
--   본문 텍스트는 email_content 에 1벌만 저장(스토리지 중복 제거 유지)하고,
--   첨부 행은 각 envelope 마다 개별 생성(per-account 첨부 좌표 특성 반영).
--   미적재 판정 기준을 email_content.body_fetched_at → email_message.fetched_at 으로 전환한다.
--
-- 백필:
--   이미 적재가 완료된 envelope (Task5 이전 경로 포함)는 재적재를 방지하기 위해
--   content.body_fetched_at 을 envelope.fetched_at 으로 복사한다.
--   Task5 버그로 두 번째 수신자가 누락된 경우에는 content.body_fetched_at 이 이미 설정되어 있지만
--   해당 envelope 의 fetched_at 은 NULL 로 남겨 재시도를 허용한다(의도적 비백필).
--   실제로는 이 worktree 에서 Task5 적용 후 prod 데이터가 없으므로 backfill 은 기존 행 보호용이다.

ALTER TABLE email_message
    ADD COLUMN IF NOT EXISTS fetched_at TIMESTAMPTZ;

-- 이미 본문이 적재된 envelope: content.body_fetched_at 을 복사(재적재 방지)
UPDATE email_message m
SET fetched_at = c.body_fetched_at
FROM email_content c
WHERE m.content_id = c.id
  AND c.body_fetched_at IS NOT NULL;
