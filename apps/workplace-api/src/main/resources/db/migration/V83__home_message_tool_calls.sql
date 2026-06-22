-- home_message 에 AI 도구 호출/위임 단계(steps)를 저장하는 JSONB 컬럼.
-- ASSISTANT 메시지에만 채워지며, [{kind:'delegation',label} | {kind:'tool',seq,toolName,args,status}] 형태.
-- widgets 컬럼과 동일하게 nullable — 도구 호출이 없는 응답은 NULL.
ALTER TABLE home_message ADD COLUMN tool_calls JSONB;
