// ChatMessageAttachmentSourceProvider.java — CHAT_MESSAGE 첨부파일 가상 뷰 제공
package com.workplace.chat.service;

import static com.workplace.jooq.Tables.CHAT_MESSAGE;
import static com.workplace.jooq.Tables.CHAT_MESSAGE_ATTACHMENT;
import static com.workplace.jooq.Tables.CHAT_THREAD;
import static com.workplace.jooq.Tables.CHAT_THREAD_MEMBER;
import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.PROJECT;
import static org.jooq.impl.DSL.exists;
import static org.jooq.impl.DSL.selectOne;

import com.workplace.drive.api.AttachmentSourceProvider;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * CHAT_MESSAGE 첨부파일 가상 뷰 제공자. 호출자가 멤버인 thread 의 메시지 첨부만 노출. q=파일명 부분일치, beforeAt=커서(최신→오래된 순),
 * limit+1 개 반환(다음 페이지 판단용). (MessageAttachmentSourceProvider 미러, messaging 대신 chat 테이블 사용)
 */
@Component
@RequiredArgsConstructor
public class ChatMessageAttachmentSourceProvider implements AttachmentSourceProvider {

  private final DSLContext dsl;

  @Override
  public String sourceType() {
    return "CHAT_MESSAGE";
  }

  @Override
  @Transactional(readOnly = true)
  public List<Entry> list(long callerId, String q, Instant beforeAt, int limit) {
    var query =
        dsl.select(
                FILE.ID,
                FILE.ORIGINAL_NAME,
                FILE.MIME_TYPE,
                FILE.SIZE_BYTES,
                FILE.THUMBNAIL_PATH,
                CHAT_MESSAGE.ID.as("message_id"),
                CHAT_MESSAGE.THREAD_ID,
                PROJECT.KEY,
                ISSUE.NUMBER,
                CHAT_MESSAGE_ATTACHMENT.ATTACHED_AT)
            .from(CHAT_MESSAGE_ATTACHMENT)
            .join(FILE)
            .on(FILE.ID.eq(CHAT_MESSAGE_ATTACHMENT.FILE_ID))
            .join(CHAT_MESSAGE)
            .on(CHAT_MESSAGE.ID.eq(CHAT_MESSAGE_ATTACHMENT.MESSAGE_ID))
            .join(CHAT_THREAD)
            .on(CHAT_THREAD.ID.eq(CHAT_MESSAGE.THREAD_ID))
            .join(ISSUE)
            .on(ISSUE.ID.eq(CHAT_THREAD.ISSUE_ID))
            .join(PROJECT)
            .on(PROJECT.ID.eq(ISSUE.PROJECT_ID))
            // 호출자가 thread 멤버인 경우만 노출 (EXISTS WHERE 필터)
            .where(
                exists(
                    selectOne()
                        .from(CHAT_THREAD_MEMBER)
                        .where(
                            CHAT_THREAD_MEMBER
                                .THREAD_ID
                                .eq(CHAT_MESSAGE.THREAD_ID)
                                .and(CHAT_THREAD_MEMBER.USER_ID.eq(callerId)))))
            .and(CHAT_MESSAGE.DELETED_AT.isNull());

    // 파일명 부분일치 필터 (선택)
    if (q != null && !q.isBlank()) {
      query = query.and(FILE.ORIGINAL_NAME.likeIgnoreCase("%" + q + "%"));
    }

    // 커서 기반 페이지네이션 (attached_at < beforeAt)
    if (beforeAt != null) {
      OffsetDateTime cursor = beforeAt.atOffset(ZoneOffset.UTC);
      query = query.and(CHAT_MESSAGE_ATTACHMENT.ATTACHED_AT.lt(cursor));
    }

    return query
        .orderBy(CHAT_MESSAGE_ATTACHMENT.ATTACHED_AT.desc())
        .limit(limit + 1) // 다음 페이지 판단을 위해 limit+1 개 조회
        .fetch(
            r -> {
              long threadId = r.get(CHAT_MESSAGE.THREAD_ID);
              long messageId = r.get(CHAT_MESSAGE.ID.as("message_id"), Long.class);
              String key = r.get(PROJECT.KEY);
              int num = r.get(ISSUE.NUMBER);
              // 라벨: 이슈 키 형식
              String sourceLabel = key + "-" + num;
              // 딥링크: IssueDriveLinkSourceResolver 와 동일한 "/projects/KEY/issues/번호" 패턴
              String deepLink = "/projects/" + key + "/issues/" + num;
              // 채팅 첨부 다운로드 경로 (ChatMessageAttachmentController 실제 엔드포인트)
              String downloadUrl =
                  "/api/v1/chat/threads/"
                      + threadId
                      + "/messages/"
                      + messageId
                      + "/attachments/"
                      + r.get(FILE.ID)
                      + "/content";
              return new Entry(
                  r.get(FILE.ID),
                  r.get(FILE.ORIGINAL_NAME),
                  r.get(FILE.MIME_TYPE),
                  r.get(FILE.SIZE_BYTES),
                  r.get(FILE.THUMBNAIL_PATH) != null,
                  sourceLabel,
                  deepLink,
                  downloadUrl,
                  r.get(CHAT_MESSAGE_ATTACHMENT.ATTACHED_AT).toInstant());
            });
  }

  /** caller 가 멤버인 thread 의 메시지에 fileId 가 첨부된 경우 true. import 인가 검증용. */
  @Override
  @Transactional(readOnly = true)
  public boolean canAccessFile(long callerId, long fileId) {
    return dsl.fetchExists(
        dsl.selectOne()
            .from(CHAT_MESSAGE_ATTACHMENT)
            .join(CHAT_MESSAGE)
            .on(CHAT_MESSAGE.ID.eq(CHAT_MESSAGE_ATTACHMENT.MESSAGE_ID))
            .where(CHAT_MESSAGE_ATTACHMENT.FILE_ID.eq(fileId))
            .and(CHAT_MESSAGE.DELETED_AT.isNull())
            .and(
                DSL.exists(
                    DSL.selectOne()
                        .from(CHAT_THREAD_MEMBER)
                        .where(
                            CHAT_THREAD_MEMBER
                                .THREAD_ID
                                .eq(CHAT_MESSAGE.THREAD_ID)
                                .and(CHAT_THREAD_MEMBER.USER_ID.eq(callerId))))));
  }
}
