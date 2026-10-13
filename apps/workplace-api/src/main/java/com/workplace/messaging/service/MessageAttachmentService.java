package com.workplace.messaging.service;

import com.workplace.file.storage.FileStore;
import com.workplace.fileai.ExtractionProfile;
import com.workplace.fileai.dto.ExtractedTextSlice;
import com.workplace.fileai.inbound.FileExtractionRequestedEvent;
import com.workplace.fileai.service.ExtractedTextService;
import com.workplace.messaging.exception.ChannelNotMemberException;
import com.workplace.messaging.exception.InvalidMessageAttachmentException;
import com.workplace.messaging.exception.MessageAttachmentLimitExceededException;
import com.workplace.messaging.exception.MessageAttachmentTooLargeException;
import com.workplace.messaging.repository.ChannelMemberRepository;
import com.workplace.messaging.repository.MessageAttachmentRepository;
import com.workplace.messaging.repository.MessageRepository;
import java.io.IOException;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

/** 메시지 첨부 선업로드 + 전송 시 바인딩 검증/승격을 담당. */
@Service
@Transactional
public class MessageAttachmentService {

  private final MessageAttachmentStorage storage;
  private final MessageAttachmentRepository repo;
  private final ChannelMemberRepository memberRepo;
  private final MessageRepository messageRepo;

  /** 상대경로→절대경로 복원용 코어 파일 저장소. 다운로드 시 FileSystemResource 에 전달하기 전에 resolve() 호출. */
  private final FileStore fileStore;

  /** WP-358: 바인딩(영구 승격) 시 텍스트 추출 요청 발행. */
  private final ApplicationEventPublisher eventPublisher;

  /** WP-358: 추출 텍스트 구간 읽기(공용 fileai). */
  private final ExtractedTextService extractedText;

  @Value("${workplace.storage.attachment.max-file-size-bytes:26214400}")
  private long maxFileSize;

  @Value("${workplace.storage.attachment.max-per-message:10}")
  private int maxPerMessage;

  public MessageAttachmentService(
      MessageAttachmentStorage storage,
      MessageAttachmentRepository repo,
      ChannelMemberRepository memberRepo,
      MessageRepository messageRepo,
      FileStore fileStore,
      ApplicationEventPublisher eventPublisher,
      ExtractedTextService extractedText) {
    this.storage = storage;
    this.repo = repo;
    this.memberRepo = memberRepo;
    this.messageRepo = messageRepo;
    this.fileStore = fileStore;
    this.eventPublisher = eventPublisher;
    this.extractedText = extractedText;
  }

  /** 선업로드: 채널 멤버 검증 + 크기/개수 게이트 후 임시 저장. fileId 메타 반환. */
  public List<UploadedFile> upload(long callerId, long channelId, List<MultipartFile> files)
      throws IOException {
    ensureMember(channelId, callerId);
    if (files == null || files.isEmpty()) return List.of();
    if (files.size() > maxPerMessage) {
      throw new MessageAttachmentLimitExceededException(files.size(), maxPerMessage);
    }
    // 크기 검증을 실제 저장 전에 수행해 불필요한 I/O 방지
    for (MultipartFile mf : files) {
      if (mf.getSize() > maxFileSize) {
        throw new MessageAttachmentTooLargeException(mf.getSize(), maxFileSize);
      }
    }
    List<UploadedFile> out = new ArrayList<>();
    for (MultipartFile mf : files) {
      Long id = storage.storeTemporary(mf, callerId);
      // 저장소가 file 행에 쓴 것과 같은 정규화 mime 을 응답에 싣는다(WP-358).
      String mime = MessageAttachmentStorage.normalizedMime(mf);
      out.add(
          new UploadedFile(
              id,
              mf.getOriginalFilename() != null ? mf.getOriginalFilename() : "file",
              mime,
              mf.getSize()));
    }
    return out;
  }

  /**
   * 전송 시 바인딩: 각 fileId 가 callerId 소유 + 미바인딩 + 미만료인지 검증 후 정션 INSERT + 영구 승격.
   *
   * <p>호출 측(MessageService) 트랜잭션에 합류한다.
   */
  public void bindToMessage(long callerId, long messageId, List<Long> fileIds) {
    if (fileIds == null || fileIds.isEmpty()) return;
    if (fileIds.size() > maxPerMessage) {
      throw new MessageAttachmentLimitExceededException(fileIds.size(), maxPerMessage);
    }
    OffsetDateTime now = OffsetDateTime.now();
    // 1차 패스: 전부 유효한지 검증. 추출 요청 발행용으로 후보(mime 포함)를 모아 둔다.
    List<MessageAttachmentRepository.Bindable> bindables = new ArrayList<>();
    for (Long fileId : fileIds) {
      var b =
          repo.findBindable(fileId)
              .orElseThrow(() -> new InvalidMessageAttachmentException(fileId));
      // uploadedBy null 체크: DB 컬럼이 nullable 인 경우 방어
      boolean ownedByCaller = b.uploadedBy() != null && b.uploadedBy() == callerId;
      boolean expired = b.expiresAt() != null && b.expiresAt().isBefore(now);
      if (!ownedByCaller || b.bound() || expired) {
        throw new InvalidMessageAttachmentException(fileId);
      }
      bindables.add(b);
    }
    for (Long fileId : fileIds) {
      repo.bind(fileId, messageId, callerId);
    }
    repo.promoteToPermanent(fileIds);
    // WP-358: 메시지에 붙어 영구 파일이 된 시점에 텍스트 추출을 요청한다(이슈 챗 첨부와 같은 시점). 선업로드만 하고 버려진 임시 파일은
    // 여기 오지 않아 추출 비용을 쓰지 않는다. 메시지 생성과 같은 트랜잭션이라 추출 행도 함께 커밋·롤백된다.
    for (var b : bindables) {
      eventPublisher.publishEvent(
          FileExtractionRequestedEvent.of(b.fileId(), b.mimeType(), ExtractionProfile.TEXT_ONLY));
    }
  }

  /**
   * 채널 멤버만 다운로드 가능. 메시지-파일-채널 정합성 + 멤버십 검증 후 저장 파일 정보 반환.
   *
   * <p>STORAGE_PATH 는 상대경로이므로 FileStore.resolve() 로 절대경로를 복원한다. 컨트롤러가 path() 를 FileSystemResource 에
   * 그대로 넘기므로 절대경로여야 한다.
   *
   * @return 다운로드용 파일 메타(절대 경로·이름·MIME·크기)
   */
  @Transactional(readOnly = true)
  public MessageAttachmentRepository.StoredFileRow download(
      long callerId, long channelId, long messageId, Long fileId) {
    ensureMember(channelId, callerId);
    if (!messageRepo.belongsToChannel(messageId, channelId)) {
      throw new InvalidMessageAttachmentException(fileId);
    }
    var row =
        repo.findStoredFile(fileId, messageId)
            .orElseThrow(() -> new InvalidMessageAttachmentException(fileId));
    // 상대경로를 절대경로로 복원 — FileSystemResource 에 넘기기 전에 반드시 resolve 필요
    return new MessageAttachmentRepository.StoredFileRow(
        fileStore.resolve(row.path()).toString(),
        row.originalName(),
        row.mimeType(),
        row.sizeBytes());
  }

  /**
   * 첨부 추출 텍스트 구간 읽기(WP-358). 권한·소속 판정은 {@link #download} 와 같다 — 채널 비멤버는
   * 403(ChannelNotMemberException), 다른 채널의 메시지·그 메시지에 붙지 않은 fileId 는
   * 400(InvalidMessageAttachmentException). 상태·사유·자르기는 fileai 공용 서비스가 맡는다.
   */
  @Transactional(readOnly = true)
  public ExtractedTextSlice readText(
      long callerId, long channelId, long messageId, long fileId, int offset, int limit) {
    ensureMember(channelId, callerId);
    if (!messageRepo.belongsToChannel(messageId, channelId)
        || repo.findStoredFile(fileId, messageId).isEmpty()) {
      throw new InvalidMessageAttachmentException(fileId);
    }
    return extractedText.read(fileId, offset, limit);
  }

  /** 채널 멤버 여부 확인. 비멤버면 ChannelNotMemberException 발생. */
  private void ensureMember(long channelId, long userId) {
    if (!memberRepo.isMember(channelId, userId)) {
      throw new ChannelNotMemberException(channelId, userId);
    }
  }

  /** 선업로드 응답 한 건. */
  public record UploadedFile(Long fileId, String originalName, String mimeType, long sizeBytes) {}
}
