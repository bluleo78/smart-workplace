-- 드라이브 휴지통 — 소프트삭제(trashed_at) + 삭제작업 그룹(trash_op_id) + 휴지통 진입점(trash_root)
-- 삭제 1건 = 하나의 trash_op_id. 폴더 삭제 시 살아있는 서브트리 전체를 같은 op 로 마킹(최상위만 trash_root).
-- (V35 는 병렬 mail 브랜치의 email_sent 가 선점 → drive 는 V36)

ALTER TABLE drive_folder
  ADD COLUMN trashed_at  TIMESTAMPTZ,                       -- NULL = 살아있음
  ADD COLUMN trash_op_id BIGINT,                            -- 삭제 작업 그룹(복원/식별 단위)
  ADD COLUMN trash_root  BOOLEAN NOT NULL DEFAULT false;    -- 명시 삭제된 최상위 = 휴지통 목록 진입점

ALTER TABLE drive_file
  ADD COLUMN trashed_at  TIMESTAMPTZ,
  ADD COLUMN trash_op_id BIGINT,
  ADD COLUMN trash_root  BOOLEAN NOT NULL DEFAULT false;

-- 폴더명 유니크를 '살아있는 행'으로 한정 — 휴지통에 동명 폴더가 있어도 신규 생성/복원 가능
DROP INDEX uq_drive_folder_name;
CREATE UNIQUE INDEX uq_drive_folder_name
  ON drive_folder(space_id, COALESCE(parent_id, 0), name)
  WHERE trashed_at IS NULL;

-- 삭제 작업 단위 시퀀스
CREATE SEQUENCE drive_trash_op_seq;

-- 휴지통 목록/자동정리 조회용(trash_root 만)
CREATE INDEX idx_drive_folder_trash ON drive_folder(space_id, trashed_at) WHERE trash_root = true;
CREATE INDEX idx_drive_file_trash   ON drive_file(space_id, trashed_at)   WHERE trash_root = true;
