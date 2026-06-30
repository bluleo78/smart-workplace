package com.workplace.drive.repository;

import static com.workplace.jooq.Tables.DRIVE_FILE_VERSION;
import static com.workplace.jooq.Tables.USER;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import org.jooq.DSLContext;
import org.springframework.stereotype.Repository;

/** 드라이브 파일 버전(#79) 영속·조회. 각 버전은 자체 file(blob) 1개를 가리킨다. */
@Repository
public class DriveFileVersionRepository {
  private final DSLContext dsl;

  public DriveFileVersionRepository(DSLContext dsl) {
    this.dsl = dsl;
  }

  /** 버전 행 적재. version_no 는 호출측에서 nextVersionNo 로 채번. */
  public long insert(
      long driveFileId,
      int versionNo,
      long fileId,
      long sizeBytes,
      long uploadedBy,
      String comment) {
    return dsl.insertInto(DRIVE_FILE_VERSION)
        .set(DRIVE_FILE_VERSION.DRIVE_FILE_ID, driveFileId)
        .set(DRIVE_FILE_VERSION.VERSION_NO, versionNo)
        .set(DRIVE_FILE_VERSION.FILE_ID, fileId)
        .set(DRIVE_FILE_VERSION.SIZE_BYTES, sizeBytes)
        .set(DRIVE_FILE_VERSION.UPLOADED_BY, uploadedBy)
        .set(DRIVE_FILE_VERSION.COMMENT, comment)
        .returning(DRIVE_FILE_VERSION.ID)
        .fetchOne()
        .getId();
  }

  /** 다음 버전 번호(max+1, 없으면 1). 업로드는 테넌트 advisory lock 으로 직렬화됨. */
  public int nextVersionNo(long driveFileId) {
    Integer max =
        dsl.select(org.jooq.impl.DSL.max(DRIVE_FILE_VERSION.VERSION_NO))
            .from(DRIVE_FILE_VERSION)
            .where(DRIVE_FILE_VERSION.DRIVE_FILE_ID.eq(driveFileId))
            .fetchOne(0, Integer.class);
    return max == null ? 1 : max + 1;
  }

  /** 버전 목록(version_no DESC), 업로더 이름 조인. current 는 서비스에서 표시. */
  public List<VersionRow> listForDriveFile(long driveFileId) {
    return dsl.select(
            DRIVE_FILE_VERSION.VERSION_NO,
            DRIVE_FILE_VERSION.FILE_ID,
            DRIVE_FILE_VERSION.SIZE_BYTES,
            DRIVE_FILE_VERSION.UPLOADED_BY,
            USER.NAME,
            DRIVE_FILE_VERSION.CREATED_AT,
            DRIVE_FILE_VERSION.COMMENT)
        .from(DRIVE_FILE_VERSION)
        .join(USER)
        .on(USER.ID.eq(DRIVE_FILE_VERSION.UPLOADED_BY))
        .where(DRIVE_FILE_VERSION.DRIVE_FILE_ID.eq(driveFileId))
        .orderBy(DRIVE_FILE_VERSION.VERSION_NO.desc())
        .fetch(
            r ->
                new VersionRow(
                    r.get(DRIVE_FILE_VERSION.VERSION_NO),
                    r.get(DRIVE_FILE_VERSION.FILE_ID),
                    r.get(DRIVE_FILE_VERSION.SIZE_BYTES),
                    r.get(DRIVE_FILE_VERSION.UPLOADED_BY),
                    r.get(USER.NAME),
                    r.get(DRIVE_FILE_VERSION.CREATED_AT),
                    r.get(DRIVE_FILE_VERSION.COMMENT)));
  }

  /** 단일 버전 조회(롤백/다운로드용). */
  public Optional<VersionRow> findVersion(long driveFileId, int versionNo) {
    var r =
        dsl.select(
                DRIVE_FILE_VERSION.VERSION_NO,
                DRIVE_FILE_VERSION.FILE_ID,
                DRIVE_FILE_VERSION.SIZE_BYTES,
                DRIVE_FILE_VERSION.UPLOADED_BY,
                USER.NAME,
                DRIVE_FILE_VERSION.CREATED_AT,
                DRIVE_FILE_VERSION.COMMENT)
            .from(DRIVE_FILE_VERSION)
            .join(USER)
            .on(USER.ID.eq(DRIVE_FILE_VERSION.UPLOADED_BY))
            .where(DRIVE_FILE_VERSION.DRIVE_FILE_ID.eq(driveFileId))
            .and(DRIVE_FILE_VERSION.VERSION_NO.eq(versionNo))
            .fetchOne();
    return r == null
        ? Optional.empty()
        : Optional.of(
            new VersionRow(
                r.get(DRIVE_FILE_VERSION.VERSION_NO),
                r.get(DRIVE_FILE_VERSION.FILE_ID),
                r.get(DRIVE_FILE_VERSION.SIZE_BYTES),
                r.get(DRIVE_FILE_VERSION.UPLOADED_BY),
                r.get(USER.NAME),
                r.get(DRIVE_FILE_VERSION.CREATED_AT),
                r.get(DRIVE_FILE_VERSION.COMMENT)));
  }

  /** drive_file 의 모든 버전 blob file_id — purge 시 일괄 만료용. */
  public List<Long> fileIdsForDriveFile(long driveFileId) {
    return dsl.select(DRIVE_FILE_VERSION.FILE_ID)
        .from(DRIVE_FILE_VERSION)
        .where(DRIVE_FILE_VERSION.DRIVE_FILE_ID.eq(driveFileId))
        .fetch(DRIVE_FILE_VERSION.FILE_ID);
  }

  /** 공간 내 모든 drive_file 의 전 버전 blob file_id — 공간 삭제 시 일괄 만료용. */
  public List<Long> fileIdsForSpace(long spaceId) {
    return dsl.select(DRIVE_FILE_VERSION.FILE_ID)
        .from(DRIVE_FILE_VERSION)
        .join(com.workplace.jooq.Tables.DRIVE_FILE)
        .on(DRIVE_FILE_VERSION.DRIVE_FILE_ID.eq(com.workplace.jooq.Tables.DRIVE_FILE.ID))
        .where(com.workplace.jooq.Tables.DRIVE_FILE.SPACE_ID.eq(spaceId))
        .fetch(DRIVE_FILE_VERSION.FILE_ID);
  }

  /** 조회 행 — current 는 서비스 레이어에서 채운다. */
  public record VersionRow(
      int versionNo,
      long fileId,
      long sizeBytes,
      long uploadedBy,
      String uploadedByName,
      OffsetDateTime createdAt,
      String comment) {}
}
