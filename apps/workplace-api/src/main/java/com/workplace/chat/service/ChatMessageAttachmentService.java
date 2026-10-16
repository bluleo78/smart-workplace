package com.workplace.chat.service;

import com.workplace.chat.exception.ChatAttachmentNotFoundException;
import com.workplace.chat.exception.InvalidChatAttachmentException;
import com.workplace.chat.repository.ChatMessageAttachmentRepository;
import com.workplace.chat.repository.ChatMessageRepository;
import com.workplace.file.api.StagedFile;
import com.workplace.file.api.StagedFileClaimer;
import com.workplace.file.exception.StagedFileUnusableException;
import com.workplace.file.storage.FileStore;
import com.workplace.fileai.ExtractionProfile;
import com.workplace.fileai.dto.ExtractedTextSlice;
import com.workplace.fileai.inbound.FileExtractionRequestedEvent;
import com.workplace.fileai.service.ExtractedTextService;
import java.io.IOException;
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

  /** 전송 시 스테이징 파일 클레임(WP-423) — 소유·임시·미바인딩 검증과 영구 승격을 한곳에서 한다. */
  private final StagedFileClaimer claimer;

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
      ChatIssueAttachmentService issueAttachments,
      StagedFileClaimer claimer) {
    this.storage = storage;
    this.repo = repo;
    this.messageRepo = messageRepo;
    this.fileStore = fileStore;
    this.threadAccess = threadAccess;
    this.eventPublisher = eventPublisher;
    this.extractedText = extractedText;
    this.issueAttachments = issueAttachments;
    this.claimer = claimer;
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
      // 저장소가 돌려준 표시 이름·정규화 mime 을 그대로 응답에 쓴다 — 저장값과 응답값이 갈라지지 않는다(WP-242).
      var stored = storage.storeTemporary(mf, callerId);
      out.add(
          new UploadedFile(
              stored.fileId(), stored.originalName(), stored.mimeType(), mf.getSize()));
    }
    return out;
  }

  /**
   * 전송 시 바인딩: 공용 스테이징 클레임({@link StagedFileClaimer}, WP-423)으로 각 fileId 가 callerId 가 올린 미바인딩·미만료 임시
   * 첨부인지 검증하고 영구로 바꾼 뒤 정션을 INSERT 한다. 이미 영구가 된 파일이나 다른 도메인에 묶인 파일은 거절한다. 메시지 생성과 동일 트랜잭션에서 호출한다.
   */
  public void bindToMessage(long callerId, long messageId, List<Long> fileIds) {
    if (fileIds == null || fileIds.isEmpty()) return;
    if (fileIds.size() > maxPerMessage) {
      // 바인딩 요청 첨부 개수 초과.
      throw new InvalidChatAttachmentException();
    }
    List<StagedFile> claimed;
    try {
      claimed = claimer.claim(callerId, fileIds, StagedFileClaimer.Retention.PERMANENT);
    } catch (StagedFileUnusableException e) {
      // 웹 경로의 기존 응답(InvalidChatAttachmentException, 400)을 그대로 유지한다.
      throw new InvalidChatAttachmentException();
    }
    for (Long fileId : fileIds) {
      repo.bind(fileId, messageId, callerId);
    }
    // 메시지에 붙어 영구 파일이 된 시점에 텍스트 추출을 요청한다(WP-242). 버려진 임시 업로드는 여기 오지 않아 추출하지 않는다.
    for (StagedFile f : claimed) {
      eventPublisher.publishEvent(
          FileExtractionRequestedEvent.of(f.fileId(), f.mimeType(), ExtractionProfile.TEXT_ONLY));
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
   * 첨부 추출 텍스트 구간 읽기(WP-242). fileId 가 이 스레드의 챗 첨부면 스레드 열람 권한(기존 가드, 없으면 403), 스레드가 딸린 이슈의 첨부면 이슈 첨부
   * 열람 권한({@link ChatIssueAttachmentService#ensureCanReadIssueAttachments}, 없으면 403)으로 판정한다. 둘 다
   * 아니면 404.
   *
   * <p>WP-244: 이슈 첨부도 같은 경로로 받는다 — 이슈 챗 AI(역할·프로젝트 멤버십 없는 AGENT)가 이슈 첨부 API 대신 이 경로로 읽고, 도구 인자가
   * 챗·이슈 첨부 모두 {@code {threadId, fileId}} 한 가지로 같아진다. 이슈 첨부는 스레드 멤버십만으로 열지 않는다(프로젝트에서 빠진 사람 차단).
   */
  @Transactional(readOnly = true)
  public ExtractedTextSlice readText(
      long callerId, long threadId, long fileId, int offset, int limit) {
    // 권한 규칙은 resolveViewFileId 한 곳에 — /text 와 /view 가 같은 가드를 쓴다(같은 readOnly 트랜잭션 안에서 실행).
    return extractedText.read(resolveViewFileId(callerId, threadId, fileId), offset, limit);
  }

  /**
   * 이미지 보기용 파일 id 확인(WP-250, R5) — {@link #readText} 와 같은 가드(이슈 첨부면 이슈 열람 권한, 챗 첨부면 스레드 열람 권한 + 스레드
   * 소속)를 거쳐 core file.id 만 돌려준다. 워커 렌더는 이 트랜잭션 밖에서 컨트롤러가 부른다.
   */
  @Transactional(readOnly = true)
  public long resolveViewFileId(long callerId, long threadId, long fileId) {
    if (issueAttachments.isIssueAttachment(threadId, fileId)) {
      issueAttachments.ensureCanReadIssueAttachments(threadId, callerId);
    } else {
      threadAccess.ensureCanRead(threadId, callerId);
      if (!repo.isAttachedToThread(fileId, threadId)) {
        throw new ChatAttachmentNotFoundException(fileId);
      }
    }
    return fileId;
  }

  /** 선업로드 응답 한 건. messageId 에 바인딩하기 전까지는 임시 상태. */
  public record UploadedFile(Long fileId, String originalName, String mimeType, long sizeBytes) {}
}
