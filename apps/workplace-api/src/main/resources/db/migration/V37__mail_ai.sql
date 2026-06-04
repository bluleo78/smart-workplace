-- 메일 AI 비서(#71): 계정별 옵트인 + 메시지별 분류/요약 캐시.
ALTER TABLE email_account
  ADD COLUMN ai_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE email_message
  ADD COLUMN ai_category      varchar(32),  -- 업무|개인|알림|프로모션|뉴스레터, null=미분류
  ADD COLUMN ai_needs_reply   boolean,      -- null=미분류
  ADD COLUMN ai_summary       text,         -- 요약 캐시, null=미생성
  ADD COLUMN ai_summarized_at timestamptz;  -- 요약 캐시 생성 시각
