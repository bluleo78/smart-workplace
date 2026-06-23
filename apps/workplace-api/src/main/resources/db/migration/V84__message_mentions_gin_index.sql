-- 대화 요약 위젯의 "안 읽은 멘션" 조회(message.mentions @> '[userId]') 가속용 GIN 인덱스.
-- mentions 는 JSONB 배열(user id). jsonb_path_ops 로 containment(@>) 전용 최적화.
CREATE INDEX IF NOT EXISTS idx_message_mentions_gin
  ON message USING gin (mentions jsonb_path_ops);
