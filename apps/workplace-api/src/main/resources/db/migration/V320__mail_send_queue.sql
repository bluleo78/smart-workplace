-- WP-1786: 메일 보낼 대기열 + 10초 되돌리기. 보내기를 누르면 임시저장 행(mail_draft)이 곧바로 보내지 않고 send_at 까지
-- 「대기」 상태로 남는다 — 그 사이 취소(되돌리기)하면 행이 그대로 임시저장으로 돌아오고, 때가 되면 스케줄러가 집어 보낸다.
-- 왜 임시저장 행을 재사용하나: 대기 중에도 수신자·본문·첨부(정션)·전달 원본이 이미 이 행에 있어 별도 큐 표가 필요 없다.
-- 열만 더하는 expand 변경이라 구 파드에 영향이 없다(새 열은 모두 NULL 허용 또는 기본값).
--   send_state: NULL = 일반 임시보관 / QUEUED = 보낼 시각 대기 / SENDING = 스케줄러가 집어 발송 중 / FAILED = 발송 실패(임시저장으로 보임)
ALTER TABLE mail_draft
  ADD COLUMN send_at              TIMESTAMPTZ,
  ADD COLUMN send_state           VARCHAR(8) CHECK (send_state IN ('QUEUED','SENDING','FAILED')),
  ADD COLUMN send_error           TEXT,
  ADD COLUMN sending_started_at   TIMESTAMPTZ,
  -- 예약 발송(true)과 즉시 보내기 후 되돌리기 대기(false)를 가려 완료 알림 문구를 다르게 한다.
  ADD COLUMN sent_by_schedule     BOOLEAN NOT NULL DEFAULT false,
  -- 발송 때 필요한데 임시저장에는 없던 값 — 스케줄러가 요청 없이 이 행만으로 보낼 수 있게 담아 둔다.
  ADD COLUMN body_text            TEXT,
  ADD COLUMN in_reply_to_message_id BIGINT,
  ADD COLUMN inline_images        JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN inline_uploads       JSONB NOT NULL DEFAULT '[]';

-- 스케줄러가 때가 된 대기 행을 send_at 순으로 집는다 / 오래 SENDING 에 머문 행(프로세스 중단)을 찾는다 — 해당 행만 담는 부분 인덱스.
CREATE INDEX idx_mail_draft_queued ON mail_draft(send_at) WHERE send_state = 'QUEUED';
CREATE INDEX idx_mail_draft_sending ON mail_draft(sending_started_at) WHERE send_state = 'SENDING';

-- 발송 완료·실패 알림이 어느 임시저장에서 나왔는지 가리킨다. 임시저장은 지워질 수 있어 FK 를 두지 않는다.
ALTER TABLE notification ADD COLUMN mail_draft_id BIGINT;
-- 메일 발송 실패 알림(MAIL_SEND_FAILED)의 변형 — true 면 발송 중 멈춰 결과를 모르는 「보냈는지 확인하지 못함」, false 면 「메일을 보내지 못함」.
-- 다른 유형은 늘 false. 기본값이 있어 구 파드의 insert 에 영향이 없다.
ALTER TABLE notification ADD COLUMN mail_send_unknown BOOLEAN NOT NULL DEFAULT false;
