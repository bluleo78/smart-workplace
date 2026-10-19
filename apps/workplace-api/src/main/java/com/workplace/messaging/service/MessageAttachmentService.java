package com.workplace.messaging.service;

import com.workplace.file.api.StagedFile;
import com.workplace.file.api.StagedFileClaimer;
import com.workplace.file.exception.StagedFileUnusableException;
import com.workplace.file.storage.FileStore;
import com.workplace.fileai.ExtractionProfile;
import com.workplace.fileai.dto.ExtractedTextSlice;
import com.workplace.fileai.inbound.FileExtractionRequestedEvent;
import com.workplace.fileai.service.ExtractedTextService;
import com.workplace.global.util.SafeFileNames;
import com.workplace.messaging.exception.ChannelArchivedException;
import com.workplace.messaging.exception.ChannelNotMemberException;
import com.workplace.messaging.exception.InvalidMessageAttachmentException;
import com.workplace.messaging.exception.MessageAttachmentLimitExceededException;
import com.workplace.messaging.exception.MessageAttachmentTooLargeException;
import com.workplace.messaging.repository.ChannelMemberRepository;
import com.workplace.messaging.repository.ChannelRepository;
import com.workplace.messaging.repository.MessageAttachmentRepository;
import com.workplace.messaging.repository.MessageRepository;
import java.io.IOException;
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

  /** 전송 시 스테이징 파일 클레임(WP-423) — 소유·임시·미바인딩 검증과 영구 승격을 한곳에서 한다. */
  private final StagedFileClaimer claimer;

  /** 보관된 채널 업로드 차단용(WP-508). */
  private final ChannelRepository channelRepo;

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
      ExtractedTextService extractedText,
      StagedFileClaimer claimer,
      ChannelRepository channelRepo) {
    this.storage = storage;
    this.repo = repo;
    this.memberRepo = memberRepo;
    this.messageRepo = messageRepo;
    this.fileStore = fileStore;
    this.eventPublisher = eventPublisher;
    this.extractedText = extractedText;
    this.claimer = claimer;
    this.channelRepo = channelRepo;
  }

  /** 선업로드: 채널 멤버 검증 + 크기/개수 게이트 후 임시 저장. fileId 메타 반환. */
  public List<UploadedFile> upload(long callerId, long channelId, List<MultipartFile> files)
      throws IOException {
    ensureMember(channelId, callerId);
    // 보관된 채널은 읽기 전용 — 보낼 수 없는 첨부를 미리 올리지 못하게 한다(WP-508).
    if (channelRepo.isArchived(channelId)) throw new ChannelArchivedException(channelId);
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
              SafeFileNames.fitLength(
                  mf.getOriginalFilename() != null ? mf.getOriginalFilename() : "file"),
              mime,
              mf.getSize()));
    }
    return out;
  }

  /**
   * 전송 시 바인딩: 공용 스테이징 클레임({@link StagedFileClaimer}, WP-423)으로 각 fileId 가 callerId 가 올린 미바인딩·미만료 임시
   * 첨부인지 검증하고 영구로 바꾼 뒤 정션을 INSERT 한다. 이미 영구가 된 파일(이슈 첨부 등)이나 노트에 묶인 임시 이미지는 거절한다.
   *
   * <p>호출 측(MessageService) 트랜잭션에 합류한다.
   */
  public void bindToMessage(long callerId, long messageId, List<Long> fileIds) {
    if (fileIds == null || fileIds.isEmpty()) return;
    if (fileIds.size() > maxPerMessage) {
      throw new MessageAttachmentLimitExceededException(fileIds.size(), maxPerMessage);
    }
    List<StagedFile> claimed;
    try {
      claimed = claimer.claim(callerId, fileIds, StagedFileClaimer.Retention.PERMANENT);
    } catch (StagedFileUnusableException e) {
      // 웹 경로의 기존 응답(400, 첨부할 수 없는 파일입니다)을 그대로 유지한다.
      throw new InvalidMessageAttachmentException(e.fileId());
    }
    for (Long fileId : fileIds) {
      repo.bind(fileId, messageId, callerId);
    }
    // WP-358: 메시지에 붙어 영구 파일이 된 시점에 텍스트 추출을 요청한다(이슈 챗 첨부와 같은 시점). 선업로드만 하고 버려진 임시 파일은
    // 여기 오지 않아 추출 비용을 쓰지 않는다. 메시지 생성과 같은 트랜잭션이라 추출 행도 함께 커밋·롤백된다.
    for (StagedFile f : claimed) {
      eventPublisher.publishEvent(
          FileExtractionRequestedEvent.of(f.fileId(), f.mimeType(), ExtractionProfile.TEXT_ONLY));
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
    // 권한 규칙은 resolveViewFileId 한 곳에 — /text 와 /view 가 같은 가드를 쓴다(같은 readOnly 트랜잭션 안에서 실행).
    return extractedText.read(
        resolveViewFileId(callerId, channelId, messageId, fileId), offset, limit);
  }

  /**
   * 이미지 보기용 파일 id 확인(WP-250, R5) — {@link #readText} 와 같은 가드(채널 멤버 + 그 채널 메시지에 붙은 첨부)를 거쳐 core
   * file.id 만 돌려준다.
   */
  @Transactional(readOnly = true)
  public long resolveViewFileId(long callerId, long channelId, long messageId, long fileId) {
    ensureMember(channelId, callerId);
    if (!messageRepo.belongsToChannel(messageId, channelId)
        || repo.findStoredFile(fileId, messageId).isEmpty()) {
      throw new InvalidMessageAttachmentException(fileId);
    }
    return fileId;
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
