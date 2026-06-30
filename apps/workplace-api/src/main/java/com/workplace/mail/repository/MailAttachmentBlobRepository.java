package com.workplace.mail.repository;

import static com.workplace.jooq.Tables.CONTENT_ATTACHMENT;
import static com.workplace.jooq.Tables.MAIL_ATTACHMENT_BLOB;

import com.workplace.mail.dto.AttachmentCacheUsage;
import java.util.Collection;
import java.util.List;
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

  /**
   * 후보 해시 중 content_attachment 가 더 이상 참조하지 않는 고아 blob 의 DB 행을 삭제하고, 삭제된 file_ref 목록을 반환한다.
   *
   * <p>blob 은 content_hash 로 메시지·계정 간 dedup 공유되므로, 계정 purge 로 일부 content_attachment 가 사라진 뒤 "아무
   * content_attachment 도 안 쓰는" 해시만 안전하게 정리한다. 디스크 파일 삭제는 호출측이 커밋 이후 수행한다.
   *
   * @param candidateHashes purge 대상 계정이 참조하던 content_hash 후보 집합
   * @return 삭제된 blob 의 file_ref 목록(디스크 삭제 대상)
   */
  public List<String> deleteOrphanBlobsByHash(Collection<String> candidateHashes) {
    if (candidateHashes == null || candidateHashes.isEmpty()) return List.of();
    return dsl.deleteFrom(MAIL_ATTACHMENT_BLOB)
        .where(MAIL_ATTACHMENT_BLOB.CONTENT_HASH.in(candidateHashes))
        .andNotExists(
            dsl.selectOne()
                .from(CONTENT_ATTACHMENT)
                .where(CONTENT_ATTACHMENT.CONTENT_HASH.eq(MAIL_ATTACHMENT_BLOB.CONTENT_HASH)))
        .returning(MAIL_ATTACHMENT_BLOB.FILE_REF)
        .fetch(MAIL_ATTACHMENT_BLOB.FILE_REF);
  }
}
