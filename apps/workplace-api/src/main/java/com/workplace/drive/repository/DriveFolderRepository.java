package com.workplace.drive.repository;

import static com.workplace.jooq.Tables.DRIVE_FILE;
import static com.workplace.jooq.Tables.DRIVE_FOLDER;

import com.workplace.drive.dto.DriveFolderResponse;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.List;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.jooq.Condition;
import org.jooq.DSLContext;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Repository;

/** drive_folder 접근. */
@Repository
@RequiredArgsConstructor
public class DriveFolderRepository {
  private final DSLContext dsl;

  public long insert(long spaceId, Long parentId, String name) {
    return dsl.insertInto(DRIVE_FOLDER)
        .set(DRIVE_FOLDER.SPACE_ID, spaceId)
        .set(DRIVE_FOLDER.PARENT_ID, parentId)
        .set(DRIVE_FOLDER.NAME, name)
        .returning(DRIVE_FOLDER.ID)
        .fetchOne()
        .getId();
  }

  public boolean existsInSpace(long spaceId, Long parentId, String name) {
    Condition parentCond =
        parentId == null ? DRIVE_FOLDER.PARENT_ID.isNull() : DRIVE_FOLDER.PARENT_ID.eq(parentId);
    return dsl.fetchExists(
        dsl.selectOne()
            .from(DRIVE_FOLDER)
            .where(DRIVE_FOLDER.SPACE_ID.eq(spaceId))
            .and(parentCond)
            .and(DRIVE_FOLDER.NAME.eq(name)));
  }

  public Optional<Long> findSpaceId(long folderId) {
    return dsl.select(DRIVE_FOLDER.SPACE_ID)
        .from(DRIVE_FOLDER)
        .where(DRIVE_FOLDER.ID.eq(folderId))
        .fetchOptional(DRIVE_FOLDER.SPACE_ID);
  }

  public Optional<DriveFolderResponse> findById(long folderId) {
    return dsl.select(
            DRIVE_FOLDER.ID, DRIVE_FOLDER.PARENT_ID, DRIVE_FOLDER.NAME, DRIVE_FOLDER.CREATED_AT)
        .from(DRIVE_FOLDER)
        .where(DRIVE_FOLDER.ID.eq(folderId))
        .fetchOptional(
            r ->
                new DriveFolderResponse(
                    r.get(DRIVE_FOLDER.ID),
                    r.get(DRIVE_FOLDER.PARENT_ID),
                    r.get(DRIVE_FOLDER.NAME),
                    r.get(DRIVE_FOLDER.CREATED_AT)));
  }

  public void rename(long folderId, String name) {
    dsl.update(DRIVE_FOLDER)
        .set(DRIVE_FOLDER.NAME, name)
        .set(DRIVE_FOLDER.UPDATED_AT, DSL.currentOffsetDateTime())
        .where(DRIVE_FOLDER.ID.eq(folderId))
        .execute();
  }

  public void delete(long folderId) {
    // 하위 폴더/파일 행은 FK ON DELETE CASCADE 로 함께 삭제됨
    dsl.deleteFrom(DRIVE_FOLDER).where(DRIVE_FOLDER.ID.eq(folderId)).execute();
  }

  public List<DriveFolderResponse> listChildFolders(long spaceId, Long parentId) {
    Condition parentCond =
        parentId == null ? DRIVE_FOLDER.PARENT_ID.isNull() : DRIVE_FOLDER.PARENT_ID.eq(parentId);
    return dsl.select(
            DRIVE_FOLDER.ID, DRIVE_FOLDER.PARENT_ID, DRIVE_FOLDER.NAME, DRIVE_FOLDER.CREATED_AT)
        .from(DRIVE_FOLDER)
        .where(DRIVE_FOLDER.SPACE_ID.eq(spaceId))
        .and(parentCond)
        .orderBy(DRIVE_FOLDER.NAME.asc())
        .fetch(
            r ->
                new DriveFolderResponse(
                    r.get(DRIVE_FOLDER.ID),
                    r.get(DRIVE_FOLDER.PARENT_ID),
                    r.get(DRIVE_FOLDER.NAME),
                    r.get(DRIVE_FOLDER.CREATED_AT)));
  }

  /**
   * 폴더 서브트리(자기 자신 포함)의 모든 drive_file.file_id — 삭제 전 FILE 만료 처리용. BFS 로 하위 폴더를 수집해 CTE 없이 안전하게 처리.
   */
  public List<Long> findFileIdsUnderFolder(long folderId) {
    List<Long> subtree = new ArrayList<>();
    Deque<Long> queue = new ArrayDeque<>();
    queue.add(folderId);
    while (!queue.isEmpty()) {
      long cur = queue.poll();
      subtree.add(cur);
      queue.addAll(
          dsl.select(DRIVE_FOLDER.ID)
              .from(DRIVE_FOLDER)
              .where(DRIVE_FOLDER.PARENT_ID.eq(cur))
              .fetch(DRIVE_FOLDER.ID));
    }
    return dsl.select(DRIVE_FILE.FILE_ID)
        .from(DRIVE_FILE)
        .where(DRIVE_FILE.FOLDER_ID.in(subtree))
        .fetch(DRIVE_FILE.FILE_ID);
  }
}
