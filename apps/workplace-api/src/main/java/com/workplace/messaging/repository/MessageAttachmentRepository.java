package com.workplace.messaging.repository;

import static com.workplace.jooq.tables.File.FILE;
import static com.workplace.jooq.tables.Message.MESSAGE;
import static com.workplace.jooq.tables.MessageAttachment.MESSAGE_ATTACHMENT;
import static com.workplace.jooq.tables.User.USER;

import com.workplace.file.api.AttachmentBindings;
import com.workplace.messaging.dto.MessageAttachmentResponse;
import java.time.OffsetDateTime;
import java.util.Collection;
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

  /** 다른 「보이는 첨부」 정션에 묶인 file 을 만료 재설정에서 거르는 공용 조건(WP-1399) — 수정에서 첨부를 뺄 때 쓴다(WP-1679). */
  private final AttachmentBindings attachmentBindings;

  public MessageAttachmentRepository(DSLContext dsl, AttachmentBindings attachmentBindings) {
    this.dsl = dsl;
    this.attachmentBindings = attachmentBindings;
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

  /** 메시지에 지금 붙은 첨부 file id(붙인 순서). 수정에서 keep 과 비교하는 기준(WP-1679). */
  public List<Long> fileIdsOfMessage(long messageId) {
    return dsl.select(MESSAGE_ATTACHMENT.FILE_ID)
        .from(MESSAGE_ATTACHMENT)
        .where(MESSAGE_ATTACHMENT.MESSAGE_ID.eq(messageId))
        .orderBy(MESSAGE_ATTACHMENT.ATTACHED_AT.asc(), MESSAGE_ATTACHMENT.FILE_ID.asc())
        .fetch(MESSAGE_ATTACHMENT.FILE_ID);
  }

  /**
   * 메시지에서 첨부 연결만 지운다(WP-1679) — file 행·원본은 남긴다(수명은 {@link #rearmExpiry} 의 만료 스윕이나 드라이브가 맡는다).
   *
   * @return 실제로 지운 file id
   */
  public List<Long> unbind(long messageId, Collection<Long> fileIds) {
    if (fileIds.isEmpty()) return List.of();
    return dsl.deleteFrom(MESSAGE_ATTACHMENT)
        .where(MESSAGE_ATTACHMENT.MESSAGE_ID.eq(messageId))
        .and(MESSAGE_ATTACHMENT.FILE_ID.in(fileIds))
        .returning(MESSAGE_ATTACHMENT.FILE_ID)
        .fetch(MESSAGE_ATTACHMENT.FILE_ID);
  }

  /**
   * 메시지에서 뺀 file 에 만료를 다시 건다(WP-1679) — 아무도 쓰지 않는 원본이 영구로 남지 않게 만료 스윕에 맡긴다. 이미 만료가 걸린 것({@code
   * expires_at} 이 있음)은 건드리지 않는다 — 걸린 만료를 늘리지 않는다.
   *
   * <p>다른 「보이는 첨부」 정션(이슈·이슈 채팅·홈 첨부, 강등 안 된 노트 첨부·이슈 본문 이미지)에 아직 묶인 file 도 건드리지 않는다 — 드라이브 영구 삭제의
   * {@code expireFiles} 와 같은 판정({@link AttachmentBindings#notVisiblyBound})이다. 걸면 만료 스윕이 file 행을
   * 지우고 그 정션 행이 CASCADE 로 함께 사라져 다른 곳의 첨부가 조용히 없어진다. 이 메시지의 연결은 호출 전에 이미 지웠으므로 조건에 걸리지 않는다. 드라이브가
   * 쓰는 file 은 호출자가 미리 걸러 낸다(DriveFileUsage). 다른 이슈 본문에 붙여넣은 본문 이미지의 텍스트 참조는 만료 스윕의 보존
   * 정책(IssueBodyImageRetentionPolicy.stillReferencedAnywhere)이 지울 때 한 번 더 본다.
   */
  public void rearmExpiry(Collection<Long> fileIds, OffsetDateTime expiresAt) {
    if (fileIds.isEmpty()) return;
    dsl.update(FILE)
        .set(FILE.EXPIRES_AT, expiresAt)
        .where(FILE.ID.in(fileIds))
        .and(FILE.EXPIRES_AT.isNull())
        .and(attachmentBindings.notVisiblyBound(FILE.ID))
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
