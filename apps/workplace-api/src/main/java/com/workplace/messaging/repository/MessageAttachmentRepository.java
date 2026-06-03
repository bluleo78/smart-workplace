package com.workplace.messaging.repository;

import static com.workplace.jooq.tables.File.FILE;
import static com.workplace.jooq.tables.MessageAttachment.MESSAGE_ATTACHMENT;
import static com.workplace.jooq.tables.User.USER;

import com.workplace.messaging.dto.MessageAttachmentResponse;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.stream.Collectors;
import org.jooq.DSLContext;
import org.springframework.stereotype.Repository;

/** 메시지 첨부 정션 CRUD + 바인딩 검증 + 영구 승격. */
@Repository
public class MessageAttachmentRepository {

  private final DSLContext dsl;

  public MessageAttachmentRepository(DSLContext dsl) {
    this.dsl = dsl;
  }

  /** 바인딩 검증용 파일 상태(소유자/만료/이미 바인딩 여부). */
  public record Bindable(Long fileId, Long uploadedBy, OffsetDateTime expiresAt, boolean bound) {}

  /**
   * 파일 존재 시 바인딩 후보 정보를 반환. 없으면 empty.
   *
   * <p>message_attachment 를 LEFT JOIN 해 이미 바인딩됐는지 여부(bound)도 함께 반환한다.
   */
  public Optional<Bindable> findBindable(Long fileId) {
    var r =
        dsl.select(FILE.ID, FILE.UPLOADED_BY, FILE.EXPIRES_AT, MESSAGE_ATTACHMENT.MESSAGE_ID)
            .from(FILE)
            .leftJoin(MESSAGE_ATTACHMENT)
            .on(MESSAGE_ATTACHMENT.FILE_ID.eq(FILE.ID))
            .where(FILE.ID.eq(fileId))
            .fetchOne();
    if (r == null) return Optional.empty();
    return Optional.of(
        new Bindable(
            r.get(FILE.ID),
            r.get(FILE.UPLOADED_BY),
            r.get(FILE.EXPIRES_AT),
            r.get(MESSAGE_ATTACHMENT.MESSAGE_ID) != null));
  }

  /**
   * 정션 매핑 INSERT — file 을 특정 message 에 바인딩한다.
   *
   * @param fileId 바인딩할 파일 ID
   * @param messageId 대상 메시지 ID
   * @param attachedBy 첨부한 사용자 ID
   */
  public void bind(Long fileId, Long messageId, Long attachedBy) {
    dsl.insertInto(MESSAGE_ATTACHMENT)
        .set(MESSAGE_ATTACHMENT.FILE_ID, fileId)
        .set(MESSAGE_ATTACHMENT.MESSAGE_ID, messageId)
        .set(MESSAGE_ATTACHMENT.ATTACHED_BY, attachedBy)
        .set(MESSAGE_ATTACHMENT.ATTACHED_AT, OffsetDateTime.now())
        .execute();
  }

  /**
   * 바인딩된 파일을 영구로 승격(expires_at = NULL).
   *
   * <p>메시지 전송 완료 후 호출해 임시 파일이 FileCleanupService 에 의해 삭제되지 않게 한다.
   */
  public void promoteToPermanent(List<Long> fileIds) {
    if (fileIds.isEmpty()) return;
    dsl.update(FILE).setNull(FILE.EXPIRES_AT).where(FILE.ID.in(fileIds)).execute();
  }

  /**
   * 여러 메시지의 첨부를 배치 조회(N+1 회피).
   *
   * @return messageId → 첨부 목록 맵. attached_at ASC 정렬.
   */
  public Map<Long, List<MessageAttachmentResponse>> findByMessageIds(List<Long> messageIds) {
    if (messageIds.isEmpty()) return Map.of();
    return dsl
        .select(
            MESSAGE_ATTACHMENT.FILE_ID,
            MESSAGE_ATTACHMENT.MESSAGE_ID,
            MESSAGE_ATTACHMENT.ATTACHED_BY,
            MESSAGE_ATTACHMENT.ATTACHED_AT,
            FILE.ORIGINAL_NAME,
            FILE.MIME_TYPE,
            FILE.SIZE_BYTES,
            USER.NAME)
        .from(MESSAGE_ATTACHMENT)
        .join(FILE)
        .on(FILE.ID.eq(MESSAGE_ATTACHMENT.FILE_ID))
        .join(USER)
        .on(USER.ID.eq(MESSAGE_ATTACHMENT.ATTACHED_BY))
        .where(MESSAGE_ATTACHMENT.MESSAGE_ID.in(messageIds))
        .orderBy(MESSAGE_ATTACHMENT.ATTACHED_AT.asc())
        .fetch(
            r ->
                new MessageAttachmentResponse(
                    r.get(MESSAGE_ATTACHMENT.FILE_ID),
                    r.get(MESSAGE_ATTACHMENT.MESSAGE_ID),
                    r.get(FILE.ORIGINAL_NAME),
                    r.get(FILE.MIME_TYPE),
                    r.get(FILE.SIZE_BYTES),
                    r.get(MESSAGE_ATTACHMENT.ATTACHED_BY),
                    r.get(USER.NAME),
                    r.get(MESSAGE_ATTACHMENT.ATTACHED_AT).toInstant()))
        .stream()
        .collect(Collectors.groupingBy(MessageAttachmentResponse::messageId));
  }

  /**
   * 다운로드용 저장 파일 정보 조회(채널 멤버십은 서비스에서 검증).
   *
   * @param fileId 파일 ID
   * @param messageId 해당 파일이 첨부된 메시지 ID (보안: 잘못된 조합 차단)
   */
  public Optional<StoredFileRow> findStoredFile(Long fileId, Long messageId) {
    var r =
        dsl.select(FILE.STORAGE_PATH, FILE.ORIGINAL_NAME, FILE.MIME_TYPE, FILE.SIZE_BYTES)
            .from(MESSAGE_ATTACHMENT)
            .join(FILE)
            .on(FILE.ID.eq(MESSAGE_ATTACHMENT.FILE_ID))
            .where(MESSAGE_ATTACHMENT.FILE_ID.eq(fileId))
            .and(MESSAGE_ATTACHMENT.MESSAGE_ID.eq(messageId))
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
