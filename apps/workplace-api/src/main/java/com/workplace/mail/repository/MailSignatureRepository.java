package com.workplace.mail.repository;

import static com.workplace.jooq.Tables.MAIL_SIGNATURE;
import static com.workplace.jooq.Tables.MAIL_SIGNATURE_IMAGE;

import java.time.OffsetDateTime;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.function.Function;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.jooq.Record;
import org.jooq.SelectField;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Repository;

/**
 * 메일 서명(WP-1517) 저장소 — 사용자당 서명 한 행({@code mail_signature})과 서명 이미지 행({@code mail_signature_image}).
 * 테넌트는 RLS GUC 와 tenant_id 기본값이 정하므로 여기서는 user_id 로만 거른다.
 */
@Repository
@RequiredArgsConstructor
public class MailSignatureRepository {

  private final DSLContext dsl;

  /** 서명 행. */
  public record SignatureRow(
      String html, boolean autoNew, boolean autoReply, OffsetDateTime updatedAt) {}

  /** 서명 이미지 행 — 바이트는 storagePath(파일 저장소 상대경로)에 있다. */
  public record ImageRow(long id, String storagePath, String mimeType, int sizeBytes) {}

  /** 서명 행으로 읽는 열 — 조회(find)와 upsert 의 RETURNING 이 같은 열·같은 순서를 쓴다. */
  private static final List<SelectField<?>> SIGNATURE_FIELDS =
      List.of(
          MAIL_SIGNATURE.HTML,
          MAIL_SIGNATURE.AUTO_NEW,
          MAIL_SIGNATURE.AUTO_REPLY,
          MAIL_SIGNATURE.UPDATED_AT);

  /** {@link #SIGNATURE_FIELDS} 로 읽은 레코드를 서명 행으로 바꾼다. */
  private static SignatureRow toSignatureRow(Record r) {
    return new SignatureRow(
        r.get(MAIL_SIGNATURE.HTML),
        r.get(MAIL_SIGNATURE.AUTO_NEW),
        r.get(MAIL_SIGNATURE.AUTO_REPLY),
        r.get(MAIL_SIGNATURE.UPDATED_AT));
  }

  /** 내 서명 행(없으면 empty). */
  public Optional<SignatureRow> find(long userId) {
    return dsl.select(SIGNATURE_FIELDS)
        .from(MAIL_SIGNATURE)
        .where(MAIL_SIGNATURE.USER_ID.eq(userId))
        .fetchOptional(MailSignatureRepository::toSignatureRow);
  }

  /** 서명을 넣거나 덮어쓴다(테넌트·사용자당 한 행). updated_at 은 지금으로 바꾼다. */
  public SignatureRow upsert(long userId, String html, boolean autoNew, boolean autoReply) {
    return dsl.insertInto(MAIL_SIGNATURE)
        .set(MAIL_SIGNATURE.USER_ID, userId)
        .set(MAIL_SIGNATURE.HTML, html)
        .set(MAIL_SIGNATURE.AUTO_NEW, autoNew)
        .set(MAIL_SIGNATURE.AUTO_REPLY, autoReply)
        .onConflict(MAIL_SIGNATURE.TENANT_ID, MAIL_SIGNATURE.USER_ID)
        .doUpdate()
        .set(MAIL_SIGNATURE.HTML, html)
        .set(MAIL_SIGNATURE.AUTO_NEW, autoNew)
        .set(MAIL_SIGNATURE.AUTO_REPLY, autoReply)
        .set(MAIL_SIGNATURE.UPDATED_AT, DSL.currentOffsetDateTime())
        .returningResult(SIGNATURE_FIELDS)
        .fetchOne(MailSignatureRepository::toSignatureRow);
  }

  /** 서명 이미지 행을 넣고 id 를 돌려준다. */
  public long insertImage(long userId, String storagePath, String mimeType, int sizeBytes) {
    return dsl.insertInto(MAIL_SIGNATURE_IMAGE)
        .set(MAIL_SIGNATURE_IMAGE.USER_ID, userId)
        .set(MAIL_SIGNATURE_IMAGE.STORAGE_PATH, storagePath)
        .set(MAIL_SIGNATURE_IMAGE.MIME_TYPE, mimeType)
        .set(MAIL_SIGNATURE_IMAGE.SIZE_BYTES, sizeBytes)
        .returning(MAIL_SIGNATURE_IMAGE.ID)
        .fetchOne()
        .getId();
  }

  /** 내 서명 이미지 하나(남의 것·없는 id 는 empty). */
  public Optional<ImageRow> findImage(long userId, long imageId) {
    return findImages(userId, List.of(imageId)).stream().findFirst();
  }

  /** 내 서명 이미지 중 ids 에 든 것만(남의 것·없는 id 는 빠진다. 순서 보장 없음). */
  public List<ImageRow> findImages(long userId, Collection<Long> imageIds) {
    if (imageIds.isEmpty()) return List.of();
    return dsl.select(
            MAIL_SIGNATURE_IMAGE.ID,
            MAIL_SIGNATURE_IMAGE.STORAGE_PATH,
            MAIL_SIGNATURE_IMAGE.MIME_TYPE,
            MAIL_SIGNATURE_IMAGE.SIZE_BYTES)
        .from(MAIL_SIGNATURE_IMAGE)
        .where(MAIL_SIGNATURE_IMAGE.USER_ID.eq(userId))
        .and(MAIL_SIGNATURE_IMAGE.ID.in(imageIds))
        .fetch(r -> new ImageRow(r.value1(), r.value2(), r.value3(), r.value4()));
  }

  /** {@link #findImages} 를 id → 행 맵으로(남의 것·없는 id 는 키가 없다). 서명 저장·발송용 사본이 id 로 찾아 쓴다. */
  public Map<Long, ImageRow> findImagesById(long userId, Collection<Long> imageIds) {
    return findImages(userId, imageIds).stream()
        .collect(Collectors.toMap(ImageRow::id, Function.identity()));
  }
}
