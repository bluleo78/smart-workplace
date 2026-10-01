-- WP-151 후속: 배포 전(WP-149 이전) 기준으로 "회신필요"(true)로 판정된 채 새 흐름(④ 개인 분석)으로 다시 판정되지 않은 메일의
-- ai_needs_reply 를 NULL(판정 전)로 되돌린다.
--
-- 왜: 새 기준 재분석(MailReanalysisService)은 계정당 1회·안읽음 최근 50건만 다시 판정한다. 회신필요 배지·목록
--   (needsReplyCondition = ai_needs_reply true + 안읽음)은 안읽음 INBOX 전체를 세므로, 50건보다 오래된 옛 판정 true 가 그대로 남아
--   집계를 부풀렸다(운영 사례: 회신필요 300건 중 299건이 옛 판정).
-- 대상: ai_analyzed_at IS NULL(새 흐름 미분석 — 새 흐름은 ⑤ 최종값을 분석된 사본에만 쓰므로 이 조건의 값은 전부 옛 기준) AND
--   ai_needs_reply IS TRUE. 옛 false 는 집계에 영향이 없어 건드리지 않는다(NULL 로 바꾸면 백필 대상이 되어 LLM 호출만 늘어난다).
-- 영향: NULL 이 된 안읽음 행은 ④ 백필(listRecentUnreadUnanalyzedIds, 동기화마다 최근 20건)이 새 기준으로 점진 판정한다.
--   읽은 행은 열람 시 온디맨드로 판정된다. 홈 우선순위(user_priority_item)는 스케줄러가 재계산 시 정리한다.
--   옛 false 는 재판정되지 않으므로 새 기준에서 놓친 회신필요가 있을 수 있다(비용 대비 의도된 트레이드오프).
--   AI 를 끈 계정의 행도 함께 지운다 — 옛 기준 판정이라 남길 가치가 없고, AI 를 다시 켜면 백필·재분석이 새 기준으로 채운다.
UPDATE email_message
SET ai_needs_reply = NULL
WHERE ai_analyzed_at IS NULL
  AND ai_needs_reply IS TRUE;
