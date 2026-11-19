package com.workplace.mail.service;

import com.workplace.mail.dto.MailDraftDetail;
import com.workplace.mail.dto.MailDraftSaveRequest;
import com.workplace.mail.dto.MailSendRequest;
import com.workplace.mail.dto.QueuedSend;
import com.workplace.mail.exception.MailAlreadySendingException;
import com.workplace.mail.exception.MailDraftSendingException;
import com.workplace.mail.repository.MailDraftRepository;
import com.workplace.mail.repository.MailDraftRepository.QueuedRow;
import com.workplace.mail.repository.SendState;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 메일 보내기 대기열(WP-1786) — 보내기를 즉시 보내지 않고 임시보관 행을 QUEUED 로 올려 {@link #SEND_UNDO_SECONDS} 초 되돌릴 틈을 준다.
 * 실제 발송은 스케줄러가 맡는다(그쪽은 {@link #toSendRequest} 로 행을 보내기 요청으로 되돌린다). AI 확인카드 경로는 이 서비스를 거치지 않고 {@link
 * MailComposeService#send} 를 그대로 쓴다.
 */
@Service
@RequiredArgsConstructor
public class MailSendQueueService {

  /** 보내기를 누른 뒤 되돌릴 수 있는 시간(초). */
  public static final int SEND_UNDO_SECONDS = 10;

  private final MailComposeService composeService;
  private final MailDraftService draftService;
  private final MailDraftRepository draftRepo;
  private final PlatformTransactionManager txManager;

  /**
   * 보내기를 대기열에 올린다. 검증(수신자·주소·첨부·인라인)은 지금 끝내 오류를 바로 돌려주고(행을 만들지 않는다), 통과하면 한 트랜잭션에서 임시보관을 이어받거나 새로
   * 만들어 QUEUED 로 올린다.
   *
   * @throws MailDraftSendingException 이미 대기·발송 중인 임시보관에 다시 보냄(409)
   */
  public QueuedSend enqueue(long userId, long accountId, MailSendRequest req) {
    // ① 사전검증 — 실패하면 임시보관 행을 건드리지 않는다.
    composeService.validateSendable(userId, accountId, req);
    String mode = modeOf(req);
    // ② 저장+대기 표시를 한 트랜잭션으로 — 중간에 스케줄러가 집을 수 있는 반쯤 올라간 행을 남기지 않는다.
    return new TransactionTemplate(txManager)
        .execute(
            status -> {
              // 작성창이 실은 원본 메일 id 를 먼저 — 전달은 답장 원본이 없어 이것이 없으면 되돌려 열 때 인용문을 다시 만들 수 없다.
              Long sourceMessageId =
                  req.sourceMessageId() != null ? req.sourceMessageId() : req.inReplyToMessageId();
              // 값 저장과 대기 표시는 한 문장 — 보낼 시각은 DB 시계로(now() + 유예), 스케줄러가 DB now() 와 비교하므로 앱 시계를 섞지
              // 않는다(코드 리뷰). 응답에도 DB 가 정한 값을 그대로 돌려준다.
              return draftService.upsertForSend(
                  userId,
                  accountId,
                  req,
                  mode,
                  sourceMessageId,
                  req.quoteRemoved(),
                  SEND_UNDO_SECONDS);
            });
  }

  /**
   * 되돌리기 — 아직 대기(QUEUED)면 풀어 임시보관 상세를 돌려준다(작성창이 다시 열린다).
   *
   * <p>풀지 못했을 때: SENDING 이면 늦었으니 409 ALREADY_SENDING. 행이 없으면(이미 보내고 지워졌거나 남의 것 — 둘을 안전하게 가를 수 없다)
   * 404 를 돌려주고 웹이 404 도 409 와 같이 「이미 보냈어요」로 안내한다. 일반·FAILED 행은 이미 대기가 아니므로 현재 상세를 그대로 돌려준다(멱등).
   */
  @Transactional
  public MailDraftDetail cancel(long userId, long draftId) {
    if (draftRepo.cancelQueued(userId, draftId)) {
      // 계정이 삭제 대기여도 읽는다 — 여기서 404 가 나면 대기 풀기까지 롤백돼 행이 QUEUED 로 남아 곧 보내진다(코드 리뷰).
      return draftService.getIncludingDisabledAccount(userId, draftId);
    }
    // 풀지 못했다 — 보내는 중이면 늦은 것(QUEUED 인데 풀지 못한 것은 그 사이 스케줄러가 집은 경쟁). 그 밖은 get 이 갈라 준다: 행 없음은
    // MailDraftNotFoundException(404), 일반·FAILED 는 현재 상세(멱등).
    if (draftRepo.sendState(userId, draftId).filter(SendState::isInFlight).isPresent()) {
      throw new MailAlreadySendingException();
    }
    return draftService.get(userId, draftId);
  }

  /**
   * 대기 행을 보내기 요청으로 되돌린다(스케줄러가 composeService.send 에 넘긴다). draftId 는 행 자신 — 발송 성공 시 지워지고 실패 시 남는다.
   * 첨부는 묶인 업로드 전부(본문 이미지 업로드 포함 — inlineUploads 가 그 부분집합을 가리킨다).
   */
  public MailSendRequest toSendRequest(QueuedRow row) {
    return new MailSendRequest(
        row.to(),
        row.cc(),
        row.bcc(),
        row.subject(),
        row.bodyHtml(),
        row.bodyText(),
        row.inReplyToMessageId(),
        row.inlineImages(),
        row.boundFileIds(),
        row.forwardAttachmentIds(),
        row.id(),
        row.inlineUploads());
  }

  /**
   * 임시보관 mode — 작성창이 실은 값(new·reply·forward)이 있으면 그대로(WP-1786), 없거나 모르는 값이면 추정: 답장 원본이 있으면 reply,
   * 전달 첨부가 있으면 forward, 아니면 new(AI 확인카드 등 작성 문맥 없는 호출처).
   */
  private static String modeOf(MailSendRequest req) {
    if (req.mode() != null && MailDraftSaveRequest.MODES.contains(req.mode())) {
      return req.mode();
    }
    if (req.inReplyToMessageId() != null) {
      return "reply";
    }
    return req.forwardAttachmentIds().isEmpty() ? "new" : "forward";
  }
}
