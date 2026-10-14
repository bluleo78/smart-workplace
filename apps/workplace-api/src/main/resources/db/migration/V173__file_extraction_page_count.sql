-- WP-250: PDF 총 페이지 수. 추출 콜백이 알려 주는 값을 저장한다.
-- 왜: 스캔 PDF 는 글자가 없어 SKIPPED 로 끝나지만, 페이지 수를 알아야 AI 가 "N쪽짜리 문서" 임을 알고 페이지 이미지를 요청할 수 있다.
-- PDF 가 아니거나 워커가 아직 알리지 못한 행(배포 전 추출분)은 NULL — 이미지 보기 요청 때 워커가 알려 주면 그때 채운다.
ALTER TABLE file_extraction ADD COLUMN page_count INT NULL;
