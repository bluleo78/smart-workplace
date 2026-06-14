package com.workplace.wiki.repository;

import static com.workplace.jooq.Tables.WIKI_REVISION;

import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.springframework.stereotype.Repository;

/** wiki_revision 적재(버전 스냅샷). */
@Repository
@RequiredArgsConstructor
public class WikiRevisionRepository {
  private final DSLContext dsl;

  /** 직전 버전 상태를 스냅샷으로 적재. (page_id, version) 중복이면 무시. */
  public void snapshot(long pageId, int version, String title, String body, Long authorId) {
    dsl.insertInto(WIKI_REVISION)
        .set(WIKI_REVISION.PAGE_ID, pageId)
        .set(WIKI_REVISION.VERSION, version)
        .set(WIKI_REVISION.TITLE, title)
        .set(WIKI_REVISION.BODY, body)
        .set(WIKI_REVISION.AUTHOR_ID, authorId)
        .onConflict(WIKI_REVISION.PAGE_ID, WIKI_REVISION.VERSION)
        .doNothing()
        .execute();
  }
}
