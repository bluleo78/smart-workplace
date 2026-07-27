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

  /** file 행 회수에 필요한 최소 정보 — id 와 디스크 경로. */
  public record AttachedFile(long fileId, String storagePath) {}

  /**
   * rootPageId 와 그 모든 후손 페이지에 바인딩된 첨부 file 행. 페이지 삭제 직전에 호출해야 한다 — wiki_page_attachment 는 page_id
   * CASCADE 라 삭제 후에는 아무것도 남지 않는다. 이 리포에 재귀 CTE 선례가 없어 jOOQ withRecursive 대신 plain SQL 로 쓴다(같은 커넥션이라
   * RLS GUC 는 동일하게 적용된다).
   *
   * <p>재귀항은 UNION ALL 이 아니라 UNION 이어야 한다 — WikiPageRepository.move 는 parentId 를 검증 없이 UPDATE 해
   * self-FK 사이클(parent_id 가 자기 자신 또는 자기 후손)이 실제로 만들어질 수 있다. 그 상태에서 삭제하면 UNION ALL 은 같은 id 를 무한 재생산해
   * working table 이 절대 비지 않아 쿼리가 영원히 끝나지 않는다 (statement_timeout 미설정 → 커넥션 하나가 CPU/메모리를 계속 먹으며 매달림).
   * UNION 은 이미 나온 행을 걸러 working table 을 비워 정상 종료한다 — 정상 트리에서는 각 id 가 한 번만 나오므로 의미 손실은 없다.
   */
  public List<AttachedFile> attachedFilesOfPageTree(long rootPageId) {
    return dsl.fetch(
            """
            WITH RECURSIVE tree(id) AS (
              SELECT id FROM wiki_page WHERE id = ?
              UNION
              SELECT p.id FROM wiki_page p JOIN tree t ON p.parent_id = t.id
            )
            SELECT f.id, f.storage_path
              FROM wiki_page_attachment a
              JOIN tree t ON t.id = a.page_id
              JOIN file f ON f.id = a.file_id
            """,
            rootPageId)
        .map(r -> new AttachedFile(r.get(0, Long.class), r.get(1, String.class)));
  }

  /**
   * file 행 일괄 삭제 — wiki_page_attachment.file_id 가 CASCADE 라 매핑은 함께 사라진다. 실제로 삭제된 행 수를 반환한다 —
   * 호출자(reclaimPageTree)가 요청한 fileIds 개수와 비교해 어긋나면(같은 커넥션·같은 GUC 라 정상적으로는 발생하지 않아야 함) unlink 등록 대상과
   * 실제 삭제된 file 행이 어긋난다는 신호이므로 로깅할 수 있게 한다.
   */
  public int deleteFileRows(List<Long> fileIds) {
    if (fileIds.isEmpty()) return 0;
    return dsl.deleteFrom(FILE).where(FILE.ID.in(fileIds)).execute();
  }

  /** 페이지에 바인딩됐지만 아직 임시(expires_at IS NOT NULL)인 첨부 — 저장 전이라 본문에 아직 없다. */
  public List<Long> tempFileIdsOfPage(long pageId) {
    return dsl.select(WIKI_PAGE_ATTACHMENT.FILE_ID)
        .from(WIKI_PAGE_ATTACHMENT)
        .join(FILE)
        .on(FILE.ID.eq(WIKI_PAGE_ATTACHMENT.FILE_ID))
        .where(WIKI_PAGE_ATTACHMENT.PAGE_ID.eq(pageId))
        .and(FILE.EXPIRES_AT.isNotNull())
        .fetch(WIKI_PAGE_ATTACHMENT.FILE_ID);
  }
}
