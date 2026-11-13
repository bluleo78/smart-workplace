package com.workplace.drive.repository;

import static com.workplace.jooq.Tables.DRIVE_FILE;
import static com.workplace.jooq.Tables.DRIVE_FOLDER;
import static com.workplace.jooq.Tables.FILE;

import com.workplace.drive.dto.ShareFolderListing.FileItem;
import com.workplace.drive.dto.ShareFolderListing.FolderItem;
import java.time.OffsetDateTime;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Repository;

/**
 * 폴더 공유 링크의 공개 열람용 조회(WP-1538) — 자손 검사 사슬과 하위 목록·수.
 *
 * <p>RLS 는 호출 트랜잭션이 적용한다: 호출부가 링크 워크스페이스로 컨텍스트를 세우고({@code TenantContext.callAs}) 트랜잭션 안에서 불러야 한다.
 * 그래서 다른 테넌트의 폴더·파일 id 는 보이지 않아 빈 결과가 된다.
 */
@Repository
@RequiredArgsConstructor
public class DriveSharedFolderRepository {
  private final DSLContext dsl;

  /**
   * 시작 폴더에서 부모 방향으로 올라가며 공유 폴더(root)에서 멈춘 사슬(spec §5.1). 순서는 <b>공유 폴더 → 시작 폴더</b>(가장 위 행이 먼저)라 그대로
   * 경로(breadcrumb)로 쓸 수 있다.
   *
   * <p>{@code WHERE up.id <> :root} 로 공유 폴더 위는 읽지 않는다. 시작 폴더가 자손이 아니면 사슬에 root 가 없고 첫 행은 다른 폴더다 —
   * 판정은 호출부(서비스)가 한다. 휴지통 행도 그대로 돌려준다(호출부가 사슬 전체의 trashed 를 본다).
   *
   * <p>순환 데이터(WP-762 류 손상)에도 끝나야 한다. 깊이 칸이 행마다 달라 UNION 중복 제거만으로는 순환이 멈추지 않으므로, 지나온 id 배열 ({@code
   * seen})에 이미 있는 부모로는 더 올라가지 않는다.
   */
  public List<ChainRow> chainToRoot(long startFolderId, long rootFolderId) {
    return dsl.resultQuery(
            """
            WITH RECURSIVE up(id, parent_id, space_id, name, trashed_at, depth, seen) AS (
              SELECT id, parent_id, space_id, name, trashed_at, 0, ARRAY[id]
              FROM drive_folder WHERE id = ?
              UNION
              SELECT f.id, f.parent_id, f.space_id, f.name, f.trashed_at, up.depth + 1, up.seen || f.id
              FROM drive_folder f JOIN up ON f.id = up.parent_id
              WHERE up.id <> ? AND NOT f.id = ANY(up.seen)
            )
            SELECT id, parent_id, space_id, name, trashed_at FROM up ORDER BY depth DESC
            """,
            DSL.val(startFolderId),
            DSL.val(rootFolderId))
        .fetch(
            r ->
                new ChainRow(
                    r.get("id", Long.class),
                    r.get("parent_id", Long.class),
                    r.get("space_id", Long.class),
                    r.get("name", String.class),
                    r.get("trashed_at", OffsetDateTime.class) != null));
  }

  /** 바로 아래 살아 있는 폴더(이름순, 같으면 id) — 상한 limit 개. 넘침 판정은 호출부가 limit+1 로 부른다. */
  public List<FolderItem> listChildFolders(long folderId, int limit) {
    return dsl.select(DRIVE_FOLDER.ID, DRIVE_FOLDER.NAME, DRIVE_FOLDER.UPDATED_AT)
        .from(DRIVE_FOLDER)
        .where(DRIVE_FOLDER.PARENT_ID.eq(folderId))
        .and(DRIVE_FOLDER.TRASHED_AT.isNull())
        .orderBy(DRIVE_FOLDER.NAME.asc(), DRIVE_FOLDER.ID.asc())
        .limit(limit)
        .fetch(
            r ->
                new FolderItem(
                    r.get(DRIVE_FOLDER.ID),
                    r.get(DRIVE_FOLDER.NAME),
                    r.get(DRIVE_FOLDER.UPDATED_AT)));
  }

  /** 바로 아래 살아 있는 파일(이름순, 같으면 id) — 형식·크기는 core file 에서. 상한 limit 개. */
  public List<FileItem> listChildFiles(long folderId, int limit) {
    return dsl.select(
            DRIVE_FILE.ID, DRIVE_FILE.NAME, FILE.MIME_TYPE, FILE.SIZE_BYTES, DRIVE_FILE.UPDATED_AT)
        .from(DRIVE_FILE)
        .join(FILE)
        .on(FILE.ID.eq(DRIVE_FILE.FILE_ID))
        .where(DRIVE_FILE.FOLDER_ID.eq(folderId))
        .and(DRIVE_FILE.TRASHED_AT.isNull())
        .orderBy(DRIVE_FILE.NAME.asc(), DRIVE_FILE.ID.asc())
        .limit(limit)
        .fetch(
            r ->
                new FileItem(
                    r.get(DRIVE_FILE.ID),
                    r.get(DRIVE_FILE.NAME),
                    r.get(FILE.MIME_TYPE),
                    r.get(FILE.SIZE_BYTES),
                    r.get(DRIVE_FILE.UPDATED_AT)));
  }

  /**
   * 바로 아래 살아 있는 폴더·파일 수(P5) — 서브트리 전체가 아니다(큰 트리에서 비싸다). 두 수를 스칼라 서브쿼리 두 개로 한 번에 읽어 왕복을 한 번으로 줄인다.
   */
  public Counts countChildren(long folderId) {
    var folders =
        DSL.selectCount()
            .from(DRIVE_FOLDER)
            .where(DRIVE_FOLDER.PARENT_ID.eq(folderId))
            .and(DRIVE_FOLDER.TRASHED_AT.isNull())
            .<Integer>asField("folder_count");
    var files =
        DSL.selectCount()
            .from(DRIVE_FILE)
            .where(DRIVE_FILE.FOLDER_ID.eq(folderId))
            .and(DRIVE_FILE.TRASHED_AT.isNull())
            .<Integer>asField("file_count");
    return dsl.select(folders, files).fetchSingle(r -> new Counts(r.value1(), r.value2()));
  }

  /** 자손 사슬 한 행. trashed = 휴지통에 있음. */
  public record ChainRow(long id, Long parentId, long spaceId, String name, boolean trashed) {}

  /** 바로 아래 항목 수. */
  public record Counts(int folderCount, int fileCount) {}
}
