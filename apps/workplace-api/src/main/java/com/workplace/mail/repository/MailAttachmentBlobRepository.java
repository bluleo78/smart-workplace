package com.workplace.mail.repository;

import static com.workplace.jooq.Tables.MAIL_ATTACHMENT_BLOB;

import com.workplace.mail.dto.AttachmentCacheUsage;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Repository;

/** mail_attachment_blob(per-tenant-hash dedup 된 암호화 바이너리) 리포지토리. */
@Repository
@RequiredArgsConstructor
public class MailAttachmentBlobRepository {

  private final DSLContext dsl;

  /** blob 참조(id + 디스크 file_ref). */
  public record BlobRef(long id, String fileRef) {}

  /** 테넌트 GUC 스코프에서 hash 로 blob 조회. evict 됐으면 empty. */
  public Optional<BlobRef> findByHash(String contentHash) {
    return dsl.select(MAIL_ATTACHMENT_BLOB.ID, MAIL_ATTACHMENT_BLOB.FILE_REF)
        .from(MAIL_ATTACHMENT_BLOB)
        .where(MAIL_ATTACHMENT_BLOB.CONTENT_HASH.eq(contentHash))
        .fetchOptional(r -> new BlobRef(r.value1(), r.value2()));
  }

  /** 캐시 hit 시 슬라이딩 TTL 갱신. */
  public void touch(String contentHash) {
    dsl.update(MAIL_ATTACHMENT_BLOB)
        .set(MAIL_ATTACHMENT_BLOB.LAST_ACCESSED_AT, DSL.currentOffsetDateTime())
        .where(MAIL_ATTACHMENT_BLOB.CONTENT_HASH.eq(contentHash))
        .execute();
  }

  /**
   * blob 등록. ON CONFLICT (tenant_id, content_hash) DO NOTHING — 동시 재fetch 가 같은 hash 를 동시에 쓰는 경쟁을
   * 흡수(본문 dedup 과 동일 패턴). 패배한 호출자는 이후 findByHash 로 승자 file_ref 를 쓴다.
   */
  public void insertIfAbsent(String contentHash, String fileRef, long sizeBytes) {
    dsl.insertInto(MAIL_ATTACHMENT_BLOB)
        .set(MAIL_ATTACHMENT_BLOB.CONTENT_HASH, contentHash)
        .set(MAIL_ATTACHMENT_BLOB.FILE_REF, fileRef)
        .set(MAIL_ATTACHMENT_BLOB.SIZE_BYTES, sizeBytes)
        .onConflict(MAIL_ATTACHMENT_BLOB.TENANT_ID, MAIL_ATTACHMENT_BLOB.CONTENT_HASH)
        .doNothing()
        .execute();
  }

  /** 테넌트 물리 사용량(distinct blob size 합) + blob 수. dedup 절감률은 메터링 서비스가 논리합과 비교. */
  public AttachmentCacheUsage usage() {
    var rec =
        dsl.select(
                DSL.coalesce(DSL.sum(MAIL_ATTACHMENT_BLOB.SIZE_BYTES), DSL.inline(0)).as("phys"),
                DSL.count().as("cnt"))
            .from(MAIL_ATTACHMENT_BLOB)
            .fetchOne();
    long physical = rec.get("phys", Long.class);
    long count = rec.get("cnt", Integer.class).longValue();
    // logicalBytes 는 의도적으로 0L 로 두고, 호출자(MailAttachmentMeteringService.currentTenantUsage())에서
    // 계산·덮어씀
    return new AttachmentCacheUsage(physical, 0L, count);
  }
}
