package com.workplace.wiki.repository;

import static com.workplace.jooq.Tables.WIKI_PAGE;
import static com.workplace.jooq.Tables.WIKI_PAGE_BODY_HISTORY;

import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.jooq.Condition;
import org.jooq.DSLContext;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Repository;

/**
 * wiki_page_body_history — 노트 AI 병합 기준본(WP-289). (page_id, version) 당 한 행, read_at 기준 {@link #TTL}
 * 보관. tenant_id 는 GUC 기본값으로 채워진다.
 *
 * <p>body = 그 version 의 실제 본문(읽은 판·저장 응답의 병합본). submitted_body = 그 version 이 본문 저장 응답이었으면 그때 제출된
 * 본문. 쓴 쪽이 다음 저장을 어디서 이어 쓰는지가 다르다 — MCP·채팅 비서는 보통 응답(병합본)에서, 구버전 웹은 응답 본문을 화면에 넣지 않아 자기 본문에서. 하나만
 * 기준으로 두면 다른 쪽 흐름에서 그사이 합쳐진 남의 블록이 "삭제"(병합본 기준인데 자기 본문에서 이어 씀)나 "중복 삽입"(제출본 기준인데 응답에서 이어 씀)으로 병합된다.
 * 그래서 둘 다 남기고 동기화 서버가 다음 저장 본문에 가까운 쪽을 고른다(closestBase).
 *
 * <p>키에 읽은 사람이 없으므로 같은 판을 누가 몇 번 읽든 한 행이다 — 조회 경로가 행을 불리지 않는다.
 */
@Repository
@RequiredArgsConstructor
public class WikiBodyHistoryRepository {
  /** 기준본 보관 시간 — 스펙 §3.1 "1시간 보관". */
  public static final Duration TTL = Duration.ofHours(1);

  /**
   * 다시 읽을 때 read_at 을 갱신하지 않고 넘기는 간격. 인기 페이지는 조회마다 같은 행을 UPDATE 하면 죽은 튜플·WAL 만 늘어나므로, 이 간격 안의 재조회는
   * 건너뛴다. TTL 보다 충분히 짧아 만료 판단에는 영향이 없다.
   */
  static final Duration REFRESH_THROTTLE = Duration.ofMinutes(1);

  private final DSLContext dsl;

  /** 기준본 한 행. submittedBody 는 읽기만 기록된 판이면 null. */
  public record BaseRow(String body, String submittedBody, OffsetDateTime readAt) {}

  /**
   * 직전 갱신이 {@link #REFRESH_THROTTLE} 보다 오래됐다 — 다시 읽기·위임 저장 기록이 이미 있는 행의 read_at 을 갱신하는 조건(UPSERT 의
   * DO UPDATE WHERE). 상세 조회의 기준본 기록({@link WikiPageRepository#findDetailRecordingBase})과 같은 규칙을 쓰도록
   * 패키지 공개.
   */
  static Condition readAtStale() {
    return WIKI_PAGE_BODY_HISTORY.READ_AT.lt(OffsetDateTime.now().minus(REFRESH_THROTTLE));
  }

  /**
   * 위임 저장 결과 판 기록 — 단일 UPSERT. 없으면 실제 본문(병합본)·제출 본문을 넣는다. 이미 있으면:
   *
   * <ul>
   *   <li>그 판에 다른 저장의 제출 본문이 있으면(taken) 덮지 않고 {@link WikiPageRepository#findDetailRecordingBase} 의
   *       기록처럼 read_at 만 갱신한다(직전 갱신이 {@link #REFRESH_THROTTLE} 안이면 건드리지 않음). 바뀐 것 없는 병합은 현재 판을
   *       돌려주는데, 그 판이 구버전 웹 저장의 응답이었다면 제출 본문을 덮는 순간 그 웹의 다음 저장(자기 본문에서 이어 씀)이 기준을 잃는다.
   *   <li>아니면 제출 본문·read_at 을 갱신한다(저장 응답 기록).
   * </ul>
   *
   * <p>본문(body)은 어느 경우에도 갱신하지 않는다. taken 판정을 충돌 행에서 하므로 기존 본문 TEXT 를 미리 읽지 않는다.
   */
  public void recordApplied(long pageId, int version, String body, String submittedBody) {
    var h = WIKI_PAGE_BODY_HISTORY;
    // taken = 기존 제출 본문이 있고 이번 제출 본문과 다르다(Java equals 와 같게 NULL 도 "다름"으로 — IS DISTINCT FROM).
    Condition taken =
        h.SUBMITTED_BODY
            .isNotNull()
            .and(h.SUBMITTED_BODY.isDistinctFrom(DSL.excluded(h.SUBMITTED_BODY)));
    dsl.insertInto(h)
        .set(h.PAGE_ID, pageId)
        .set(h.VERSION, version)
        .set(h.BODY, body)
        .set(h.SUBMITTED_BODY, submittedBody)
        .onConflict(h.PAGE_ID, h.VERSION)
        .doUpdate()
        .set(
            h.SUBMITTED_BODY,
            DSL.when(taken, h.SUBMITTED_BODY).otherwise(DSL.excluded(h.SUBMITTED_BODY)))
        .set(h.READ_AT, DSL.currentOffsetDateTime())
        .where(taken.not().or(readAtStale()))
        .execute();
  }

  /** version 의 기준본(만료 여부 판단은 호출자 — 현재 version 이면 오래돼도 쓴다). */
  public Optional<BaseRow> find(long pageId, int version) {
    return dsl.select(
            WIKI_PAGE_BODY_HISTORY.BODY,
            WIKI_PAGE_BODY_HISTORY.SUBMITTED_BODY,
            WIKI_PAGE_BODY_HISTORY.READ_AT)
        .from(WIKI_PAGE_BODY_HISTORY)
        .where(
            WIKI_PAGE_BODY_HISTORY
                .PAGE_ID
                .eq(pageId)
                .and(WIKI_PAGE_BODY_HISTORY.VERSION.eq(version)))
        .fetchOptional(
            r ->
                new BaseRow(
                    r.get(WIKI_PAGE_BODY_HISTORY.BODY),
                    r.get(WIKI_PAGE_BODY_HISTORY.SUBMITTED_BODY),
                    r.get(WIKI_PAGE_BODY_HISTORY.READ_AT)));
  }

  /** 현재 테넌트의 만료 행 삭제 — 단 페이지의 현재 version 행은 남긴다. 삭제 수. */
  public int deleteExpired(Duration ttl) {
    OffsetDateTime cutoff = OffsetDateTime.now().minus(ttl);
    return dsl.deleteFrom(WIKI_PAGE_BODY_HISTORY)
        .where(WIKI_PAGE_BODY_HISTORY.READ_AT.lt(cutoff))
        .andNotExists(
            dsl.selectOne()
                .from(WIKI_PAGE)
                .where(WIKI_PAGE.ID.eq(WIKI_PAGE_BODY_HISTORY.PAGE_ID))
                .and(WIKI_PAGE.VERSION.eq(WIKI_PAGE_BODY_HISTORY.VERSION)))
        .execute();
  }
}
