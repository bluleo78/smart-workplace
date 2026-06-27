package com.workplace.mail.service;

import static com.workplace.jooq.Tables.CONTENT_ATTACHMENT;
import static com.workplace.jooq.Tables.MAIL_ATTACHMENT_BLOB;

import com.workplace.mail.dto.AttachmentCacheUsage;
import com.workplace.mail.repository.MailAttachmentBlobRepository;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 첨부 캐시 사용량 메터링(가시성만, 쿼터 강제 없음). 물리=실제 저장, 논리=dedup 전 합. */
@Service
@RequiredArgsConstructor
public class MailAttachmentMeteringService {

  private final MailAttachmentBlobRepository blobRepo;
  private final DSLContext dsl;

  /** 현재 테넌트(GUC) 사용량. 논리=캐시된 hash 를 참조하는 content_attachment.size_bytes 합. */
  @Transactional(readOnly = true)
  public AttachmentCacheUsage currentTenantUsage() {
    AttachmentCacheUsage physical = blobRepo.usage(); // physicalBytes, blobCount
    Long logical =
        dsl.select(DSL.coalesce(DSL.sum(CONTENT_ATTACHMENT.SIZE_BYTES), DSL.inline(0)))
            .from(CONTENT_ATTACHMENT)
            .where(
                DSL.exists(
                    dsl.selectOne()
                        .from(MAIL_ATTACHMENT_BLOB)
                        .where(
                            MAIL_ATTACHMENT_BLOB.CONTENT_HASH.eq(CONTENT_ATTACHMENT.CONTENT_HASH))))
            .fetchOne(0, Long.class);
    return new AttachmentCacheUsage(
        physical.physicalBytes(), logical == null ? 0L : logical, physical.blobCount());
  }
}
