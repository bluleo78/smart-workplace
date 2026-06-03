package com.workplace.drive.repository;

import static com.workplace.jooq.Tables.DRIVE_FILE;
import static com.workplace.jooq.Tables.FILE;

import com.workplace.drive.dto.DriveFileResponse;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.jooq.Condition;
import org.jooq.DSLContext;
import org.springframework.stereotype.Repository;

/** drive_file 접근 + FILE 영구화/만료 갱신(messaging 도 FILE 을 직접 갱신하는 것과 동일 패턴). */
@Repository
@RequiredArgsConstructor
public class DriveFileRepository {
  private final DSLContext dsl;

  public long insert(long spaceId, Long folderId, long fileId, String name) {
    return dsl.insertInto(DRIVE_FILE)
        .set(DRIVE_FILE.SPACE_ID, spaceId)
        .set(DRIVE_FILE.FOLDER_ID, folderId)
        .set(DRIVE_FILE.FILE_ID, fileId)
        .set(DRIVE_FILE.NAME, name)
        .returning(DRIVE_FILE.ID)
        .fetchOne()
        .getId();
  }

  /** 업로드 직후 FILE 영구화(expires_at = null). */
  public void promoteFile(long fileId) {
    dsl.update(FILE).setNull(FILE.EXPIRES_AT).where(FILE.ID.eq(fileId)).execute();
  }

  /** 삭제 시 FILE 만료 표시 → FileCleanupService 가 바이트 정리. */
  public void expireFiles(Collection<Long> fileIds) {
    if (fileIds.isEmpty()) {
      return;
    }
    dsl.update(FILE)
        .set(FILE.EXPIRES_AT, OffsetDateTime.now(ZoneOffset.UTC))
        .where(FILE.ID.in(fileIds))
        .execute();
  }

  public Optional<DriveFileRow> findRow(long driveFileId) {
    var r =
        dsl.select(DRIVE_FILE.ID, DRIVE_FILE.SPACE_ID, DRIVE_FILE.FILE_ID)
            .from(DRIVE_FILE)
            .where(DRIVE_FILE.ID.eq(driveFileId))
            .fetchOne();
    return r == null
        ? Optional.empty()
        : Optional.of(
            new DriveFileRow(
                r.get(DRIVE_FILE.ID), r.get(DRIVE_FILE.SPACE_ID), r.get(DRIVE_FILE.FILE_ID)));
  }

  public void delete(long driveFileId) {
    dsl.deleteFrom(DRIVE_FILE).where(DRIVE_FILE.ID.eq(driveFileId)).execute();
  }

  public List<DriveFileResponse> listInFolder(long spaceId, Long folderId) {
    Condition folderCond =
        folderId == null ? DRIVE_FILE.FOLDER_ID.isNull() : DRIVE_FILE.FOLDER_ID.eq(folderId);
    return dsl.select(
            DRIVE_FILE.ID,
            DRIVE_FILE.FOLDER_ID,
            DRIVE_FILE.FILE_ID,
            DRIVE_FILE.NAME,
            FILE.MIME_TYPE,
            FILE.SIZE_BYTES,
            FILE.CATEGORY,
            DRIVE_FILE.CREATED_AT)
        .from(DRIVE_FILE)
        .join(FILE)
        .on(FILE.ID.eq(DRIVE_FILE.FILE_ID))
        .where(DRIVE_FILE.SPACE_ID.eq(spaceId))
        .and(folderCond)
        .orderBy(DRIVE_FILE.NAME.asc())
        .fetch(
            r ->
                new DriveFileResponse(
                    r.get(DRIVE_FILE.ID),
                    r.get(DRIVE_FILE.FOLDER_ID),
                    r.get(DRIVE_FILE.FILE_ID),
                    r.get(DRIVE_FILE.NAME),
                    r.get(FILE.MIME_TYPE),
                    r.get(FILE.SIZE_BYTES),
                    r.get(FILE.CATEGORY),
                    r.get(DRIVE_FILE.CREATED_AT)));
  }

  /** 내부 행 표현(권한 검증·다운로드용). */
  public record DriveFileRow(long id, long spaceId, long fileId) {}
}
