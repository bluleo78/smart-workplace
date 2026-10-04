-- WP-232: 메인 AI 채팅 세션 누적 요약. 토큰 예산을 넘친 앞부분 대화를 요약으로 대체하기 위해 세션에 저장한다.
-- summary_upto_message_id: 이 id 이하의 home_message 는 context_summary 에 반영됨(이후 메시지만 원문으로 전달).
-- expand 단계 — 기존 행·구버전 앱과 호환되도록 nullable.
ALTER TABLE home_session ADD COLUMN context_summary TEXT;
ALTER TABLE home_session ADD COLUMN summary_upto_message_id BIGINT;
