package com.workplace.wiki.repository;

import static com.workplace.jooq.Tables.WIKI_PAGE_ATTACHMENT;
import static com.workplace.jooq.tables.File.FILE;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import org.jooq.DSLContext;
import org.springframework.stereotype.Repository;

/** 노트 페이지 ↔ 이미지 첨부 매핑(wiki_page_attachment) CRUD + 파일 영구 승격. */
@Repository
public class WikiAttachmentRepository {

  private final DSLContext dsl;

  public WikiAttachmentRepository(DSLContext dsl) {
    this.dsl = dsl;
  }

  /** 정션 INSERT — file 을 특정 페이지에 바인딩(tenant_id 는 DEFAULT 에 맡긴다). */
  public void bind(long fileId, long pageId, long attachedBy) {
    dsl.insertInto(WIKI_PAGE_ATTACHMENT)
        .set(WIKI_PAGE_ATTACHMENT.FILE_ID, fileId)
        .set(WIKI_PAGE_ATTACHMENT.PAGE_ID, pageId)
        .set(WIKI_PAGE_ATTACHMENT.ATTACHED_BY, attachedBy)
        .set(WIKI_PAGE_ATTACHMENT.ATTACHED_AT, OffsetDateTime.now())
        .execute();
  }

  /** 페이지에 바인딩된 첨부 개수. */
  public int countByPage(long pageId) {
    return dsl.selectCount()
        .from(WIKI_PAGE_ATTACHMENT)
        .where(WIKI_PAGE_ATTACHMENT.PAGE_ID.eq(pageId))
        .fetchOne(0, int.class);
  }

  /** fileId 가 바인딩된 페이지 ID. 매핑이 없으면 empty. */
  public Optional<Long> findPageId(long fileId) {
    return dsl.select(WIKI_PAGE_ATTACHMENT.PAGE_ID)
        .from(WIKI_PAGE_ATTACHMENT)
        .where(WIKI_PAGE_ATTACHMENT.FILE_ID.eq(fileId))
        .fetchOptional(WIKI_PAGE_ATTACHMENT.PAGE_ID);
  }

  /** 페이지에 바인딩된 file ID 전체. */
  public List<Long> fileIdsOfPage(long pageId) {
    return dsl.select(WIKI_PAGE_ATTACHMENT.FILE_ID)
        .from(WIKI_PAGE_ATTACHMENT)
        .where(WIKI_PAGE_ATTACHMENT.PAGE_ID.eq(pageId))
        .fetch(WIKI_PAGE_ATTACHMENT.FILE_ID);
  }

  /**
   * 본문에 참조된 파일을 영구로 승격(expires_at = NULL).
   *
   * <p>promote-only — 참조가 사라져도 되돌리지 않는다(재만료 없음).
   */
  public void promoteToPermanent(List<Long> fileIds) {
    if (fileIds.isEmpty()) return;
    dsl.update(FILE).setNull(FILE.EXPIRES_AT).where(FILE.ID.in(fileIds)).execute();
  }

  /** 매핑 삭제 — file row 자체는 건드리지 않는다(호출자가 별도로 정리). */
  public void deleteMapping(long fileId) {
    dsl.deleteFrom(WIKI_PAGE_ATTACHMENT).where(WIKI_PAGE_ATTACHMENT.FILE_ID.eq(fileId)).execute();
  }
}
