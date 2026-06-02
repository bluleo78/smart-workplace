-- V25: messaging 메시지 멘션. chat_message.mentions 와 동일 패턴(JSONB long[]).
-- 멘션된 user.id 배열을 JSONB 로 저장 — 파싱은 MentionParser, 검증/hydrate 는 UserMentionHydrator(공용).
ALTER TABLE message ADD COLUMN mentions JSONB NOT NULL DEFAULT '[]';
