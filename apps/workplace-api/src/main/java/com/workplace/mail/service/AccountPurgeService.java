package com.workplace.mail.service;

import static com.workplace.jooq.Tables.CONTENT_ATTACHMENT;
import static com.workplace.jooq.Tables.EMAIL_MESSAGE;

import com.workplace.file.storage.FileStore;
import com.workplace.mail.repository.EmailAccountRepository;
import com.workplace.mail.repository.EmailContentRepository;
import com.workplace.mail.repository.MailAttachmentBlobRepository;
import java.util.List;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.jooq.DSLContext;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * soft-deleted 메일 계정의 물리 삭제(purge) 오케스트레이션.
 *
 * <p>화면에서는 disabled_at + 조회 필터로 이미 숨겨진 상태이며, 이 서비스는 백그라운드에서 실제 데이터를 완전히 제거한다.
 *
 * <p>절차: (1) 삭제 전 content_id·blob 해시 후보 수집 → (2) 단일 트랜잭션에서 계정 하드삭제(cascade) + 고아 본문 GC + 고아 blob DB
 * 행 삭제 → (3) 커밋 후 디스크 파일 best-effort 삭제. 모든 DB 단계는 호출 시점 TenantContext GUC 안에서 실행되어야 한다(스케줄러가 테넌트별로
 * set).
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class AccountPurgeService {

  private final DSLContext dsl;
  private final EmailAccountRepository accountRepo;
  private final EmailContentRepository contentRepo;
  private final MailAttachmentBlobRepository blobRepo;
  private final FileStore fileStore;
  private final PlatformTransactionManager txManager;

  /**
   * 한 계정을 완전 삭제한다. TenantContext 가 세팅된 상태에서 호출해야 한다(RLS).
   *
   * @param userId 계정 소유자(로깅·일관성용)
   * @param accountId purge 대상 계정 id
   */
  public void purgeAccount(long userId, long accountId) {
    // ⚠️ 모든 DB 단계를 단일 TransactionTemplate 안에서 수행해야 한다. TenantContext.set() 은
    // TenantAwareTransactionManager.doBegin 이 트랜잭션 시작 시점에 GUC(app.tenant_id)로 주입한다.
    // 트랜잭션 밖 bare dsl.* 호출은 GUC 미주입 → FORCE RLS fail-closed → 빈 결과 → 고아 본문/blob
    // 이 조용히 누수된다(#492/#517/#525/#444 동일 함정). 따라서 후보 수집(SELECT)도 트랜잭션 안에서.
    //
    // 순서: (1) 삭제 전 content_id·blob 해시 후보 수집 → (2) 계정 하드삭제(cascade: 메시지·첨부·캘린더·일정)
    //       → (3) 고아 본문 GC(→content_attachment cascade) → (4) 고아 blob DB 행 삭제(+fileRef 수집).
    List<String> orphanFileRefs =
        new TransactionTemplate(txManager)
            .execute(
                status -> {
                  List<Long> contentIds =
                      dsl.selectDistinct(EMAIL_MESSAGE.CONTENT_ID)
                          .from(EMAIL_MESSAGE)
                          .where(EMAIL_MESSAGE.ACCOUNT_ID.eq(accountId))
                          .and(EMAIL_MESSAGE.CONTENT_ID.isNotNull())
                          .fetch(EMAIL_MESSAGE.CONTENT_ID);
                  List<String> candidateHashes =
                      contentIds.isEmpty()
                          ? List.of()
                          : dsl.selectDistinct(CONTENT_ATTACHMENT.CONTENT_HASH)
                              .from(CONTENT_ATTACHMENT)
                              .where(CONTENT_ATTACHMENT.CONTENT_ID.in(contentIds))
                              .and(CONTENT_ATTACHMENT.CONTENT_HASH.isNotNull())
                              .fetch(CONTENT_ATTACHMENT.CONTENT_HASH);
                  accountRepo.hardDelete(accountId);
                  contentRepo.deleteOrphans(contentIds);
                  return blobRepo.deleteOrphanBlobsByHash(candidateHashes);
                });

    // 커밋 후 디스크 파일 삭제 — best-effort(롤백 위험 제거). 실패해도 데이터 무결성엔 영향 없음(고아 파일만 잔존).
    if (orphanFileRefs != null) {
      for (String ref : orphanFileRefs) {
        try {
          fileStore.deleteIfExists(ref);
        } catch (RuntimeException e) {
          log.warn("purge 디스크 blob 삭제 실패(무시) fileRef={} accountId={}", ref, accountId, e);
        }
      }
    }
    log.info(
        "계정 purge 완료 accountId={} userId={} blob삭제={}",
        accountId,
        userId,
        orphanFileRefs == null ? 0 : orphanFileRefs.size());
  }
}
