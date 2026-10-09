package com.workplace.wiki.repository;

import static com.workplace.jooq.Tables.WIKI_PAGE_DOC;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Repository;

/** wiki_page_doc 접근 — 노트 동시 편집의 Yjs 문서 상태 원본(WP-286). tenant_id 는 GUC 기본값으로 채워진다. */
@Repository
@RequiredArgsConstructor
public class WikiPageDocRepository {
  private final DSLContext dsl;

  /** 저장된 문서 상태 한 건. bodyVersion = 이 상태로 파생 저장한 wiki_page.version. */
  public record DocRow(byte[] state, int bodyVersion) {}

  public Optional<DocRow> find(long pageId) {
    return dsl.select(WIKI_PAGE_DOC.STATE, WIKI_PAGE_DOC.BODY_VERSION)
        .from(WIKI_PAGE_DOC)
        .where(WIKI_PAGE_DOC.PAGE_ID.eq(pageId))
        .fetchOptional(
            r -> new DocRow(r.get(WIKI_PAGE_DOC.STATE), r.get(WIKI_PAGE_DOC.BODY_VERSION)));
  }

  /** 없으면 넣고 있으면 상태·파생 버전을 덮어쓴다(페이지당 1행). */
  public void upsert(long pageId, byte[] state, int bodyVersion) {
    dsl.insertInto(WIKI_PAGE_DOC)
        .set(WIKI_PAGE_DOC.PAGE_ID, pageId)
        .set(WIKI_PAGE_DOC.STATE, state)
        .set(WIKI_PAGE_DOC.BODY_VERSION, bodyVersion)
        .onConflict(WIKI_PAGE_DOC.PAGE_ID)
        .doUpdate()
        .set(WIKI_PAGE_DOC.STATE, state)
        .set(WIKI_PAGE_DOC.BODY_VERSION, bodyVersion)
        .set(WIKI_PAGE_DOC.UPDATED_AT, DSL.currentOffsetDateTime())
        .execute();
  }

  /**
   * 리비전 스냅샷 판단 재료(WP-297). 행이 없으면(아직 동기화 서버 저장이 없던 페이지) 기준 시각 없음·누적 편집자 없음.
   *
   * @param bodyChangedAt 마지막 본문 저장 시각 — 제목만 바꾸는 저장은 갱신하지 않는다. null 이면 이관 직후(기준 없음)
   * @param pendingEditorIds 마지막 스냅샷 이후 본문을 저장한 편집자들(처음 등장 순)
   */
  public record RevisionBasis(OffsetDateTime bodyChangedAt, List<Long> pendingEditorIds) {
    /** 지금 판의 편집자 — 누적 편집자, 없으면 직전 수정자 하나(그마저 없으면 빈 목록). */
    public List<Long> editorsOr(Long updatedBy) {
      return !pendingEditorIds.isEmpty() ? pendingEditorIds : editorsOf(updatedBy);
    }

    /** 지금 판의 본문 변경 시각 — 기준 시각, 없으면(동기화 서버 저장 전) 주어진 대체 시각(wiki_page.updated_at). */
    public OffsetDateTime editedAtOr(OffsetDateTime updatedAt) {
      return bodyChangedAt != null ? bodyChangedAt : updatedAt;
    }

    /** 편집자 누적이 없는 곳의 대체 규칙 — 직전 수정자 하나, null 이면 빈 목록. */
    public static List<Long> editorsOf(Long updatedBy) {
      return updatedBy != null ? List.of(updatedBy) : List.of();
    }
  }

  public RevisionBasis revisionBasis(long pageId) {
    return dsl.select(WIKI_PAGE_DOC.BODY_CHANGED_AT, WIKI_PAGE_DOC.PENDING_EDITOR_IDS)
        .from(WIKI_PAGE_DOC)
        .where(WIKI_PAGE_DOC.PAGE_ID.eq(pageId))
        .fetchOptional(
            r ->
                new RevisionBasis(
                    r.get(WIKI_PAGE_DOC.BODY_CHANGED_AT),
                    List.of(r.get(WIKI_PAGE_DOC.PENDING_EDITOR_IDS))))
        .orElse(new RevisionBasis(null, List.of()));
  }

  /**
   * 본문이 바뀐 저장 — {@link #upsert} 에 더해 다음 스냅샷 판단의 기준 시각과 누적 편집자를 한 문장으로 갱신한다. 같은 본문 저장·상태만 저장·제목 저장은
   * {@link #upsert} 만 써서 기준 시각이 리셋되지 않는다.
   */
  public void upsertBodyChanged(
      long pageId, byte[] state, int bodyVersion, OffsetDateTime at, List<Long> pendingEditorIds) {
    Long[] pending = pendingEditorIds.toArray(Long[]::new);
    dsl.insertInto(WIKI_PAGE_DOC)
        .set(WIKI_PAGE_DOC.PAGE_ID, pageId)
        .set(WIKI_PAGE_DOC.STATE, state)
        .set(WIKI_PAGE_DOC.BODY_VERSION, bodyVersion)
        .set(WIKI_PAGE_DOC.BODY_CHANGED_AT, at)
        .set(WIKI_PAGE_DOC.PENDING_EDITOR_IDS, pending)
        .onConflict(WIKI_PAGE_DOC.PAGE_ID)
        .doUpdate()
        .set(WIKI_PAGE_DOC.STATE, state)
        .set(WIKI_PAGE_DOC.BODY_VERSION, bodyVersion)
        .set(WIKI_PAGE_DOC.BODY_CHANGED_AT, at)
        .set(WIKI_PAGE_DOC.PENDING_EDITOR_IDS, pending)
        .set(WIKI_PAGE_DOC.UPDATED_AT, DSL.currentOffsetDateTime())
        .execute();
  }
}
