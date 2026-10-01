package com.workplace.mail.service;

import com.workplace.mail.dto.SenderRelation;
import com.workplace.mail.dto.UserMailProfile;
import com.workplace.mail.outbound.MailAiMessages.IssueRef;
import com.workplace.mail.outbound.MailAiMessages.PriorMail;
import com.workplace.mail.outbound.MailAiMessages.Sender;
import com.workplace.mail.repository.EmailMessageRepository.AnalysisContext;
import com.workplace.mail.repository.PersonalContextRepository;
import com.workplace.mail.repository.PersonalContextRepository.AttachmentRow;
import com.workplace.mail.repository.PersonalContextRepository.PriorMailRow;
import com.workplace.mail.util.MailAddresses;
import com.workplace.mail.util.NewContentExtractor;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.function.Supplier;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.util.StringUtils;

/**
 * ④ 개인 분석 보강 입력 조회(WP-150) — 보낸 사람 관계 · 같은 스레드 이전 메일 · 연결 이슈 · 첨부 이름.
 *
 * <p>블록마다 자기 짧은 트랜잭션(RLS GUC 주입)에서 읽는다. Postgres 는 실패한 문장 뒤 같은 트랜잭션을 못 쓰므로, 한 트랜잭션 안의 try/catch 로는
 * 뒤 블록까지 모두 실패한다. 실패한 블록은 경고 로그 후 null(목록은 빈 목록)로 두고 분석은 계속한다(스펙 오류 처리 표 첫 행).
 */
@Slf4j
@Component
public class PersonalContextLoader {

  /** 이전 메일 최대 건수(스펙: 직전 최대 2건). */
  static final int THREAD_LIMIT = 2;

  /** 이전 메일 1건의 새로 쓴 부분 상한(앞부분). */
  static final int THREAD_BODY_CHARS = 500;

  /** 첨부 이름 최대 개수 — 프롬프트 길이 제한. */
  static final int ATTACHMENT_LIMIT = 10;

  /** 첨부 이름 1개 상한. */
  static final int ATTACHMENT_NAME_MAX = 100;

  private final SenderRelationResolver relationResolver;
  private final PersonalContextRepository contextRepo;
  private final TransactionTemplate txTemplate;

  public PersonalContextLoader(
      SenderRelationResolver relationResolver,
      PersonalContextRepository contextRepo,
      PlatformTransactionManager txManager) {
    this.relationResolver = relationResolver;
    this.contextRepo = contextRepo;
    this.txTemplate = new TransactionTemplate(txManager);
  }

  /**
   * 보강 입력 조회. ctx 는 소유 검증된 분석 컨텍스트(findAnalysisContextByIdAndUser)다.
   *
   * @param userId 사본 소유자(스레드 조회의 소유 검증)
   * @param me "나" 프로필 — 관계의 "나 자신" 판정과 이전 메일의 "나" 표시에 같은 주소 집합을 쓴다
   */
  public PersonalContext load(long userId, AnalysisContext ctx, UserMailProfile me) {
    long id = ctx.messageId();
    Sender sender =
        block("보낸 사람 관계", id, () -> toWire(relationResolver.resolve(me, ctx.fromAddress())));
    List<PriorMail> thread =
        block(
            "이전 메일",
            id,
            () ->
                priorMails(
                    contextRepo.listPriorThreadMails(userId, id, THREAD_LIMIT), me.addressSet()));
    IssueRef issue = block("연결 이슈", id, () -> contextRepo.findLinkedIssue(id).orElse(null));
    List<String> attachments =
        block("첨부", id, () -> attachmentNames(contextRepo.listAttachments(id)));
    return new PersonalContext(sender, thread, issue, attachments);
  }

  /** 블록 하나를 자기 트랜잭션에서 조회. 실패하면 null(PersonalContext 가 목록 null 을 빈 목록으로 바꾼다). */
  private <T> T block(String label, long messageId, Supplier<T> query) {
    try {
      return txTemplate.execute(status -> query.get());
    } catch (RuntimeException e) {
      log.warn("개인 분석 입력에서 {} 블록을 뺌 (messageId={}): {}", label, messageId, e.toString());
      return null;
    }
  }

  /** 관계 → 와이어. 렌더(줄바꿈 접기 포함)는 agent 가 한다. */
  static Sender toWire(SenderRelation r) {
    return new Sender(
        r.kind().name(), r.name(), r.title(), r.organization(), r.sameGroups(), r.favorite());
  }

  /**
   * 이전 메일 → 와이어. 본문은 ③·④ 와 같은 {@link NewContentExtractor} 로 인용·서명을 떼고 앞 500자만. 새로 쓴 부분이 비면 뺀다. "나"
   * 는 보낸 주소가 내 주소 집합에 있을 때.
   */
  static List<PriorMail> priorMails(List<PriorMailRow> rows, Set<String> myAddresses) {
    List<PriorMail> out = new ArrayList<>();
    for (PriorMailRow r : rows) {
      String body = excerpt(NewContentExtractor.extract(r.bodyText(), r.bodyHtml(), r.snippet()));
      if (!StringUtils.hasText(body)) {
        continue;
      }
      String address = MailAddresses.normalize(r.fromAddress());
      boolean fromMe = address != null && myAddresses.contains(address);
      String raw = r.fromAddress() == null ? "" : r.fromAddress();
      String from = StringUtils.hasText(r.fromName()) ? r.fromName() + " <" + raw + ">" : raw;
      String date = r.receivedAt() == null ? "" : r.receivedAt().toString();
      out.add(new PriorMail(fromMe, from, date, body));
    }
    return out;
  }

  /** 새로 쓴 부분의 앞 {@value #THREAD_BODY_CHARS}자(넘으면 "…"). null → 빈 문자열. */
  static String excerpt(String newBody) {
    if (newBody == null) {
      return "";
    }
    String s = newBody.strip();
    return s.length() <= THREAD_BODY_CHARS ? s : s.substring(0, THREAD_BODY_CHARS) + "…";
  }

  /**
   * 첨부 이름 — 본문 인라인 이미지(image/* + Content-ID, 서명 로고 등)와 이름 없는 행은 빼고, 중복 제거·순서 유지, 최대 {@value
   * #ATTACHMENT_LIMIT}개, 이름 {@value #ATTACHMENT_NAME_MAX}자.
   */
  static List<String> attachmentNames(List<AttachmentRow> rows) {
    Set<String> out = new LinkedHashSet<>();
    for (AttachmentRow r : rows) {
      if (InlineImageSupport.isImage(r.contentType()) && StringUtils.hasText(r.mimeContentId())) {
        continue;
      }
      if (!StringUtils.hasText(r.filename())) {
        continue;
      }
      String name = r.filename().strip();
      out.add(
          name.length() <= ATTACHMENT_NAME_MAX
              ? name
              : name.substring(0, ATTACHMENT_NAME_MAX) + "…");
      if (out.size() >= ATTACHMENT_LIMIT) {
        break;
      }
    }
    return List.copyOf(out);
  }
}
