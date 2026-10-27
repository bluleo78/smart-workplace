-- WP-1011: 프로젝트의 연결된 저장소 — AI 가 이 프로젝트의 이슈를 처리할 때 clone 해 쓰는 코드 저장소 주소와 기본 브랜치.
-- 둘 다 비워 둘 수 있다(개발이 아닌 프로젝트). 칸 추가만이라 구 코드와 함께 돌아도 문제없다(롤링 배포 호환).
ALTER TABLE project ADD COLUMN repository_url VARCHAR(500);
ALTER TABLE project ADD COLUMN repository_branch VARCHAR(100);
