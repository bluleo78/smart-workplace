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
import org.jooq.impl.DSL;
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
        dsl.select(DRIVE_FILE.ID, DRIVE_FILE.SPACE_ID, DRIVE_FILE.FILE_ID, DRIVE_FILE.NAME)
            .from(DRIVE_FILE)
            .where(DRIVE_FILE.ID.eq(driveFileId))
            .and(DRIVE_FILE.TRASHED_AT.isNull())
            .fetchOne();
    return r == null
        ? Optional.empty()
        : Optional.of(
            new DriveFileRow(
                r.get(DRIVE_FILE.ID),
                r.get(DRIVE_FILE.SPACE_ID),
                r.get(DRIVE_FILE.FILE_ID),
                r.get(DRIVE_FILE.NAME)));
  }

  public void delete(long driveFileId) {
    dsl.deleteFrom(DRIVE_FILE).where(DRIVE_FILE.ID.eq(driveFileId)).execute();
  }

  /** 파일을 휴지통으로(soft). 살아있을 때만 마킹, trash_root=true(leaf). */
  public void markTrashed(long driveFileId, long opId) {
    dsl.update(DRIVE_FILE)
        .set(DRIVE_FILE.TRASHED_AT, OffsetDateTime.now(ZoneOffset.UTC))
        .set(DRIVE_FILE.TRASH_OP_ID, opId)
        .set(DRIVE_FILE.TRASH_ROOT, true)
        .where(DRIVE_FILE.ID.eq(driveFileId))
        .and(DRIVE_FILE.TRASHED_AT.isNull())
        .execute();
  }

  /** 이동 — 소속 폴더 변경(null = 공간 루트). */
  public void updateFolder(long driveFileId, Long targetFolderId) {
    dsl.update(DRIVE_FILE)
        .set(DRIVE_FILE.FOLDER_ID, targetFolderId)
        .set(DRIVE_FILE.UPDATED_AT, DSL.currentOffsetDateTime())
        .where(DRIVE_FILE.ID.eq(driveFileId))
        .execute();
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
        .and(DRIVE_FILE.TRASHED_AT.isNull())
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

  /** 공간 전체에서 이름에 q 를 포함(대소문자 무시)하는 파일 — LIKE 와일드카드(%, _)는 리터럴로 이스케이프. */
  public List<DriveFileResponse> searchByName(long spaceId, String q) {
    String pattern = "%" + DriveSearchPattern.escape(q) + "%";
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
        .and(DRIVE_FILE.NAME.likeIgnoreCase(pattern, '\\'))
        .and(DRIVE_FILE.TRASHED_AT.isNull())
        .orderBy(DRIVE_FILE.NAME.asc())
        .limit(200)
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

  /** 공간 휴지통의 파일 trash_root 항목. */
  public List<TrashRow> listTrashedFiles(long spaceId) {
    return dsl.select(
            DRIVE_FILE.ID,
            DRIVE_FILE.NAME,
            DRIVE_FILE.FOLDER_ID,
            DRIVE_FILE.TRASHED_AT,
            FILE.SIZE_BYTES)
        .from(DRIVE_FILE)
        .join(FILE)
        .on(FILE.ID.eq(DRIVE_FILE.FILE_ID))
        .where(DRIVE_FILE.SPACE_ID.eq(spaceId))
        .and(DRIVE_FILE.TRASH_ROOT.isTrue())
        .and(DRIVE_FILE.TRASHED_AT.isNotNull())
        .orderBy(DRIVE_FILE.TRASHED_AT.desc())
        .fetch(
            r ->
                new TrashRow(
                    r.get(DRIVE_FILE.ID),
                    r.get(DRIVE_FILE.NAME),
                    r.get(DRIVE_FILE.FOLDER_ID),
                    r.get(DRIVE_FILE.TRASHED_AT),
                    r.get(FILE.SIZE_BYTES)));
  }

  /** 휴지통 파일 행. folderId = 원래 폴더(null=루트). */
  public record TrashRow(
      long id, String name, Long folderId, java.time.OffsetDateTime trashedAt, Long sizeBytes) {}

  /** 내부 행 표현(권한 검증·다운로드·복사용). */
  public record DriveFileRow(long id, long spaceId, long fileId, String name) {}

  /** op 단위 파일 복원. */
  public void restoreByOp(long opId) {
    dsl.update(DRIVE_FILE)
        .setNull(DRIVE_FILE.TRASHED_AT)
        .setNull(DRIVE_FILE.TRASH_OP_ID)
        .set(DRIVE_FILE.TRASH_ROOT, false)
        .where(DRIVE_FILE.TRASH_OP_ID.eq(opId))
        .execute();
  }

  /** trash_root 파일 메타. */
  public java.util.Optional<TrashRootMeta> findTrashRoot(long driveFileId) {
    var r =
        dsl.select(
                DRIVE_FILE.SPACE_ID, DRIVE_FILE.FOLDER_ID, DRIVE_FILE.TRASH_OP_ID, DRIVE_FILE.NAME)
            .from(DRIVE_FILE)
            .where(DRIVE_FILE.ID.eq(driveFileId))
            .and(DRIVE_FILE.TRASH_ROOT.isTrue())
            .and(DRIVE_FILE.TRASHED_AT.isNotNull())
            .fetchOne();
    return r == null
        ? java.util.Optional.empty()
        : java.util.Optional.of(
            new TrashRootMeta(
                r.get(DRIVE_FILE.SPACE_ID),
                r.get(DRIVE_FILE.FOLDER_ID),
                r.get(DRIVE_FILE.TRASH_OP_ID),
                r.get(DRIVE_FILE.NAME)));
  }

  /** 복원 시 폴더 보정(루트로). */
  public void setFolderToRoot(long driveFileId) {
    dsl.update(DRIVE_FILE)
        .setNull(DRIVE_FILE.FOLDER_ID)
        .where(DRIVE_FILE.ID.eq(driveFileId))
        .execute();
  }

  /** 공간의 trashed 파일 전체 file_id(비우기 시 blob 만료용). */
  public List<Long> trashedFileIds(long spaceId) {
    return dsl.select(DRIVE_FILE.FILE_ID)
        .from(DRIVE_FILE)
        .where(DRIVE_FILE.SPACE_ID.eq(spaceId))
        .and(DRIVE_FILE.TRASHED_AT.isNotNull())
        .fetch(DRIVE_FILE.FILE_ID);
  }

  /** 공간의 trashed 파일 행 전체 삭제. */
  public void deleteTrashedInSpace(long spaceId) {
    dsl.deleteFrom(DRIVE_FILE)
        .where(DRIVE_FILE.SPACE_ID.eq(spaceId))
        .and(DRIVE_FILE.TRASHED_AT.isNotNull())
        .execute();
  }

  /** 한 파일의 file_id(영구삭제 blob 만료용). */
  public java.util.Optional<Long> fileIdOf(long driveFileId) {
    return dsl.select(DRIVE_FILE.FILE_ID)
        .from(DRIVE_FILE)
        .where(DRIVE_FILE.ID.eq(driveFileId))
        .fetchOptional(DRIVE_FILE.FILE_ID);
  }

  /** 복원 메타. */
  public record TrashRootMeta(long spaceId, Long folderId, long opId, String name) {}
}
