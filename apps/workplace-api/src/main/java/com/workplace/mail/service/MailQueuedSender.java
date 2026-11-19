package com.workplace.mail.service;

import com.workplace.mail.dto.MailSendRequest;
import com.workplace.mail.exception.EmailAccountNotFoundException;
import com.workplace.mail.exception.EmailMessageNotFoundException;
import com.workplace.mail.exception.MailSendException;
import com.workplace.mail.exception.MailValidationException;
import com.workplace.mail.outbound.MailChangeNotifier;
import com.workplace.mail.outbound.MailSendFailedEvent;
import com.workplace.mail.repository.MailDraftRepository;
import com.workplace.mail.repository.MailDraftRepository.QueuedRow;
import java.time.OffsetDateTime;
import java.util.Optional;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 보낼 대기열(WP-1786)에서 스케줄러가 잡은(SENDING) 행 하나를 실제로 보낸다. 트랜잭션 밖에서 불린다 — 메일 전송(외부 I/O)이 DB 트랜잭션·행 잠금을
 * 붙잡지 않게 하려는 것이고, 기존 {@link MailComposeService#send} 가 단계마다 스스로 짧은 트랜잭션을 연다. 호출자(스케줄러)가 그 테넌트의
 * TenantContext 를 세워 두어야 트랜잭션 시작 때 RLS GUC 가 주입된다.
 *
 * <p>성공하면 send 가 임시보관을 지우고 보낸편지함 행을 남긴다 — send 는 그 삭제 실패를 삼키므로 여기서 행이 정말 사라졌는지 다시 확인해 지운다(남으면 10분 뒤
 * 멈춤 정리가 「보냈는지 확인하지 못함」으로 잘못 알린다). 실패(예외)하면 새 트랜잭션에서 FAILED·사유를 남기고, 같은 트랜잭션에서 {@link
 * MailSendFailedEvent} 를 발행해 알림 도메인이 보낸 본인에게 「메일을 보내지 못함」 알림을 만든다. 자동 재시도는 하지 않는다 — 실패 원인(주소 거부·계정
 * 문제)이 대개 다시 보내도 같고, 사용자가 임시보관에서 고쳐 다시 보내게 한다.
 */
@Slf4j
@Component
public class MailQueuedSender {

  /** 사용자에게 보여 줄 만한 문구가 없는 실패의 기본 사유(임시보관 send_error 로 남는다). */
  static final String GENERIC_FAILURE = "메일을 보내지 못했어요. 잠시 뒤 다시 보내 주세요";

  private final MailDraftRepository draftRepo;
  private final MailSendQueueService queueService;
  private final MailComposeService composeService;
  private final ApplicationEventPublisher publisher;
  private final MailChangeNotifier changeNotifier;
  private final TransactionTemplate tx;

  /** 보낸 뒤 남은 임시보관 지우기 시도 횟수 — 처음 + 다시 한 번. */
  static final int CLEANUP_ATTEMPTS = 2;

  public MailQueuedSender(
      MailDraftRepository draftRepo,
      MailSendQueueService queueService,
      MailComposeService composeService,
      ApplicationEventPublisher publisher,
      MailChangeNotifier changeNotifier,
      PlatformTransactionManager txManager) {
    this.draftRepo = draftRepo;
    this.queueService = queueService;
    this.composeService = composeService;
    this.publisher = publisher;
    this.changeNotifier = changeNotifier;
    // 테넌트 GUC 는 TenantAwareTransactionManager 가 트랜잭션 시작 때 현재 TenantContext 로 주입한다.
    this.tx = new TransactionTemplate(txManager);
  }

  /**
   * 잡힌 대기 행 하나를 보낸다. 행이 없거나(그 사이 계정 삭제로 함께 지워짐·이미 보내 지워짐) 발송 중(SENDING)이 아니면(이 호출자가 잡은 행이 아님 — 대기
   * 중이거나 이미 실패 처리됨) 아무것도 하지 않는다. 실패는 기록·알림으로 끝내고 예외를 밖으로 내지 않는다.
   */
  public void sendOne(long draftId) {
    // 짧은 트랜잭션 하나 — 전송 직전 멈춤 시계를 이 행 기준으로 다시 찍으며(SENDING 일 때만, 코드 리뷰) 보낼 값을 같은 문장으로 읽는다. 찍지
    // 못했으면(대기 중·이미 실패 처리·지워짐) 보내지 않는다.
    Optional<QueuedRow> found = tx.execute(status -> draftRepo.startSend(draftId));
    if (found == null || found.isEmpty()) {
      log.debug("[mail-queue] 보낼 행 없음 또는 발송 중 아님 — 건너뜀 draftId={}", draftId);
      return;
    }
    QueuedRow row = found.get();
    MailSendRequest req = queueService.toSendRequest(row);
    try {
      composeService.send(row.userId(), row.accountId(), req);
    } catch (RuntimeException e) {
      // 원문(내부 문구·원인)은 로그에만 — 임시보관 사유에는 사용자 문구만 남긴다(userMessage).
      log.warn("[mail-queue] 대기 메일 발송 실패 draftId={}", draftId, e);
      recordFailure(row, userMessage(e));
      return;
    }
    ensureDraftRemoved(row);
  }

  /**
   * 보낸 뒤 임시보관 행이 정말 사라졌는지 확인한다(코드 리뷰) — send 는 임시보관 삭제 실패를 경고로 삼키는데(AI 확인카드 경로와 같은 동작이라 그대로 둔다), 행이
   * SENDING 으로 남으면 10분 뒤 멈춤 정리가 이미 나간 메일을 「보냈는지 확인하지 못함」으로 알려 사용자가 다시 보내게(중복 발송) 만든다.
   *
   * <p>새 트랜잭션에서 잠그고 읽어 남아 있으면 지운다(정상이면 이미 없어 잠금 SELECT 한 번으로 끝난다). 실패하면 한 번 더 하고, 그래도 실패하면 오류 로그만
   * 남긴다. 같은 트랜잭션에서 메일 변경 이벤트도 보내 열린 웹이 보낸편지함을 곧바로 다시 읽게 한다(20초 새로고침을 기다리지 않게).
   */
  private void ensureDraftRemoved(QueuedRow row) {
    for (int attempt = 1; attempt <= CLEANUP_ATTEMPTS; attempt++) {
      try {
        tx.executeWithoutResult(
            status -> {
              // 보낸 뒤라 되돌릴 일이 없다 — 남은 묶인 업로드는 지금 만료(deleteIfPresent 와 같은 기준).
              if (draftRepo.deleteOwned(row.userId(), row.id(), OffsetDateTime.now())) {
                log.warn("[mail-queue] 보낸 뒤 남은 임시보관을 다시 지움 draftId={}", row.id());
              }
              changeNotifier.mailChanged(row.userId(), row.accountId(), null, null);
            });
        return;
      } catch (RuntimeException e) {
        log.warn(
            "[mail-queue] 보낸 뒤 임시보관 정리 실패 (시도 {}/{}) draftId={}: {}",
            attempt,
            CLEANUP_ATTEMPTS,
            row.id(),
            e.toString());
      }
    }
    log.error(
        "[mail-queue] 메일은 보냈지만 임시보관을 지우지 못함 — 멈춤 정리가 「확인하지 못함」으로 알릴 수 있음 draftId={}", row.id());
  }

  /**
   * 실패 기록 + 알림을 새 트랜잭션 하나로 — 상태를 실제로 바꿨을 때만 알린다(그 사이 멈춤 정리가 먼저 UNKNOWN 으로 돌렸으면 그쪽 알림이 이미 갔다). 이
   * 기록마저 실패하면 행은 SENDING 에 남고 10분 뒤 멈춤 정리가 「확인하지 못함」으로 돌린다.
   */
  private void recordFailure(QueuedRow row, String message) {
    try {
      tx.executeWithoutResult(
          status -> {
            if (draftRepo.markFailed(row.id(), message)) {
              // 동기 리스너(알림 도메인)가 이 트랜잭션 안에서 알림을 만든다 — 실패하면 FAILED 기록도 함께 롤백된다.
              publisher.publishEvent(
                  new MailSendFailedEvent(row.userId(), row.id(), row.subject(), false));
            }
          });
    } catch (RuntimeException e) {
      log.error("[mail-queue] 발송 실패 기록 실패 — 멈춤 정리가 처리 draftId={}: {}", row.id(), e.toString());
    }
  }

  /**
   * 임시보관에 남길 실패 사유(WP-1786 최종 리뷰 T4-M2) — 웹이 다시 열 때 「보내지 못한 이유: …」로 그대로 보이므로 사용자용 한국어 문구만 남긴다.
   *
   * <ul>
   *   <li>입력 검증(400)·계정 없음·원본 메일 없음(404) — 바로 보내기 API 가 이미 그 문구를 화면에 내던 것이라 그대로.
   *   <li>발송 실패(502) — 던질 때 사용자용으로 표시한 것({@link MailSendException#userFacing})만 그대로. 그 밖의 발송 실패는
   *       공급자 응답 코드·내부 단계 이름(「Graph post 실패: 500」「지원하지 않는 메일 공급자: …」)을 싣고 있어 화면에 내지 않는다.
   *   <li>그 밖(내부 발송 문구·라이브러리·네트워크 예외) — 기본 문구. 원문은 호출자가 서버 로그에 남긴다.
   * </ul>
   */
  static String userMessage(RuntimeException e) {
    String msg = e.getMessage();
    if (msg == null || msg.isBlank()) {
      return GENERIC_FAILURE;
    }
    if (e instanceof MailValidationException
        || e instanceof EmailAccountNotFoundException
        || e instanceof EmailMessageNotFoundException) {
      return msg;
    }
    if (e instanceof MailSendException send && send.isUserFacing()) {
      return msg;
    }
    return GENERIC_FAILURE;
  }
}
