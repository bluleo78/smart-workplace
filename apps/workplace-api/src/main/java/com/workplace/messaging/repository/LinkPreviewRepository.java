package com.workplace.messaging.repository;

import static com.workplace.jooq.tables.Message.MESSAGE;
import static com.workplace.jooq.tables.MessageLinkPreview.MESSAGE_LINK_PREVIEW;

import com.workplace.messaging.dto.LinkPreviewResponse;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.stream.Collectors;
import org.jooq.DSLContext;
import org.jooq.Record;
import org.springframework.stereotype.Repository;

/**
 * 메시지 링크 미리보기(message_link_preview) CRUD + 미리보기 갱신에 쓰는 메시지 상태 조회(WP-874). RLS 보호 표 — 트랜잭션 안에서 쓴다.
 */
@Repository
public class LinkPreviewRepository {

  private final DSLContext dsl;

  public LinkPreviewRepository(DSLContext dsl) {
    this.dsl = dsl;
  }

  /**
   * 미리보기 갱신 판단용 메시지 상태.
   *
   * @param body 원문 본문(삭제 마스킹 전, null 가능)
   * @param editedAt 마지막 수정 시각 — 가져오는 사이 본문이 바뀌었는지 비교한다
   */
  public record MessageState(
      long channelId,
      long authorId,
      String body,
      OffsetDateTime editedAt,
      boolean deleted,
      boolean dismissed) {}

  /** 저장할 미리보기 1건(가져오기 성공분). */
  public record NewPreview(
      int position,
      String url,
      String title,
      String description,
      String siteName,
      String imageUrl) {
    /** 응답 모양 — 저장 직후 SSE 를 다시 읽지 않고 메모리 값으로 만든다. */
    public LinkPreviewResponse toResponse() {
      return new LinkPreviewResponse(position, url, title, description, siteName, imageUrl != null);
    }
  }

  /** 메시지 상태 조회. forUpdate 면 행을 잠가 저장 직전 재확인과 지우기·수정이 엇갈리지 않게 한다. */
  public Optional<MessageState> findState(long messageId, boolean forUpdate) {
    var q =
        dsl.select(
                MESSAGE.CHANNEL_ID,
                MESSAGE.AUTHOR_ID,
                MESSAGE.BODY,
                MESSAGE.EDITED_AT,
                MESSAGE.DELETED_AT,
                MESSAGE.LINK_PREVIEWS_DISMISSED)
            .from(MESSAGE)
            .where(MESSAGE.ID.eq(messageId));
    var rec = forUpdate ? q.forUpdate().fetchOptional() : q.fetchOptional();
    return rec.map(
        r ->
            new MessageState(
                r.get(MESSAGE.CHANNEL_ID),
                r.get(MESSAGE.AUTHOR_ID),
                r.get(MESSAGE.BODY),
                r.get(MESSAGE.EDITED_AT),
                r.get(MESSAGE.DELETED_AT) != null,
                Boolean.TRUE.equals(r.get(MESSAGE.LINK_PREVIEWS_DISMISSED))));
  }

  /** 여러 메시지의 미리보기를 한 번에(N+1 회피). messageId → position 순 목록. */
  public Map<Long, List<LinkPreviewResponse>> findByMessageIds(List<Long> messageIds) {
    if (messageIds.isEmpty()) return Map.of();
    return dsl
        .selectFrom(MESSAGE_LINK_PREVIEW)
        .where(MESSAGE_LINK_PREVIEW.MESSAGE_ID.in(messageIds))
        .orderBy(MESSAGE_LINK_PREVIEW.MESSAGE_ID, MESSAGE_LINK_PREVIEW.POSITION)
        .fetch()
        .stream()
        .collect(
            Collectors.groupingBy(
                r -> r.get(MESSAGE_LINK_PREVIEW.MESSAGE_ID),
                Collectors.mapping(LinkPreviewRepository::toResponse, Collectors.toList())));
  }

  /** 메시지 1건의 미리보기(position 순). */
  public List<LinkPreviewResponse> findByMessageId(long messageId) {
    return findByMessageIds(List.of(messageId)).getOrDefault(messageId, List.of());
  }

  /** 미리보기 행이 하나라도 있는지(행을 읽지 않는 exists). */
  public boolean exists(long messageId) {
    return dsl.fetchExists(
        dsl.selectOne()
            .from(MESSAGE_LINK_PREVIEW)
            .where(MESSAGE_LINK_PREVIEW.MESSAGE_ID.eq(messageId)));
  }

  /** 썸네일 원본 주소. 행이 없거나 이미지가 없으면 빈 값. */
  public Optional<String> findImageUrl(long messageId, int position) {
    return dsl.select(MESSAGE_LINK_PREVIEW.IMAGE_URL)
        .from(MESSAGE_LINK_PREVIEW)
        .where(MESSAGE_LINK_PREVIEW.MESSAGE_ID.eq(messageId))
        .and(MESSAGE_LINK_PREVIEW.POSITION.eq((short) position))
        .fetchOptional(MESSAGE_LINK_PREVIEW.IMAGE_URL);
  }

  /** 메시지의 미리보기를 모두 지운다. 지운 행 수. */
  public int deleteAll(long messageId) {
    return dsl.deleteFrom(MESSAGE_LINK_PREVIEW)
        .where(MESSAGE_LINK_PREVIEW.MESSAGE_ID.eq(messageId))
        .execute();
  }

  /** 기존 행을 지우고 새 목록으로 바꾼다(같은 트랜잭션, 여러 행 INSERT 한 번). */
  public void replace(long messageId, List<NewPreview> previews) {
    deleteAll(messageId);
    if (previews.isEmpty()) return;
    var insert =
        dsl.insertInto(
            MESSAGE_LINK_PREVIEW,
            MESSAGE_LINK_PREVIEW.MESSAGE_ID,
            MESSAGE_LINK_PREVIEW.POSITION,
            MESSAGE_LINK_PREVIEW.URL,
            MESSAGE_LINK_PREVIEW.TITLE,
            MESSAGE_LINK_PREVIEW.DESCRIPTION,
            MESSAGE_LINK_PREVIEW.SITE_NAME,
            MESSAGE_LINK_PREVIEW.IMAGE_URL);
    for (NewPreview p : previews) {
      insert =
          insert.values(
              messageId,
              (short) p.position(),
              p.url(),
              p.title(),
              p.description(),
              p.siteName(),
              p.imageUrl());
    }
    insert.execute();
  }

  /** 보낸 사람이 미리보기를 지웠음을 표시 — 이후 수정해도 다시 만들지 않는다. */
  public void markDismissed(long messageId) {
    dsl.update(MESSAGE)
        .set(MESSAGE.LINK_PREVIEWS_DISMISSED, true)
        .where(MESSAGE.ID.eq(messageId))
        .execute();
  }

  private static LinkPreviewResponse toResponse(Record r) {
    return new LinkPreviewResponse(
        r.get(MESSAGE_LINK_PREVIEW.POSITION),
        r.get(MESSAGE_LINK_PREVIEW.URL),
        r.get(MESSAGE_LINK_PREVIEW.TITLE),
        r.get(MESSAGE_LINK_PREVIEW.DESCRIPTION),
        r.get(MESSAGE_LINK_PREVIEW.SITE_NAME),
        r.get(MESSAGE_LINK_PREVIEW.IMAGE_URL) != null);
  }
}
