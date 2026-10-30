package com.workplace.mail.service;

import static com.workplace.jooq.Tables.CALENDAR_EVENT_TAG;
import static com.workplace.jooq.Tables.CALENDAR_TAG;
import static com.workplace.jooq.Tables.CONTENT_ATTACHMENT;
import static com.workplace.jooq.Tables.EMAIL_MESSAGE;

import com.workplace.file.storage.FileStore;
import com.workplace.mail.repository.EmailAccountRepository;
import com.workplace.mail.repository.EmailContentRepository;
import com.workplace.mail.repository.MailAttachmentBlobRepository;
import com.workplace.mail.repository.MailAttachmentPreviewRepository;
import com.workplace.mail.repository.MailDraftRepository;
import java.util.ArrayList;
import java.util.List;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.jooq.DSLContext;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * soft-deleted 메일 계정의 물리 삭제(purge) 오케스트레이션.
 *
 * <p>화면에서는 disabled_at + 조회 필터로 이미 숨겨진 상태이며, 이 서비스는 백그라운드에서 실제 데이터를 완전히 제거한다.
 *
 * <p>절차: (1) 삭제 전 content_id·blob 해시 후보 수집 → (2) 단일 트랜잭션에서 계정 하드삭제(cascade) + 고아 본문 GC + 고아 blob DB
 * 행·참조 없는 미리보기 행 삭제 → (3) 커밋 후 디스크 파일 best-effort 삭제. 모든 DB 단계는 호출 시점 TenantContext GUC 안에서 실행되어야
 * 한다(스케줄러가 테넌트별로 set).
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class AccountPurgeService {

  private final DSLContext dsl;
  private final EmailAccountRepository accountRepo;
  private final EmailContentRepository contentRepo;
  private final MailAttachmentBlobRepository blobRepo;
  private final MailAttachmentPreviewRepository previewRepo;
  private final MailDraftRepository draftRepo;
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
    //       → (3) 고아 본문 GC(→content_attachment cascade) → (4) 고아 blob DB 행 삭제(+fileRef 수집)
    //       → (5) 참조가 0 이 된 미리보기 행 삭제 + 같은 트랜잭션에서 그 파일 삭제(WP-432). 다른 계정이 같은 해시를 아직 참조하면 남는다.
    //       → (6) 일정이 하나도 남지 않은 Outlook 범주 태그 정리(WP-1220).
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
                  // WP-577: 임시저장에 묶인 업로드는 영구라 CASCADE(정션만 삭제) 뒤 고아가 된다 — 먼저 만료를 걸어 스윕이 지우게 한다.
                  draftRepo.expireBoundFilesOfAccount(accountId);
                  accountRepo.hardDelete(accountId);
                  contentRepo.deleteOrphans(contentIds);
                  List<String> refs =
                      new ArrayList<>(blobRepo.deleteOrphanBlobsByHash(candidateHashes));
                  // 미리보기 파일은 행 잠금을 쥔 이 트랜잭션 안에서 지운다 — 커밋 뒤에 지우면 그 사이 같은 해시를 다시 선점·변환한
                  // 작업의 결과(결정적 경로라 같은 위치)를 지울 수 있다. 선점 업서트는 이 커밋까지 기다린다.
                  previewRepo.deleteUnreferenced(candidateHashes).forEach(fileStore::deleteQuietly);
                  deleteOrphanCategoryTags(userId);
                  return refs;
                });

    // 커밋 후 캐시 blob 파일 삭제 — best-effort(롤백 위험 제거). 실패해도 데이터 무결성엔 영향 없음(고아 파일만 잔존).
    if (orphanFileRefs != null) {
      orphanFileRefs.forEach(fileStore::deleteQuietly);
    }
    log.info(
        "계정 purge 완료 accountId={} userId={} blob삭제={}",
        accountId,
        userId,
        orphanFileRefs == null ? 0 : orphanFileRefs.size());
  }

  /**
   * 계정 하드삭제로 일정·연결이 CASCADE 로 사라진 뒤, 남은 연결이 하나도 없는 이 사용자의 Outlook 범주 태그를 지운다(WP-1220). 그대로 두면 태그
   * 목록에 「일정 0개」 태그로 남는다.
   *
   * <p>지우는 것은 동기화가 새로 만든 태그(origin=OUTLOOK)뿐이다 — 사용자가 만든 태그(동기화가 같은 이름으로 재사용한 것 포함)·사용자가 손본 태그는 APP
   * 이라 남는다. 다른 계정의 일정이나 앱에서 붙인 일정이 남은 태그, 구독 주소를 만든 태그도 남긴다. 캘린더 도메인 코드를 들이지 않고 앞 단계처럼 테이블을 직접
   * 다룬다(도메인 간 직접 의존 금지).
   */
  private void deleteOrphanCategoryTags(long userId) {
    int deleted =
        dsl.deleteFrom(CALENDAR_TAG)
            .where(CALENDAR_TAG.USER_ID.eq(userId))
            .and(CALENDAR_TAG.ORIGIN.eq("OUTLOOK"))
            .and(CALENDAR_TAG.FEED_TOKEN.isNull())
            .andNotExists(
                DSL.selectOne()
                    .from(CALENDAR_EVENT_TAG)
                    .where(CALENDAR_EVENT_TAG.TAG_ID.eq(CALENDAR_TAG.ID)))
            .execute();
    if (deleted > 0) log.info("계정 purge — 일정 없는 Outlook 범주 태그 {}개 정리 userId={}", deleted, userId);
  }
}
