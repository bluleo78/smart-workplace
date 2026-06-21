-- V81: 드라이브 버전 관리(#79)
-- 같은 폴더·같은 이름 재업로드를 중복 행이 아닌 "버전"으로 쌓는다.
-- 버전 체인은 drive 도메인에 둔다(file core 불변 유지, refcount 미도입).

-- 1) 버전 테이블 — 각 버전이 자체 file(blob) 1개를 소유(공유 없음 → refcount 불필요)
CREATE TABLE drive_file_version (
  id            BIGSERIAL    PRIMARY KEY,
  drive_file_id BIGINT       NOT NULL REFERENCES drive_file(id) ON DELETE CASCADE,
  version_no    INT          NOT NULL,                    -- drive_file 내 1부터 증가
  file_id       BIGINT       NOT NULL REFERENCES file(id),-- 이 버전의 blob
  size_bytes    BIGINT       NOT NULL,                    -- 쿼터/표시용(file.size_bytes 복사)
  uploaded_by   BIGINT       NOT NULL REFERENCES "user"(id),
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  comment       VARCHAR(500),                             -- 시스템 자동 코멘트(예: "v2에서 복원")
  tenant_id     BIGINT       NOT NULL
                  DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint
                  REFERENCES tenant(id),
  CONSTRAINT uq_drive_file_version_no UNIQUE (drive_file_id, version_no)
);
CREATE INDEX idx_drive_file_version_file   ON drive_file_version(drive_file_id, version_no);
CREATE INDEX idx_drive_file_version_tenant ON drive_file_version(tenant_id);

-- 2) drive_file 에 버전 개수(비정규화) — 목록 v{n} 뱃지용
ALTER TABLE drive_file ADD COLUMN version_count INT NOT NULL DEFAULT 1;

-- 3) 기존 데이터 마이그레이션: 활성(trashed_at IS NULL) drive_file 의 blob 을 버전으로 백필하고,
--    같은 그룹의 동명 중복을 가장 이른 행(정본)으로 병합한다.
--    그룹 키: (tenant_id, space_id, COALESCE(folder_id,0), name). space_id 는 전역 유일이라 사실상 테넌트 내 유일.
-- 3a) 각 활성행에 그룹 내 순번(created_at,id 오름차순) 부여 후, 정본(rn=1)에 버전으로 적재
WITH ranked AS (
  SELECT df.id, df.file_id, df.tenant_id, df.created_at,
         df.space_id, COALESCE(df.folder_id, 0) AS fkey, df.name,
         f.size_bytes, f.uploaded_by,
         ROW_NUMBER() OVER (PARTITION BY df.tenant_id, df.space_id, COALESCE(df.folder_id,0), df.name
                            ORDER BY df.created_at, df.id) AS rn
  FROM drive_file df
  JOIN file f ON f.id = df.file_id
  WHERE df.trashed_at IS NULL
),
canon AS (
  SELECT id, tenant_id, space_id, fkey, name FROM ranked WHERE rn = 1
),
mapped AS (
  SELECT r.rn, r.file_id, r.size_bytes, r.uploaded_by, r.created_at, r.tenant_id, c.id AS canonical_id
  FROM ranked r
  JOIN canon c ON c.tenant_id = r.tenant_id AND c.space_id = r.space_id
              AND c.fkey = r.fkey AND c.name = r.name
)
INSERT INTO drive_file_version (drive_file_id, version_no, file_id, size_bytes, uploaded_by, created_at, tenant_id)
SELECT canonical_id, rn, file_id, size_bytes, uploaded_by, created_at, tenant_id
FROM mapped;

-- 3a-2) 휴지통 파일도 v1 백필(병합 대상 아님 — 복원 후 이력 일관성 보장)
INSERT INTO drive_file_version (drive_file_id, version_no, file_id, size_bytes, uploaded_by, created_at, tenant_id)
SELECT df.id, 1, df.file_id, f.size_bytes, f.uploaded_by, df.created_at, df.tenant_id
FROM drive_file df
JOIN file f ON f.id = df.file_id
WHERE df.trashed_at IS NOT NULL;

-- 3b) 정본의 현재 포인터 = 그룹 최신 버전 blob, version_count = 버전 수
--     (휴지통 파일도 agg 에 포함되어 version_count=1 로 정합)
WITH agg AS (
  SELECT drive_file_id, MAX(version_no) AS vmax, COUNT(*) AS cnt
  FROM drive_file_version
  GROUP BY drive_file_id
),
latest AS (
  SELECT dfv.drive_file_id, dfv.file_id
  FROM drive_file_version dfv
  JOIN agg ON agg.drive_file_id = dfv.drive_file_id AND agg.vmax = dfv.version_no
)
UPDATE drive_file df
SET file_id = latest.file_id, version_count = agg.cnt
FROM agg
JOIN latest ON latest.drive_file_id = agg.drive_file_id
WHERE df.id = agg.drive_file_id;

-- 3c) 흡수된 비정본(같은 그룹에 더 이른 행이 있는) 활성 중복 행 삭제 → 정본만 남김
--     (해당 행의 share_link/file_ref 는 ON DELETE CASCADE 로 함께 정리됨 — 일회성 정리)
DELETE FROM drive_file df
USING (
  SELECT df2.id
  FROM drive_file df2
  WHERE df2.trashed_at IS NULL
    AND EXISTS (
      SELECT 1 FROM drive_file other
      WHERE other.tenant_id = df2.tenant_id
        AND other.space_id = df2.space_id
        AND COALESCE(other.folder_id, 0) = COALESCE(df2.folder_id, 0)
        AND other.name = df2.name
        AND other.trashed_at IS NULL
        AND (other.created_at < df2.created_at
             OR (other.created_at = df2.created_at AND other.id < df2.id))
    )
) dup
WHERE df.id = dup.id;

-- 4) 병합·백필 이후 활성 동명 유일 보장(V36 폴더 제약과 동형). space_id 가 테넌트 내포.
CREATE UNIQUE INDEX uq_drive_file_active_name
  ON drive_file (space_id, COALESCE(folder_id, 0), name)
  WHERE trashed_at IS NULL;

-- 5) RLS(V53/V78 패턴)
ALTER TABLE drive_file_version ENABLE ROW LEVEL SECURITY;
ALTER TABLE drive_file_version FORCE  ROW LEVEL SECURITY;
CREATE POLICY drive_file_version_tenant_isolation ON drive_file_version
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);
GRANT SELECT, INSERT, UPDATE, DELETE ON drive_file_version TO app_tenant;
GRANT USAGE, SELECT ON SEQUENCE drive_file_version_id_seq TO app_tenant;
