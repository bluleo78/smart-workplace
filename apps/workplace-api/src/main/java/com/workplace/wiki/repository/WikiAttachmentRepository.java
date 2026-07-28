package com.workplace.wiki.repository;

import static com.workplace.jooq.Tables.WIKI_PAGE;
import static com.workplace.jooq.Tables.WIKI_PAGE_ATTACHMENT;
import static com.workplace.jooq.tables.File.FILE;

import com.workplace.wiki.exception.WikiAttachmentPromoteRaceException;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Collection;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;
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
   * 본문에 참조된 파일을 영구로 승격(expires_at = NULL) — 유예 중이던 강등도 함께 해제(demoted_at = NULL).
   *
   * <p>#759 이후 promote-only 가 아니다. 참조가 빠지면 {@link #demote}, 돌아오면 여기서 되돌린다. 유예 창 안에서 참조가 복귀하면
   * (잘라내기→붙여넣기, undo, autosave 중간 상태) 아무 일도 없던 것처럼 원상 복귀돼야 한다 — #751 이 즉시 삭제를 기각한 이유가 바로 이 왕복이다.
   */
  public void promoteToPermanent(List<Long> fileIds) {
    if (fileIds.isEmpty()) return;
    int affected = dsl.update(FILE).setNull(FILE.EXPIRES_AT).where(FILE.ID.in(fileIds)).execute();
    // 행이 모자라면 정리 스윕이 방금 그 파일을 지운 것이다(스윕의 행 잠금에 이 UPDATE 가 블록됐다가
    // 삭제 커밋 후 재평가되면 0행이 된다). 조용히 지나가면 저장은 성공했는데 본문이 사라진 파일을 가리키는
    // 깨진 이미지가 남으므로, 여기서 409 로 실패시켜 사용자가 재시도하게 한다(#759 재리뷰).
    if (affected != fileIds.size()) {
      throw new WikiAttachmentPromoteRaceException(fileIds.size(), affected);
    }
    dsl.update(WIKI_PAGE_ATTACHMENT)
        .setNull(WIKI_PAGE_ATTACHMENT.DEMOTED_AT)
        .where(WIKI_PAGE_ATTACHMENT.FILE_ID.in(fileIds))
        .execute();
  }

  /**
   * #759 본문에서 참조가 빠진 첨부를 강등한다 — 삭제가 아니라 만료 재무장(expires_at = 유예 후 시각). 실제로 강등된 fileId 를 반환한다.
   *
   * <p><b>이미 임시인 파일(expires_at IS NOT NULL)은 건드리지 않는다.</b> 업로드 직후 아직 본문에 실리지 않은 파일이 여기 섞여 들어오는데,
   * 그것까지 강등하면 (1) 24시간짜리 임시 만료가 유예만큼 늘어나고 (2) demoted_at 이 찍혀 상한 계산의 "임시" 집합에서 빠져 업로드 상한이 무력화된다.
   * 그래서 조건은 승격된 것(expires_at IS NULL)뿐이다.
   *
   * <p>demoted_at 은 강등된 행에만 찍는다 — 상한 계산이 "temp(아직 승격 전)" 와 "demoted(유예 중)" 를 구분하는 유일한 표식이다(V127).
   */
  public List<Long> demote(List<Long> fileIds, OffsetDateTime expiresAt) {
    if (fileIds.isEmpty()) return List.of();
    List<Long> demoted =
        dsl.update(FILE)
            .set(FILE.EXPIRES_AT, expiresAt)
            .where(FILE.ID.in(fileIds))
            .and(FILE.EXPIRES_AT.isNull())
            .returningResult(FILE.ID)
            .fetch()
            .map(r -> r.get(0, Long.class));
    if (demoted.isEmpty()) return List.of();
    dsl.update(WIKI_PAGE_ATTACHMENT)
        .set(WIKI_PAGE_ATTACHMENT.DEMOTED_AT, OffsetDateTime.now(ZoneOffset.UTC))
        .where(WIKI_PAGE_ATTACHMENT.FILE_ID.in(demoted))
        .execute();
    return demoted;
  }

  /**
   * #759 (A) 페이지당 매핑 총개수 — 참조 여부·승격 여부와 무관한 하드 실링용.
   *
   * <p>해소 가능한 상한(참조∪임시)과 별개다. 그쪽은 사용자가 본문을 정리하면 풀리지만, 그렇기 때문에 "지우고 다시 올리기" 를 반복하면 유예가 끝나기 전까지 매핑이
   * 계속 쌓인다. 이 실링은 그 폭주만 막는 훨씬 높은 값이다.
   */
  public int countByPage(long pageId) {
    return dsl.fetchCount(WIKI_PAGE_ATTACHMENT, WIKI_PAGE_ATTACHMENT.PAGE_ID.eq(pageId));
  }

  /**
   * #759 주어진 fileId 중 <b>현재 어느 위키 페이지 본문에든 참조가 남아 있는</b> 것들.
   *
   * <p>정리 스윕이 유예가 끝난 강등 첨부를 지우기 직전에 쓴다. 첨부 URL 에는 원본 pageId 가 박혀 있어 다른 페이지에 붙여넣은 이미지도 원본 페이지의 매핑으로
   * 서빙된다 — 원본에서 참조가 빠졌다는 이유로 지우면 복사본이 조용히 깨진다. 요청 경로가 아니라 스윕에서 한 번만 확인하므로 LIKE 전수 스캔 비용을 감당할 수 있고,
   * 유예 기간 전체가 안전 창으로 남는다.
   */
  public Set<Long> fileIdsStillReferencedAnywhere(Collection<Long> fileIds) {
    if (fileIds.isEmpty()) return Set.of();
    // 먼저 위키 첨부인 것만 남긴다. 만료 집합에는 메일 캐시·이슈/채팅 첨부 등 다른 도메인 파일이 섞여 들어오고
    // file.id 는 도메인 공통 시퀀스라, 이 필터가 없으면 (1) 위키 본문에 붙여넣은 타 도메인 URL 때문에 그 파일이
    // 영구 보존되어 그쪽 회수를 무력화하고 (2) 만료 건수만큼 본문 전수 스캔을 돌게 된다.
    List<Long> candidates =
        dsl.select(WIKI_PAGE_ATTACHMENT.FILE_ID)
            .from(WIKI_PAGE_ATTACHMENT)
            .where(WIKI_PAGE_ATTACHMENT.FILE_ID.in(fileIds))
            .fetch(WIKI_PAGE_ATTACHMENT.FILE_ID);
    Set<Long> alive = new LinkedHashSet<>();
    for (Long fileId : candidates) {
      // URL 형태는 WikiAttachmentResponse.urlOf 계약. pageId 자리는 와일드카드 — 복사본은 원본 pageId 를
      // 그대로 달고 다른 페이지 본문에 들어가므로 "어느 페이지 본문에든" 을 봐야 한다.
      boolean referenced =
          dsl.fetchExists(
              dsl.selectOne()
                  .from(WIKI_PAGE)
                  .where(
                      WIKI_PAGE.BODY.like(
                          "%/api/v1/wiki/pages/%/attachments/" + fileId + "/content%")));
      if (referenced) alive.add(fileId);
    }
    return alive;
  }

  /**
   * #759 유예가 끝났지만 어딘가에서 참조가 살아 있어 보존된 첨부의 만료를 <b>다시 유예 뒤로 미룬다</b>.
   *
   * <p>여기서 {@code expires_at} 을 NULL 로 되돌리면(= 승격) 안 된다. 재무장은 <b>원본 페이지를 저장할 때만</b> 일어나므로, 원본을 다시는
   * 저장하지 않고 복사본 쪽 참조만 지우면 그 blob 은 어떤 본문도 참조하지 않는데 만료도 없는 영구 고아가 된다 — 무제한 증가 경로가 그대로 되살아난다. 만료를
   * 미루기만 하면 다음 유예 뒤 다시 판정된다.
   *
   * <p>{@code demoted_at} 은 남겨 둔다 — 상한 계산에서 이 파일은 여전히 "임시" 가 아니다.
   */
  public void rearm(Collection<Long> fileIds, OffsetDateTime expiresAt) {
    if (fileIds.isEmpty()) return;
    dsl.update(FILE).set(FILE.EXPIRES_AT, expiresAt).where(FILE.ID.in(fileIds)).execute();
    // demoted_at 이 비어 있으면 여기서 찍는다 — 페이지 A 에서 잘라내 B 에 붙여넣은 파일은 A 저장 시
    // 아직 임시라 강등을 건너뛰고, B 저장 시엔 URL 에 박힌 pageId 가 A 라 승격도 안 된다. 그대로 두면
    // 매 유예마다 보존만 반복되면서 A 의 "임시" 집합과 실링 슬롯을 영원히 점유해, 사용자가 본문을 어떻게
    // 고쳐도 풀 수 없는 409 가 된다(#757 이 없앤 바로 그 상태). 이 시점의 파일은 "첫 저장 대기" 가 아니다.
    dsl.update(WIKI_PAGE_ATTACHMENT)
        .set(WIKI_PAGE_ATTACHMENT.DEMOTED_AT, OffsetDateTime.now(ZoneOffset.UTC))
        .where(WIKI_PAGE_ATTACHMENT.FILE_ID.in(fileIds))
        .and(WIKI_PAGE_ATTACHMENT.DEMOTED_AT.isNull())
        .execute();
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

  /**
   * 페이지에 바인딩됐지만 <b>아직 승격된 적 없는</b> 임시 첨부 — 저장 전이라 본문에 아직 없다.
   *
   * <p>#759: {@code demoted_at IS NULL} 조건이 필수다. 강등(만료 재무장)된 첨부도 expires_at 이 채워져 있어, 이 조건이 없으면
   * "본문에서 지우고 저장하면 다시 올릴 수 있다"(#757 이 만든 해소 가능성)가 조용히 사라진다.
   */
  public List<Long> tempFileIdsOfPage(long pageId) {
    return dsl.select(WIKI_PAGE_ATTACHMENT.FILE_ID)
        .from(WIKI_PAGE_ATTACHMENT)
        .join(FILE)
        .on(FILE.ID.eq(WIKI_PAGE_ATTACHMENT.FILE_ID))
        .where(WIKI_PAGE_ATTACHMENT.PAGE_ID.eq(pageId))
        .and(FILE.EXPIRES_AT.isNotNull())
        .and(WIKI_PAGE_ATTACHMENT.DEMOTED_AT.isNull())
        .fetch(WIKI_PAGE_ATTACHMENT.FILE_ID);
  }
}
