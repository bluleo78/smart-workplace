package com.workplace.mail.service;

import static com.workplace.jooq.Tables.CONTENT_ATTACHMENT;
import static com.workplace.jooq.Tables.EMAIL_MESSAGE;
import static com.workplace.jooq.Tables.MAIL_ATTACHMENT_BLOB;

import com.workplace.global.tenant.TenantContext;
import com.workplace.mail.repository.MailAttachmentPreviewRepository;
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
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.jooq.DSLContext;
import org.jooq.Select;
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
 *   <li><b>TTL 만료</b>: {@code now - last_accessed_at > ttl-days} — 장기 미사용 blob 퇴거. 단 로컬 보낸
 *       메일(imap_uid· provider_message_id 모두 NULL)의 첨부가 참조하는 blob 은 제외한다(WP-574) — 원본 서버에서 다시 받을 좌표가
 *       없어 blob 이 유일한 사본이다. 그 메일이 지워지면 아래 refcount-0 으로 지운다.
 *   <li><b>refcount-0</b>: 해당 hash 를 참조하는 content_attachment 가 없는 경우 — content GC 후 남은 고아 blob.
 * </ol>
 *
 * <p>삭제 순서: DB 행 삭제(트랜잭션) → 디스크 파일 삭제(커밋 후 best-effort). 파일 삭제 실패는 경고 로그만(고아 파일은 orphan-file 백스톱이
 * 재정리).
 *
 * <p>추가로 {@code baseDir/tenant-{id}/mail} 디렉터리를 walk 하여 DB 행 없이 남은 고아 파일을 정리하는 백스톱 스윕을 수행한다(mtime
 * 1시간 이상 경과한 파일만 — in-flight store 와의 레이스 방지). baseDir 는 통합 스토리지 루트라 반드시 mail 세그먼트로 한정해야 한다 — 다른 모듈
 * 파일까지 지운다.
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
  private final MailAttachmentPreviewRepository previewRepo;
  private final long ttlDays;

  public MailAttachmentBlobGcSweeper(
      TenantRepository tenantRepository,
      DSLContext dsl,
      PlatformTransactionManager txManager,
      MailAttachmentBlobStore blobStore,
      MailAttachmentPreviewRepository previewRepo,
      @Value("${workplace.storage.mail.ttl-days:7}") long ttlDays) {
    this.tenantRepository = tenantRepository;
    this.dsl = dsl;
    // @Primary TenantAwareTransactionManager 사용 — 트랜잭션 진입 시 GUC 주입
    this.txTemplate = new TransactionTemplate(txManager);
    this.blobStore = blobStore;
    this.previewRepo = previewRepo;
    this.ttlDays = ttlDays;
  }

  /** 스케줄 진입점 — 이전 사이클 완료 후 1시간 뒤 재실행. 기동 후 2분 뒤 첫 실행으로 초기화를 기다린다. */
  @Scheduled(fixedDelay = 3_600_000, initialDelay = 120_000)
  @SchedulerLock(name = "MailAttachmentBlobGcSweeper.scheduled")
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
   *   <li>참조가 0 인 미리보기(WP-432) 행 삭제와 파일 삭제(같은 트랜잭션 — 행 잠금을 쥔 채).
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
                            .and(DSL.notExists(localSentReference()))
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
      sweepUnreferencedPreviews(tenantId);
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

    // 5) 미리보기 refcount-0 정리.
    sweepUnreferencedPreviews(tenantId);
  }

  /**
   * 이 blob 해시를 참조하는 로컬 보낸 메일 첨부(WP-574) — 보낸 메일 행은 imap_uid·provider_message_id 가 모두 NULL 이다(V141 과
   * 같은 판별). 그런 첨부는 다시 받을 원본이 없으므로 TTL 로 퇴거하지 않는다.
   */
  private Select<?> localSentReference() {
    return dsl.selectOne()
        .from(CONTENT_ATTACHMENT)
        .join(EMAIL_MESSAGE)
        .on(EMAIL_MESSAGE.CONTENT_ID.eq(CONTENT_ATTACHMENT.CONTENT_ID))
        .where(CONTENT_ATTACHMENT.CONTENT_HASH.eq(MAIL_ATTACHMENT_BLOB.CONTENT_HASH))
        .and(EMAIL_MESSAGE.IMAP_UID.isNull())
        .and(EMAIL_MESSAGE.PROVIDER_MESSAGE_ID.isNull());
  }

  /**
   * 어떤 content_attachment 도 해시를 참조하지 않는 미리보기 행을 지우고, <b>같은 트랜잭션 안에서</b> 파일도 지운다(WP-432).
   *
   * <p>커밋 뒤에 지우면, 그 사이 같은 해시를 새로 선점·변환한 작업의 결과 파일(결정적 경로라 같은 위치)을 지울 수 있다. DELETE 로 잡은 행 잠금을 쥔 채
   * 파일을 지우면 같은 키의 선점 업서트는 커밋까지 기다린다. 행을 먼저 지우므로 진행 중이던 변환 작업은 READY 기록(CAS)에 실패해 스스로 결과를 지운다. 유효
   * 리스의 CONVERTING 행은 저장소가 남긴다. 파일 삭제 실패는 건별로 삼킨다 — 행 삭제까지 롤백되지 않게.
   */
  private void sweepUnreferencedPreviews(Long tenantId) {
    Integer count =
        txTemplate.execute(
            status -> {
              List<String> paths = previewRepo.deleteAllUnreferenced();
              paths.forEach(blobStore::deleteQuietly);
              return paths.size();
            });
    if (count != null && count > 0) {
      log.info("테넌트 {} 참조 없는 미리보기 {} 건 정리", tenantId, count);
    }
  }

  /**
   * 디스크 {@code baseDir/tenant-{tenantId}/mail} 디렉터리를 walk 하여 DB 에 대응 blob 행이 없고 mtime 1시간 이상 경과한
   * 파일을 삭제한다.
   *
   * <p>walk 루트는 mail 세그먼트로 좁히되, {@code relRef} 계산 기준은 {@code baseDir()} 를 유지해야 한다 — {@code
   * file_ref} 가 {@code tenant-{id}/mail/...} 형태라 기준을 바꾸면 살아 있는 blob 이 전부 고아로 뒤집힌다.
   *
   * <p>in-flight store(파일 기록 완료·DB 미커밋) 와의 레이스를 방지하기 위해 mtime 이 {@code ORPHAN_FILE_MIN_AGE_SECONDS}
   * 이상 경과한 파일만 대상으로 한다.
   */
  void sweepOrphanFiles(Long tenantId) {
    if (tenantId == null) return;
    // baseDir 는 통합 스토리지 루트다. "tenant-{id}" 까지만 잡으면 Drive·메시징·위키 첨부까지 walk 대상이 되고,
    // 그것들은 mail_attachment_blob 에 없으므로 전부 고아로 판정돼 삭제된다(운영 파일 전량 소실 회귀).
    // store() 의 저장 레이아웃(tenant-{id}/mail/...)과 맞춰 메일 세그먼트 안만 훑는다.
    Path tenantDir = blobStore.baseDir().resolve("tenant-" + tenantId).resolve("mail");
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
