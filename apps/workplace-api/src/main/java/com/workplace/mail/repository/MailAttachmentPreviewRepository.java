package com.workplace.mail.repository;

import static com.workplace.jooq.Tables.CONTENT_ATTACHMENT;
import static com.workplace.jooq.Tables.MAIL_ATTACHMENT_PREVIEW;

import com.workplace.filepreview.repository.AbstractPreviewStateRepository;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import org.jooq.Condition;
import org.jooq.DSLContext;
import org.jooq.Field;
import org.jooq.Table;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Repository;

/**
 * mail_attachment_preview 테이블 접근 — 메일 첨부({@code (tenant_id, content_hash)} 키)의 문서 미리보기 상태(WP-432).
 *
 * <p>선점·리스 CAS·결과 기록 SQL 은 {@link AbstractPreviewStateRepository} 가 드라이브와 공유한다. 이 클래스는 키 매핑과
 * refcount-0 정리만 둔다. RLS 대상 테이블이라 키 조건에는 해시만 쓰고 테넌트는 GUC 가 거른다 — 호출자는 테넌트 GUC 가 심긴 트랜잭션 안에서 불러야 한다.
 */
@Repository
public class MailAttachmentPreviewRepository
    extends AbstractPreviewStateRepository<MailPreviewKey> {

  public MailAttachmentPreviewRepository(DSLContext dsl) {
    super(dsl);
  }

  @Override
  protected Table<?> table() {
    return MAIL_ATTACHMENT_PREVIEW;
  }

  @Override
  protected Condition keyIs(MailPreviewKey key) {
    return MAIL_ATTACHMENT_PREVIEW.CONTENT_HASH.eq(key.contentHash());
  }

  @Override
  protected List<Field<?>> conflictKeys() {
    return List.of(MAIL_ATTACHMENT_PREVIEW.TENANT_ID, MAIL_ATTACHMENT_PREVIEW.CONTENT_HASH);
  }

  @Override
  protected Map<Field<?>, Object> keyValues(MailPreviewKey key, long tenantId) {
    return Map.of(
        MAIL_ATTACHMENT_PREVIEW.TENANT_ID,
        tenantId,
        MAIL_ATTACHMENT_PREVIEW.CONTENT_HASH,
        key.contentHash());
  }

  /** READY 때 결정적 경로를 blob_path 에 함께 기록한다. */
  @Override
  protected Map<Field<?>, Object> readyExtras(MailPreviewKey key) {
    return Map.of(MAIL_ATTACHMENT_PREVIEW.BLOB_PATH, key.previewRef());
  }

  /**
   * 후보 해시 중 어떤 {@code content_attachment} 도 더는 참조하지 않는 미리보기 행을 지운다(계정 purge 의 refcount-0 정리).
   *
   * @return 지운 행의 blob_path(null 제외) — 호출자가 파일을 지운다
   */
  public List<String> deleteUnreferenced(Collection<String> candidateHashes) {
    if (candidateHashes.isEmpty()) {
      return List.of();
    }
    return deleteWhere(
        MAIL_ATTACHMENT_PREVIEW.CONTENT_HASH.in(candidateHashes).and(unreferenced()));
  }

  /**
   * 후보 제한 없이 참조가 0 인 미리보기 행을 모두 지운다(시간별 GC 용). 유효 리스를 가진 CONVERTING 행은 진행 중인 변환이라 남긴다.
   *
   * @return 지운 행의 blob_path(null 제외)
   */
  public List<String> deleteAllUnreferenced() {
    Condition activeLease =
        MAIL_ATTACHMENT_PREVIEW
            .STATUS
            .eq("CONVERTING")
            .and(MAIL_ATTACHMENT_PREVIEW.LEASED_UNTIL.gt(DSL.currentOffsetDateTime()));
    return deleteWhere(unreferenced().andNot(activeLease));
  }

  /** 같은 테넌트·같은 해시를 참조하는 content_attachment 가 하나도 없다(RLS 를 우회하는 소유자 연결에서도 맞도록 테넌트까지 맞춘다). */
  private static Condition unreferenced() {
    return DSL.notExists(
        DSL.selectOne()
            .from(CONTENT_ATTACHMENT)
            .where(CONTENT_ATTACHMENT.TENANT_ID.eq(MAIL_ATTACHMENT_PREVIEW.TENANT_ID))
            .and(CONTENT_ATTACHMENT.CONTENT_HASH.eq(MAIL_ATTACHMENT_PREVIEW.CONTENT_HASH)));
  }

  private List<String> deleteWhere(Condition condition) {
    return dsl
        .deleteFrom(MAIL_ATTACHMENT_PREVIEW)
        .where(condition)
        .returningResult(MAIL_ATTACHMENT_PREVIEW.BLOB_PATH)
        .fetch(MAIL_ATTACHMENT_PREVIEW.BLOB_PATH)
        .stream()
        .filter(Objects::nonNull)
        .toList();
  }
}
