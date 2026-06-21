package com.workplace.chat.repository;

import static com.workplace.jooq.tables.ChatMessageAttachment.CHAT_MESSAGE_ATTACHMENT;
import static com.workplace.jooq.tables.File.FILE;
import static com.workplace.jooq.tables.User.USER;

import com.workplace.chat.dto.ChatMessageAttachmentResponse;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.stream.Collectors;
import org.jooq.DSLContext;
import org.springframework.stereotype.Repository;

/** chat 메시지 첨부 정션 CRUD + 바인딩 검증 + 영구 승격. (MessageAttachmentRepository 미러) */
@Repository
public class ChatMessageAttachmentRepository {

  private final DSLContext dsl;

  public ChatMessageAttachmentRepository(DSLContext dsl) {
    this.dsl = dsl;
  }

  /** 바인딩 검증용 파일 상태(소유자/만료/이미 바인딩 여부). */
  public record Bindable(Long fileId, Long uploadedBy, OffsetDateTime expiresAt, boolean bound) {}

  /** 파일 존재 시 바인딩 후보 정보 반환. chat_message_attachment LEFT JOIN 으로 bound 여부 포함. */
  public Optional<Bindable> findBindable(Long fileId) {
    var r =
        dsl.select(FILE.ID, FILE.UPLOADED_BY, FILE.EXPIRES_AT, CHAT_MESSAGE_ATTACHMENT.MESSAGE_ID)
            .from(FILE)
            .leftJoin(CHAT_MESSAGE_ATTACHMENT)
            .on(CHAT_MESSAGE_ATTACHMENT.FILE_ID.eq(FILE.ID))
            .where(FILE.ID.eq(fileId))
            .fetchOne();
    if (r == null) return Optional.empty();
    return Optional.of(
        new Bindable(
            r.get(FILE.ID),
            r.get(FILE.UPLOADED_BY),
            r.get(FILE.EXPIRES_AT),
            r.get(CHAT_MESSAGE_ATTACHMENT.MESSAGE_ID) != null));
  }

  /** 정션 INSERT — file 을 특정 chat 메시지에 바인딩. */
  public void bind(Long fileId, Long messageId, Long attachedBy) {
    dsl.insertInto(CHAT_MESSAGE_ATTACHMENT)
        .set(CHAT_MESSAGE_ATTACHMENT.FILE_ID, fileId)
        .set(CHAT_MESSAGE_ATTACHMENT.MESSAGE_ID, messageId)
        .set(CHAT_MESSAGE_ATTACHMENT.ATTACHED_BY, attachedBy)
        .set(CHAT_MESSAGE_ATTACHMENT.ATTACHED_AT, OffsetDateTime.now())
        .execute();
  }

  /** 바인딩된 파일을 영구로 승격(expires_at = NULL). */
  public void promoteToPermanent(List<Long> fileIds) {
    if (fileIds.isEmpty()) return;
    dsl.update(FILE).setNull(FILE.EXPIRES_AT).where(FILE.ID.in(fileIds)).execute();
  }

  /** 여러 메시지의 첨부 배치 조회(N+1 회피). messageId → 첨부 목록, attached_at ASC. */
  public Map<Long, List<ChatMessageAttachmentResponse>> findByMessageIds(List<Long> messageIds) {
    if (messageIds.isEmpty()) return Map.of();
    return dsl
        .select(
            CHAT_MESSAGE_ATTACHMENT.FILE_ID,
            CHAT_MESSAGE_ATTACHMENT.MESSAGE_ID,
            CHAT_MESSAGE_ATTACHMENT.ATTACHED_BY,
            CHAT_MESSAGE_ATTACHMENT.ATTACHED_AT,
            FILE.ORIGINAL_NAME,
            FILE.MIME_TYPE,
            FILE.SIZE_BYTES,
            USER.NAME)
        .from(CHAT_MESSAGE_ATTACHMENT)
        .join(FILE)
        .on(FILE.ID.eq(CHAT_MESSAGE_ATTACHMENT.FILE_ID))
        .join(USER)
        .on(USER.ID.eq(CHAT_MESSAGE_ATTACHMENT.ATTACHED_BY))
        .where(CHAT_MESSAGE_ATTACHMENT.MESSAGE_ID.in(messageIds))
        .orderBy(CHAT_MESSAGE_ATTACHMENT.ATTACHED_AT.asc())
        .fetch(
            r ->
                new ChatMessageAttachmentResponse(
                    r.get(CHAT_MESSAGE_ATTACHMENT.FILE_ID),
                    r.get(CHAT_MESSAGE_ATTACHMENT.MESSAGE_ID),
                    r.get(FILE.ORIGINAL_NAME),
                    r.get(FILE.MIME_TYPE),
                    r.get(FILE.SIZE_BYTES),
                    r.get(CHAT_MESSAGE_ATTACHMENT.ATTACHED_BY),
                    r.get(USER.NAME),
                    r.get(CHAT_MESSAGE_ATTACHMENT.ATTACHED_AT).toInstant()))
        .stream()
        .collect(Collectors.groupingBy(ChatMessageAttachmentResponse::messageId));
  }

  /** 다운로드용 저장 파일 정보. (file-message 정합성은 PK 로 보장, thread 멤버십은 서비스 검증) */
  public Optional<StoredFileRow> findStoredFile(Long fileId, Long messageId) {
    var r =
        dsl.select(FILE.STORAGE_PATH, FILE.ORIGINAL_NAME, FILE.MIME_TYPE, FILE.SIZE_BYTES)
            .from(CHAT_MESSAGE_ATTACHMENT)
            .join(FILE)
            .on(FILE.ID.eq(CHAT_MESSAGE_ATTACHMENT.FILE_ID))
            .where(CHAT_MESSAGE_ATTACHMENT.FILE_ID.eq(fileId))
            .and(CHAT_MESSAGE_ATTACHMENT.MESSAGE_ID.eq(messageId))
            .fetchOne();
    if (r == null) return Optional.empty();
    return Optional.of(
        new StoredFileRow(
            r.get(FILE.STORAGE_PATH),
            r.get(FILE.ORIGINAL_NAME),
            r.get(FILE.MIME_TYPE),
            r.get(FILE.SIZE_BYTES)));
  }

  /** 다운로드 응답용 저장 파일 정보. */
  public record StoredFileRow(String path, String originalName, String mimeType, long sizeBytes) {}
}
