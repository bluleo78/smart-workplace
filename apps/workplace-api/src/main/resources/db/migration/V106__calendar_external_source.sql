-- M365 등 외부 공급자 일정 동기화를 위한 출처 표시(#501).
-- calendar 는 범용 테이블이므로 컬럼명은 공급자 중립. 공급자 종류는 external_account_id→email_account.provider 로 식별.

-- 외부 달력 컨테이너 표시: 어느 메일 계정의 어느 공급자측 달력에서 왔는지.
ALTER TABLE calendar ADD COLUMN external_account_id BIGINT REFERENCES email_account(id) ON DELETE CASCADE; -- NULL=로컬 캘린더
ALTER TABLE calendar ADD COLUMN external_id VARCHAR(500);  -- 공급자측 달력 id
ALTER TABLE calendar ADD COLUMN is_read_only BOOLEAN NOT NULL DEFAULT FALSE; -- 외부 동기화 컨테이너는 사용자 편집·삭제 불가

-- (계정, 공급자측 달력) 유일 → 컨테이너 idempotent upsert. 로컬 캘린더(NULL)는 제약 제외.
CREATE UNIQUE INDEX uq_calendar_external ON calendar(external_account_id, external_id)
  WHERE external_account_id IS NOT NULL;

-- 일정의 공급자측 식별자(occurrence id 포함). 같은 달력 내 멱등 upsert 키.
ALTER TABLE calendar_event ADD COLUMN external_id VARCHAR(500);
CREATE UNIQUE INDEX uq_event_external ON calendar_event(calendar_id, external_id)
  WHERE external_id IS NOT NULL;
