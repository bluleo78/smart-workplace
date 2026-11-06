// WikiAttachmentSourceProvider.java — 노트(WIKI) 첨부 가상 뷰 제공(WP-1392)
package com.workplace.wiki.service;

import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.WIKI_PAGE;
import static com.workplace.jooq.Tables.WIKI_PAGE_ATTACHMENT;
import static com.workplace.jooq.Tables.WIKI_SPACE;

import com.workplace.drive.api.AttachmentSourceProvider;
import com.workplace.global.share.WikiSpaceMembership;
import com.workplace.global.util.LikePatternUtils;
import com.workplace.wiki.dto.WikiAttachmentResponse;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.jooq.Condition;
import org.jooq.DSLContext;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * 노트 첨부 가상 뷰 제공자(sourceType "WIKI"). 호출자가 멤버인 노트 공간의 페이지 첨부만 노출한다 — 공유 링크로만 볼 수 있는 페이지는 「내 공간의 파일」이
 * 아니라 넣지 않는다(멤버 판정은 {@link WikiSpaceMembership#isMember} 한 곳 규칙). 업로드 직후 아직 본문에 연결되지 않은 임시
 * 첨부(file.expires_at 있음)와 본문에서 빠져 회수 유예 중인 강등 첨부(demoted_at 있음)는 곧 사라질 파일이라 제외한다.
 *
 * <p>drive 가 wiki 를 import 하지 않도록 wiki 모듈이 SPI 를 구현한다(이슈·메시지 출처와 같은 방식).
 */
@Component
@RequiredArgsConstructor
public class WikiAttachmentSourceProvider implements AttachmentSourceProvider {

  private final DSLContext dsl;

  @Override
  public String sourceType() {
    return "WIKI";
  }

  /** 노트 첨부를 (attached_at, file id) 내림차순으로 limit+1 개까지. q=파일명 부분일치, cursor=커서. */
  @Override
  @Transactional(readOnly = true)
  public List<Entry> list(long callerId, String q, Cursor cursor, int limit) {
    var query =
        dsl.select(
                FILE.ID,
                FILE.ORIGINAL_NAME,
                FILE.MIME_TYPE,
                FILE.SIZE_BYTES,
                FILE.THUMBNAIL_PATH,
                WIKI_PAGE.ID,
                WIKI_PAGE.TITLE,
                WIKI_SPACE.ID,
                WIKI_SPACE.NAME,
                WIKI_PAGE_ATTACHMENT.ATTACHED_AT)
            .from(WIKI_PAGE_ATTACHMENT)
            .join(FILE)
            .on(FILE.ID.eq(WIKI_PAGE_ATTACHMENT.FILE_ID))
            .join(WIKI_PAGE)
            .on(WIKI_PAGE.ID.eq(WIKI_PAGE_ATTACHMENT.PAGE_ID))
            .join(WIKI_SPACE)
            .on(WIKI_SPACE.ID.eq(WIKI_PAGE.SPACE_ID))
            .where(visible(callerId));

    // 파일명 부분일치 필터 (선택)
    if (q != null && !q.isBlank()) {
      query =
          query.and(FILE.ORIGINAL_NAME.likeIgnoreCase(LikePatternUtils.containsPattern(q), '\\'));
    }

    // 커서 기반 페이지네이션 — (attached_at, file_id) 가 커서 다음인 행(같은 시각도 빠지지 않게, WP-1392). 첫 페이지면 조건 없음
    query =
        query.and(
            Cursor.after(
                cursor,
                sourceType(),
                WIKI_PAGE_ATTACHMENT.ATTACHED_AT,
                WIKI_PAGE_ATTACHMENT.FILE_ID));

    return query
        .orderBy(Cursor.order(WIKI_PAGE_ATTACHMENT.ATTACHED_AT, WIKI_PAGE_ATTACHMENT.FILE_ID))
        .limit(limit + 1) // 다음 페이지 판단을 위해 limit+1 개 조회
        .fetch(
            r -> {
              long fileId = r.get(FILE.ID);
              long pageId = r.get(WIKI_PAGE.ID);
              long spaceId = r.get(WIKI_SPACE.ID);
              // 「공간 이름 / 페이지 제목」 — 제목·이름이 비어 있어도 null 이 문자열로 새지 않게
              String spaceName = r.get(WIKI_SPACE.NAME) != null ? r.get(WIKI_SPACE.NAME) : "";
              String title = r.get(WIKI_PAGE.TITLE) != null ? r.get(WIKI_PAGE.TITLE) : "";
              return new Entry(
                  fileId,
                  r.get(FILE.ORIGINAL_NAME),
                  r.get(FILE.MIME_TYPE),
                  r.get(FILE.SIZE_BYTES),
                  r.get(FILE.THUMBNAIL_PATH) != null,
                  spaceName + " / " + title,
                  "/wiki/spaces/" + spaceId + "/pages/" + pageId,
                  // 노트 첨부 다운로드 경로 (WikiAttachmentController GET /{fileId}/content) — 본문 정본 경로와 같다
                  WikiAttachmentResponse.urlOf(pageId, fileId),
                  r.get(WIKI_PAGE_ATTACHMENT.ATTACHED_AT).toInstant());
            });
  }

  /** caller 가 멤버인 공간의 페이지에 fileId 가 (임시·강등 아닌 상태로) 첨부된 경우 true. import 인가 검증용 — 목록과 같은 조건. */
  @Override
  @Transactional(readOnly = true)
  public boolean canAccessFile(long callerId, long fileId) {
    return dsl.fetchExists(
        dsl.selectOne()
            .from(WIKI_PAGE_ATTACHMENT)
            .join(FILE)
            .on(FILE.ID.eq(WIKI_PAGE_ATTACHMENT.FILE_ID))
            .join(WIKI_PAGE)
            .on(WIKI_PAGE.ID.eq(WIKI_PAGE_ATTACHMENT.PAGE_ID))
            .where(WIKI_PAGE_ATTACHMENT.FILE_ID.eq(fileId))
            .and(visible(callerId)));
  }

  /** 모아보기에 보일 노트 첨부 — 공간 멤버(공유 링크 전용 접근 제외) + 임시 아님(expires_at NULL) + 강등 아님. */
  private static Condition visible(long callerId) {
    return WikiSpaceMembership.isMember(WIKI_PAGE.SPACE_ID, DSL.val(callerId))
        .and(FILE.EXPIRES_AT.isNull())
        .and(WIKI_PAGE_ATTACHMENT.DEMOTED_AT.isNull());
  }
}
