-- V196 (WP-579): 감사 기록이 있는 AI 에이전트도 하드 삭제(UserService.deleteAgent)할 수 있게 audit_log.user_id 의 삭제 동작만 바꾼다.
-- 사유: 에이전트의 모든 행위(노트 공유 등)는 감사 행을 남기는데, audit_log.user_id 가 NO ACTION FK 라 감사 기록이 하나라도 있으면 지워지지 않았다.
--       사용자 행을 지우는 경로는 deleteAgent 하나뿐이다(사람 사용자는 하드 삭제 경로가 없다).
-- 범위: 감사 로그 하나만. 노트 스페이스 멤버십은 FK CASCADE 가 아니라 앱 경로(WikiSpaceService 의 AgentDeleted 리스너 — 마지막 OWNER 보호 WP-496 과
--       멤버 변경 알림을 그대로 탄다)로 지운다. 알림 행위자(notification.actor_id)·일정 초대자(event_attendee.invited_by_user_id)는
--       비우면 지난 알림의 행위자·AI 표시가 영구히 사라지므로 바꾸지 않는다. 일을 실제로 한 에이전트(작성자 NOT NULL FK)는 여전히 삭제가 막히고,
--       관리자 삭제(AgentRemovalService, WP-705)는 그 FK 위반이면 사용 중지로 대신한다.
-- 롤링 배포 호환: FK 의 ON DELETE 동작만 바꾼다 — 컬럼·NOT NULL·데이터는 그대로라 구 버전 코드와 공존한다.

-- 감사 로그: 행은 남기고 행위자 id 만 비운다. 감사에는 행위자 username 이 NOT NULL 문자열로 따로 남아(V3) 누가 했는지 계속 읽힌다.
-- user_id 는 처음부터 nullable(시스템 행위는 NULL)이라 NOT NULL 해제가 필요 없다.
-- NOT VALID: 같은 정의의 기존 FK 가 지금까지 모든 행을 보장해 왔으므로 다시 걸 때 전체 행 검증 스캔(감사 로그는 가장 큰 테이블 중 하나 — 그동안
-- 잠금이 길어진다)을 건너뛴다. NOT VALID 는 「기존 행 검증을 미룬다」는 뜻일 뿐, 새로 쓰는 행의 참조 검사와 ON DELETE SET NULL 동작은 곧바로 적용된다.
-- 따로 VALIDATE 하지 않는다(보장할 것이 이미 보장돼 있다). DROP·ADD 를 한 문장으로 묶어 FK 가 없는 틈이 없게 한다.
ALTER TABLE audit_log
    DROP CONSTRAINT audit_log_user_id_fkey,
    ADD CONSTRAINT audit_log_user_id_fkey
        FOREIGN KEY (user_id) REFERENCES "user"(id) ON DELETE SET NULL NOT VALID;
