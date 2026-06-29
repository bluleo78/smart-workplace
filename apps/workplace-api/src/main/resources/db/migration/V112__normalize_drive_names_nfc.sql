-- Drive 이름 NFC 정규화 백필 (#552).
-- macOS(HFS+/APFS) 업로드 파일명은 NFD(자모 분해형)로 저장되어, 일반 NFC 검색어와 ILIKE 바이트 비교가 영구 미스했다.
-- 기존 행의 이름을 NFC(정준 합성형)로 일괄 정규화한다. 신규 쓰기는 애플리케이션(UnicodeNames.toNfc)이 경계에서 정규화한다.
-- normalize(text, NFC) 는 PostgreSQL 13+ 필요(로컬/프로드 pg16). 비정규형 행만 갱신해 no-op 비용을 줄인다.
-- 주: 세 테이블 모두 tenant RLS 대상이나, Flyway 유저(app)는 superuser(BYPASSRLS)라 GUC 없이 전체 행을 갱신한다.

UPDATE drive_file
   SET name = normalize(name, NFC)
 WHERE name IS NOT NULL
   AND name <> normalize(name, NFC);

UPDATE drive_folder
   SET name = normalize(name, NFC)
 WHERE name IS NOT NULL
   AND name <> normalize(name, NFC);

UPDATE file
   SET original_name = normalize(original_name, NFC)
 WHERE original_name IS NOT NULL
   AND original_name <> normalize(original_name, NFC);
