package com.workplace.mail.service;

import com.workplace.file.api.StagedFileClaimer;
import com.workplace.mail.dto.MailDraftCount;
import com.workplace.mail.dto.MailDraftDetail;
import com.workplace.mail.dto.MailDraftDetail.Attachment;
import com.workplace.mail.dto.MailDraftSaveRequest;
import com.workplace.mail.dto.MailDraftSaved;
import com.workplace.mail.dto.MailDraftSummary;
import com.workplace.mail.dto.MailDraftVersion;
import com.workplace.mail.exception.EmailAccountNotFoundException;
import com.workplace.mail.exception.MailDraftConflictException;
import com.workplace.mail.exception.MailDraftNotFoundException;
import com.workplace.mail.exception.MailValidationException;
import com.workplace.mail.repository.EmailAccountRepository;
import com.workplace.mail.repository.EmailAttachmentRepository;
import com.workplace.mail.repository.EmailAttachmentRepository.InlineSourceMeta;
import com.workplace.mail.repository.MailDraftRepository;
import com.workplace.mail.repository.MailDraftRepository.DraftRow;
import com.workplace.mail.repository.MailDraftRepository.Fields;
import com.workplace.mail.util.MailComposeLimits;
import java.nio.charset.StandardCharsets;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 메일 임시저장(WP-577) — 작성창 상태를 앱 DB 에만 둔다(IMAP·M365 Drafts 폴더와 동기화하지 않는다). 소유자만 보고 고치고 지운다.
 *
 * <p>첨부 묶기: 작성 첨부 업로드(스테이징 FILE)는 저장할 때 {@link StagedFileClaimer} 로 PERMANENT 클레임해 정션
 * (mail_draft_attachment)에 묶는다 — 이슈 첨부와 같은 방식이다. 묶인 동안 만료가 없어 24시간 스윕에 지워지지 않고, 정션이 {@code
 * AttachmentBindingConfig} 에 등록돼 다른 도메인·남의 임시저장이 가져가지 못한다(내 다른 임시저장의 업로드는 저장할 때 옮겨 묶는다). 저장에서 빠진
 * 업로드와 버린 임시저장의 업로드는 다시 임시(지금 + 24시간)로 풀어(버리기 「되돌리기」가 다시 묶을 수 있게) 만료 뒤 스윕이 정리하고, 발송으로 지운 임시저장의 남은
 * 업로드는 지금 만료시킨다. 발송은 같은 lookup 이 "내 임시저장에 묶인 파일"을 보류 클레임에 내주고, 끝나면 {@link #afterSend} 가 정리한다.
 *
 * <p>전달 원본 첨부(email_attachment)는 id 참조만 둔다 — 내 메일 첨부만 남기고, 원본이 지워지면 FK CASCADE 로 빠진다.
 */
@Service
public class MailDraftService {

  /** 목록 최대 건수. */
  static final int LIST_LIMIT = 200;

  /** 목록 미리보기 길이(문자, 코드포인트 기준). */
  static final int PREVIEW_MAX = 120;

  private final MailDraftRepository draftRepo;
  private final EmailAccountRepository accountRepo;
  private final EmailAttachmentRepository attachmentRepo;
  private final StagedFileClaimer stagedFileClaimer;

  /** 풀린 업로드의 임시 수명 — 업로드 직후와 같은 값(기본 24시간). */
  private final int tempExpiryHours;

  public MailDraftService(
      MailDraftRepository draftRepo,
      EmailAccountRepository accountRepo,
      EmailAttachmentRepository attachmentRepo,
      StagedFileClaimer stagedFileClaimer,
      @Value("${workplace.storage.attachment.temp-expiry-hours:24}") int tempExpiryHours) {
    this.draftRepo = draftRepo;
    this.accountRepo = accountRepo;
    this.attachmentRepo = attachmentRepo;
    this.stagedFileClaimer = stagedFileClaimer;
    this.tempExpiryHours = tempExpiryHours;
  }

  /** 내 계정의 임시저장 목록 — 갱신 최신순, 최대 200건. 남의·비활성 계정은 404. */
  @Transactional(readOnly = true)
  public List<MailDraftSummary> list(long userId, long accountId) {
    requireAccount(userId, accountId);
    return draftRepo.listByAccount(userId, accountId, LIST_LIMIT);
  }

  /** 내 계정의 임시저장 개수(사이드바 배지). 남의·비활성 계정은 404. */
  @Transactional(readOnly = true)
  public MailDraftCount count(long userId, long accountId) {
    requireAccount(userId, accountId);
    return new MailDraftCount(draftRepo.countByAccount(userId, accountId));
  }

  /** 임시저장 상세 — 전달 원본 첨부(남아 있는 것만) 다음 업로드 첨부. 없거나 남의 것이면 404. */
  @Transactional(readOnly = true)
  public MailDraftDetail get(long userId, long draftId) {
    DraftRow row =
        draftRepo
            .findOwned(userId, draftId)
            .orElseThrow(() -> new MailDraftNotFoundException(draftId));
    List<Long> forwardIds = draftRepo.forwardIds(draftId);
    Map<Long, InlineSourceMeta> metas = attachmentRepo.findOwnedMetas(userId, forwardIds);
    List<Attachment> attachments = new ArrayList<>();
    for (Long id : forwardIds) {
      InlineSourceMeta m = metas.get(id);
      if (m != null) {
        attachments.add(
            new Attachment(
                id, m.filename(), m.sizeBytes(), m.contentType(), MailDraftDetail.SOURCE_FORWARD));
      }
    }
    attachments.addAll(draftRepo.uploadAttachments(draftId));
    return new MailDraftDetail(
        row.id(),
        row.accountId(),
        row.mode(),
        row.to(),
        row.cc(),
        row.bcc(),
        row.subject(),
        row.bodyHtml(),
        row.sourceMessageId(),
        row.quoteRemoved(),
        attachments,
        row.version(),
        row.updatedAt());
  }

  /**
   * 새 임시저장 — 업로드를 묶고 전달 원본 첨부 참조를 둔다.
   *
   * @throws EmailAccountNotFoundException 남의·비활성 계정(404)
   * @throws MailValidationException 본문 상한 초과·쓸 수 없는 업로드(남의 것·만료·다른 곳에 묶임)(400)
   */
  @Transactional
  public MailDraftSaved create(long userId, MailDraftSaveRequest req) {
    Fields fields = toFields(userId, req);
    MailDraftSaved saved = draftRepo.insert(userId, fields);
    syncAttachments(userId, saved.id(), req);
    return saved;
  }

  /**
   * 임시저장 수정(낙관적 잠금) — 요청 version 이 지금 값과 같을 때만 고치고 버전을 올린다. 업로드는 차이만 반영한다(새로 생긴 것은 묶고, 빠진 것은 푼다).
   *
   * @throws MailDraftNotFoundException 없거나 남의 것(404)
   * @throws MailDraftConflictException 다른 탭이 먼저 저장해 버전이 다름(409, DRAFT_CONFLICT)
   */
  @Transactional
  public MailDraftVersion update(long userId, long draftId, MailDraftSaveRequest req) {
    if (req.version() == null) {
      throw new MailValidationException("임시저장 버전(version)이 필요해요");
    }
    Fields fields = toFields(userId, req);
    MailDraftVersion saved =
        draftRepo
            .updateIfVersion(userId, draftId, req.version(), fields)
            .orElseThrow(
                () ->
                    draftRepo.exists(userId, draftId)
                        ? new MailDraftConflictException()
                        : new MailDraftNotFoundException(draftId));
    return saved.withAttachmentCount(syncAttachments(userId, draftId, req));
  }

  /**
   * 임시저장 버리기 — 묶인 업로드는 다시 임시(지금 + 24시간)로 푼다. 웹의 「되돌리기」가 같은 내용·같은 업로드로 새 임시저장을 만들 수 있어야 해서 지금 만료시키지
   * 않는다(되돌리지 않으면 만료 뒤 스윕이 지운다). 없거나 남의 것이면 404.
   */
  @Transactional
  public void delete(long userId, long draftId) {
    if (!draftRepo.deleteOwned(userId, draftId, tempExpiry())) {
      throw new MailDraftNotFoundException(draftId);
    }
  }

  /**
   * 발송 성공 뒤 임시저장 정리(WP-577) — {@link #delete} 와 같지만 없으면 조용히 넘어간다(다른 탭이 먼저 버렸을 수 있다). 호출자 트랜잭션 안에서
   * 부른다.
   */
  @Transactional
  public void deleteIfPresent(long userId, long draftId) {
    // 보낸 뒤라 되돌릴 일이 없다 — 보내지 않은 묶인 업로드는 지금 만료시켜 바로 정리한다.
    draftRepo.deleteOwned(userId, draftId, OffsetDateTime.now());
  }

  /**
   * 발송 뒤 업로드 정리(WP-577) — 보낸 업로드·되돌린 업로드를 내 임시저장 기준으로 맞춘다. 실패해도 메일 결과를 바꾸지 않도록 호출자가 감싼다.
   *
   * <ul>
   *   <li>성공: 보낸(소비된) 업로드를 내 임시저장 정션에서 뺀다 — 남은 임시저장이 사라질 파일을 첨부로 들고 있지 않게.
   *   <li>실패: 보류를 되돌린 영구 업로드 중 그 사이 묶임이 사라진 것(임시저장이 지워짐·저장에서 빠짐)을 다시 임시로 만든다 — 원래 만료가 NULL 이라 그대로
   *       두면 지워지지 않는 고아가 된다.
   * </ul>
   *
   * @param uploadIds 발송이 보류했던 업로드 id 전체(임시저장과 무관한 것은 아무 일도 없다)
   */
  @Transactional
  public void afterSend(long userId, Collection<Long> uploadIds, boolean sent) {
    if (uploadIds.isEmpty()) {
      return;
    }
    if (sent) {
      // 소비된 파일은 보류 범주라 만료는 그대로 두고 정션만 빠진다.
      draftRepo.releaseFromOwnedDrafts(userId, uploadIds, OffsetDateTime.now());
    } else {
      draftRepo.expireUnboundPermanent(userId, uploadIds, tempExpiry());
    }
  }

  /** 요청을 저장 값으로 정규화한다 — 계정 소유·본문 상한 확인, 목록의 빈 값 제거, 미리보기 생성. */
  private Fields toFields(long userId, MailDraftSaveRequest req) {
    requireAccount(userId, req.accountId());
    String bodyHtml = req.bodyHtml() == null ? "" : req.bodyHtml();
    // UTF-8 은 UTF-16 문자 하나당 3바이트를 넘지 않는다 — 문자 수 × 3 이 상한 안이면 바이트로 바꾸지 않는다(자동 저장마다 2MB 복사를 피한다).
    if ((long) bodyHtml.length() * 3 > MailDraftSaveRequest.MAX_BODY_HTML_BYTES
        && bodyHtml.getBytes(StandardCharsets.UTF_8).length
            > MailDraftSaveRequest.MAX_BODY_HTML_BYTES) {
      throw new MailValidationException("본문이 너무 길어요. 임시저장은 2MB까지 할 수 있어요");
    }
    List<String> to = MailComposeLimits.clean(req.to());
    List<String> cc = MailComposeLimits.clean(req.cc());
    List<String> bcc = MailComposeLimits.clean(req.bcc());
    String subject = req.subject() == null ? "" : req.subject();
    // 발송과 같은 상한·같은 문구 — 저장은 되는데 발송만 거절되거나 그 반대가 없게.
    MailComposeLimits.requireWithin(to, cc, bcc, subject);
    return new Fields(
        req.accountId(),
        req.mode() == null ? "new" : req.mode(),
        to,
        cc,
        bcc,
        subject,
        bodyHtml,
        preview(req.bodyText()),
        req.sourceMessageId(),
        Boolean.TRUE.equals(req.quoteRemoved()));
  }

  /**
   * 첨부 반영 — 업로드는 차이만(새로 생긴 것은 PERMANENT 클레임 후 묶기, 빠진 것은 풀기), 전달 원본도 차이만(새로 생긴 것만 소유 확인).
   *
   * <p>내 다른 임시저장에 묶인 업로드는 옮겨 묶는다 — 그 정션에서 빼며 임시로 푼 뒤 평범하게 클레임한다(같은 트랜잭션, 클레임이 FILE 행을 잠근다). 쓸 수 없는
   * 업로드(남의 것·만료·소비·발송 중·다른 도메인에 묶임)는 발송과 같은 문구로 400 — 저장 전체가 롤백된다(풀었던 묶임·버전도 그대로).
   */
  private int syncAttachments(long userId, long draftId, MailDraftSaveRequest req) {
    List<Long> requested = uploadIds(req.attachmentIds());
    List<Long> current = draftRepo.boundFileIds(draftId);
    Set<Long> currentSet = new HashSet<>(current);
    Set<Long> requestedSet = new HashSet<>(requested);
    List<Long> toAdd = requested.stream().filter(id -> !currentSet.contains(id)).toList();
    List<Long> toRemove = current.stream().filter(id -> !requestedSet.contains(id)).toList();

    draftRepo.releaseFromOwnedDrafts(userId, toAdd, tempExpiry());
    MailComposeService.uploadsOrReject(
        toAdd, () -> stagedFileClaimer.claim(userId, toAdd, StagedFileClaimer.Retention.PERMANENT));
    draftRepo.bindFiles(draftId, toAdd);
    draftRepo.releaseFiles(userId, draftId, toRemove, tempExpiry());

    // 업로드는 모두 묶였거나 전체가 거절됐다(400) — 개수는 요청 그대로, 전달 원본은 남은 것만.
    return requested.size() + syncForwards(userId, draftId, req.forwardAttachmentIds());
  }

  /**
   * 전달 원본 반영 — 저장된 참조와 비교해 바뀐 것만 고친다(같으면 쿼리 없음). 새로 생긴 것은 내 메일 첨부인지 확인하고 남의 것·없는 것은 버린다(중복 제거, 요청
   * 순서). 원본 메일이 지워진 참조는 FK CASCADE 로 이미 빠져 있다. 반영 뒤 남은 전달 원본 수를 돌려준다.
   */
  private int syncForwards(long userId, long draftId, List<Long> requestedIds) {
    Set<Long> requested = new LinkedHashSet<>();
    if (requestedIds != null) {
      requestedIds.stream().filter(Objects::nonNull).forEach(requested::add);
    }
    Set<Long> current = new LinkedHashSet<>(draftRepo.forwardIds(draftId));
    if (requested.equals(current)) {
      return current.size();
    }
    List<Long> added = requested.stream().filter(id -> !current.contains(id)).toList();
    Set<Long> owned = attachmentRepo.findOwnedMetas(userId, added).keySet();
    List<Long> removed = current.stream().filter(id -> !requested.contains(id)).toList();
    List<Long> kept = added.stream().filter(owned::contains).toList();
    draftRepo.removeForwards(draftId, removed);
    draftRepo.addForwards(draftId, kept);
    return current.size() - removed.size() + kept.size();
  }

  /** 업로드 id 목록 형태 검사 — 빈 값·중복은 발송과 같은 문구로 400. */
  private static List<Long> uploadIds(List<Long> ids) {
    if (ids == null) {
      return List.of();
    }
    Set<Long> seen = new HashSet<>();
    for (Long id : ids) {
      if (id == null || !seen.add(id)) {
        throw new MailValidationException(MailComposeService.UPLOAD_UNUSABLE_MESSAGE);
      }
    }
    return List.copyOf(ids);
  }

  /** 본인 활성 계정인지 — 아니면 404(존재를 드러내지 않는다). */
  private void requireAccount(long userId, long accountId) {
    if (accountRepo.findByIdAndUser(userId, accountId).isEmpty()) {
      throw new EmailAccountNotFoundException(accountId);
    }
  }

  private OffsetDateTime tempExpiry() {
    return OffsetDateTime.now().plusHours(tempExpiryHours);
  }

  /** 본문 텍스트 미리보기 — 공백 정리 후 앞 120자(서로게이트 쌍을 자르지 않게 코드포인트로 센다). */
  static String preview(String text) {
    if (text == null) {
      return "";
    }
    String collapsed = text.replaceAll("\\s+", " ").trim();
    if (collapsed.codePointCount(0, collapsed.length()) <= PREVIEW_MAX) {
      return collapsed;
    }
    return collapsed.substring(0, collapsed.offsetByCodePoints(0, PREVIEW_MAX));
  }
}
