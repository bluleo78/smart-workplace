-- WP-188: 읽음 역동기화 순서 보장 + 재시도.
-- 롤링 배포 호환(expand): nullable 컬럼·상수 DEFAULT 컬럼·인덱스만 추가한다(PG11+ 는 테이블을 재작성하지 않음).

-- 1) 계정 단위 리스 — api 인스턴스가 여러 개여도 한 계정의 원본 서버 반영은 한 번에 하나만 돈다.
--    획득은 "UPDATE ... WHERE 리스 비었거나 만료" 원자 갱신, 시각 비교는 모두 DB now() 로 한다(인스턴스 간 시계 차이 무관).
--    보유자가 죽어도 만료 시각이 지나면 다른 실행이 가져간다(크래시 복구).
ALTER TABLE email_account ADD COLUMN seen_push_lease_owner VARCHAR(64);
ALTER TABLE email_account ADD COLUMN seen_push_lease_until TIMESTAMPTZ;

COMMENT ON COLUMN email_account.seen_push_lease_owner IS '읽음 역동기화 리스 보유자 토큰(디스패치 1회마다 새 UUID) — 계정 단위 직렬화 (WP-188)';
COMMENT ON COLUMN email_account.seen_push_lease_until IS '읽음 역동기화 리스 만료 시각(DB 시각) — 지나면 다른 실행이 가져갈 수 있음 (WP-188)';

-- 2) 메일 단위 재시도 백오프 — 실패 횟수와 다음 시도 시각. 사용자가 읽음 상태를 바꾸면 0 / now() 로 되돌린다.
--    seen_push_next_at 이 NULL 이면(이 마이그레이션 이전 대기 행) 바로 시도 대상이다.
ALTER TABLE email_message ADD COLUMN seen_push_attempts INT NOT NULL DEFAULT 0;
ALTER TABLE email_message ADD COLUMN seen_push_next_at TIMESTAMPTZ;

COMMENT ON COLUMN email_message.seen_push_attempts IS '읽음 역동기화 연속 실패 횟수 — 상한에 닿으면 포기하고 서버 값을 따름 (WP-188)';
COMMENT ON COLUMN email_message.seen_push_next_at IS '읽음 역동기화 다음 시도 시각(지수 백오프). NULL 이면 즉시 대상 (WP-188)';

-- 3) 재시도 배치·디스패처가 "계정의 반영 대기 행"을 찾는 부분 인덱스. 대기 행은 늘 소수라 인덱스가 작고,
--    부분 인덱스 생성은 대기 행만 담으므로 일반 CREATE INDEX 로 둔다(스캔은 1회, 쓰기 차단 시간은 짧다).
CREATE INDEX idx_email_message_seen_push_pending
  ON email_message (account_id, id)
  WHERE seen_push_pending;
