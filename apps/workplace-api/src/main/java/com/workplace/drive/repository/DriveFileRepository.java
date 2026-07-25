package com.workplace.drive.repository;

import static com.workplace.jooq.Tables.DRIVE_FILE;
import static com.workplace.jooq.Tables.DRIVE_FILE_VERSION;
import static com.workplace.jooq.Tables.DRIVE_SPACE;
import static com.workplace.jooq.Tables.FILE;

import com.workplace.drive.dto.DriveFileResponse;
import com.workplace.file.storage.FileStore;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.jooq.Condition;
import org.jooq.DSLContext;
import org.jooq.Record;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Repository;

/** drive_file 접근 + FILE 영구화/만료 갱신(messaging 도 FILE 을 직접 갱신하는 것과 동일 패턴). */
@Repository
@RequiredArgsConstructor
public class DriveFileRepository {
  private final DSLContext dsl;

  /** available 파생 필드 계산(원본 blob 유실 가시화, #739) — FileCleanupService 와 동일하게 FileStore 로 상대/레거시
   * 절대경로를 모두 복원해 존재 확인한다. */
  private final FileStore fileStore;

  /**
   * listInFolder/searchByName/findResponse 세 projection 이 동일하게 중복하던 DriveFileResponse 생성 로직을
   * 단일화한 매퍼(#739). 각 projection 은 FILE.STORAGE_PATH 를 반드시 select 해야 한다.
   */
  private DriveFileResponse toResponse(Record r) {
    return new DriveFileResponse(
        r.get(DRIVE_FILE.ID),
        r.get(DRIVE_FILE.FOLDER_ID),
        r.get(DRIVE_FILE.FILE_ID),
        r.get(DRIVE_FILE.NAME),
        r.get(FILE.MIME_TYPE),
        r.get(FILE.SIZE_BYTES),
        r.get(FILE.CATEGORY),
        r.get(DRIVE_FILE.CREATED_AT),
        r.get(DRIVE_FILE.VERSION_COUNT),
        fileStore.exists(r.get(FILE.STORAGE_PATH)));
  }

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

  /**
   * 새 drive_file + 초기 버전(v1) 행을 함께 생성한다(#79 불변식: 모든 live drive_file 은 ≥1 버전 행을 갖는다).
   *
   * <p>upload 신규/copy/폴더 copy 등 새 파일을 만드는 모든 경로가 이 메서드를 거쳐 invariant 를 강제한다. 각 버전이 자체 blob 1개를
   * 소유하므로 fileId 는 이 drive_file 전용 blob 이어야 한다(공유 blob 금지).
   */
  public long insertWithInitialVersion(
      long spaceId, Long folderId, long fileId, String name, long sizeBytes, long uploadedBy) {
    long driveFileId = insert(spaceId, folderId, fileId, name);
    dsl.insertInto(DRIVE_FILE_VERSION)
        .set(DRIVE_FILE_VERSION.DRIVE_FILE_ID, driveFileId)
        .set(DRIVE_FILE_VERSION.VERSION_NO, 1)
        .set(DRIVE_FILE_VERSION.FILE_ID, fileId)
        .set(DRIVE_FILE_VERSION.SIZE_BYTES, sizeBytes)
        .set(DRIVE_FILE_VERSION.UPLOADED_BY, uploadedBy)
        .execute();
    return driveFileId;
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
        dsl.select(
                DRIVE_FILE.ID,
                DRIVE_FILE.SPACE_ID,
                DRIVE_FILE.FILE_ID,
                DRIVE_FILE.NAME,
                DRIVE_FILE.FOLDER_ID)
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
                r.get(DRIVE_FILE.NAME),
                r.get(DRIVE_FILE.FOLDER_ID)));
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

  /** 동명 활성 파일 조회(자동 버전화용). folder_id NULL(루트) 명시 처리. */
  public java.util.Optional<Long> findActiveByName(long spaceId, Long folderId, String name) {
    Condition folderCond =
        folderId == null ? DRIVE_FILE.FOLDER_ID.isNull() : DRIVE_FILE.FOLDER_ID.eq(folderId);
    Long id =
        dsl.select(DRIVE_FILE.ID)
            .from(DRIVE_FILE)
            .where(DRIVE_FILE.SPACE_ID.eq(spaceId))
            .and(folderCond)
            .and(DRIVE_FILE.NAME.eq(name))
            .and(DRIVE_FILE.TRASHED_AT.isNull())
            .fetchOne(DRIVE_FILE.ID);
    return java.util.Optional.ofNullable(id);
  }

  /** 현재 버전 포인터·버전수·갱신시각 업데이트. */
  public void setCurrentVersion(long driveFileId, long fileId, int versionCount) {
    dsl.update(DRIVE_FILE)
        .set(DRIVE_FILE.FILE_ID, fileId)
        .set(DRIVE_FILE.VERSION_COUNT, versionCount)
        .set(DRIVE_FILE.UPDATED_AT, OffsetDateTime.now(ZoneOffset.UTC))
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
            DRIVE_FILE.CREATED_AT,
            DRIVE_FILE.VERSION_COUNT,
            FILE.STORAGE_PATH)
        .from(DRIVE_FILE)
        .join(FILE)
        .on(FILE.ID.eq(DRIVE_FILE.FILE_ID))
        .where(DRIVE_FILE.SPACE_ID.eq(spaceId))
        .and(folderCond)
        .and(DRIVE_FILE.TRASHED_AT.isNull())
        .orderBy(DRIVE_FILE.NAME.asc())
        .fetch(this::toResponse);
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
            DRIVE_FILE.CREATED_AT,
            DRIVE_FILE.VERSION_COUNT,
            FILE.STORAGE_PATH)
        .from(DRIVE_FILE)
        .join(FILE)
        .on(FILE.ID.eq(DRIVE_FILE.FILE_ID))
        .where(DRIVE_FILE.SPACE_ID.eq(spaceId))
        .and(DRIVE_FILE.NAME.likeIgnoreCase(pattern, '\\'))
        .and(DRIVE_FILE.TRASHED_AT.isNull())
        .orderBy(DRIVE_FILE.NAME.asc())
        .limit(200)
        .fetch(this::toResponse);
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

  /** 내부 행 표현(권한 검증·다운로드·복사·이동용). folderId=null 은 공간 루트. */
  public record DriveFileRow(long id, long spaceId, long fileId, String name, Long folderId) {}

  /** 파일 이름 변경(복원 자동 리네임 등). updated_at 갱신. */
  public void rename(long driveFileId, String name) {
    dsl.update(DRIVE_FILE)
        .set(DRIVE_FILE.NAME, name)
        .set(DRIVE_FILE.UPDATED_AT, DSL.currentOffsetDateTime())
        .where(DRIVE_FILE.ID.eq(driveFileId))
        .execute();
  }

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

  /** 공간의 모든 파일 file_id(trashed 무관) — 공간 삭제 시 blob 일괄 만료용. */
  public List<Long> allFileIdsInSpace(long spaceId) {
    return dsl.select(DRIVE_FILE.FILE_ID)
        .from(DRIVE_FILE)
        .where(DRIVE_FILE.SPACE_ID.eq(spaceId))
        .fetch(DRIVE_FILE.FILE_ID);
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

  /** cutoff 이전에 버려진 trash_root 파일 id. */
  public List<Long> expiredTrashRootFileIds(java.time.OffsetDateTime cutoff) {
    return dsl.select(DRIVE_FILE.ID)
        .from(DRIVE_FILE)
        .where(DRIVE_FILE.TRASH_ROOT.isTrue())
        .and(DRIVE_FILE.TRASHED_AT.lt(cutoff))
        .fetch(DRIVE_FILE.ID);
  }

  /** 복원 메타. */
  public record TrashRootMeta(long spaceId, Long folderId, long opId, String name) {}

  /** import 시 drive_file 이름으로 사용할 FILE.ORIGINAL_NAME 조회. */
  public String findFileOriginalName(long fileId) {
    return dsl.select(FILE.ORIGINAL_NAME)
        .from(FILE)
        .where(FILE.ID.eq(fileId))
        .fetchOne(FILE.ORIGINAL_NAME);
  }

  /** driveFileId 단건 조회 (insert 직후 응답 빌딩용). listInFolder 와 동일 컬럼 조인. */
  public java.util.Optional<DriveFileResponse> findResponse(long driveFileId) {
    return dsl.select(
            DRIVE_FILE.ID,
            DRIVE_FILE.FOLDER_ID,
            DRIVE_FILE.FILE_ID,
            DRIVE_FILE.NAME,
            FILE.MIME_TYPE,
            FILE.SIZE_BYTES,
            FILE.CATEGORY,
            DRIVE_FILE.CREATED_AT,
            DRIVE_FILE.VERSION_COUNT,
            FILE.STORAGE_PATH)
        .from(DRIVE_FILE)
        .join(FILE)
        .on(FILE.ID.eq(DRIVE_FILE.FILE_ID))
        .where(DRIVE_FILE.ID.eq(driveFileId))
        .fetchOptional(this::toResponse);
  }

  /** 링크 렌더용 메타. 휴지통(trashed) 파일도 포함하며 trashed 플래그로 가용성 표시. */
  public record LinkMeta(
      long driveFileId,
      long spaceId,
      long fileId,
      String spaceName,
      String name,
      String mimeType,
      long sizeBytes,
      boolean hasThumbnail,
      boolean trashed) {}

  /** 상태 무관(trashed 포함) 링크 렌더 메타 조회. DRIVE_FILE ⨝ DRIVE_SPACE ⨝ FILE 조인. */
  public Optional<LinkMeta> findLinkMeta(long driveFileId) {
    return dsl.select(
            DRIVE_FILE.ID,
            DRIVE_FILE.SPACE_ID,
            DRIVE_FILE.FILE_ID,
            DRIVE_SPACE.NAME,
            DRIVE_FILE.NAME,
            FILE.MIME_TYPE,
            FILE.SIZE_BYTES,
            FILE.THUMBNAIL_PATH,
            DRIVE_FILE.TRASHED_AT)
        .from(DRIVE_FILE)
        .join(DRIVE_SPACE)
        .on(DRIVE_SPACE.ID.eq(DRIVE_FILE.SPACE_ID))
        .join(FILE)
        .on(FILE.ID.eq(DRIVE_FILE.FILE_ID))
        .where(DRIVE_FILE.ID.eq(driveFileId))
        .fetchOptional(
            r ->
                new LinkMeta(
                    r.get(DRIVE_FILE.ID),
                    r.get(DRIVE_FILE.SPACE_ID),
                    r.get(DRIVE_FILE.FILE_ID),
                    r.get(DRIVE_SPACE.NAME),
                    r.get(DRIVE_FILE.NAME),
                    r.get(FILE.MIME_TYPE),
                    r.get(FILE.SIZE_BYTES),
                    r.get(FILE.THUMBNAIL_PATH) != null,
                    r.get(DRIVE_FILE.TRASHED_AT) != null));
  }
}
