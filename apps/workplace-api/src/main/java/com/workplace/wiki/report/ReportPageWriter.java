package com.workplace.wiki.report;

import com.workplace.wiki.dto.WikiPageDetail;
import com.workplace.wiki.service.WikiSystemPageWriter;
import java.time.OffsetDateTime;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

/**
 * 리포트 페이지 쓰기 도우미(WP-1486) — AI 가 쓴 리포트 본문을 쓰고, 자리로 옮기고, 「AI 작성」 표지를 남긴다. 프로젝트 리포트 생성기(WP-1483)와 개인
 * 보고 생성기가 나눠 쓰는 쓰기 뼈대다(자리·작성자 규칙은 각 생성기가 정한다 — 생성기 전체를 하나로 합치지 않는다).
 *
 * <p>본문 쓰기는 동기화 서버 위임 경로라 <b>트랜잭션 밖에서</b> 부른다.
 */
@Component
@RequiredArgsConstructor
public class ReportPageWriter {

  private final WikiSystemPageWriter writer;

  /**
   * 본문을 AI 글로 쓰고(수정 기록 없음) parentId 아래 position 자리로 옮긴 뒤 「AI 작성」 표지를 남긴다 — 표지가 마지막이라 그 뒤 수정 시각이 더
   * 늦으면 사람이 고친 것.
   *
   * @param page 쓸 페이지(만들기 응답 또는 다시 쓰는 페이지 — version 을 쓴다)
   */
  public void writeAndMark(
      long authorId,
      WikiPageDetail page,
      String body,
      long parentId,
      int position,
      OffsetDateTime now) {
    writeAndMark(authorId, page, body, parentId, position, now, false);
  }

  /**
   * {@link #writeAndMark(long, WikiPageDetail, String, long, int, OffsetDateTime)} 에 직전 판 남기기를 고를 수
   * 있게 한 것 — 이미 있는 리포트를 다시 쓸 때(「지금 생성」 덮어쓰기, WP-1630) 직전 본문을 수정 기록에 남긴다.
   *
   * @param snapshot 직전 판을 수정 기록으로 남길지
   */
  public void writeAndMark(
      long authorId,
      WikiPageDetail page,
      String body,
      long parentId,
      int position,
      OffsetDateTime now,
      boolean snapshot) {
    long pageId = page.id();
    writer.writeBody(authorId, pageId, page.version(), body, true, snapshot);
    writer.moveTo(pageId, parentId, position);
    writer.markAiReport(pageId, markTime(pageId, now));
  }

  /**
   * 본문을 AI 글로 쓰고 「AI 작성」 표지를 남긴다 — 자리는 옮기지 않는다(WP-1654). 프로젝트 리포트의 저장 위치를 바꾼 뒤 같은 회차를 다시 쓸 때, 옛
   * 위치(또는 사람이 옮긴 자리)의 리포트를 그대로 두기 위해 쓴다.
   *
   * @param snapshot 직전 판을 수정 기록으로 남길지
   */
  public void writeAndMarkInPlace(
      long authorId, WikiPageDetail page, String body, OffsetDateTime now, boolean snapshot) {
    long pageId = page.id();
    writer.writeBody(authorId, pageId, page.version(), body, true, snapshot);
    writer.markAiReport(pageId, markTime(pageId, now));
  }

  /**
   * 「AI 작성」 표지 시각 — 페이지 마지막 수정 시각보다 이르지 않게(쓰기·옮기기가 DB 시각으로 updated_at 을 적으므로, 실행 시각만 쓰면 방금 만든 리포트가
   * 「수정됨」으로 보인다).
   */
  OffsetDateTime markTime(long pageId, OffsetDateTime now) {
    // 수정 시각만 읽는다 — 본문까지 담은 상세를 읽을 까닭이 없다.
    OffsetDateTime updated = writer.findUpdatedAt(pageId).orElse(null);
    return updated != null && updated.isAfter(now) ? updated : now;
  }

  /** 글 길이(코드 포인트) — 템플릿·AI 출력 상한 검사용. */
  public static int codePoints(String s) {
    return s.codePointCount(0, s.length());
  }
}
