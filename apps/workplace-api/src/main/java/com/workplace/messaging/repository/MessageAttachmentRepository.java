package com.workplace.messaging.repository;

import static com.workplace.jooq.tables.File.FILE;
import static com.workplace.jooq.tables.Message.MESSAGE;
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

/** 메시지 첨부 정션 CRUD — 바인딩 검증·영구 승격은 공용 스테이징 클레임(StagedFileClaimer)이 한다. */
@Repository
public class MessageAttachmentRepository {

  private final DSLContext dsl;

  public MessageAttachmentRepository(DSLContext dsl) {
    this.dsl = dsl;
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
   * 다운로드용 저장 파일 정보 조회(채널 멤버십은 서비스에서 검증). 삭제된 메시지의 첨부는 찾지 않는다 — 소프트 삭제라 첨부 행이 남아 있다(WP-366).
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
            .join(MESSAGE)
            .on(MESSAGE.ID.eq(MESSAGE_ATTACHMENT.MESSAGE_ID))
            .where(MESSAGE_ATTACHMENT.FILE_ID.eq(fileId))
            .and(MESSAGE_ATTACHMENT.MESSAGE_ID.eq(messageId))
            .and(MESSAGE.DELETED_AT.isNull())
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
