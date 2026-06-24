-- 회신필요(ai_needs_reply) 위에 얹는 사용자 해결 마커. null=미처리.
-- AI 판정은 불변, 사용자가 처리완료하면 now() 기록. 재분류가 되돌리지 않음.
ALTER TABLE email_message ADD COLUMN needs_reply_done_at timestamptz;
