package com.workplace.mail.service;

import static com.workplace.jooq.Tables.FILE;

import com.workplace.file.api.InternalFileCategories;
import com.workplace.file.storage.FilePathBuilder;
import com.workplace.file.storage.FileStore;
import com.workplace.file.storage.StorageDomain;
import com.workplace.global.util.SafeFileNames;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Optional;
import lombok.extern.slf4j.Slf4j;
import org.jooq.DSLContext;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/**
 * 메일 첨부 텍스트 추출용 평문 사본 저장소(WP-358).
 *
 * <p>공용 추출 파이프라인은 코어 file 행(file_extraction FK)과 워커가 읽을 평문 storage_path 를 전제로 한다. 메일 첨부 캐시 blob 은
 * 암호화·hash 키·독자 TTL 이라 워커가 읽을 수 없어, 추출이 필요할 때만 평문 사본을 코어 file 로 만든다.
 *
 * <p>수명(평문 노출 최소화):
 *
 * <ul>
 *   <li><b>바이너리</b>: 추출 결과가 확정되면({@link MailExtractCopyReleaser}) 즉시 지운다 — 워커 처리 시간(수 분)만 디스크에 남는다.
 *   <li><b>file 행·추출 텍스트</b>: 생성 시각부터 고정 TTL(기본 7일, 읽어도 연장하지 않음) 뒤 FileCleanupService 가 회수한다. 원본 메일
 *       content 가 지워지면(계정 purge·content GC) 그 자리에서 즉시 만료시킨다(EmailContentRepository).
 * </ul>
 *
 * <p>사용자 임시 업로드와 구분되도록 전용 카테고리 {@value #CATEGORY} 로 만든다 — 코어 업로더 경로(/api/v1/files)와 첨부 바인딩
 * 검증(ATTACHMENT 만 허용)이 이 사본을 내려주거나 영구 첨부로 승격하지 못하게 한다.
 */
@Slf4j
@Component
public class MailExtractCopyStore {

  /** 사본 전용 file.category — 업로드·바인딩 경로가 받는 ATTACHMENT 와 구분한다. */
  public static final String CATEGORY = InternalFileCategories.MAIL_EXTRACT;

  private final DSLContext dsl;
  private final FilePathBuilder pathBuilder;
  private final FileStore fileStore;

  /**
   * 사본 file 행 최대 수명(일) — 생성 시각 기준 고정. 첨부 캐시 blob TTL(workplace.storage.mail.ttl-days, 기본 7일)과 같은
   * 기본값.
   */
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
   * 평문 바이트를 tenant-{id}/mail-extract/... 에 쓰고 만료가 달린 사본 file 행을 만든다. 테넌트 컨텍스트·트랜잭션 안에서 호출해야 한다.
   *
   * <p>트랜잭션이 롤백되면 file 행은 사라지는데 디스크 평문은 남고, 이 세그먼트를 훑는 스윕이 없어 영구 고아가 된다. 그래서 롤백 완료 시 바이너리를
   * 지운다(WikiAttachmentService 의 커밋 후 unlink 와 대칭).
   *
   * @return 생성된 file.id
   */
  public long store(byte[] content, String filename, String mime, long uploaderId) {
    String relativePath = pathBuilder.build(StorageDomain.MAIL_EXTRACT, filename);
    fileStore.storeBytes(relativePath, content);
    registerRollbackCleanup(relativePath);
    OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);
    return dsl.insertInto(FILE)
        .set(FILE.ORIGINAL_NAME, SafeFileNames.fitLength(filename))
        .set(FILE.STORED_NAME, relativePath.substring(relativePath.lastIndexOf('/') + 1))
        .set(FILE.MIME_TYPE, mime)
        .set(FILE.SIZE_BYTES, (long) content.length)
        .set(FILE.CATEGORY, CATEGORY)
        .set(FILE.STORAGE_PATH, relativePath)
        .set(FILE.UPLOADED_BY, uploaderId)
        .set(FILE.CREATED_AT, now)
        .set(FILE.EXPIRES_AT, now.plusDays(ttlDays))
        .returning(FILE.ID)
        .fetchOne()
        .getId();
  }

  /**
   * 사본이 아직 유효한지 — 행이 있고 만료 전이면 true. 만료됐지만 아직 정리 전인 사본은 false 로 보고 호출자가 새로 만든다(만료를 연장하지 않는다 — 수명은
   * 생성 시각 기준 고정).
   */
  public boolean isLive(long fileId) {
    return dsl.fetchExists(
        dsl.selectOne()
            .from(FILE)
            .where(FILE.ID.eq(fileId))
            .and(FILE.CATEGORY.eq(CATEGORY))
            .and(FILE.EXPIRES_AT.gt(OffsetDateTime.now(ZoneOffset.UTC))));
  }

  /** 사본이면 평문 바이너리 경로를 돌려준다(추출 확정 후 삭제용). 사본이 아니면(드라이브·첨부 등 다른 파일) empty — 남의 파일을 지우지 않는다. */
  public Optional<String> copyStoragePath(long fileId) {
    return dsl.select(FILE.STORAGE_PATH)
        .from(FILE)
        .where(FILE.ID.eq(fileId))
        .and(FILE.CATEGORY.eq(CATEGORY))
        .fetchOptional(FILE.STORAGE_PATH);
  }

  /** 평문 바이너리 삭제(best-effort). file 행·추출 텍스트는 남는다 — /text 구간 읽기는 바이너리를 쓰지 않는다. */
  public void deleteBinary(String relativePath) {
    try {
      fileStore.deleteIfExists(relativePath);
    } catch (RuntimeException e) {
      log.warn("메일 추출 사본 바이너리 삭제 실패(무시) path={}", relativePath, e);
    }
  }

  /** 롤백 완료 시 방금 쓴 평문 바이너리를 지운다. 트랜잭션 밖 호출이면 등록하지 않는다(호출 계약상 항상 트랜잭션 안). */
  private void registerRollbackCleanup(String relativePath) {
    if (!TransactionSynchronizationManager.isSynchronizationActive()) return;
    TransactionSynchronizationManager.registerSynchronization(
        new TransactionSynchronization() {
          @Override
          public void afterCompletion(int status) {
            if (status == STATUS_ROLLED_BACK) {
              deleteBinary(relativePath);
            }
          }
        });
  }
}
