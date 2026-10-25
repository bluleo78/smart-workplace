package com.workplace.mail.service;

import com.workplace.file.api.StagedFile;
import com.workplace.file.api.StagedFileClaimer;
import com.workplace.file.exception.StagedFileUnusableException;
import com.workplace.file.service.MimeNormalizer;
import com.workplace.file.storage.FileStore;
import com.workplace.mail.dto.EmailAccountResponse;
import com.workplace.mail.dto.MailProvider;
import com.workplace.mail.dto.MailSendRequest;
import com.workplace.mail.dto.MailSendRequest.InlineImageRef;
import com.workplace.mail.dto.MailSendRequest.InlineUploadRef;
import com.workplace.mail.dto.OutgoingMail;
import com.workplace.mail.dto.OutgoingMail.AttachmentPart;
import com.workplace.mail.dto.OutgoingMail.InlineImagePart;
import com.workplace.mail.dto.ReplyContext;
import com.workplace.mail.dto.SendResult;
import com.workplace.mail.exception.EmailAccountNotFoundException;
import com.workplace.mail.exception.EmailAttachmentNotFoundException;
import com.workplace.mail.exception.EmailMessageNotFoundException;
import com.workplace.mail.exception.MailSendException;
import com.workplace.mail.exception.MailValidationException;
import com.workplace.mail.repository.EmailAccountRepository;
import com.workplace.mail.repository.EmailAttachmentRepository;
import com.workplace.mail.repository.EmailAttachmentRepository.AttachmentDownloadContext;
import com.workplace.mail.repository.EmailAttachmentRepository.InlineSourceMeta;
import com.workplace.mail.repository.EmailFolderRepository;
import com.workplace.mail.repository.EmailMessageRepository;
import com.workplace.mail.repository.EmailMessageRepository.SentRow;
import com.workplace.mail.repository.MailDraftRepository;
import com.workplace.mail.service.MailAttachmentService.AttachmentDownload;
import com.workplace.mail.service.MailSentAttachmentRecorder.PreparedAttachment;
import com.workplace.mail.util.MailComposeLimits;
import jakarta.mail.MessagingException;
import jakarta.mail.internet.AddressException;
import jakarta.mail.internet.InternetAddress;
import jakarta.mail.internet.MimeMessage;
import java.io.UncheckedIOException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.function.Supplier;
import java.util.regex.Pattern;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 메일 작성+발송 오케스트레이션. 순서가 핵심:
 *
 * <ol>
 *   <li>계정 소유 검증.
 *   <li>수신자 검증, Message-ID 직접 생성, 답장이면 부모 thread_id/Message-ID/References 상속.
 *   <li>MIME 조립(공유 MailMimeBuilder) + 공급자별 전송기(MailTransport) 디스패치 — 유일한 사용자 노출 실패 지점(실패 시 502, 로컬
 *       저장 안 함).
 *   <li>로컬 SENT 행 저장(표시 원본) + 첨부 기록(WP-574, blob 은 전송 전에 써 둔다).
 *   <li>IMAP 계정만 best-effort APPEND(Graph 는 saveToSentItems 로 서버가 자동 저장).
 * </ol>
 *
 * <p>WP-69: 답장·전달 인용문이 cid: 로 참조하는 원본 첨부(inlineImages)는 prepare 에서 소유·타입·용량만 검증하고, send 에서 바이트를 조회해
 * 같은 Content-ID 의 인라인 파트로 다시 붙인다.
 *
 * <p>WP-574: 일반 첨부 — 작성창 임시 업로드(attachmentIds, 스테이징 파일 규칙)와 전달 원본 첨부(forwardAttachmentIds). prepare
 * 는 소유·만료와 메타 크기 합계(인라인 포함 25MB)만 읽기로 본다. send 는 짧은 트랜잭션에서 임시 업로드를 클레임해 만료로 커밋하고(동시 발송 차단), 전송 전에
 * 실패하면 되돌린다. 바이트는 하나씩 받으며 실제 바이트 누적으로 25MB 를 센다(메타 크기는 IMAP 인코딩 크기 추정·NULL 일 수 있다). 단계별 트랜잭션은
 * {@link #send} 참조.
 *
 * <p>WP-577: 내 임시저장(어느 것이든)에 묶인 업로드는 임시저장 lookup 이 보류 클레임에 내줘 같은 보류·소비 흐름으로 보낸다(남의 임시저장 업로드는 묶여 있어
 * 거절). 발송에 성공하면 보낸 업로드를 임시저장 정션에서 빼고 draftId 임시저장을 지우며, 실패하면 남긴다. 받는사람·제목 상한은 임시저장과 같다.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class MailComposeService {

  private static final String SENT = EmailFolderRepository.LOCAL_SENT;
  private static final int SNIPPET_MAX = 280;

  /** 인용문 인라인 이미지 최대 개수(WP-69). */
  static final int MAX_INLINE_IMAGES = 20;

  /**
   * 인라인 이미지 원본 합계 상한 — Graph MIME sendMail 은 base64 요청 본문 4MB 제한(MIME 내부 base64 + 요청 base64 로 원본 대비
   * 약 1.8배)이라 2MB, SMTP 는 일반 릴레이 한도 내 10MB.
   */
  static final long MAX_INLINE_TOTAL_GRAPH = 2L * 1024 * 1024;

  static final long MAX_INLINE_TOTAL_SMTP = 10L * 1024 * 1024;

  static final String UPLOAD_UNUSABLE_MESSAGE = "첨부 파일을 찾을 수 없어요. 만료됐을 수 있으니 파일을 다시 올려 주세요";

  static final String FORWARD_MISSING_MESSAGE = "전달할 원본 첨부를 찾을 수 없어요";

  /**
   * 본문에 붙여 넣은 이미지(WP-947)로 받는 형식 — 웹 작성창이 받는 형식(PNG·JPEG·GIF·WebP)과 같다. SVG 처럼 활성 내용을 품을 수 있는 형식이
   * API 를 직접 부른 요청으로 받는 사람 본문에 실리지 않게 서버도 같은 목록으로 막는다(인용문 이미지는 받은 메일 원본이라 이 목록을 쓰지 않는다).
   */
  private static final Set<String> PASTED_IMAGE_TYPES =
      Set.of("image/png", "image/jpeg", "image/gif", "image/webp");

  /** Content-ID 허용 문자 — 출력 가능 ASCII 중 공백·꺾쇠·따옴표 제외(헤더 인젝션 차단), 최대 250자. */
  private static final Pattern CONTENT_ID = Pattern.compile("^[\\x21-\\x7E&&[^<>\"]]{1,250}$");

  private final EmailAccountRepository accountRepo;
  private final EmailFolderRepository folderRepo;
  private final EmailMessageRepository messageRepo;
  private final MailMimeBuilder mimeBuilder;
  private final List<MailTransport> transports;
  private final MailSentAppender appender;
  private final EmailAttachmentRepository attachmentRepo;
  private final MailAttachmentService attachmentService;
  private final StagedFileClaimer stagedFileClaimer;
  private final FileStore fileStore;
  private final MailSentAttachmentRecorder sentAttachmentRecorder;
  private final PlatformTransactionManager txManager;
  private final MailDraftService draftService;

  /**
   * 첨부 원본 합계 상한(WP-574) — 업로드 + 전달 + 인용문 이미지, 메일 한 통 기준. IMAP·M365 공통(M365 는 4MB 를 넘으면 초안+첨부 API
   * 경로로 보낸다). 첨부 파일 하나 상한과 같은 설정값(기본 25MB)을 쓴다 — 업로드 상한과 어긋나지 않게.
   */
  @Value("${workplace.storage.attachment.max-file-size-bytes:26214400}")
  private long maxAttachmentTotal;

  /**
   * 발송 사전검증(#842) — 확인카드 승인 전에 "승인 후에야 드러날 실패"를 미리 드러내기 위한 dry-run. 실행 경로(send)와 완전히 동일한 술어를
   * 공유하며(prepare) 전송·폴더 생성 등 어떤 쓰기도 하지 않는다.
   *
   * @throws EmailAccountNotFoundException 내 계정이 아님
   * @throws MailValidationException 수신자 0명·잘못된 주소 형식·쓸 수 없는 첨부·첨부 합계 상한(기본 25MB) 초과
   * @throws EmailMessageNotFoundException 답장 대상 원본 메일 없음
   * @throws MailSendException 지원하지 않는 메일 공급자
   */
  @Transactional(readOnly = true)
  public void validateSendable(long userId, long accountId, MailSendRequest req) {
    prepare(userId, accountId, req);
  }

  /**
   * 발송 전 검증 + 조회 결과 취합. send 와 validateSendable 이 공유하는 유일한 술어 정의 지점 — 검증 순서(계정 소유 → 수신자 → 주소 형식 →
   * 답장 컨텍스트 → 공급자 전송기)가 곧 예외 우선순위다. 읽기만 수행한다.
   */
  private SendPlan prepare(long userId, long accountId, MailSendRequest req) {
    EmailAccountResponse account =
        accountRepo
            .findByIdAndUser(userId, accountId)
            .orElseThrow(() -> new EmailAccountNotFoundException(accountId));

    List<String> to = MailComposeLimits.clean(req.to());
    List<String> cc = MailComposeLimits.clean(req.cc());
    List<String> bcc = MailComposeLimits.clean(req.bcc());
    if (to.isEmpty() && cc.isEmpty() && bcc.isEmpty()) {
      throw new MailValidationException("수신자를 한 명 이상 입력하세요");
    }
    // 받는사람 수·주소·제목 상한은 임시저장과 같은 검사(WP-577). 본문 상한은 없다 — 인용한 원본이 붙어 임시저장 본문보다 클 수 있다.
    MailComposeLimits.requireWithin(to, cc, bcc, req.subject());
    validateAddresses(to);
    validateAddresses(cc);
    validateAddresses(bcc);

    // 답장이면 부모 메일(내 소유) 존재 확인 — 없으면 404.
    ReplyContext replyCtx = null;
    if (req.inReplyToMessageId() != null) {
      replyCtx =
          messageRepo
              .findReplyContextByIdAndUser(userId, req.inReplyToMessageId())
              .orElseThrow(() -> new EmailMessageNotFoundException(req.inReplyToMessageId()));
    }

    // 공급자별 전송기 존재 확인 — 미지원 공급자를 MIME 조립 전에 조기 차단.
    MailTransport transport = transportFor(account.provider());
    List<InlineSource> inline =
        validateInlineImages(userId, account.provider(), req.inlineImages());
    List<StagedFile> uploads = checkUploads(userId, req.attachmentIds());
    validateInlineUploads(account.provider(), req, inline, uploads);
    List<ForwardSource> forwards = validateForwards(userId, req.forwardAttachmentIds());
    long total = 0;
    for (InlineSource src : inline) {
      total += src.meta().sizeBytes();
    }
    for (StagedFile f : uploads) {
      total += f.sizeBytes();
    }
    for (ForwardSource f : forwards) {
      total += f.meta().sizeBytes();
    }
    requireWithinTotal(total);
    return new SendPlan(account, to, cc, bcc, replyCtx, transport, inline, forwards);
  }

  /**
   * 임시 업로드 사전검증(WP-574) — 잠그지도 쓰지도 않는다(validateSendable 읽기 전용 유지). 내가 올렸고 만료 전이며 다른 곳에 묶이지 않은
   * ATTACHMENT 파일이어야 한다. 내 임시저장에 묶인 업로드는 그 바인딩을 지목해 다시 가져온다(WP-577 — 다른 도메인에도 묶였으면 거절). 남의 것·없는
   * 것·만료된 것은 구분하지 않고 같은 문구로 거절한다(남의 id 존재를 떠볼 수 없게).
   */
  private List<StagedFile> checkUploads(long userId, List<Long> ids) {
    return uploadsOrReject(
        ids,
        () ->
            stagedFileClaimer.requireClaimable(
                userId, ids, StagedFileClaimer.Retention.HOLD, MailDraftRepository.UPLOAD_BINDING));
  }

  /** 발송 시 임시 업로드를 잠가 클레임한다 — 사전검증 이후 만료·동시 발송을 다시 거른다. 보류(HOLD)로 커밋해 전송 동안 다른 발송·만료 스윕을 막는다. */
  private List<StagedFile> claimUploads(long userId, List<Long> ids) {
    return uploadsOrReject(
        ids,
        () ->
            stagedFileClaimer.claim(
                userId, ids, StagedFileClaimer.Retention.HOLD, MailDraftRepository.UPLOAD_BINDING));
  }

  /**
   * 업로드 판정 공통 — 빈 목록은 그대로, 쓸 수 없는 파일·형태 오류는 구분 없이 같은 사용자 문구(남의 id 존재를 떠볼 수 없게). 임시저장의 업로드
   * 묶기(WP-577)도 같은 규칙으로 쓴다.
   */
  static List<StagedFile> uploadsOrReject(List<Long> ids, Supplier<List<StagedFile>> claimer) {
    if (ids.isEmpty()) {
      return List.of();
    }
    try {
      return claimer.get();
    } catch (StagedFileUnusableException | IllegalArgumentException e) {
      throw new MailValidationException(UPLOAD_UNUSABLE_MESSAGE);
    }
  }

  /** 전달 원본 첨부 검증(WP-574) — 내 계정 메일의 첨부여야 한다. 바이트는 읽지 않는다. 빈 값·중복 id 는 거절. */
  private List<ForwardSource> validateForwards(long userId, List<Long> ids) {
    if (ids.isEmpty()) {
      return List.of();
    }
    Set<Long> seen = new HashSet<>();
    for (Long id : ids) {
      if (id == null || !seen.add(id)) {
        throw new MailValidationException("전달할 원본 첨부 목록이 올바르지 않아요");
      }
    }
    // 한 번에 조회 — 내 메일 첨부가 아닌 id 가 하나라도 있으면 거절(어느 것인지 드러내지 않는다).
    Map<Long, InlineSourceMeta> metas = attachmentRepo.findOwnedMetas(userId, ids);
    List<ForwardSource> out = new ArrayList<>(ids.size());
    for (Long id : ids) {
      InlineSourceMeta meta = metas.get(id);
      if (meta == null) {
        throw new MailValidationException(FORWARD_MISSING_MESSAGE);
      }
      out.add(new ForwardSource(id, meta));
    }
    return out;
  }

  /** 첨부 원본 합계가 상한을 넘으면 발송 전에 거절한다. */
  private void requireWithinTotal(long totalBytes) {
    if (totalBytes > maxAttachmentTotal) {
      throw new MailValidationException(
          "첨부 파일이 너무 커요. 메일 한 통에 모두 합쳐 " + (maxAttachmentTotal / (1024 * 1024)) + "MB까지 보낼 수 있어요");
    }
  }

  /** 검증을 통과한 전달 원본 첨부 — send 에서 바이트를 조회한다. */
  private record ForwardSource(long attachmentId, InlineSourceMeta meta) {}

  /**
   * 첨부 원본 누적 합계(WP-574) — 파트를 하나씩 확보할 때마다 더하고, 25MB 를 넘는 즉시 중단한다. 메타 크기는 NULL·추정치(IMAP 인코딩 크기)일 수
   * 있어 실제 바이트로 센다.
   */
  private final class Budget {
    private long used;

    /** 받기 전에 알고 있는 실제 크기(캐시 blob 크기 등)로 먼저 판정 — 넘으면 받지 않고 거절. */
    void requireRoomFor(long knownBytes) {
      requireWithinTotal(used + knownBytes);
    }

    /** 받은 바이트를 더한다 — 넘으면 거절. */
    byte[] add(byte[] content) {
      used += content.length;
      requireWithinTotal(used);
      return content;
    }
  }

  /** 업로드 바이트를 읽는다(디스크, 트랜잭션 밖). 크기는 우리가 저장할 때 잰 값이라 믿을 수 있지만 읽은 바이트로 다시 센다. */
  private byte[] readUpload(StagedFile f, Budget budget) {
    budget.requireRoomFor(f.sizeBytes());
    try {
      return budget.add(fileStore.readAllBytes(f.storagePath()));
    } catch (UncheckedIOException e) {
      throw new MailSendException("첨부 파일을 읽지 못했어요. 파일을 다시 올려 주세요", e);
    }
  }

  /**
   * 전달 원본 첨부 바이트를 받는다(WP-574) — 받은 메일 순서. 캐시에 없으면 원본 서버에서 바로 받는다. 실패는 발송 전체 실패 — 첨부를 빼고 보내지 않는다.
   */
  private List<AttachmentPart> loadForwards(
      long userId, List<ForwardSource> forwards, Budget budget) {
    List<AttachmentPart> parts = new ArrayList<>();
    for (ForwardSource src : forwards) {
      AttachmentDownload dl =
          fetchOwnedAttachment(
              userId,
              src.attachmentId(),
              budget,
              FORWARD_MISSING_MESSAGE,
              "전달할 원본 첨부를 가져오지 못했어요. 잠시 뒤 다시 보내 주세요");
      parts.add(
          new AttachmentPart(
              src.meta().filename(), src.meta().contentType(), dl.content(), dl.contentHash()));
    }
    return parts;
  }

  /**
   * 내 메일 첨부 바이트를 받는다 — 소유 확인만 짧은 읽기 트랜잭션에서 하고, 원본 서버 받기는 DB 연결 없이 한다({@link
   * MailAttachmentService#downloadForPreview}). 캐시에 있으면 그 blob 의 실제 크기로 읽기 전에 상한을 판정하고, 받은 뒤에도 실제
   * 바이트로 센다. 상한 초과(400)는 그대로, 원본 없음은 notFoundMessage 가 있으면 400 으로, 나머지 실패는 failMessage 의 502 로 바꾼다.
   */
  private AttachmentDownload fetchOwnedAttachment(
      long userId, long attachmentId, Budget budget, String notFoundMessage, String failMessage) {
    try {
      TransactionTemplate readTx = new TransactionTemplate(txManager);
      readTx.setReadOnly(true);
      AttachmentDownloadContext ctx =
          readTx.execute(
              status ->
                  attachmentRepo
                      .findContextForDownload(userId, attachmentId)
                      .orElseThrow(() -> new EmailAttachmentNotFoundException(attachmentId)));
      AttachmentDownload dl =
          attachmentService.downloadForPreview(userId, ctx, budget::requireRoomFor);
      budget.add(dl.content());
      return dl;
    } catch (MailValidationException e) {
      throw e;
    } catch (EmailAttachmentNotFoundException e) {
      if (notFoundMessage != null) {
        throw new MailValidationException(notFoundMessage);
      }
      throw new MailSendException(failMessage, e);
    } catch (RuntimeException e) {
      throw new MailSendException(failMessage, e);
    }
  }

  /**
   * 인용문 인라인 이미지 검증(WP-69) — 바이트는 읽지 않는다(validateSendable 읽기 전용 유지). 개수 → Content-ID 형식 → 소유(원본 첨부
   * 존재) → image/* → 공급자별 총용량 순.
   */
  private List<InlineSource> validateInlineImages(
      long userId, MailProvider provider, List<InlineImageRef> refs) {
    if (refs.isEmpty()) {
      return List.of();
    }
    if (refs.size() > MAX_INLINE_IMAGES) {
      throw new MailValidationException("인용문 이미지는 최대 " + MAX_INLINE_IMAGES + "개까지 보낼 수 있습니다");
    }
    List<InlineSource> out = new ArrayList<>();
    long total = 0;
    for (InlineImageRef ref : refs) {
      if (ref == null
          || ref.attachmentId() == null
          || ref.contentId() == null
          || !CONTENT_ID.matcher(ref.contentId()).matches()) {
        throw new MailValidationException("인용문 이미지 참조가 올바르지 않습니다");
      }
      InlineSourceMeta meta =
          attachmentRepo
              .findInlineSourceMeta(userId, ref.attachmentId())
              .orElseThrow(() -> new MailValidationException("인용문 이미지 원본을 찾을 수 없습니다"));
      if (!InlineImageSupport.isImage(meta.contentType())) {
        throw new MailValidationException("인용문 이미지가 이미지 파일이 아닙니다");
      }
      total += meta.sizeBytes();
      out.add(new InlineSource(ref, meta));
    }
    requireInlineWithin(provider, total, "인용문 이미지", "인용문을 제거하고 보내세요");
    return out;
  }

  /**
   * 본문에 붙여 넣은 이미지 검증(WP-947) — 업로드 자체(소유·만료·바인딩)는 checkUploads 가 이미 봤다. 여기서는 참조 형식 → attachmentIds
   * 안에 있는지 → 중복(같은 업로드·같은 Content-ID, 인용문 cid 포함) → image/* → 인용문 이미지와 합친 개수·공급자별 총용량을 본다. 인라인 파트는
   * MIME 안에 들어가 Graph 요청 본문 상한을 함께 쓰므로 인용문 이미지와 같은 한도를 나눠 쓴다.
   */
  private void validateInlineUploads(
      MailProvider provider,
      MailSendRequest req,
      List<InlineSource> inline,
      List<StagedFile> uploads) {
    List<InlineUploadRef> refs = req.inlineUploads();
    if (refs.isEmpty()) {
      return;
    }
    if (inline.size() + refs.size() > MAX_INLINE_IMAGES) {
      throw new MailValidationException(
          "본문 이미지는 인용문 이미지와 합쳐 최대 " + MAX_INLINE_IMAGES + "개까지 보낼 수 있습니다");
    }
    Map<Long, StagedFile> byId = new HashMap<>();
    for (StagedFile f : uploads) {
      byId.put(f.fileId(), f);
    }
    Set<String> contentIds = new HashSet<>();
    long total = 0;
    for (InlineSource src : inline) {
      contentIds.add(src.ref().contentId());
      total += src.meta().sizeBytes();
    }
    Set<Long> seen = new HashSet<>();
    for (InlineUploadRef ref : refs) {
      if (ref == null
          || ref.attachmentId() == null
          || ref.contentId() == null
          || !CONTENT_ID.matcher(ref.contentId()).matches()
          || !byId.containsKey(ref.attachmentId())
          || !seen.add(ref.attachmentId())
          || !contentIds.add(ref.contentId())) {
        throw new MailValidationException("본문 이미지 참조가 올바르지 않습니다");
      }
      StagedFile f = byId.get(ref.attachmentId());
      if (!PASTED_IMAGE_TYPES.contains(MimeNormalizer.baseMime(f.mimeType()))) {
        throw new MailValidationException("본문 이미지가 이미지 파일이 아닙니다");
      }
      total += f.sizeBytes();
    }
    requireInlineWithin(provider, total, "본문 이미지", "이미지를 줄이거나 첨부로 보내세요");
  }

  /** 인라인 이미지 원본 합계의 공급자별 상한 — 인용문 이미지와 붙여 넣은 본문 이미지가 같은 MIME 한도를 나눠 쓴다. */
  private static void requireInlineWithin(
      MailProvider provider, long total, String what, String advice) {
    long max = provider == MailProvider.M365_GRAPH ? MAX_INLINE_TOTAL_GRAPH : MAX_INLINE_TOTAL_SMTP;
    if (total > max) {
      throw new MailValidationException(
          what + " 용량이 너무 큽니다(최대 " + (max / (1024 * 1024)) + "MB). " + advice);
    }
  }

  /** 검증을 통과한 인라인 이미지 원본 — send 에서 바이트를 조회한다. */
  private record InlineSource(InlineImageRef ref, InlineSourceMeta meta) {}

  /** 원본 첨부 바이트를 조회해 인라인 파트로 만든다. 실패 시 발송 전체를 실패시킨다 — 이미지를 빼고 보내면 수신자에게 깨진 참조가 남으므로 조용히 누락하지 않는다. */
  private List<InlineImagePart> loadInlineImages(
      long userId, List<InlineSource> sources, Budget budget) {
    List<InlineImagePart> parts = new ArrayList<>();
    for (InlineSource src : sources) {
      AttachmentDownload dl =
          fetchOwnedAttachment(
              userId,
              src.ref().attachmentId(),
              budget,
              null,
              "인용문 이미지를 가져오지 못했습니다. 인용문을 제거하고 다시 보내세요");
      parts.add(
          new InlineImagePart(
              src.ref().contentId(),
              src.meta().filename(),
              src.meta().contentType(),
              dl.content(),
              dl.contentHash()));
    }
    return parts;
  }

  /** prepare 산출물 — 검증 통과 사실 + 재조회 없이 재사용할 값들. replyCtx 는 신규/전달이면 null. */
  private record SendPlan(
      EmailAccountResponse account,
      List<String> to,
      List<String> cc,
      List<String> bcc,
      ReplyContext replyCtx,
      MailTransport transport,
      List<InlineSource> inline,
      List<ForwardSource> forwards) {}

  /**
   * 본인 계정으로 메일 발송. 발송 성공 시 로컬 SENT 행 id + Message-ID 반환.
   *
   * <p>WP-574 — 트랜잭션을 단계로 나눈다(메서드 전체를 한 트랜잭션으로 묶지 않는다):
   *
   * <ol>
   *   <li><b>짧은 트랜잭션</b>: 검증(prepare) + 임시 업로드 보류 클레임(HOLD — 범주 ATTACHMENT_HELD, 만료 1시간 뒤). 커밋되면 같은
   *       업로드로 동시에 보내는 두 번째 요청은 거절되고, 긴 전송 동안 만료 스윕이 행·파일을 지우지 않는다 — 잠금·DB 연결을 전송 내내 붙잡지 않는다.
   *   <li><b>트랜잭션 밖</b>: 첨부 바이트 확보(누적 25MB) → MIME → 전송. 여기서 실패하면 보류를 원래 상태(ATTACHMENT, 원래 만료)로 되돌려
   *       같은 업로드로 다시 보낼 수 있게 한다. 성공하면 보류를 사용 완료(지금 만료)로 바꾼다.
   *   <li><b>기록 트랜잭션</b>(호출자 트랜잭션이 있으면 세이브포인트): SENT 행 + 첨부 기록(blob 저장 포함 — 전송 경로에 얹지 않는다). 메일은 이미
   *       나갔으므로 실패해도 발송 성공으로 응답하고 경고만 남긴다 — 롤백 뒤 실패로 보이면 사용자가 다시 보내 같은 메일이 두 번 나간다. 이때
   *       localMessageId 는 0. Graph 초안 경로에서 Exchange 가 다른 Message-ID 를 붙였으면 그 값으로 남긴다.
   *   <li>IMAP 계정만 best-effort APPEND.
   * </ol>
   *
   * <p>호출자 트랜잭션 안에서 불리면(AI 확인카드 ActionService.confirm) 1·3 단계가 거기에 합류한다 — 그 경로는 기존처럼 바깥 트랜잭션이 끝날 때
   * 커밋된다.
   */
  public SendResult send(long userId, long accountId, MailSendRequest req) {
    // ① 검증은 사전검증(validateSendable)과 동일 경로 — 술어 포크 금지. 업로드 클레임까지 한 트랜잭션.
    Claimed claimed =
        new TransactionTemplate(txManager)
            .execute(
                status -> {
                  SendPlan plan = prepare(userId, accountId, req);
                  return new Claimed(plan, claimUploads(userId, req.attachmentIds()));
                });
    SendPlan plan = claimed.plan();
    EmailAccountResponse account = plan.account();

    OutgoingMail mail;
    MimeMessage message;
    String sentMessageId;
    try {
      // ② 트랜잭션 밖 — 바이트 확보부터 전송까지
      mail = buildMail(userId, plan, req, claimed.uploads());
      try {
        message = mimeBuilder.build(account, mail);
      } catch (MessagingException e) {
        throw new MailSendException("메일 구성에 실패했습니다", e);
      }
      sentMessageId = plan.transport().transmit(userId, account, message, mail);
    } catch (RuntimeException e) {
      releaseUploads(userId, claimed.uploads(), e);
      afterSendQuietly(userId, req.attachmentIds(), false, e);
      throw e;
    }
    // 로컬 기록·응답은 실제로 나간 Message-ID 로(Graph 초안 경로는 Exchange 가 다른 값을 붙일 수 있다)
    if (!sentMessageId.equals(mail.messageId())) {
      mail = mail.withMessageId(sentMessageId);
    }

    // ③ 업로드 사용 완료 + 기록 — 실패해도 발송은 성공
    consumeUploads(userId, claimed.uploads());
    long localId = recordSent(accountId, mail);
    // WP-577: 이어받은 임시저장 정리 — 메일은 이미 나갔으므로 실패해도 발송은 성공(기록과 따로 커밋해 기록 실패가 임시저장을 남겨 재발송을 부르지 않게)
    deleteDraftQuietly(userId, req.draftId());
    // 보낸(소비된) 업로드를 다른 임시저장에서도 뺀다 — 남겨 두면 그 임시저장이 사라진 파일을 첨부로 보여 주고 다시 보내면 400 이다.
    afterSendQuietly(userId, req.attachmentIds(), true, null);

    // ④ IMAP 계정만 best-effort APPEND(Graph 는 saveToSentItems 로 서버가 자동 저장).
    if (account.provider() == MailProvider.IMAP) {
      appender.appendQuietly(account, userId, message);
    }

    return new SendResult(localId, mail.messageId());
  }

  /** ① 단계 산출물 — 검증 결과 + 클레임한 업로드. */
  private record Claimed(SendPlan plan, List<StagedFile> uploads) {}

  /** 첨부 바이트를 확보하고(누적 25MB — 넘으면 그 자리에서 중단) 발송 캐리어를 만든다. 업로드 → 인용문 이미지 → 전달 원본 순으로 센다. */
  private OutgoingMail buildMail(
      long userId, SendPlan plan, MailSendRequest req, List<StagedFile> uploads) {
    EmailAccountResponse account = plan.account();
    // Message-ID 직접 생성(전송본·APPEND·로컬 행 공유).
    String messageId = UUID.randomUUID() + "@" + domainOf(account.emailAddress());

    // 답장: 부모 스레드/헤더 상속. 신규/전달: 새 스레드(자기 ID 루트).
    String threadId = messageId;
    String inReplyTo = null;
    String references = null;
    if (plan.replyCtx() != null) {
      ReplyContext ctx = plan.replyCtx();
      threadId = ctx.threadId();
      inReplyTo = ctx.parentMessageId();
      references = buildReferences(ctx.parentReferences(), ctx.parentMessageId());
    }

    Budget budget = new Budget();
    // 본문에 붙여 넣은 이미지(WP-947)는 업로드 가운데 인라인 파트로 가고, 나머지만 일반 첨부가 된다.
    Map<Long, String> inlineCids = new HashMap<>();
    for (InlineUploadRef ref : req.inlineUploads()) {
      inlineCids.put(ref.attachmentId(), ref.contentId());
    }
    List<AttachmentPart> uploadParts = new ArrayList<>();
    List<InlineImagePart> inlineParts =
        new ArrayList<>(loadInlineImages(userId, plan.inline(), budget));
    for (StagedFile f : uploads) {
      byte[] content = readUpload(f, budget);
      String cid = inlineCids.get(f.fileId());
      if (cid != null) {
        inlineParts.add(new InlineImagePart(cid, f.originalName(), f.mimeType(), content));
      } else {
        uploadParts.add(new AttachmentPart(f.originalName(), f.mimeType(), content));
      }
    }
    // 메일 안 첨부 순서: 전달 원본(받은 메일 순서) 다음 업로드
    List<AttachmentPart> attachments =
        new ArrayList<>(loadForwards(userId, plan.forwards(), budget));
    attachments.addAll(uploadParts);

    return new OutgoingMail(
        messageId,
        threadId,
        account.emailAddress(),
        account.displayName(),
        plan.to(),
        plan.cc(),
        plan.bcc(),
        nz(req.subject()),
        req.bodyText(),
        req.bodyHtml(),
        inReplyTo,
        references,
        snippet(req.bodyText()),
        Instant.now(),
        inlineParts,
        attachments);
  }

  /**
   * 전송 전 실패 시 보류 되돌리기 — 원래 상태(ATTACHMENT, 원래 만료)로 살려 같은 업로드로 다시 보낼 수 있게 한다. 되돌리기 실패가 원래 오류를 가리지 않게
   * 덧붙이기만 한다(보류 만료 1시간 뒤 스윕이 지우므로 그때는 다시 올리면 된다).
   */
  private void releaseUploads(long userId, List<StagedFile> held, RuntimeException cause) {
    if (held.isEmpty()) {
      return;
    }
    try {
      stagedFileClaimer.releaseHeld(userId, held);
    } catch (RuntimeException e) {
      log.warn("발송 실패 뒤 첨부 업로드 되살리기 실패 — 다시 올려야 함: {}", e.toString());
      cause.addSuppressed(e);
    }
  }

  /**
   * 발송 뒤 임시저장 업로드 정리(WP-577, {@link MailDraftService#afterSend}) — 성공이면 보낸 업로드를 내 임시저장에서 빼고, 실패면 그
   * 사이 묶임이 사라진 영구 업로드에 만료를 다시 건다. 정리가 실패해도 발송 결과를 바꾸지 않는다(실패 경로면 원래 오류에 덧붙인다).
   */
  private void afterSendQuietly(
      long userId, List<Long> uploadIds, boolean sent, RuntimeException cause) {
    if (uploadIds.isEmpty()) {
      return;
    }
    try {
      draftService.afterSend(userId, uploadIds, sent);
    } catch (RuntimeException e) {
      log.warn("발송 뒤 임시저장 업로드 정리 실패(sent={}): {}", sent, e.toString());
      if (cause != null) {
        cause.addSuppressed(e);
      }
    }
  }

  /** 발송 성공 뒤 임시저장 삭제(WP-577) — 없으면(다른 탭이 버림) 그대로, 실패해도 경고만 남긴다(메일은 이미 나갔다). */
  private void deleteDraftQuietly(long userId, Long draftId) {
    if (draftId == null) {
      return;
    }
    try {
      draftService.deleteIfPresent(userId, draftId);
    } catch (RuntimeException e) {
      log.warn("메일은 보냈지만 임시저장 삭제 실패 (draftId={}): {}", draftId, e.toString());
    }
  }

  /** 전송 성공 뒤 보류 업로드를 사용 완료(보류 그대로 지금 만료)로 — 실패해도 발송은 성공(보류 만료 뒤 스윕이 지운다). */
  private void consumeUploads(long userId, List<StagedFile> held) {
    if (held.isEmpty()) {
      return;
    }
    try {
      stagedFileClaimer.consumeHeld(userId, held);
    } catch (RuntimeException e) {
      log.warn("메일은 보냈지만 첨부 업로드 정리 실패 — 보류 만료 뒤 정리됨: {}", e.toString());
    }
  }

  /**
   * 전송 뒤 기록(SENT 행 + 첨부) — 따로 커밋되는 트랜잭션(호출자 트랜잭션이 있으면 세이브포인트)이라 실패해도 발송 결과를 뒤집지 않는다.
   *
   * @return 로컬 SENT 행 id, 기록 실패면 0
   */
  private long recordSent(long accountId, OutgoingMail mail) {
    // 해시·암호화 파일 쓰기는 트랜잭션 밖(준비 실패도 발송 결과를 뒤집지 않는다), 트랜잭션 안에서는 행만.
    List<PreparedAttachment> prepared;
    try {
      prepared = sentAttachmentRecorder.prepare(mail);
    } catch (RuntimeException e) {
      log.warn(
          "메일은 보냈지만 보낸 메일 첨부 준비 실패 — 첨부 없이 기록 (account={}, messageId={}): {}",
          accountId,
          mail.messageId(),
          e.toString());
      prepared = List.of();
    }
    List<PreparedAttachment> parts = prepared;
    TransactionTemplate recordTx = new TransactionTemplate(txManager);
    recordTx.setPropagationBehavior(TransactionDefinition.PROPAGATION_NESTED);
    try {
      Long id =
          recordTx.execute(
              status -> {
                long folderId = folderRepo.ensureFolder(accountId, SENT).id();
                SentRow row = messageRepo.insertSentRow(accountId, folderId, mail);
                sentAttachmentRecorder.record(row.messageId(), row.contentId(), parts);
                return row.messageId();
              });
      return id == null ? 0L : id;
    } catch (RuntimeException e) {
      log.warn(
          "메일은 보냈지만 보낸편지함 기록 실패 (account={}, messageId={}): {}",
          accountId,
          mail.messageId(),
          e.toString());
      return 0L;
    }
  }

  /** 공급자에 맞는 전송기 선택. 미지원 공급자는 MailSendException 으로 조기 실패. */
  private MailTransport transportFor(MailProvider provider) {
    return transports.stream()
        .filter(t -> t.provider() == provider)
        .findFirst()
        .orElseThrow(() -> new MailSendException("지원하지 않는 메일 공급자: " + provider));
  }

  /** strict 파싱으로 주소 형식 검증(헤더 인젝션 방지). 실패 시 400. */
  private void validateAddresses(List<String> addrs) {
    for (String a : addrs) {
      try {
        new InternetAddress(a, true);
      } catch (AddressException e) {
        throw new MailValidationException("올바르지 않은 이메일 주소: " + a);
      }
    }
  }

  /** References = 부모 References(있으면) + "<부모 Message-ID>"(있으면). 둘 다 없으면 null. */
  private String buildReferences(String parentReferences, String parentMessageId) {
    String pid = parentMessageId != null ? "<" + parentMessageId + ">" : null;
    if (pid == null) {
      return (parentReferences != null && !parentReferences.isBlank())
          ? parentReferences.trim()
          : null;
    }
    if (parentReferences == null || parentReferences.isBlank()) {
      return pid;
    }
    return parentReferences.trim() + " " + pid;
  }

  private String domainOf(String email) {
    int at = email.indexOf('@');
    return at >= 0 && at < email.length() - 1 ? email.substring(at + 1) : "localhost";
  }

  private String nz(String s) {
    return s == null ? "" : s;
  }

  /** 본문 텍스트에서 미리보기 스니펫(공백 정규화 후 최대 280자). */
  private String snippet(String text) {
    if (text == null) {
      return null;
    }
    String collapsed = text.replaceAll("\\s+", " ").trim();
    if (collapsed.isEmpty()) {
      return null;
    }
    return collapsed.length() <= SNIPPET_MAX ? collapsed : collapsed.substring(0, SNIPPET_MAX);
  }
}
