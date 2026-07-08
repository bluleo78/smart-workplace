-- V123: calendar_event 에 iCalUId(공급자 표준 미팅 식별자) 저장 컬럼 추가.
-- 목적: 같은 미팅이 "내 동기화 사본" + "주최자 크로스가시성 초대 사본"으로 중복 표시되는 것을
--       조회(list) 시점에 (ical_uid, starts_at) 로 그룹핑해 제거하기 위한 dedup 키.
-- nullable: 순수 로컬 이벤트는 NULL, 외부 동기화 이벤트만 값 존재. 데이터 백필 불필요(동기화가 채움).
ALTER TABLE calendar_event ADD COLUMN ical_uid VARCHAR(500);
