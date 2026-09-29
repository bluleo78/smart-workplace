-- #484: 메일 요약 '시도 여부' 상태 모델 정합화(데이터 전용 — 스키마 변경 없음, jOOQ 재생성 불요).
--
-- 새 규칙: *_summarized_at 은 '요약을 시도했음'을 뜻하고, *_summary 가 NULL 이면 '시도했으나 결과 없음'이다.
-- 배치 대상 조회는 이제 *_summarized_at IS NULL 기준이다.
--
-- RLS: email_content·email_message 는 FORCE RLS 이지만 Flyway 유저는 superuser(BYPASSRLS)라
--      GUC 없이 전 테넌트 행을 갱신한다(V112 선례).
--
-- 공백 판정은 '\S'(비공백 문자) 부재로 한다 — btrim 은 공백만 제거해 탭·개행만 있는 값을 놓친다(Java isBlank 와 일치).

-- ① 과거에 저장된 빈/공백 요약 정리.
--    1b0e26c8 이전 코드는 LLM 빈 응답을 그대로 저장했고, 그 시기엔 HTML 전용 메일이 본문 폴백(#480 effectiveBody) 없이
--    빈 텍스트로 요약돼 빈 결과가 났을 가능성이 높다. summarized_at 을 유지하면 이 메일들은 영영 요약되지 않으므로
--    summarized_at 도 NULL 로 풀어 현재(수정된) 파이프라인으로 1회 재시도하게 한다. 재시도에서도 빈 결과면 새 규칙에 따라
--    summarized_at 만 기록돼 더는 재시도하지 않으므로 비용은 행당 최대 1회로 한정된다.
UPDATE email_content
SET ai_summary = NULL, ai_summarized_at = NULL
WHERE ai_summary IS NOT NULL AND ai_summary !~ '\S';

UPDATE email_message
SET ai_personal_summary = NULL, ai_personal_summarized_at = NULL
WHERE ai_personal_summary IS NOT NULL AND ai_personal_summary !~ '\S';

-- ② 불변식 보정: 요약이 있으면 summarized_at 도 있어야 한다.
--    V98 백필이 envelope 의 summarized_at 을 복사했으므로 NULL 이 섞였을 수 있다. 그런 행은 새 배치 술어
--    (summarized_at IS NULL)에 매번 선택되고, ensure* 는 요약이 있어 skip 하므로 LIMIT 슬롯만 영구 점유한다.
UPDATE email_content
SET ai_summarized_at = now()
WHERE ai_summary ~ '\S' AND ai_summarized_at IS NULL;

UPDATE email_message
SET ai_personal_summarized_at = now()
WHERE ai_personal_summary ~ '\S' AND ai_personal_summarized_at IS NULL;
