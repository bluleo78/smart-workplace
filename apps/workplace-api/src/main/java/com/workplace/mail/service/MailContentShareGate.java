package com.workplace.mail.service;

import com.workplace.mail.dto.ParsedAttachment;
import com.workplace.mail.repository.ContentAttachmentRepository;
import com.workplace.mail.repository.EmailContentRepository;
import com.workplace.mail.repository.EmailMessageRepository;
import com.workplace.mail.util.MailContentHash;
import java.util.List;
import java.util.Objects;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

/**
 * 본문 적재 시점의 공유 content 검증(WP-130 두 번째 방어선).
 *
 * <p>동기화 시점 지문(Message-ID + 헤더 + 본문 구조)으로 공유된 content 라도, 이 envelope 가 실제로 내려받은 본문 해시나 첨부 목록이 이미
 * 기록된 것과 다르면 다른 메일로 판단해 이 envelope 만 새 content 로 분리한다. 공유 본문은 첫 적재자만 기록하고 이후에는 덮어쓰지 않는다.
 *
 * <p>호출자(본문 로더)의 트랜잭션 안에서 실행된다 — 선점·비교·분리·재연결이 한 트랜잭션으로 묶인다.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class MailContentShareGate {

  private final EmailContentRepository contentRepo;
  private final ContentAttachmentRepository contentAttachmentRepo;
  private final EmailMessageRepository messageRepo;

  /**
   * 내려받은 본문을 envelope 의 content 에 기록하거나 검증한다.
   *
   * @param envelopeId email_message.id
   * @param contentId envelope 가 현재 가리키는 content id
   * @param attachments 이 envelope 가 파싱한 첨부 목록(ordinal = 리스트 인덱스)
   * @return 이후 첨부 적재에 써야 할 content id — 분리됐으면 새 id
   */
  public long storeFetchedBody(
      long envelopeId,
      long contentId,
      String bodyText,
      String bodyHtml,
      String snippet,
      List<ParsedAttachment> attachments) {
    // 1) 첫 적재자: 본문 기록(이후 수신자는 덮어쓰지 못함)
    if (contentRepo.claimBody(contentId, bodyText, bodyHtml, snippet)) {
      return contentId;
    }
    // 2) 이미 기록된 본문·첨부와 일치하면 그대로 공유
    boolean sameBody =
        Objects.equals(
            contentRepo.findContentHash(contentId), MailContentHash.of(bodyText, bodyHtml));
    if (sameBody && contentAttachmentRepo.matchesManifest(contentId, attachments)) {
      return contentId;
    }
    // 3) 불일치 → 이 envelope 만 새 content 로 분리(원본 수신자의 본문·첨부·AI 요약은 그대로)
    long forked = contentRepo.forkHeaders(contentId);
    contentRepo.claimBody(forked, bodyText, bodyHtml, snippet);
    messageRepo.repointContent(envelopeId, forked);
    log.warn(
        "공유 메일 content 불일치 — envelope 분리 (envelopeId={}, from={}, to={}, sameBody={})",
        envelopeId,
        contentId,
        forked,
        sameBody);
    return forked;
  }
}
