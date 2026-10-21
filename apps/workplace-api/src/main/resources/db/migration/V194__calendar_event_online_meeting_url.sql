-- 동기화된 M365 일정의 온라인 회의 참가 주소(Graph onlineMeeting.joinUrl).
-- 설명·장소에서 링크를 찾아내는 서버 판정의 1순위 근거라 별도 컬럼으로 둔다. 로컬 일정·옛 행은 NULL.
-- expand 단계: NULL 허용 컬럼 추가뿐이라 구 버전 코드와 공존해도 안전하다.
ALTER TABLE calendar_event ADD COLUMN online_meeting_url VARCHAR(2000);
