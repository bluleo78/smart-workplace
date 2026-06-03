-- V34: file 에 썸네일 blob 경로 추가. IMAGE 카테고리 업로드 시에만 채워진다(nullable).
-- 원본 blob 과 동일 디렉터리에 thumb_{uuid}.png 로 저장. 원본 만료 정리 시 함께 삭제.
-- (병렬 contacts 워크트리가 V33 선점 → V34 사용. 머지 시 번호 재정렬 가능.)
ALTER TABLE file ADD COLUMN thumbnail_path VARCHAR(500);
