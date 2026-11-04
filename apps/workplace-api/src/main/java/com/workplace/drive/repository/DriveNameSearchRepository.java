package com.workplace.drive.repository;

import static com.workplace.jooq.Tables.DRIVE_FILE;
import static com.workplace.jooq.Tables.DRIVE_FOLDER;
import static com.workplace.jooq.Tables.DRIVE_SPACE;
import static com.workplace.jooq.Tables.FILE;

import java.util.List;
import org.jooq.DSLContext;
import org.jooq.Field;
import org.jooq.impl.DSL;
import org.jooq.impl.SQLDataType;
import org.springframework.stereotype.Repository;

/**
 * 호출자가 (실효) 멤버인 모든 공간에 걸친 드라이브 이름 검색(WP-1353, 통합 검색 팔레트). 공간 하나만 보는 {@code searchByName}(폴더·파일
 * 리포지토리)과 같은 규칙 — 이름 ILIKE(와일드카드 이스케이프)·휴지통 제외(폴더를 휴지통에 보내면 하위 항목도 같은 시각에 휴지통 표시가 붙어 자연히 빠진다) — 을
 * 폴더와 파일 UNION 한 번으로 돌리고, 폴더 먼저·이름·id 순으로 정렬해 offset 페이지를 이어 받는다. RLS 가 테넌트를 스코프한다.
 */
@Repository
public class DriveNameSearchRepository {

  /** 정렬용 종류 순번 — 폴더 0, 파일 1(폴더 먼저). */
  private static final Field<Integer> KIND = DSL.field(DSL.name("k"), Integer.class);

  private static final Field<Long> ID = DSL.field(DSL.name("id"), Long.class);
  private static final Field<Long> SPACE_ID = DSL.field(DSL.name("space_id"), Long.class);
  private static final Field<String> SPACE_NAME = DSL.field(DSL.name("space_name"), String.class);
  private static final Field<Long> FOLDER_ID = DSL.field(DSL.name("folder_id"), Long.class);
  private static final Field<String> NAME = DSL.field(DSL.name("name"), String.class);
  private static final Field<String> MIME = DSL.field(DSL.name("mime_type"), String.class);

  private final DSLContext dsl;

  public DriveNameSearchRepository(DSLContext dsl) {
    this.dsl = dsl;
  }

  /**
   * 검색 결과 한 행. folder=true 면 폴더(folderId 는 부모, mimeType 은 null), 아니면 파일(folderId 는 들어 있는 폴더). 루트
   * 직속이면 folderId 는 null.
   */
  public record NameRow(
      boolean folder,
      long id,
      long spaceId,
      String spaceName,
      Long folderId,
      String name,
      String mimeType) {}

  /**
   * 이름에 q 를 포함하는 폴더·파일을 limit 건 읽는다(호출자가 hasMore 판정을 위해 size+1 을 넘긴다).
   *
   * @param callerId 실효 멤버인 공간({@link DriveSpaceMembership#spaceIdsOf})만 대상
   * @param q 이미 trim·정규화된 검색어(와일드카드는 여기서 이스케이프)
   */
  public List<NameRow> search(long callerId, String q, int limit, int offset) {
    String pattern = "%" + DriveSearchPattern.escape(q) + "%";
    var spaces = DriveSpaceMembership.spaceIdsOf(DSL.val(callerId));

    var folders =
        dsl.select(
                DSL.inline(0).as(KIND.getName()),
                DRIVE_FOLDER.ID.as(ID.getName()),
                DRIVE_FOLDER.SPACE_ID.as(SPACE_ID.getName()),
                DRIVE_SPACE.NAME.as(SPACE_NAME.getName()),
                DRIVE_FOLDER.PARENT_ID.as(FOLDER_ID.getName()),
                DRIVE_FOLDER.NAME.as(NAME.getName()),
                DSL.castNull(SQLDataType.VARCHAR).as(MIME.getName()))
            .from(DRIVE_FOLDER)
            .join(DRIVE_SPACE)
            .on(DRIVE_SPACE.ID.eq(DRIVE_FOLDER.SPACE_ID))
            .where(DRIVE_FOLDER.SPACE_ID.in(spaces))
            .and(DRIVE_FOLDER.NAME.likeIgnoreCase(pattern, '\\'))
            .and(DRIVE_FOLDER.TRASHED_AT.isNull());
    var files =
        dsl.select(
                DSL.inline(1).as(KIND.getName()),
                DRIVE_FILE.ID.as(ID.getName()),
                DRIVE_FILE.SPACE_ID.as(SPACE_ID.getName()),
                DRIVE_SPACE.NAME.as(SPACE_NAME.getName()),
                DRIVE_FILE.FOLDER_ID.as(FOLDER_ID.getName()),
                DRIVE_FILE.NAME.as(NAME.getName()),
                FILE.MIME_TYPE.as(MIME.getName()))
            .from(DRIVE_FILE)
            .join(FILE)
            .on(FILE.ID.eq(DRIVE_FILE.FILE_ID))
            .join(DRIVE_SPACE)
            .on(DRIVE_SPACE.ID.eq(DRIVE_FILE.SPACE_ID))
            .where(DRIVE_FILE.SPACE_ID.in(spaces))
            .and(DRIVE_FILE.NAME.likeIgnoreCase(pattern, '\\'))
            .and(DRIVE_FILE.TRASHED_AT.isNull());

    return dsl.select(KIND, ID, SPACE_ID, SPACE_NAME, FOLDER_ID, NAME, MIME)
        .from(folders.unionAll(files).asTable("hits"))
        .orderBy(KIND.asc(), NAME.asc(), ID.asc())
        .limit(limit)
        .offset(offset)
        .fetch(
            r ->
                new NameRow(
                    r.get(KIND) == 0,
                    r.get(ID),
                    r.get(SPACE_ID),
                    r.get(SPACE_NAME),
                    r.get(FOLDER_ID),
                    r.get(NAME),
                    r.get(MIME)));
  }
}
