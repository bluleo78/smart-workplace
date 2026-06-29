package com.workplace.mail.service;

import static com.workplace.jooq.Tables.CONTENT_ATTACHMENT;
import static com.workplace.jooq.Tables.MAIL_ATTACHMENT_BLOB;

import com.workplace.global.tenant.TenantContext;
import com.workplace.tenant.repository.TenantRepository;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;
import lombok.extern.slf4j.Slf4j;
import org.jooq.DSLContext;
import org.jooq.impl.DSL;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 메일 첨부 캐시 blob 의 정기 GC(Garbage Collection) 스윕.
 *
 * <p>삭제 트리거:
 *
 * <ol>
 *   <li><b>TTL 만료</b>: {@code now - last_accessed_at > ttl-days} — 장기 미사용 blob 퇴거.
 *   <li><b>refcount-0</b>: 해당 hash 를 참조하는 content_attachment 가 없는 경우 — content GC 후 남은 고아 blob.
 * </ol>
 *
 * <p>삭제 순서: DB 행 삭제(트랜잭션) → 디스크 파일 삭제(커밋 후 best-effort). 파일 삭제 실패는 경고 로그만(고아 파일은 orphan-file 백스톱이
 * 재정리).
 *
 * <p>추가로 {@code baseDir/tenant-{id}} 디렉터리를 walk 하여 DB 행 없이 남은 고아 파일을 정리하는 백스톱 스윕을 수행한다(mtime 1시간 이상
 * 경과한 파일만 — in-flight store 와의 레이스 방지).
 *
 * <p>{@link MailContentGcSweeper} 와 동일한 {@code @Scheduled fixedDelay/initialDelay}, sweepAllTenants
 * TenantContext 루프, TransactionTemplate-per-tenant 패턴.
 */
@Slf4j
@Component
public class MailAttachmentBlobGcSweeper {

  /** 1시간 이상 경과한 고아 파일만 백스톱 삭제(in-flight store 레이스 방지). */
  private static final long ORPHAN_FILE_MIN_AGE_SECONDS = 3600L;

  /** TTL 만료·refcount-0 blob 을 담는 내부 레코드. */
  record BlobRow(long id, String fileRef) {}

  private final TenantRepository tenantRepository;
  private final DSLContext dsl;
  private final TransactionTemplate txTemplate;
  private final MailAttachmentBlobStore blobStore;
  private final long ttlDays;

  public MailAttachmentBlobGcSweeper(
      TenantRepository tenantRepository,
      DSLContext dsl,
      PlatformTransactionManager txManager,
      MailAttachmentBlobStore blobStore,
      @Value("${workplace.storage.mail.ttl-days:7}") long ttlDays) {
    this.tenantRepository = tenantRepository;
    this.dsl = dsl;
    // @Primary TenantAwareTransactionManager 사용 — 트랜잭션 진입 시 GUC 주입
    this.txTemplate = new TransactionTemplate(txManager);
    this.blobStore = blobStore;
    this.ttlDays = ttlDays;
  }

  /** 스케줄 진입점 — 이전 사이클 완료 후 1시간 뒤 재실행. 기동 후 2분 뒤 첫 실행으로 초기화를 기다린다. */
  @Scheduled(fixedDelay = 3_600_000, initialDelay = 120_000)
  public void scheduled() {
    sweepAllTenants();
  }

  /**
   * 모든 활성 테넌트를 순회하며 TTL 만료·refcount-0 blob 을 퇴거한다.
   *
   * <p>테스트에서 직접 호출하는 진입점. 각 테넌트마다 {@link TenantContext}를 세팅해 트랜잭션 시작 시 {@code
   * TenantAwareTransactionManager}가 GUC 를 주입하도록 한다.
   */
  public void sweepAllTenants() {
    List<Long> tenantIds = tenantRepository.findActiveTenantIds();
    log.debug("첨부 blob GC 스윕 시작 — 활성 테넌트 {}개", tenantIds.size());

    for (Long tenantId : tenantIds) {
      try {
        TenantContext.set(tenantId);
        sweepTenant();
      } catch (Exception e) {
        log.warn("테넌트 {} 첨부 blob GC 스윕 실패 — 건너뜀", tenantId, e);
      } finally {
        TenantContext.clear();
      }
    }

    log.debug("첨부 blob GC 스윕 완료");
  }

  /**
   * 현재 테넌트(TenantContext 기준)의 TTL 만료·refcount-0 blob 을 퇴거한다.
   *
   * <p>순서:
   *
   * <ol>
   *   <li>삭제 대상(doomed) 수집 — TTL 초과 OR refcount-0 (트랜잭션).
   *   <li>DB 행 id 로 삭제 (트랜잭션).
   *   <li>디스크 파일 삭제 (커밋 후 best-effort).
   *   <li>orphan-file 백스톱 스윕.
   * </ol>
   */
  public void sweepTenant() {
    Long tenantId = TenantContext.get();
    OffsetDateTime cutoff = OffsetDateTime.now().minusDays(ttlDays);

    // 1) 삭제 대상 blob(id, file_ref) 수집 — TTL 초과 OR refcount-0.
    List<BlobRow> doomed =
        txTemplate.execute(
            status ->
                dsl.select(MAIL_ATTACHMENT_BLOB.ID, MAIL_ATTACHMENT_BLOB.FILE_REF)
                    .from(MAIL_ATTACHMENT_BLOB)
                    .where(
                        MAIL_ATTACHMENT_BLOB
                            .LAST_ACCESSED_AT
                            .lt(cutoff)
                            .or(
                                DSL.notExists(
                                    dsl.selectOne()
                                        .from(CONTENT_ATTACHMENT)
                                        .where(
                                            CONTENT_ATTACHMENT.CONTENT_HASH.eq(
                                                MAIL_ATTACHMENT_BLOB.CONTENT_HASH)))))
                    .fetch(r -> new BlobRow(r.value1(), r.value2())));

    if (doomed == null || doomed.isEmpty()) {
      sweepOrphanFiles(tenantId);
      return;
    }

    // 2) DB 행 삭제(tx).
    List<Long> ids = doomed.stream().map(BlobRow::id).toList();
    txTemplate.executeWithoutResult(
        s -> dsl.deleteFrom(MAIL_ATTACHMENT_BLOB).where(MAIL_ATTACHMENT_BLOB.ID.in(ids)).execute());

    // 3) 디스크 파일 삭제(커밋 후 best-effort).
    for (BlobRow b : doomed) {
      try {
        blobStore.delete(b.fileRef());
      } catch (Exception e) {
        log.warn("첨부 blob 파일 삭제 실패(best-effort) — fileRef={}", b.fileRef(), e);
      }
    }
    log.info("테넌트 {} 첨부 blob {} 건 evict(TTL/refcount-0)", tenantId, doomed.size());

    // 4) orphan-file 백스톱: 디스크 파일 중 DB 행 없는 것 정리.
    sweepOrphanFiles(tenantId);
  }

  /**
   * 디스크 {@code baseDir/tenant-{tenantId}} 디렉터리를 walk 하여 DB 에 대응 blob 행이 없고 mtime 1시간 이상 경과한 파일을
   * 삭제한다.
   *
   * <p>in-flight store(파일 기록 완료·DB 미커밋) 와의 레이스를 방지하기 위해 mtime 이 {@code ORPHAN_FILE_MIN_AGE_SECONDS}
   * 이상 경과한 파일만 대상으로 한다.
   */
  void sweepOrphanFiles(Long tenantId) {
    if (tenantId == null) return;
    Path tenantDir = blobStore.baseDir().resolve("tenant-" + tenantId);
    if (!Files.exists(tenantDir)) return;

    // 현재 테넌트의 DB file_ref 전체 수집 (트랜잭션 — GUC 필요).
    Set<String> knownRefs =
        txTemplate.execute(
            status ->
                dsl.select(MAIL_ATTACHMENT_BLOB.FILE_REF)
                    .from(MAIL_ATTACHMENT_BLOB)
                    .fetchSet(MAIL_ATTACHMENT_BLOB.FILE_REF));

    if (knownRefs == null) knownRefs = Set.of();

    Instant cutoffMtime = Instant.now().minusSeconds(ORPHAN_FILE_MIN_AGE_SECONDS);
    int orphanCount = 0;

    try (var stream = Files.walk(tenantDir)) {
      List<Path> candidates = stream.filter(Files::isRegularFile).collect(Collectors.toList());

      for (Path file : candidates) {
        // 상대 경로를 baseDir 기준 file_ref 로 변환
        String relRef = blobStore.baseDir().relativize(file).toString();
        if (knownRefs.contains(relRef)) continue; // DB 에 존재 → 보존

        // mtime 유예: in-flight 파일 보호
        try {
          Instant mtime = Files.getLastModifiedTime(file).toInstant();
          if (mtime.isAfter(cutoffMtime)) continue; // 신규 파일 — 아직 DB 커밋 전일 수 있음
        } catch (IOException e) {
          log.warn("orphan-file mtime 조회 실패 — 건너뜀: {}", file, e);
          continue;
        }

        try {
          Files.deleteIfExists(file);
          orphanCount++;
          log.debug("orphan 첨부 blob 파일 삭제: {}", relRef);
        } catch (IOException e) {
          log.warn("orphan 첨부 blob 파일 삭제 실패 — 건너뜀: {}", file, e);
        }
      }
    } catch (UncheckedIOException | IOException e) {
      log.warn("테넌트 {} orphan-file 스윕 실패 — 건너뜀", tenantId, e);
    }

    if (orphanCount > 0) {
      log.info("테넌트 {} orphan 첨부 blob 파일 {} 건 삭제", tenantId, orphanCount);
    }
  }
}
