package com.workplace.wiki.repository;

import static com.workplace.jooq.Tables.WIKI_REVISION;

import com.workplace.wiki.dto.RevisionReason;
import com.workplace.wiki.dto.WikiPageDetail;
import com.workplace.wiki.repository.WikiPageDocRepository.RevisionBasis;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.jooq.SelectField;
import org.springframework.stereotype.Repository;

/** wiki_revision 적재(버전 스냅샷)·조회(버전 기록 목록·단건, WP-297). */
@Repository
@RequiredArgsConstructor
public class WikiRevisionRepository {
  private final DSLContext dsl;

  /**
   * 현재(바뀌기 직전) 페이지 상태를 그 version 의 리비전으로 적재한다(WP-297). (page_id, version) 중복이면 무시 — 같은 판을 두 사유가 겹쳐
   * 남기려 할 때(예: AI 적용 직전 스냅샷과 시간 규칙) 먼저 남은 행을 유지한다.
   *
   * @param reason 스냅샷 사유
   * @param editorIds 이 판을 만든 편집자들(마지막 스냅샷 이후 누적, 처음 등장 순). author_id 는 구버전 호환으로 직전 수정자를 그대로 남긴다
   * @param aiActorId AI 적용 직전 스냅샷이면 적용을 요청한 사용자(✦ 귀속), 아니면 null
   * @param editedAt 이 판의 본문이 마지막으로 바뀐 시각 — 목록 표시 시각(적재 시각 created_at 과 다르다)
   * @return 실제로 적재했으면 true, 같은 version 행이 있어 무시됐으면 false
   */
  public boolean snapshot(
      WikiPageDetail current,
      RevisionReason reason,
      List<Long> editorIds,
      Long aiActorId,
      OffsetDateTime editedAt) {
    return dsl.insertInto(WIKI_REVISION)
            .set(WIKI_REVISION.PAGE_ID, current.id())
            .set(WIKI_REVISION.VERSION, current.version())
            .set(WIKI_REVISION.TITLE, current.title())
            .set(WIKI_REVISION.BODY, current.body())
            .set(WIKI_REVISION.AUTHOR_ID, current.updatedBy())
            .set(WIKI_REVISION.EDITOR_IDS, editorIds.toArray(Long[]::new))
            .set(WIKI_REVISION.AI_ACTOR_ID, aiActorId)
            .set(WIKI_REVISION.REASON, reason.name())
            .set(WIKI_REVISION.EDITED_AT, editedAt)
            .onConflict(WIKI_REVISION.PAGE_ID, WIKI_REVISION.VERSION)
            .doNothing()
            .execute()
        > 0;
  }

  /** 페이지의 가장 최근 리비전 적재 시각. 리비전이 없으면 empty. */
  public Optional<OffsetDateTime> latestCreatedAt(long pageId) {
    return dsl.select(org.jooq.impl.DSL.max(WIKI_REVISION.CREATED_AT))
        .from(WIKI_REVISION)
        .where(WIKI_REVISION.PAGE_ID.eq(pageId))
        .fetchOptional()
        .map(r -> r.value1());
  }

  /**
   * 리비전 한 행(버전 기록 표시용, WP-297). body 는 목록 조회에선 null(본문 200개를 끌어오지 않게), 단건 조회에서만 채운다.
   *
   * @param editedAt 표시 시각 — edited_at, 없으면(WP-297 이전 행) created_at
   * @param editorIds 그 판의 편집자 — editor_ids, 비었으면 author_id 하나, 그마저 없으면 빈 목록
   * @param reason 스냅샷 사유, WP-297 이전 행은 null
   */
  public record RevisionRow(
      int version,
      String title,
      String body,
      OffsetDateTime editedAt,
      OffsetDateTime createdAt,
      RevisionReason reason,
      List<Long> editorIds,
      Long aiActorId) {}

  /** 목록·단건 공통 조회 컬럼(본문 제외 — 단건만 BODY 를 더한다). */
  private static final List<SelectField<?>> ROW_FIELDS =
      List.of(
          WIKI_REVISION.VERSION,
          WIKI_REVISION.TITLE,
          WIKI_REVISION.EDITED_AT,
          WIKI_REVISION.CREATED_AT,
          WIKI_REVISION.REASON,
          WIKI_REVISION.EDITOR_IDS,
          WIKI_REVISION.AUTHOR_ID,
          WIKI_REVISION.AI_ACTOR_ID);

  /**
   * 페이지의 리비전 최신순(created_at DESC, 같은 시각이면 version DESC — 한 트랜잭션의 적재는 now() 가 같다) 최대 limit 개, 본문 제외.
   */
  public List<RevisionRow> list(long pageId, int limit) {
    return dsl.select(ROW_FIELDS)
        .from(WIKI_REVISION)
        .where(WIKI_REVISION.PAGE_ID.eq(pageId))
        .orderBy(WIKI_REVISION.CREATED_AT.desc(), WIKI_REVISION.VERSION.desc())
        .limit(limit)
        .fetch(r -> toRow(r, null));
  }

  /** 페이지의 그 version 리비전(본문 포함). 없으면 empty. */
  public Optional<RevisionRow> find(long pageId, int version) {
    return dsl.select(ROW_FIELDS)
        .select(WIKI_REVISION.BODY)
        .from(WIKI_REVISION)
        .where(WIKI_REVISION.PAGE_ID.eq(pageId).and(WIKI_REVISION.VERSION.eq(version)))
        .fetchOptional(r -> toRow(r, r.get(WIKI_REVISION.BODY)));
  }

  /**
   * 조회 행 → RevisionRow. 표시 시각·편집자 대체 규칙(edited_at ?? created_at, editor_ids 비면 author_id)을 여기서 한 번만
   * 적용한다.
   */
  private static RevisionRow toRow(org.jooq.Record r, String body) {
    Long[] editors = r.get(WIKI_REVISION.EDITOR_IDS);
    List<Long> editorIds =
        editors != null && editors.length > 0
            ? List.of(editors)
            : RevisionBasis.editorsOf(r.get(WIKI_REVISION.AUTHOR_ID));
    OffsetDateTime createdAt = r.get(WIKI_REVISION.CREATED_AT);
    OffsetDateTime editedAt = r.get(WIKI_REVISION.EDITED_AT);
    String reason = r.get(WIKI_REVISION.REASON);
    return new RevisionRow(
        r.get(WIKI_REVISION.VERSION),
        r.get(WIKI_REVISION.TITLE),
        body,
        editedAt != null ? editedAt : createdAt,
        createdAt,
        reason != null ? RevisionReason.valueOf(reason) : null,
        editorIds,
        r.get(WIKI_REVISION.AI_ACTOR_ID));
  }
}
