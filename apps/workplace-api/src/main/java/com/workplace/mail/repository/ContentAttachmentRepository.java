package com.workplace.mail.repository;

import static com.workplace.jooq.Tables.CONTENT_ATTACHMENT;

import com.workplace.mail.dto.ParsedAttachment;
import java.util.List;
import java.util.Objects;
import lombok.RequiredArgsConstructor;
import org.jooq.Condition;
import org.jooq.DSLContext;
import org.springframework.stereotype.Repository;

/** content_attachment(per-content 공유 첨부 manifest) 리포지토리. */
@Repository
@RequiredArgsConstructor
public class ContentAttachmentRepository {

  private final DSLContext dsl;

  /**
   * (content_id, ordinal) 기준 find-or-create. 같은 메일을 받은 다른 envelope 의 sync 가 같은 위치 첨부에 대해 같은
   * manifest 행을 공유하도록 보장한다. ON CONFLICT DO NOTHING 후 id 를 다시 조회한다(동시 sync 경쟁 흡수).
   *
   * @return content_attachment id
   */
  public long findOrCreate(
      long contentId,
      int ordinal,
      String filename,
      String contentType,
      Long sizeBytes,
      String mimeContentId) {
    dsl.insertInto(CONTENT_ATTACHMENT)
        .set(CONTENT_ATTACHMENT.CONTENT_ID, contentId)
        .set(CONTENT_ATTACHMENT.ORDINAL, ordinal)
        .set(CONTENT_ATTACHMENT.FILENAME, filename)
        .set(CONTENT_ATTACHMENT.CONTENT_TYPE, contentType)
        .set(CONTENT_ATTACHMENT.SIZE_BYTES, sizeBytes)
        .set(CONTENT_ATTACHMENT.MIME_CONTENT_ID, mimeContentId)
        .onConflict(CONTENT_ATTACHMENT.CONTENT_ID, CONTENT_ATTACHMENT.ORDINAL)
        .doNothing()
        .execute();
    var row =
        dsl.select(
                CONTENT_ATTACHMENT.ID,
                CONTENT_ATTACHMENT.FILENAME,
                CONTENT_ATTACHMENT.CONTENT_TYPE,
                CONTENT_ATTACHMENT.SIZE_BYTES)
            .from(CONTENT_ATTACHMENT)
            .where(CONTENT_ATTACHMENT.CONTENT_ID.eq(contentId))
            .and(CONTENT_ATTACHMENT.ORDINAL.eq(ordinal))
            .fetchSingle();
    // WP-130: 기존 manifest 행이 다른 첨부면 채택하지 않는다(fail-closed) — 채택하면 그 행의 content_hash(첨부 캐시 키)로 다른 사람
    // 첨부
    // 바이트를 받게 된다. 공유 게이트가 사전 검증하므로 정상 흐름에선 발생하지 않고, 검증 없는 새 쓰기 경로를 막는 최종 방어선이다.
    if (!sameMeta(row.value2(), row.value3(), row.value4(), filename, contentType, sizeBytes)) {
      throw new ManifestMismatchException(contentId, ordinal);
    }
    return row.value1();
  }

  /** 공유 manifest 행과 파싱한 첨부의 메타(파일명·타입·크기) 일치 여부. */
  private static boolean sameMeta(
      String filename, String contentType, Long sizeBytes, String f2, String t2, Long s2) {
    return Objects.equals(filename, f2)
        && Objects.equals(contentType, t2)
        && Objects.equals(sizeBytes, s2);
  }

  /** 공유 manifest 의 같은 ordinal 에 다른 첨부가 이미 있음(WP-130). 호출 트랜잭션을 롤백시켜 부분 적재를 남기지 않는다. */
  public static class ManifestMismatchException extends IllegalStateException {
    public ManifestMismatchException(long contentId, int ordinal) {
      super("공유 첨부 manifest 불일치 (contentId=" + contentId + ", ordinal=" + ordinal + ")");
    }
  }

  /**
   * 이 envelope 가 파싱한 첨부 목록이 공유 manifest 와 겹치는 ordinal 에서 모두 일치하는지(WP-130). 파일명·타입·크기 중 하나라도 다르면 다른
   * 메일로 보고 content 를 분리해야 한다 — 그대로 공유하면 manifest 의 content_hash(첨부 캐시 키)로 다른 사람 첨부 바이트를 받게 된다.
   * manifest 에 없는 ordinal 은 비교하지 않는다(각 envelope 는 자기 email_attachment 가 가리키는 행만 본다).
   */
  public boolean matchesManifest(long contentId, List<ParsedAttachment> attachments) {
    if (attachments.isEmpty()) {
      return true; // 비교할 ordinal 없음 — 조회 생략(대부분의 메일)
    }
    var rows =
        dsl.select(
                CONTENT_ATTACHMENT.ORDINAL,
                CONTENT_ATTACHMENT.FILENAME,
                CONTENT_ATTACHMENT.CONTENT_TYPE,
                CONTENT_ATTACHMENT.SIZE_BYTES)
            .from(CONTENT_ATTACHMENT)
            .where(CONTENT_ATTACHMENT.CONTENT_ID.eq(contentId))
            .and(CONTENT_ATTACHMENT.ORDINAL.lt(attachments.size()))
            .fetch();
    for (var r : rows) {
      ParsedAttachment a = attachments.get(r.value1());
      if (!sameMeta(
          r.value2(), r.value3(), r.value4(), a.filename(), a.contentType(), a.sizeBytes())) {
        return false;
      }
    }
    return true;
  }

  /** content_hash 가 NULL 일 때만 기록(첫 다운로드 시 1회 — 불변 식별자). */
  public void setContentHashIfNull(long contentAttachmentId, String hash) {
    dsl.update(CONTENT_ATTACHMENT)
        .set(CONTENT_ATTACHMENT.CONTENT_HASH, hash)
        .where(CONTENT_ATTACHMENT.ID.eq(contentAttachmentId))
        .and(CONTENT_ATTACHMENT.CONTENT_HASH.isNull())
        .execute();
  }

  /**
   * mime_content_id 가 비어 있을 때만 기록(WP-68). 공유 manifest 행은 find-or-create 로 재사용되므로, 규칙 도입 전 적재된 행이나
   * 지연 백필로 알아낸 Content-ID 를 기존 실제 값 덮어쓰기 없이 채운다.
   *
   * <p>빈 문자열은 지연 백필의 "확인했지만 없음" 표시다. 실제 값은 NULL 뿐 아니라 이 표시도 덮어쓴다(다른 경로가 나중에 진짜 Content-ID 를 알게 된
   * 경우). 표시값 자체는 NULL 에만 기록한다.
   */
  public void setMimeContentIdIfNull(long contentAttachmentId, String mimeContentId) {
    Condition empty =
        mimeContentId.isEmpty()
            ? CONTENT_ATTACHMENT.MIME_CONTENT_ID.isNull()
            : CONTENT_ATTACHMENT
                .MIME_CONTENT_ID
                .isNull()
                .or(CONTENT_ATTACHMENT.MIME_CONTENT_ID.eq(""));
    dsl.update(CONTENT_ATTACHMENT)
        .set(CONTENT_ATTACHMENT.MIME_CONTENT_ID, mimeContentId)
        .where(CONTENT_ATTACHMENT.ID.eq(contentAttachmentId))
        .and(empty)
        .execute();
  }
}
