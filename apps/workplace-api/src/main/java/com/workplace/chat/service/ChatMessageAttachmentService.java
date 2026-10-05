package com.workplace.chat.service;

import com.workplace.chat.exception.ChatAttachmentNotFoundException;
import com.workplace.chat.exception.InvalidChatAttachmentException;
import com.workplace.chat.repository.ChatMessageAttachmentRepository;
import com.workplace.chat.repository.ChatMessageRepository;
import com.workplace.file.storage.FileStore;
import com.workplace.fileai.ExtractionProfile;
import com.workplace.fileai.dto.ExtractedTextSlice;
import com.workplace.fileai.inbound.FileExtractionRequestedEvent;
import com.workplace.fileai.service.ExtractedTextService;
import java.io.IOException;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

/**
 * 이슈 채팅 첨부 선업로드 + 전송 시 바인딩 검증/승격 + 다운로드. (messaging MessageAttachmentService 미러)
 *
 * <p>thread 멤버십 검증 → 파일 크기/개수 게이트 → 임시 저장 순으로 처리한다. 바인딩은 메시지 INSERT 후 동일 트랜잭션에서 호출되어 RLS 컨텍스트를
 * 공유한다.
 */
@Service
@Transactional
public class ChatMessageAttachmentService {

  private final ChatMessageAttachmentStorage storage;
  private final ChatMessageAttachmentRepository repo;
  private final ChatMessageRepository messageRepo;

  /** 코어 파일 저장소 — 다운로드 시 상대경로를 절대경로로 복원. */
  private final FileStore fileStore;

  // WP-213: 선업로드는 쓰기 권한만 확인(참여는 메시지 전송 시).
  private final ChatThreadAccess threadAccess;

  /** 첨부 바인딩 시 텍스트 추출 요청 이벤트 발행용(WP-242). */
  private final ApplicationEventPublisher eventPublisher;

  /** 추출 텍스트 구간 읽기(WP-242). */
  private final ExtractedTextService extractedText;

  /** 스레드가 딸린 이슈의 첨부 판정(WP-244) — 텍스트 읽기 경로가 이슈 첨부도 받게 한다. */
  private final ChatIssueAttachmentService issueAttachments;

  /** 파일 1개당 최대 크기(바이트). 기본 25MB. */
  @Value("${workplace.storage.attachment.max-file-size-bytes:26214400}")
  private long maxFileSize;

  /** 메시지당 최대 첨부 개수. 기본 10개. */
  @Value("${workplace.storage.attachment.max-per-message:10}")
  private int maxPerMessage;

  public ChatMessageAttachmentService(
      ChatMessageAttachmentStorage storage,
      ChatMessageAttachmentRepository repo,
      ChatMessageRepository messageRepo,
      FileStore fileStore,
      ChatThreadAccess threadAccess,
      ApplicationEventPublisher eventPublisher,
      ExtractedTextService extractedText,
      ChatIssueAttachmentService issueAttachments) {
    this.storage = storage;
    this.repo = repo;
    this.messageRepo = messageRepo;
    this.fileStore = fileStore;
    this.threadAccess = threadAccess;
    this.eventPublisher = eventPublisher;
    this.extractedText = extractedText;
    this.issueAttachments = issueAttachments;
  }

  /**
   * 선업로드: thread 멤버 검증 + 크기/개수 게이트 후 임시 저장. 반환값의 fileId 를 메시지 전송 시 bindToMessage 에 전달한다.
   *
   * @throws IOException 파일 디스크 저장 실패 시
   */
  public List<UploadedFile> upload(long callerId, long threadId, List<MultipartFile> files)
      throws IOException {
    // 스레드 멤버 또는 쓰기 권한자(곧 보낼 때 자동 참여)만 파일 업로드 가능 — 참여 자체는 메시지 전송 시 한다(WP-213).
    threadAccess.ensureCanWrite(threadId, callerId);
    if (files == null || files.isEmpty()) return List.of();
    if (files.size() > maxPerMessage) {
      // 한 번에 첨부 가능한 파일 개수 초과.
      throw new InvalidChatAttachmentException();
    }
    for (MultipartFile mf : files) {
      if (mf.getSize() > maxFileSize) {
        // 파일 크기 한도 초과.
        throw new InvalidChatAttachmentException();
      }
    }
    List<UploadedFile> out = new ArrayList<>();
    for (MultipartFile mf : files) {
      // 저장소가 돌려준 정규화 mime 을 그대로 응답에 쓴다 — 저장값과 응답값이 갈라지지 않는다(WP-242).
      var stored = storage.storeTemporary(mf, callerId);
      out.add(
          new UploadedFile(
              stored.fileId(),
              mf.getOriginalFilename() != null ? mf.getOriginalFilename() : "file",
              stored.mimeType(),
              mf.getSize()));
    }
    return out;
  }

  /**
   * 전송 시 바인딩: 각 fileId 가 callerId 소유 + 미바인딩 + 미만료인지 검증 후 정션 INSERT + 영구 승격. 메시지 생성과 동일 트랜잭션에서 호출한다.
   */
  public void bindToMessage(long callerId, long messageId, List<Long> fileIds) {
    if (fileIds == null || fileIds.isEmpty()) return;
    if (fileIds.size() > maxPerMessage) {
      // 바인딩 요청 첨부 개수 초과.
      throw new InvalidChatAttachmentException();
    }
    OffsetDateTime now = OffsetDateTime.now();
    // 1차 패스: 전부 유효한지 검증. 이벤트 발행용으로 후보를 모아 둔다.
    List<ChatMessageAttachmentRepository.Bindable> bindables = new ArrayList<>();
    for (Long fileId : fileIds) {
      var b = repo.findBindable(fileId).orElseThrow(InvalidChatAttachmentException::new);
      // 소유자 불일치, 이미 바인딩됨, 만료된 임시 파일이면 거부.
      boolean ownedByCaller = b.uploadedBy() != null && b.uploadedBy() == callerId;
      boolean expired = b.expiresAt() != null && b.expiresAt().isBefore(now);
      if (!ownedByCaller || b.bound() || expired) {
        throw new InvalidChatAttachmentException();
      }
      bindables.add(b);
    }
    // 2차 패스: 정션 INSERT + 임시 만료 해제(영구 승격).
    for (Long fileId : fileIds) {
      repo.bind(fileId, messageId, callerId);
    }
    repo.promoteToPermanent(fileIds);
    // 메시지에 붙어 영구 파일이 된 시점에 텍스트 추출을 요청한다(WP-242). 버려진 임시 업로드는 여기 오지 않아 추출하지 않는다.
    for (var b : bindables) {
      eventPublisher.publishEvent(
          FileExtractionRequestedEvent.of(b.fileId(), b.mimeType(), ExtractionProfile.TEXT_ONLY));
    }
  }

  /**
   * 메시지를 읽을 수 있는 사용자만 다운로드. 메시지-thread 정합성 + 읽기 권한 검증 후 저장 파일 정보 반환.
   *
   * <p>STORAGE_PATH 는 상대경로이므로 FileStore.resolve() 로 절대경로를 복원한다. 컨트롤러가 path() 를 FileSystemResource 에
   * 그대로 넘기므로 절대경로여야 한다.
   *
   * @return 다운로드용 파일 메타(절대 경로·이름·MIME·크기)
   */
  @Transactional(readOnly = true)
  public ChatMessageAttachmentRepository.StoredFileRow download(
      long callerId, long threadId, long messageId, Long fileId) {
    // 메시지를 읽을 수 있는 사람(스레드 멤버·프로젝트 멤버·OPEN 열람자)은 그 첨부도 열 수 있다 — 목록과 같은 읽기 규칙(WP-213).
    threadAccess.ensureCanRead(threadId, callerId);
    if (!messageRepo.belongsToThread(messageId, threadId)) {
      throw new InvalidChatAttachmentException();
    }
    var row =
        repo.findStoredFile(fileId, messageId).orElseThrow(InvalidChatAttachmentException::new);
    // 상대경로를 절대경로로 복원 — FileSystemResource 에 넘기기 전에 반드시 resolve 필요
    return new ChatMessageAttachmentRepository.StoredFileRow(
        fileStore.resolve(row.path()).toString(),
        row.originalName(),
        row.mimeType(),
        row.sizeBytes());
  }

  /**
   * 첨부 추출 텍스트 구간 읽기(WP-242). 스레드 열람 권한(기존 가드, 없으면 403) + fileId 가 이 스레드의 챗 첨부이거나 스레드가 딸린 이슈의 첨부인지(둘
   * 다 아니면 404).
   *
   * <p>WP-244: 이슈 첨부도 같은 경로로 받는다 — 이슈 챗 AI(역할·프로젝트 멤버십 없는 AGENT)가 이슈 첨부 API 대신 스레드 권한으로 읽고, 도구 인자가
   * 챗·이슈 첨부 모두 {@code {threadId, fileId}} 한 가지로 같아진다.
   */
  @Transactional(readOnly = true)
  public ExtractedTextSlice readText(
      long callerId, long threadId, long fileId, int offset, int limit) {
    threadAccess.ensureCanRead(threadId, callerId);
    if (!repo.isAttachedToThread(fileId, threadId)
        && !issueAttachments.isIssueAttachment(threadId, fileId)) {
      throw new ChatAttachmentNotFoundException(fileId);
    }
    return extractedText.read(fileId, offset, limit);
  }

  /** 선업로드 응답 한 건. messageId 에 바인딩하기 전까지는 임시 상태. */
  public record UploadedFile(Long fileId, String originalName, String mimeType, long sizeBytes) {}
}
