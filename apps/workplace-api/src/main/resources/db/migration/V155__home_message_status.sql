-- WP-190: 메인 AI 채팅 답변의 종결 상태. 정지·타임아웃(STOPPED)·오류(FAILED)로 끝난 부분 답변을 저장하고 화면에 "중단됨"을 표시한다.
-- 롤링 배포 호환(expand): 상수 DEFAULT 와 함께 추가 → 구 코드 insert(컬럼 미지정)가 막히지 않고, PG11+ 는 테이블을 재작성하지 않는다.
ALTER TABLE home_message ADD COLUMN status VARCHAR(16) NOT NULL DEFAULT 'COMPLETE';
