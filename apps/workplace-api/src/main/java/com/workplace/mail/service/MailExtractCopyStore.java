package com.workplace.mail.service;

import static com.workplace.jooq.Tables.FILE;

import com.workplace.file.storage.FilePathBuilder;
import com.workplace.file.storage.FileStore;
import com.workplace.file.storage.StorageDomain;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import org.jooq.DSLContext;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * 메일 첨부 텍스트 추출용 평문 사본 저장소(WP-358).
 *
 * <p>공용 추출 파이프라인은 코어 file 행(file_extraction FK)과 워커가 읽을 평문 storage_path 를 전제로 한다. 메일 첨부 캐시 blob 은
 * 암호화·hash 키·독자 TTL 이라 워커가 읽을 수 없어, 추출이 필요할 때만 평문 사본을 코어 file 로 만든다. 사본은 만료(expires_at) 를 달고 생성되어
 * FileCleanupService 가 회수한다 — 별도 GC 가 필요 없다. 읽힐 때마다 만료를 미뤄(슬라이딩 TTL) 에이전트가 구간을 이어 읽는 동안 사라지지 않게 한다.
 */
@Component
public class MailExtractCopyStore {

  private final DSLContext dsl;
  private final FilePathBuilder pathBuilder;
  private final FileStore fileStore;

  /** 사본 보존 기간(일). 첨부 캐시 blob TTL(workplace.storage.mail.ttl-days, 기본 7일)과 같은 기본값. */
  private final long ttlDays;

  public MailExtractCopyStore(
      DSLContext dsl,
      FilePathBuilder pathBuilder,
      FileStore fileStore,
      @Value("${workplace.storage.mail.extract-ttl-days:7}") long ttlDays) {
    this.dsl = dsl;
    this.pathBuilder = pathBuilder;
    this.fileStore = fileStore;
    this.ttlDays = ttlDays;
  }

  /**
   * 평문 바이트를 tenant-{id}/mail-extract/... 에 쓰고 만료가 달린 file 행을 만든다. 테넌트 컨텍스트·트랜잭션 안에서 호출해야 한다.
   *
   * @return 생성된 file.id
   */
  public long store(byte[] content, String filename, String mime, long uploaderId) {
    String relativePath = pathBuilder.build(StorageDomain.MAIL_EXTRACT, filename);
    fileStore.storeBytes(relativePath, content);
    OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);
    return dsl.insertInto(FILE)
        .set(FILE.ORIGINAL_NAME, filename)
        .set(FILE.STORED_NAME, relativePath.substring(relativePath.lastIndexOf('/') + 1))
        .set(FILE.MIME_TYPE, mime)
        .set(FILE.SIZE_BYTES, (long) content.length)
        .set(FILE.CATEGORY, "ATTACHMENT")
        .set(FILE.STORAGE_PATH, relativePath)
        .set(FILE.UPLOADED_BY, uploaderId)
        .set(FILE.CREATED_AT, now)
        .set(FILE.EXPIRES_AT, now.plusDays(ttlDays))
        .returning(FILE.ID)
        .fetchOne()
        .getId();
  }

  /**
   * 사본 만료를 지금부터 TTL 뒤로 미룬다(슬라이딩). 사본이 이미 정리됐으면 false — 호출자가 사본을 다시 만든다.
   *
   * <p>정리 스윕이 행을 잠그고 지우는 중이면 이 UPDATE 가 그 커밋을 기다린 뒤 0행이 된다.
   */
  public boolean touch(long fileId) {
    OffsetDateTime expiresAt = OffsetDateTime.now(ZoneOffset.UTC).plusDays(ttlDays);
    return dsl.update(FILE)
            .set(FILE.EXPIRES_AT, expiresAt)
            .where(FILE.ID.eq(fileId))
            .and(FILE.EXPIRES_AT.isNotNull())
            .execute()
        > 0;
  }
}
