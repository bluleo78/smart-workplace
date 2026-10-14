-- WP-250: 확장자 매핑(MimeNormalizer 의 heic/heif/tif/tiff/bmp)이 생기기 전에 올라온 사진의 mime 을 바로잡는다(데이터 전용 — 스키마 변경 없음).
--
-- 왜: 브라우저가 HEIC·TIFF·BMP 를 빈 type·octet-stream 으로 보내 그대로 저장된 옛 파일은 이미지로 판정되지 않아, 추출이
--   "형식 미지원"(unsupported-mime:/non-extractable:)으로 SKIPPED 되고 AI 의 read_file·/view 가 이미지로 보지 못했다. 예전에는 API·도구가
--   저마다 파일명 확장자로 다시 판별했지만, 드라이브·메시지·노트처럼 파일명이 없는 경로는 여전히 못 봤다. 데이터를 새 업로드와 같게 맞추고 그
--   특수 처리들을 걷어 낸다.
-- 대상: mime 기본형(파라미터 뗀 값)이 octet-stream 이거나 빈 값이고, 원본 파일명 확장자가 위 다섯 가지인 file 행.
--   브라우저가 구체적인 mime 을 준 행(예: image/png 인데 이름이 a.heic)은 MimeNormalizer 처럼 그대로 둔다.
--   매핑 표는 MimeNormalizer 의 이미지 항목과 같다 — 한쪽만 고치면 드리프트.
-- 추출 행: 그 파일들이 "형식 미지원"으로 SKIPPED 된 행은 새 업로드 이미지와 같은 사유(ExtractableTypes.skipReason → 'image:<mime>',
--   상태 SKIPPED 유지 → 사유 코드 IMAGE)로 바꾼다. 다른 사유(oversize 등)는 건드리지 않는다.
-- RLS: file_extraction 은 FORCE RLS 이지만 Flyway 유저는 superuser(BYPASSRLS)라 GUC 없이 전 테넌트 행을 갱신한다(V112·V136 선례).
-- 한 문장(CTE)으로 묶어, 두 번째 UPDATE 가 이미 바뀐 mime 으로 대상을 다시 찾지 않고 첫 UPDATE 가 고친 행만 받게 한다.
WITH fixed AS (
  UPDATE file SET mime_type = CASE
    WHEN lower(original_name) LIKE '%.heic' THEN 'image/heic'
    WHEN lower(original_name) LIKE '%.heif' THEN 'image/heif'
    WHEN lower(original_name) LIKE '%.tif' OR lower(original_name) LIKE '%.tiff' THEN 'image/tiff'
    WHEN lower(original_name) LIKE '%.bmp'  THEN 'image/bmp'
  END
  WHERE lower(btrim(split_part(coalesce(mime_type, ''), ';', 1))) IN ('application/octet-stream', '')
    AND (
      lower(original_name) LIKE '%.heic'
      OR lower(original_name) LIKE '%.heif'
      OR lower(original_name) LIKE '%.tif'
      OR lower(original_name) LIKE '%.tiff'
      OR lower(original_name) LIKE '%.bmp'
    )
  RETURNING id, mime_type
)
UPDATE file_extraction fe
SET error = 'image:' || fixed.mime_type
FROM fixed
WHERE fe.file_id = fixed.id
  AND fe.status = 'SKIPPED'
  AND (fe.error LIKE 'unsupported-mime:%' OR fe.error LIKE 'non-extractable:%');
