-- WP-149: 메일 AI 처리를 ③ 원본 분석(원본별 1회, 객관)과 ④ 개인 분석(사본별 1회, "나" 기준)으로 나눈다.
--
-- email_content(원본 공유):
--   auto_generated     — ② 본문 적재 시 헤더(List-Unsubscribe·List-Id·Precedence·Auto-Submitted·X-Auto-Response-Suppress)로
--                        판정한 대량·자동 발송 여부. 헤더 원문은 저장하지 않는다.
--   ai_summary_skipped — ③ 이 요약을 생략했음(짧은 본문·자동 발송). 시도 여부는 기존 ai_summarized_at 이 그대로 기록한다.
-- email_message(사본, 사람별):
--   ai_needs_reply_raw          — ④ LLM 원결과. ⑤ 규칙 재계산(③ 이 늦게 끝날 때)의 입력. ai_needs_reply 는 ⑤ 최종값으로 의미 유지.
--   ai_analyzed_at              — ④ 시도 시각(실패 시 미기록 → 다음 백필 대상).
--   ai_personal_summary_skipped — ④ 가 개인 요약을 생략했음("AI 요약" 버튼 노출 근거).
--
-- 기존 행은 백필하지 않는다 — raw 가 NULL 인 기존 사본은 ⑤ 재계산 대상이 아니고, 재분석은 WP-151 이 계정별로 1회 수행한다.
ALTER TABLE email_content
    ADD COLUMN auto_generated     BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN ai_summary_skipped BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE email_message
    ADD COLUMN ai_needs_reply_raw          BOOLEAN,
    ADD COLUMN ai_analyzed_at              TIMESTAMPTZ,
    ADD COLUMN ai_personal_summary_skipped BOOLEAN NOT NULL DEFAULT FALSE;
