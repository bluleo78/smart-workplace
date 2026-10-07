package com.workplace.wiki.repository;

import static com.workplace.jooq.Tables.WIKI_PAGE_DOC;

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
}
