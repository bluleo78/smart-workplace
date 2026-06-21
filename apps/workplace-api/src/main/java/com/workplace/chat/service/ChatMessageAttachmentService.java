package com.workplace.chat.service;

import com.workplace.chat.exception.ChatThreadNotMemberException;
import com.workplace.chat.exception.InvalidChatAttachmentException;
import com.workplace.chat.repository.ChatMessageAttachmentRepository;
import com.workplace.chat.repository.ChatMessageRepository;
import com.workplace.chat.repository.ChatThreadMemberRepository;
import java.io.IOException;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import org.springframework.beans.factory.annotation.Value;
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
  private final ChatThreadMemberRepository memberRepo;
  private final ChatMessageRepository messageRepo;

  /** 파일 1개당 최대 크기(바이트). 기본 25MB. */
  @Value("${workplace.chat.attachment.max-file-size-bytes:26214400}")
  private long maxFileSize;

  /** 메시지당 최대 첨부 개수. 기본 10개. */
  @Value("${workplace.chat.attachment.max-per-message:10}")
  private int maxPerMessage;

  public ChatMessageAttachmentService(
      ChatMessageAttachmentStorage storage,
      ChatMessageAttachmentRepository repo,
      ChatThreadMemberRepository memberRepo,
      ChatMessageRepository messageRepo) {
    this.storage = storage;
    this.repo = repo;
    this.memberRepo = memberRepo;
    this.messageRepo = messageRepo;
  }

  /**
   * 선업로드: thread 멤버 검증 + 크기/개수 게이트 후 임시 저장. 반환값의 fileId 를 메시지 전송 시 bindToMessage 에 전달한다.
   *
   * @throws IOException 파일 디스크 저장 실패 시
   */
  public List<UploadedFile> upload(long callerId, long threadId, List<MultipartFile> files)
      throws IOException {
    // thread 멤버만 파일 업로드 가능.
    ensureMember(threadId, callerId);
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
      Long id = storage.storeTemporary(mf, callerId);
      String mime =
          mf.getContentType() != null && !mf.getContentType().isBlank()
              ? mf.getContentType()
              : "application/octet-stream";
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
   * 전송 시 바인딩: 각 fileId 가 callerId 소유 + 미바인딩 + 미만료인지 검증 후 정션 INSERT + 영구 승격. 메시지 생성과 동일 트랜잭션에서 호출한다.
   */
  public void bindToMessage(long callerId, long messageId, List<Long> fileIds) {
    if (fileIds == null || fileIds.isEmpty()) return;
    if (fileIds.size() > maxPerMessage) {
      // 바인딩 요청 첨부 개수 초과.
      throw new InvalidChatAttachmentException();
    }
    OffsetDateTime now = OffsetDateTime.now();
    // 1차 패스: 전부 유효한지 검증.
    for (Long fileId : fileIds) {
      var b = repo.findBindable(fileId).orElseThrow(InvalidChatAttachmentException::new);
      // 소유자 불일치, 이미 바인딩됨, 만료된 임시 파일이면 거부.
      boolean ownedByCaller = b.uploadedBy() != null && b.uploadedBy() == callerId;
      boolean expired = b.expiresAt() != null && b.expiresAt().isBefore(now);
      if (!ownedByCaller || b.bound() || expired) {
        throw new InvalidChatAttachmentException();
      }
    }
    // 2차 패스: 정션 INSERT + 임시 만료 해제(영구 승격).
    for (Long fileId : fileIds) {
      repo.bind(fileId, messageId, callerId);
    }
    repo.promoteToPermanent(fileIds);
  }

  /**
   * thread 멤버만 다운로드. 메시지-thread 정합성 + 멤버십 검증 후 저장 파일 정보 반환.
   *
   * @return 다운로드용 파일 메타(경로·이름·MIME·크기)
   */
  @Transactional(readOnly = true)
  public ChatMessageAttachmentRepository.StoredFileRow download(
      long callerId, long threadId, long messageId, Long fileId) {
    ensureMember(threadId, callerId);
    if (!messageRepo.belongsToThread(messageId, threadId)) {
      throw new InvalidChatAttachmentException();
    }
    return repo.findStoredFile(fileId, messageId).orElseThrow(InvalidChatAttachmentException::new);
  }

  /** thread 멤버가 아니면 ChatThreadNotMemberException. */
  private void ensureMember(long threadId, long userId) {
    if (!memberRepo.isMember(threadId, userId)) {
      throw new ChatThreadNotMemberException(threadId, userId);
    }
  }

  /** 선업로드 응답 한 건. messageId 에 바인딩하기 전까지는 임시 상태. */
  public record UploadedFile(Long fileId, String originalName, String mimeType, long sizeBytes) {}
}
