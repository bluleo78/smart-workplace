-- 에이전트 자격증명에 프로바이더 축 추가. 기존 행은 전부 anthropic (OAuth 구독 토큰).
-- encrypted_token 해석은 provider 가 결정: anthropic=토큰 원문, opencode=provider config JSON.
-- PostgreSQL 에서는 NOT NULL 제약이 있는 신규 컬럼 추가 시 DEFAULT 가 필수. 먼저 DEFAULT 와 함께 추가 후 NOT NULL 제약 추가.
ALTER TABLE ai_agent_credential ADD COLUMN provider VARCHAR(32) DEFAULT 'anthropic';
ALTER TABLE ai_agent_credential ALTER COLUMN provider SET NOT NULL;
