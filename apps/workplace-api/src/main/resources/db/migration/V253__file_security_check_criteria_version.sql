-- V253__file_security_check_criteria_version.sql
-- WP-1283: 보안 점검 판정 기준이 바뀌었다(글꼴 CSS·data: 이미지·눌러야 열리는 링크·문서 안 모달은 「낮음」).
--   criteria_version : DONE 결과를 낸 판정 기준 판(FileSecurityCheckRepository.CRITERIA_VERSION). NULL 은 WP-1262 첫 기준(1판)이다.
-- 지금 판보다 낮은 DONE 결과는 화면에 「기준이 바뀌었어요」로 보이고, 「다시 점검」 요청 때 PENDING 으로 되돌려 새 기준으로 다시 본다.
-- 칸 추가만이라 옛 버전 코드(이 칸을 모름)와 함께 돌아도 된다(롤링 배포 호환).
ALTER TABLE file_security_check ADD COLUMN criteria_version SMALLINT;
