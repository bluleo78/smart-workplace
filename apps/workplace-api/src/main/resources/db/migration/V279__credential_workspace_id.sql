-- V279 (WP-1496): 워크스페이스를 정하지 않고 만든 Anthropic 키는 요청마다 anthropic-workspace-id 헤더가 있어야 동작한다.
-- 그 워크스페이스 ID(선택)를 연결(ai_agent_credential)과 AI 계정(agent_account)에 함께 저장한다.
--   - 비밀값이 아니라 평문 컬럼이다(토큰 암호문과 따로). 키 정체성(fingerprint)은 토큰만으로 그대로 둔다.
--   - 워크스페이스 ID 는 키 종류(sk-ant-usr·api·oat)와 상관없이 모든 Claude 토큰에 선택이다 — 넣지 않으면 NULL. 기존 행도 NULL.
-- 롤링 배포 호환(expand): nullable 컬럼 추가만 — 옛 코드의 insert·select 는 이 컬럼을 몰라도 그대로 동작한다.

ALTER TABLE ai_agent_credential ADD COLUMN workspace_id VARCHAR(128);
ALTER TABLE agent_account ADD COLUMN workspace_id VARCHAR(128);
