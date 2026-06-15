-- 개인 위키 스페이스 표시명을 "내 위키" → "내 노트" 로 통일(사용자 노출 용어를 '노트'로 변경).
-- 자동 생성 기본값만 대상(이름이 정확히 '내 위키' 인 PERSONAL 스페이스). 사용자가 바꾼 이름은 보존.
UPDATE wiki_space
SET name = '내 노트'
WHERE type = 'PERSONAL'
  AND name = '내 위키';
