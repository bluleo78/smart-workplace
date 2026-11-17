package com.workplace.chat.repository;

import static com.workplace.jooq.tables.ChatMessage.CHAT_MESSAGE;
import static com.workplace.jooq.tables.ChatMessageAttachment.CHAT_MESSAGE_ATTACHMENT;
import static com.workplace.jooq.tables.File.FILE;
import static com.workplace.jooq.tables.User.USER;

import com.workplace.chat.dto.ChatMessageAttachmentResponse;
import com.workplace.file.api.AttachmentBindings;
import java.time.OffsetDateTime;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.stream.Collectors;
import org.jooq.DSLContext;
import org.springframework.stereotype.Repository;

/**
 * chat 메시지 첨부 정션 CRUD. 바인딩 검증·영구 승격은 공용 스테이징 클레임({@link com.workplace.file.api.StagedFileClaimer})이
 * 맡는다(WP-423).
 */
@Repository
public class ChatMessageAttachmentRepository {

  private final DSLContext dsl;

  /** 다른 「보이는 첨부」 정션에 묶인 file 을 만료 재설정에서 거르는 공용 조건(WP-1399) — 수정에서 첨부를 뺄 때 쓴다(WP-1680). */
  private final AttachmentBindings attachmentBindings;

  public ChatMessageAttachmentRepository(DSLContext dsl, AttachmentBindings attachmentBindings) {
    this.dsl = dsl;
    this.attachmentBindings = attachmentBindings;
  }

  /** 메시지에 지금 붙은 첨부 file id(붙인 순서). 수정에서 keep 과 비교하는 기준(WP-1680). */
  public List<Long> fileIdsOfMessage(long messageId) {
    return dsl.select(CHAT_MESSAGE_ATTACHMENT.FILE_ID)
        .from(CHAT_MESSAGE_ATTACHMENT)
        .where(CHAT_MESSAGE_ATTACHMENT.MESSAGE_ID.eq(messageId))
        .orderBy(CHAT_MESSAGE_ATTACHMENT.ATTACHED_AT.asc(), CHAT_MESSAGE_ATTACHMENT.FILE_ID.asc())
        .fetch(CHAT_MESSAGE_ATTACHMENT.FILE_ID);
  }

  /**
   * 메시지에서 첨부 연결만 지운다(WP-1680) — file 행·원본은 남긴다(수명은 {@link #rearmExpiry} 의 만료 스윕이나 드라이브가 맡는다).
   *
   * @return 실제로 지운 file id
   */
  public List<Long> unbind(long messageId, Collection<Long> fileIds) {
    if (fileIds.isEmpty()) return List.of();
    return dsl.deleteFrom(CHAT_MESSAGE_ATTACHMENT)
        .where(CHAT_MESSAGE_ATTACHMENT.MESSAGE_ID.eq(messageId))
        .and(CHAT_MESSAGE_ATTACHMENT.FILE_ID.in(fileIds))
        .returning(CHAT_MESSAGE_ATTACHMENT.FILE_ID)
        .fetch(CHAT_MESSAGE_ATTACHMENT.FILE_ID);
  }

  /**
   * 메시지에서 뺀 file 에 만료를 다시 건다(WP-1680) — 아무도 쓰지 않는 원본이 영구로 남지 않게 만료 스윕에 맡긴다. 이미 만료가 걸린 것({@code
   * expires_at} 이 있음)은 건드리지 않는다 — 걸린 만료를 늘리지 않는다.
   *
   * <p>다른 「보이는 첨부」 정션(이슈·팀 채팅·메인 AI 채팅·홈 첨부, 강등 안 된 노트 첨부·이슈 본문 이미지)에 아직 묶인 file 도 건드리지 않는다 —
   * {@link AttachmentBindings#notVisiblyBound} 판정이다. 걸면 만료 스윕이 file 행을 지우고 그 정션 행이 CASCADE 로 함께 사라져
   * 다른 곳의 첨부가 조용히 없어진다. 이 메시지의 연결은 호출 전에 이미 지웠으므로 조건에 걸리지 않는다. 드라이브가 쓰는 file 은 호출자가 미리 걸러
   * 낸다(DriveFileUsage).
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
   * fileId 가 이 스레드의 어떤 메시지에 바인딩된 첨부인지(WP-242 — 구간 읽기 소속 확인). 삭제된 메시지의 첨부는 소속으로 보지 않는다 — 소프트 삭제라 첨부
   * 행이 남아 있어 /text·/view 로 지운 파일을 계속 읽을 수 있었다(WP-681, 팀 채팅 WP-366 과 같은 기준).
   */
  public boolean isAttachedToThread(long fileId, long threadId) {
    return dsl.fetchExists(
        dsl.selectOne()
            .from(CHAT_MESSAGE_ATTACHMENT)
            .join(CHAT_MESSAGE)
            .on(CHAT_MESSAGE.ID.eq(CHAT_MESSAGE_ATTACHMENT.MESSAGE_ID))
            .where(CHAT_MESSAGE_ATTACHMENT.FILE_ID.eq(fileId))
            .and(CHAT_MESSAGE.THREAD_ID.eq(threadId))
            .and(CHAT_MESSAGE.DELETED_AT.isNull()));
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
                    r.get(CHAT_MESSAGE_ATTACHMENT.ATTACHED_AT).toInstant(),
                    null))
        .stream()
        .collect(Collectors.groupingBy(ChatMessageAttachmentResponse::messageId));
  }

  /**
   * 다운로드용 저장 파일 정보. (file-message 정합성은 PK 로 보장, thread 멤버십은 서비스 검증) 삭제된 메시지의 첨부는 찾지 않는다 — 소프트 삭제라
   * 첨부 행이 남아 있다(WP-681, 팀 채팅 WP-366 과 같은 기준).
   */
  public Optional<StoredFileRow> findStoredFile(Long fileId, Long messageId) {
    var r =
        dsl.select(FILE.STORAGE_PATH, FILE.ORIGINAL_NAME, FILE.MIME_TYPE, FILE.SIZE_BYTES)
            .from(CHAT_MESSAGE_ATTACHMENT)
            .join(FILE)
            .on(FILE.ID.eq(CHAT_MESSAGE_ATTACHMENT.FILE_ID))
            .join(CHAT_MESSAGE)
            .on(CHAT_MESSAGE.ID.eq(CHAT_MESSAGE_ATTACHMENT.MESSAGE_ID))
            .where(CHAT_MESSAGE_ATTACHMENT.FILE_ID.eq(fileId))
            .and(CHAT_MESSAGE_ATTACHMENT.MESSAGE_ID.eq(messageId))
            .and(CHAT_MESSAGE.DELETED_AT.isNull())
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
