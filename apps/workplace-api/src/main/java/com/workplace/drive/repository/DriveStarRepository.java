package com.workplace.drive.repository;

import static com.workplace.jooq.Tables.DRIVE_FILE;
import static com.workplace.jooq.Tables.DRIVE_FOLDER;
import static com.workplace.jooq.Tables.DRIVE_SPACE;
import static com.workplace.jooq.Tables.DRIVE_STAR;
import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.USER;

import com.workplace.file.storage.FileStore;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Collection;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.jooq.Condition;
import org.jooq.DSLContext;
import org.jooq.Field;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Repository;

/**
 * 드라이브 「별표」(drive_star, WP-1698) 접근 — 사람마다 파일·폴더에 단 별표를 넣고, 빼고, 내 목록을 읽는다. 늘 호출자 user id 로만 다룬다(남의
 * 별표는 읽지도 지우지도 않는다). 모든 메서드는 워크스페이스 RLS 컨텍스트·트랜잭션 안에서 부른다(FORCE RLS).
 *
 * <p>별표는 권한을 주지 않는다 — 목록은 읽을 때마다 공간 실효 멤버 여부({@link DriveSpaceMembership})와 휴지통을 SQL 안에서 다시 거른다.
 * 그래서 구성원에서 빠지거나 휴지통에 가도 행은 남고, 다시 볼 수 있게 되면 목록에 돌아온다.
 */
@Repository
@RequiredArgsConstructor
public class DriveStarRepository {
  private final DSLContext dsl;

  /**
   * 파일 행의 원본 유무(available) 계산 — 공간 폴더 목록({@link DriveFileRepository})과 같은 FileStore 존재 확인을 써서 「별표」
   * 목록도 원본 유실 파일을 같은 기준으로 알린다.
   */
  private final FileStore fileStore;

  /** 공간 주인 — 남의 개인 공간은 저장된 이름이 「내 드라이브」라 주인 이름으로 바꿔 보인다. */
  private static final com.workplace.jooq.tables.User SPACE_OWNER = USER.as("dst_owner");

  /**
   * 별표를 넣는다(멱등). 이미 있으면 아무것도 하지 않는다 — 부분 유일 인덱스(사람·대상) 충돌을 ON CONFLICT DO NOTHING 으로 받아 동시에 두 번 눌러도
   * 행은 하나다. 대상을 볼 수 있는지는 서비스가 먼저 판정한다.
   *
   * @param folder true 면 targetId 는 폴더 id, false 면 드라이브 파일 id
   */
  public void star(long userId, boolean folder, long targetId) {
    // 충돌 대상을 적지 않는다 — 부분 유일 인덱스를 대상으로 고르려면 WHERE 술어까지 적어야 하는데, 이 표의 유일 제약은 그 둘(사람·파일, 사람·폴더)과
    // 시퀀스 PK 뿐이라 대상 없는 DO NOTHING 이 같은 뜻이다.
    dsl.insertInto(DRIVE_STAR)
        .set(DRIVE_STAR.USER_ID, userId)
        .set(folder ? DRIVE_STAR.DRIVE_FOLDER_ID : DRIVE_STAR.DRIVE_FILE_ID, targetId)
        .onConflictDoNothing()
        .execute();
  }

  /** 별표를 뺀다 — 내 행만 지운다. 없어도 조용히 끝난다(멱등). */
  public void unstar(long userId, boolean folder, long targetId) {
    dsl.deleteFrom(DRIVE_STAR)
        .where(DRIVE_STAR.USER_ID.eq(userId))
        .and((folder ? DRIVE_STAR.DRIVE_FOLDER_ID : DRIVE_STAR.DRIVE_FILE_ID).eq(targetId))
        .execute();
  }

  /**
   * 주어진 파일·폴더 중 내가 별표한 것 — 공간 폴더 목록 행마다 「별표함」을 붙일 때 한 번에 묻는다(행마다 묻지 않는다, N+1 금지). 빈 입력이면 조회하지 않는다.
   */
  public Starred starredAmong(
      long userId, Collection<Long> driveFileIds, Collection<Long> folderIds) {
    if (driveFileIds.isEmpty() && folderIds.isEmpty()) {
      return new Starred(Set.of(), Set.of());
    }
    Set<Long> files = new HashSet<>();
    Set<Long> folders = new HashSet<>();
    dsl.select(DRIVE_STAR.DRIVE_FILE_ID, DRIVE_STAR.DRIVE_FOLDER_ID)
        .from(DRIVE_STAR)
        .where(DRIVE_STAR.USER_ID.eq(userId))
        .and(DRIVE_STAR.DRIVE_FILE_ID.in(driveFileIds).or(DRIVE_STAR.DRIVE_FOLDER_ID.in(folderIds)))
        .forEach(
            r -> {
              if (r.value1() != null) files.add(r.value1());
              if (r.value2() != null) folders.add(r.value2());
            });
    return new Starred(files, folders);
  }

  /** 별표한 파일 id·폴더 id 묶음. */
  public record Starred(Set<Long> fileIds, Set<Long> folderIds) {}

  /** 키셋 커서 — 앞 페이지 마지막 행의 (별표한 시각, 별표 id). 정렬(created_at desc, id desc)과 같은 쌍이다. */
  public record Cursor(OffsetDateTime starredAt, long starId) {}

  /**
   * 내 목록 한 줄 — 화면 칸과 경로 계산(parentFolderId)에 쓰는 값. folder 면 mimeType·sizeBytes·fileId·category 가
   * null 이고 folderCount·fileCount 를 채운다(파일이면 둘 다 null). versionCount·available(원본 파일이 저장소에 있는지)은
   * 파일만 채우고 폴더면 null. spaceType·spaceOwnerId·spaceOwnerName 은 개인 공간 이름 표시용.
   */
  public record StarRow(
      long starId,
      boolean folder,
      long itemId,
      String name,
      String mimeType,
      Long sizeBytes,
      Long fileId,
      String category,
      Integer versionCount,
      Boolean available,
      Integer folderCount,
      Integer fileCount,
      Long parentFolderId,
      long spaceId,
      String spaceType,
      String spaceName,
      Long spaceOwnerId,
      String spaceOwnerName,
      OffsetDateTime updatedAt,
      OffsetDateTime starredAt) {}

  /**
   * 내 별표 목록 한 페이지 — 별표한 순(created_at desc, id desc), cursor 다음부터 limit 개. 지금 볼 수 있는 항목만 낸다:
   *
   * <ul>
   *   <li>그 공간의 실효 멤버(직접 행 또는 멤버 부서, {@link DriveSpaceMembership#spaceIdsOf}) — 공간 화면 권한과 같은 규칙 하나를
   *       쓴다. 내가 멤버인 공간 id 는 바깥 행을 참조하지 않는 부분 질의라 한 번만 계산된다(행마다 부서 재귀 질의를 다시 돌리지 않는다).
   *   <li>항목 자신이 휴지통에 없음 — 폴더를 휴지통에 보내면 하위 폴더·파일에도 trashed_at 이 찍히므로({@link
   *       DriveFolderRepository#markSubtreeTrashed}) 항목 자신만 보면 된다.
   * </ul>
   *
   * 영구 삭제·공간 삭제는 CASCADE 로 별표 행이 함께 지워진다. 다른 워크스페이스 행은 RLS 가 막는다. 더 있는지는 호출자가 limit+1 로 확인한다.
   */
  public List<StarRow> listForUser(long userId, Cursor cursor, int limit) {
    Field<String> name = DSL.coalesce(DRIVE_FILE.NAME, DRIVE_FOLDER.NAME).as("item_name");
    Field<Long> parentFolderId =
        DSL.coalesce(DRIVE_FILE.FOLDER_ID, DRIVE_FOLDER.PARENT_ID).as("parent_folder_id");
    Field<OffsetDateTime> updatedAt =
        DSL.coalesce(DRIVE_FILE.UPDATED_AT, DRIVE_FOLDER.UPDATED_AT).as("item_updated_at");
    // 폴더 행만 센다 — 바로 아래 살아 있는(휴지통 아님) 항목 수. 파일 행은 null.
    Condition folderRow = DRIVE_STAR.DRIVE_FOLDER_ID.isNotNull();
    Field<Integer> folderCount =
        DriveChildCounts.liveFolders(folderRow, DRIVE_STAR.DRIVE_FOLDER_ID).as("folder_count");
    Field<Integer> fileCount =
        DriveChildCounts.liveFiles(folderRow, DRIVE_STAR.DRIVE_FOLDER_ID).as("file_count");
    return dsl.select(
            DRIVE_STAR.ID,
            DRIVE_STAR.DRIVE_FOLDER_ID,
            DRIVE_STAR.DRIVE_FILE_ID,
            name,
            FILE.MIME_TYPE,
            FILE.SIZE_BYTES,
            DRIVE_FILE.FILE_ID,
            FILE.CATEGORY,
            DRIVE_FILE.VERSION_COUNT,
            FILE.STORAGE_PATH,
            folderCount,
            fileCount,
            parentFolderId,
            DRIVE_SPACE.ID,
            DRIVE_SPACE.TYPE,
            DRIVE_SPACE.NAME,
            DRIVE_SPACE.OWNER_ID,
            SPACE_OWNER.NAME,
            updatedAt,
            DRIVE_STAR.CREATED_AT)
        .from(DRIVE_STAR)
        .leftJoin(DRIVE_FILE)
        .on(DRIVE_FILE.ID.eq(DRIVE_STAR.DRIVE_FILE_ID))
        .leftJoin(FILE)
        .on(FILE.ID.eq(DRIVE_FILE.FILE_ID))
        .leftJoin(DRIVE_FOLDER)
        .on(DRIVE_FOLDER.ID.eq(DRIVE_STAR.DRIVE_FOLDER_ID))
        .join(DRIVE_SPACE)
        .on(DRIVE_SPACE.ID.eq(DSL.coalesce(DRIVE_FILE.SPACE_ID, DRIVE_FOLDER.SPACE_ID)))
        .leftJoin(SPACE_OWNER)
        .on(SPACE_OWNER.ID.eq(DRIVE_SPACE.OWNER_ID))
        .where(DRIVE_STAR.USER_ID.eq(userId))
        // 대상은 정확히 하나(V302 CHECK)라 둘 중 있는 쪽의 휴지통만 본다.
        .and(DSL.coalesce(DRIVE_FILE.TRASHED_AT, DRIVE_FOLDER.TRASHED_AT).isNull())
        .and(DRIVE_SPACE.ID.in(DriveSpaceMembership.spaceIdsOf(DSL.val(userId))))
        .and(after(cursor))
        .orderBy(DRIVE_STAR.CREATED_AT.desc(), DRIVE_STAR.ID.desc())
        .limit(limit)
        .fetch(
            r -> {
              boolean folder = r.get(DRIVE_STAR.DRIVE_FOLDER_ID) != null;
              return new StarRow(
                  r.get(DRIVE_STAR.ID),
                  folder,
                  folder ? r.get(DRIVE_STAR.DRIVE_FOLDER_ID) : r.get(DRIVE_STAR.DRIVE_FILE_ID),
                  r.get(name),
                  r.get(FILE.MIME_TYPE),
                  r.get(FILE.SIZE_BYTES),
                  r.get(DRIVE_FILE.FILE_ID),
                  r.get(FILE.CATEGORY),
                  // 폴더 행은 drive_file left join 이 비어 이미 null 이다.
                  r.get(DRIVE_FILE.VERSION_COUNT),
                  // 원본 유무는 공간 폴더 목록과 같은 FileStore 확인 — 한 페이지(최대 51행)만큼만 디스크를 본다.
                  folder ? null : fileStore.exists(r.get(FILE.STORAGE_PATH)),
                  r.get(folderCount),
                  r.get(fileCount),
                  r.get(parentFolderId),
                  r.get(DRIVE_SPACE.ID),
                  r.get(DRIVE_SPACE.TYPE),
                  r.get(DRIVE_SPACE.NAME),
                  r.get(DRIVE_SPACE.OWNER_ID),
                  r.get(SPACE_OWNER.NAME),
                  r.get(updatedAt),
                  r.get(DRIVE_STAR.CREATED_AT));
            });
  }

  /**
   * 커서 「다음」 행 조건 — (시각 &lt; 커서) 또는 (시각 = 커서 이고 id &lt; 커서 id). 같은 시각에 별표한 행이 여럿이어도 id 로 끊어 빠지거나 겹치지
   * 않는다. 첫 페이지(cursor null)는 조건 없음.
   */
  private static Condition after(Cursor cursor) {
    if (cursor == null) return DSL.noCondition();
    OffsetDateTime t = cursor.starredAt().withOffsetSameInstant(ZoneOffset.UTC);
    return DRIVE_STAR
        .CREATED_AT
        .lt(t)
        .or(DRIVE_STAR.CREATED_AT.eq(t).and(DRIVE_STAR.ID.lt(cursor.starId())));
  }
}
