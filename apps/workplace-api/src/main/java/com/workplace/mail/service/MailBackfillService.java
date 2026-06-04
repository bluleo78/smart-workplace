package com.workplace.mail.service;

import com.workplace.mail.dto.BodyTarget;
import com.workplace.mail.repository.EmailMessageRepository;
import java.util.List;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;

/** 동기화 직후 누락 본문을 최근순으로 비동기 보충. best-effort. */
@Slf4j
@Service
@RequiredArgsConstructor
public class MailBackfillService {

  /** 한 회 보충 상한(과도한 IMAP 점유 방지). */
  private static final int BATCH_LIMIT = 200;

  private final EmailMessageRepository messageRepo;
  private final MailBodyFetcher bodyFetcher;
  private final MailSyncProgress progress;

  /** 비동기 진입점(sync 가 호출). 별도 스레드/트랜잭션에서 동기 보충 수행. */
  @Async("aiAgentEventExecutor")
  public void backfill(long userId, long accountId) {
    backfillNow(userId, accountId);
  }

  /** 동기 보충 본체. 테스트는 이 메서드를 직접 호출해 같은 스레드/트랜잭션에서 검증한다. */
  public void backfillNow(long userId, long accountId) {
    try {
      List<BodyTarget> targets = messageRepo.listMissingBody(accountId, BATCH_LIMIT);
      for (BodyTarget t : targets) {
        bodyFetcher.fetchBody(userId, t);
        progress.incBody(accountId);
      }
    } catch (Exception e) {
      log.warn("본문 백그라운드 보충 실패 (accountId={}): {}", accountId, e.toString());
    } finally {
      progress.finish(accountId);
    }
  }
}
