-- WP-151: 회신필요 판정 기준이 바뀐 뒤(WP-149 ④·⑤) 계정별 "새 기준 재분석"을 정확히 1회 수행했는지 기록한다.
--
-- ai_classify_version — 이 계정의 최근 메일을 마지막으로 재분석한 판정 기준 버전. 0 = 아직(배포 전 기준 그대로).
--   현재 버전 상수는 MailReanalysisService.CURRENT_CLASSIFY_VERSION(=1). 스케줄러가 ai_enabled 계정 중 이 값이 낮은 계정을
--   조건부 UPDATE 로 선점(현재 버전으로 올림)한 뒤 안읽음 INBOX 최근 50건에 ④ + ⑤ 를 다시 실행한다 — 다중 인스턴스에서도 1회.
-- 기존 행·새 행 모두 0 으로 시작한다(새 계정도 1회 대상 — 새 흐름 미분석 행만 고르므로 비용은 AI 켬 백필 수준).
ALTER TABLE email_account
    ADD COLUMN ai_classify_version INT NOT NULL DEFAULT 0;
