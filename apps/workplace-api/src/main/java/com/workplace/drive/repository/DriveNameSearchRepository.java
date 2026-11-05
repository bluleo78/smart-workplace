package com.workplace.drive.repository;

import static com.workplace.jooq.Tables.DRIVE_FILE;
import static com.workplace.jooq.Tables.DRIVE_FOLDER;
import static com.workplace.jooq.Tables.DRIVE_SPACE;
import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.FILE_EXTRACTION;

import java.util.List;
import org.jooq.DSLContext;
import org.jooq.Field;
import org.jooq.impl.DSL;
import org.jooq.impl.SQLDataType;
import org.springframework.stereotype.Repository;

/**
 * 호출자가 (실효) 멤버인 모든 공간에 걸친 드라이브 이름·본문 검색(WP-1353, 통합 검색 팔레트 · 본문은 WP-1356). 공간 하나만 보는 {@code
 * searchByName}(폴더·파일 리포지토리)과 같은 규칙 — 이름 ILIKE(와일드카드 이스케이프)·휴지통 제외(폴더를 휴지통에 보내면 하위 항목도 같은 시각에 휴지통
 * 표시가 붙어 자연히 빠진다) — 을 폴더·파일 이름과 파일 본문(추출 텍스트) UNION 한 번으로 돌린다. 이름이 맞은 폴더 → 이름이 맞은 파일 → 본문만 맞은 파일
 * 순(같은 무리 안은 이름·id)으로 정렬해 offset 페이지를 이어 받는다 — 한 목록이라 쪽 나누기가 두 무리 경계를 그대로 넘는다. RLS 가 테넌트를 스코프한다.
 */
@Repository
public class DriveNameSearchRepository {

  /** 정렬용 종류 순번 — 이름 맞은 폴더 0, 이름 맞은 파일 1, 본문만 맞은 파일 2(이름 결과 먼저). */
  private static final Field<Integer> KIND = DSL.field(DSL.name("k"), Integer.class);

  private static final Field<Long> ID = DSL.field(DSL.name("id"), Long.class);
  private static final Field<Long> SPACE_ID = DSL.field(DSL.name("space_id"), Long.class);
  private static final Field<String> SPACE_NAME = DSL.field(DSL.name("space_name"), String.class);
  private static final Field<Long> FOLDER_ID = DSL.field(DSL.name("folder_id"), Long.class);
  private static final Field<String> NAME = DSL.field(DSL.name("name"), String.class);
  private static final Field<String> MIME = DSL.field(DSL.name("mime_type"), String.class);
  private static final Field<String> SNIP = DSL.field(DSL.name("snip"), String.class);
  private static final Field<Boolean> SNIP_HEAD = DSL.field(DSL.name("snip_head"), Boolean.class);
  private static final Field<Boolean> SNIP_TAIL = DSL.field(DSL.name("snip_tail"), Boolean.class);

  /** 발췌 창에서 맞은 곳 앞에 둘 글자 수 — 앞 문맥이 조금 보이게. */
  static final int SNIPPET_LEAD = 30;

  /** 발췌 창 길이(글자) — 결과 줄 둘째 줄은 한 줄로 잘리므로 넉넉히만 읽고, 긴 본문 전체를 정렬·전송하지 않는다. */
  static final int SNIPPET_WINDOW = 160;

  private final DSLContext dsl;

  public DriveNameSearchRepository(DSLContext dsl) {
    this.dsl = dsl;
  }

  /**
   * 검색 결과 한 행. folder=true 면 폴더(folderId 는 부모, mimeType 은 null), 아니면 파일(folderId 는 들어 있는 폴더). 루트
   * 직속이면 folderId 는 null. snippet 은 본문만 맞은 파일에만 있는 발췌 창(줄바꿈 정리 전 원문), 이름이 맞은 행은 null.
   * snippetCutHead·snippetCutTail 은 창 앞·뒤로 본문이 더 있는지(잘렸는지) — 서비스가 「…」를 붙이는 데 쓴다.
   */
  public record NameRow(
      boolean folder,
      long id,
      long spaceId,
      String spaceName,
      Long folderId,
      String name,
      String mimeType,
      String snippet,
      boolean snippetCutHead,
      boolean snippetCutTail) {}

  /**
   * 이름에 q 를 포함하는 폴더·파일과, 이름은 안 맞지만 본문(추출 텍스트)에 q 를 포함하는 파일을 limit 건 읽는다(호출자가 hasMore 판정을 위해 size+1
   * 을 넘긴다). 본문은 키워드(ILIKE) 일치만 본다 — 벡터 검색은 쓰지 않는다.
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
                DSL.castNull(SQLDataType.VARCHAR).as(MIME.getName()),
                DSL.castNull(SQLDataType.VARCHAR).as(SNIP.getName()),
                DSL.inline(false).as(SNIP_HEAD.getName()),
                DSL.inline(false).as(SNIP_TAIL.getName()))
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
                FILE.MIME_TYPE.as(MIME.getName()),
                DSL.castNull(SQLDataType.VARCHAR).as(SNIP.getName()),
                DSL.inline(false).as(SNIP_HEAD.getName()),
                DSL.inline(false).as(SNIP_TAIL.getName()))
            .from(DRIVE_FILE)
            .join(FILE)
            .on(FILE.ID.eq(DRIVE_FILE.FILE_ID))
            .join(DRIVE_SPACE)
            .on(DRIVE_SPACE.ID.eq(DRIVE_FILE.SPACE_ID))
            .where(DRIVE_FILE.SPACE_ID.in(spaces))
            .and(DRIVE_FILE.NAME.likeIgnoreCase(pattern, '\\'))
            .and(DRIVE_FILE.TRASHED_AT.isNull());
    // 본문만 맞은 파일 — 이름도 맞은 파일은 위 무리에 이미 있어 빼고(한 번만 나오게), 지금 버전 원본(drive_file.file_id)의 추출 텍스트를 본다.
    // 상태(status)는 보지 않는다 — 요약 단계(SUMMARIZING·DONE·요약 실패)와 상관없이 추출 텍스트가 있으면 그 원본의 글자다.
    // 발췌는 맞은 곳 앞 SNIPPET_LEAD 글자부터 SNIPPET_WINDOW 글자만 잘라 온다(긴 본문 전체를 정렬·전송하지 않게).
    // strpos 는 와일드카드 없는 글자 그대로라 이스케이프 전 검색어를 넘긴다. 못 찾으면(0) 맨 앞부터.
    Field<Integer> start =
        DSL.field(
            "greatest(1, strpos(lower({0}), lower({1})) - {2})",
            Integer.class, FILE_EXTRACTION.EXTRACTED_TEXT, DSL.val(q), DSL.inline(SNIPPET_LEAD));
    var bodies =
        dsl.select(
                DSL.inline(2).as(KIND.getName()),
                DRIVE_FILE.ID.as(ID.getName()),
                DRIVE_FILE.SPACE_ID.as(SPACE_ID.getName()),
                DRIVE_SPACE.NAME.as(SPACE_NAME.getName()),
                DRIVE_FILE.FOLDER_ID.as(FOLDER_ID.getName()),
                DRIVE_FILE.NAME.as(NAME.getName()),
                FILE.MIME_TYPE.as(MIME.getName()),
                DSL.substring(FILE_EXTRACTION.EXTRACTED_TEXT, start, DSL.inline(SNIPPET_WINDOW))
                    .as(SNIP.getName()),
                DSL.field(start.gt(1)).as(SNIP_HEAD.getName()),
                DSL.field(
                        DSL.charLength(FILE_EXTRACTION.EXTRACTED_TEXT)
                            .ge(start.plus(SNIPPET_WINDOW)))
                    .as(SNIP_TAIL.getName()))
            .from(DRIVE_FILE)
            .join(FILE)
            .on(FILE.ID.eq(DRIVE_FILE.FILE_ID))
            .join(FILE_EXTRACTION)
            .on(FILE_EXTRACTION.FILE_ID.eq(DRIVE_FILE.FILE_ID))
            .join(DRIVE_SPACE)
            .on(DRIVE_SPACE.ID.eq(DRIVE_FILE.SPACE_ID))
            .where(DRIVE_FILE.SPACE_ID.in(spaces))
            .and(FILE_EXTRACTION.EXTRACTED_TEXT.likeIgnoreCase(pattern, '\\'))
            .and(DRIVE_FILE.NAME.notLikeIgnoreCase(pattern, '\\'))
            .and(DRIVE_FILE.TRASHED_AT.isNull());

    return dsl.select(
            KIND, ID, SPACE_ID, SPACE_NAME, FOLDER_ID, NAME, MIME, SNIP, SNIP_HEAD, SNIP_TAIL)
        .from(folders.unionAll(files).unionAll(bodies).asTable("hits"))
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
                    r.get(MIME),
                    r.get(SNIP),
                    Boolean.TRUE.equals(r.get(SNIP_HEAD)),
                    Boolean.TRUE.equals(r.get(SNIP_TAIL))));
  }
}
