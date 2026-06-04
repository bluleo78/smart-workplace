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
            .and(DRIVE_FOLDER.NAME.eq(name))
            .and(DRIVE_FOLDER.TRASHED_AT.isNull()));
  }

  public Optional<Long> findSpaceId(long folderId) {
    return dsl.select(DRIVE_FOLDER.SPACE_ID)
        .from(DRIVE_FOLDER)
        .where(DRIVE_FOLDER.ID.eq(folderId))
        .and(DRIVE_FOLDER.TRASHED_AT.isNull())
        .fetchOptional(DRIVE_FOLDER.SPACE_ID);
  }

  public Optional<DriveFolderResponse> findById(long folderId) {
    return dsl.select(
            DRIVE_FOLDER.ID, DRIVE_FOLDER.PARENT_ID, DRIVE_FOLDER.NAME, DRIVE_FOLDER.CREATED_AT)
        .from(DRIVE_FOLDER)
        .where(DRIVE_FOLDER.ID.eq(folderId))
        .and(DRIVE_FOLDER.TRASHED_AT.isNull())
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

  /** 이동 — parent_id 변경(null = 공간 루트). */
  public void updateParent(long folderId, Long targetParentId) {
    dsl.update(DRIVE_FOLDER)
        .set(DRIVE_FOLDER.PARENT_ID, targetParentId)
        .set(DRIVE_FOLDER.UPDATED_AT, DSL.currentOffsetDateTime())
        .where(DRIVE_FOLDER.ID.eq(folderId))
        .execute();
  }

  /** 폴더 서브트리(자기 포함)를 휴지통으로 마킹. 살아있는 행만, 최상위만 trash_root=true. */
  public void markSubtreeTrashed(long rootFolderId, long opId) {
    java.util.List<Long> subtree = findSubtreeFolderIds(rootFolderId); // 자기 포함, trashed 무관 BFS
    java.time.OffsetDateTime now = java.time.OffsetDateTime.now(java.time.ZoneOffset.UTC);
    // 1) 서브트리 폴더 중 살아있는 것 마킹(trash_root=false)
    dsl.update(DRIVE_FOLDER)
        .set(DRIVE_FOLDER.TRASHED_AT, now)
        .set(DRIVE_FOLDER.TRASH_OP_ID, opId)
        .set(DRIVE_FOLDER.TRASH_ROOT, false)
        .where(DRIVE_FOLDER.ID.in(subtree))
        .and(DRIVE_FOLDER.TRASHED_AT.isNull())
        .execute();
    // 2) 최상위만 trash_root=true (방금 마킹돼 trashed_at 존재)
    dsl.update(DRIVE_FOLDER)
        .set(DRIVE_FOLDER.TRASH_ROOT, true)
        .where(DRIVE_FOLDER.ID.eq(rootFolderId))
        .execute();
    // 3) 서브트리 파일 중 살아있는 것 마킹(trash_root=false)
    dsl.update(DRIVE_FILE)
        .set(DRIVE_FILE.TRASHED_AT, now)
        .set(DRIVE_FILE.TRASH_OP_ID, opId)
        .set(DRIVE_FILE.TRASH_ROOT, false)
        .where(DRIVE_FILE.FOLDER_ID.in(subtree))
        .and(DRIVE_FILE.TRASHED_AT.isNull())
        .execute();
  }

  /** 폴더 서브트리 id(자기 자신 포함) — 이동/복사 사이클 검사용. BFS(CTE 미사용). */
  public List<Long> findSubtreeFolderIds(long folderId) {
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
    return subtree;
  }

  public List<DriveFolderResponse> listChildFolders(long spaceId, Long parentId) {
    Condition parentCond =
        parentId == null ? DRIVE_FOLDER.PARENT_ID.isNull() : DRIVE_FOLDER.PARENT_ID.eq(parentId);
    return dsl.select(
            DRIVE_FOLDER.ID, DRIVE_FOLDER.PARENT_ID, DRIVE_FOLDER.NAME, DRIVE_FOLDER.CREATED_AT)
        .from(DRIVE_FOLDER)
        .where(DRIVE_FOLDER.SPACE_ID.eq(spaceId))
        .and(parentCond)
        .and(DRIVE_FOLDER.TRASHED_AT.isNull())
        .orderBy(DRIVE_FOLDER.NAME.asc())
        .fetch(
            r ->
                new DriveFolderResponse(
                    r.get(DRIVE_FOLDER.ID),
                    r.get(DRIVE_FOLDER.PARENT_ID),
                    r.get(DRIVE_FOLDER.NAME),
                    r.get(DRIVE_FOLDER.CREATED_AT)));
  }

  /** 공간 전체에서 이름에 q 를 포함(대소문자 무시)하는 폴더 — LIKE 와일드카드(%, _)는 리터럴로 이스케이프. */
  public List<DriveFolderResponse> searchByName(long spaceId, String q) {
    String pattern = "%" + DriveSearchPattern.escape(q) + "%";
    return dsl.select(
            DRIVE_FOLDER.ID, DRIVE_FOLDER.PARENT_ID, DRIVE_FOLDER.NAME, DRIVE_FOLDER.CREATED_AT)
        .from(DRIVE_FOLDER)
        .where(DRIVE_FOLDER.SPACE_ID.eq(spaceId))
        .and(DRIVE_FOLDER.NAME.likeIgnoreCase(pattern, '\\'))
        .and(DRIVE_FOLDER.TRASHED_AT.isNull())
        .orderBy(DRIVE_FOLDER.NAME.asc())
        .limit(200)
        .fetch(
            r ->
                new DriveFolderResponse(
                    r.get(DRIVE_FOLDER.ID),
                    r.get(DRIVE_FOLDER.PARENT_ID),
                    r.get(DRIVE_FOLDER.NAME),
                    r.get(DRIVE_FOLDER.CREATED_AT)));
  }

  /** 공간의 모든 폴더(경로 계산용 id→parent/name 맵 구성). */
  public List<DriveFolderResponse> listAllFolders(long spaceId) {
    return dsl.select(
            DRIVE_FOLDER.ID, DRIVE_FOLDER.PARENT_ID, DRIVE_FOLDER.NAME, DRIVE_FOLDER.CREATED_AT)
        .from(DRIVE_FOLDER)
        .where(DRIVE_FOLDER.SPACE_ID.eq(spaceId))
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
