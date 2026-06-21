// MessageAttachmentSourceProvider.java — MESSAGE 첨부파일 가상 뷰 제공
package com.workplace.messaging.service;

import static com.workplace.jooq.Tables.CHANNEL;
import static com.workplace.jooq.Tables.CHANNEL_MEMBER;
import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.MESSAGE;
import static com.workplace.jooq.Tables.MESSAGE_ATTACHMENT;
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
 * MESSAGE 첨부파일 가상 뷰 제공자. 호출자가 멤버인 채널의 메시지 첨부만 노출. q=파일명 부분일치, beforeAt=커서(최신→오래된 순), limit+1 개
 * 반환(다음 페이지 판단용).
 */
@Component
@RequiredArgsConstructor
public class MessageAttachmentSourceProvider implements AttachmentSourceProvider {

  private final DSLContext dsl;

  @Override
  public String sourceType() {
    return "MESSAGE";
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
                MESSAGE.ID.as("message_id"),
                MESSAGE.CHANNEL_ID,
                CHANNEL.NAME,
                MESSAGE_ATTACHMENT.ATTACHED_AT)
            .from(MESSAGE_ATTACHMENT)
            .join(FILE)
            .on(FILE.ID.eq(MESSAGE_ATTACHMENT.FILE_ID))
            .join(MESSAGE)
            .on(MESSAGE.ID.eq(MESSAGE_ATTACHMENT.MESSAGE_ID))
            .join(CHANNEL)
            .on(CHANNEL.ID.eq(MESSAGE.CHANNEL_ID))
            // 호출자가 채널 멤버인 경우만 노출 (EXISTS WHERE 필터)
            .where(
                exists(
                    selectOne()
                        .from(CHANNEL_MEMBER)
                        .where(
                            CHANNEL_MEMBER
                                .CHANNEL_ID
                                .eq(MESSAGE.CHANNEL_ID)
                                .and(CHANNEL_MEMBER.USER_ID.eq(callerId)))))
            .and(MESSAGE.DELETED_AT.isNull());

    // 파일명 부분일치 필터 (선택)
    if (q != null && !q.isBlank()) {
      query = query.and(FILE.ORIGINAL_NAME.likeIgnoreCase("%" + q + "%"));
    }

    // 커서 기반 페이지네이션 (attached_at < beforeAt)
    if (beforeAt != null) {
      OffsetDateTime cursor = beforeAt.atOffset(ZoneOffset.UTC);
      query = query.and(MESSAGE_ATTACHMENT.ATTACHED_AT.lt(cursor));
    }

    return query
        .orderBy(MESSAGE_ATTACHMENT.ATTACHED_AT.desc())
        .limit(limit + 1) // 다음 페이지 판단을 위해 limit+1 개 조회
        .fetch(
            r -> {
              long channelId = r.get(MESSAGE.CHANNEL_ID);
              long messageId = r.get(MESSAGE.ID.as("message_id"), Long.class);
              // 채널 NAME 은 DM 시 null 가능 → 빈 문자열 처리
              String channelName = r.get(CHANNEL.NAME) != null ? r.get(CHANNEL.NAME) : "";
              String sourceLabel = "#" + channelName;
              String deepLink = "/chat/channels/" + channelId;
              // 메시지 첨부 다운로드 경로 (MessageAttachmentController 의 실제 엔드포인트)
              String downloadUrl =
                  "/api/v1/messaging/channels/"
                      + channelId
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
                  r.get(MESSAGE_ATTACHMENT.ATTACHED_AT).toInstant());
            });
  }

  /** caller 가 멤버인 채널의 메시지에 fileId 가 첨부된 경우 true. import 인가 검증용. */
  @Override
  @Transactional(readOnly = true)
  public boolean canAccessFile(long callerId, long fileId) {
    return dsl.fetchExists(
        dsl.selectOne()
            .from(MESSAGE_ATTACHMENT)
            .join(MESSAGE)
            .on(MESSAGE.ID.eq(MESSAGE_ATTACHMENT.MESSAGE_ID))
            .where(MESSAGE_ATTACHMENT.FILE_ID.eq(fileId))
            .and(MESSAGE.DELETED_AT.isNull())
            .and(
                DSL.exists(
                    DSL.selectOne()
                        .from(CHANNEL_MEMBER)
                        .where(
                            CHANNEL_MEMBER
                                .CHANNEL_ID
                                .eq(MESSAGE.CHANNEL_ID)
                                .and(CHANNEL_MEMBER.USER_ID.eq(callerId))))));
  }
}
