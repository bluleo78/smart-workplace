-- WP-433: 추출에 실패해 굳은 한글(HWP5, .hwp) 파일을 한 번 다시 추출 대기열에 넣는다(데이터 전용 — 스키마 변경 없음).
--
-- 왜: 워커가 레거시 형식을 LibreOffice(soffice)로 텍스트화하던 시절, LibreOffice 내장 필터가 HWP5 를 열지 못해 .hwp 는
--   추출 실패(extract-error:)나 빈 텍스트(empty / empty-text:)로 SKIPPED 에 종결됐다. 이제 워커가 converter(rhwp) 로 추출하므로
--   그 행들을 PENDING 으로 되돌려 FileExtractionScheduler 가 다시 줍게 한다(SKIPPED 는 findResumable 이 다시 줍지 않는다).
-- 대상: file.mime_type = 'application/x-hwp' 이고 file_extraction.status = 'SKIPPED' 인 행 중 아래 둘의 합집합.
--   (1) ExtractionReasons.classify 가 EXTRACTION_ERROR 또는 EMPTY 로 분류하는 사유 — 즉 oversize·image:·non-extractable:·
--       unsupported-mime: 가 아닌 모든 사유(부정형으로 classify 를 그대로 따른다):
--       - extract-error:… (WP-242 이후 추출 실패), empty / empty-text:… (빈 텍스트), error NULL.
--       - 접두 없는 옛 워커 예외 메시지 — #735(2026-07-25)~WP-242(2026-10-05) 사이엔 실패가 접두 없이 저장됐다
--         (예: 'soffice 변환 실패 rc=N', 'soffice 변환 타임아웃(60s)', 'soffice 산출물 없음', blob 다운로드 실패 등).
--   (2) 추가로 unsupported-mime:application/x-hwp — classify 상으론 UNSUPPORTED 지만, #735 이전엔 HWP 를 추출하지 않아
--       한 번도 추출되지 않은 행이라 함께 되돌린다.
-- 제외와 이유:
--   - file.category = 'MAIL_EXTRACT' — 메일 첨부 평문 사본은 추출 확정 직후 바이너리를 지운다(WP-358). 재추출하면 FileNotFound 로
--     사유만 덮어쓴다. category 가 NULL 인 레거시 행은 대상에 포함한다(IS DISTINCT FROM).
--   - oversize·image:·non-extractable:·(HWP 가 아닌) unsupported-mime: — 변환기와 무관하게 다시 돌려도 같은 결과.
--   - status FAILED — DB 의 FAILED 는 요약 상한 소진 전용이라 텍스트는 이미 있었다. TEXT_READY·DONE 도 마찬가지.
--   - HWPX(application/hwp+zip) — 원래 ZIP/XML 파싱이라 LibreOffice 를 타지 않았다.
-- RLS: file_extraction 은 FORCE RLS 이지만 Flyway 유저는 superuser(BYPASSRLS)라 GUC 없이 전 테넌트 행을 갱신한다(V112·V136·V174 선례).
-- 운영 주의:
--   - 배포 순서 converter → worker → api. 이 마이그레이션을 가진 api 가 먼저 나가면 구 LibreOffice 워커가 재큐 행을 전부 다시
--     실패시키고 일회성 마이그레이션이 소모된다.
--   - 재큐 행은 스케줄러가 틱(3분)당 resume-batch-size(기본 50, FULL 먼저)씩 소진한다.
--   - profile FULL(드라이브) 행은 추출 뒤 LLM 요약까지 다시 탄다 — 비용 = 대상 FULL 건수 × 요약 1회.
-- 멱등: 되돌린 행은 PENDING 이라 다시 실행해도 WHERE 에 걸리지 않는다.
UPDATE file_extraction fe
SET status = 'PENDING', error = NULL, attempts = 0, leased_until = NULL
FROM file f
WHERE fe.file_id = f.id
  AND f.mime_type = 'application/x-hwp'
  AND f.category IS DISTINCT FROM 'MAIL_EXTRACT'
  AND fe.status = 'SKIPPED'
  AND (
    fe.error IS NULL
    OR NOT (
      fe.error = 'oversize'
      OR fe.error LIKE 'image:%'
      OR fe.error LIKE 'non-extractable:%'
      OR (fe.error LIKE 'unsupported-mime:%' AND fe.error <> 'unsupported-mime:application/x-hwp')
    )
  );
