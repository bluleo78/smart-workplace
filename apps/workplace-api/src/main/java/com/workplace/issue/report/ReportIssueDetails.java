package com.workplace.issue.report;

import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.ISSUE_ASSIGNEE;
import static com.workplace.jooq.Tables.ISSUE_COMMENT;
import static com.workplace.jooq.Tables.PROJECT;
import static com.workplace.jooq.Tables.PROJECT_STATUS;
import static com.workplace.jooq.Tables.USER;

import com.workplace.global.util.CapabilityTokens;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;
import org.jooq.DSLContext;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Repository;

/**
 * 리포트 이슈 표시 정보(WP-1486) — 후보 이슈 id 를 AI 재료 {@link ReportIssue}(키·주소·제목·상태·담당자·에픽·마감·마지막 코멘트)로 만든다.
 * 프로젝트 리포트(WP-1483 {@link ProjectReportIssueRepository})와 개인 보고가 후보 쿼리만 따로 두고 이 표시 단계를 나눠 쓴다.
 *
 * <p>쿼리 수는 이슈 수와 무관하게 고정이다(표시 정보 1 + 담당자 1 + 코멘트 1). RLS 보호 테이블이라 트랜잭션 안에서 부른다.
 */
@Repository
public class ReportIssueDetails {

  /** 제목 자르기 길이. */
  static final int TITLE_MAX = 80;

  /** 마지막 코멘트 자르기 길이. */
  static final int COMMENT_MAX = 120;

  private final DSLContext dsl;

  /** 공개 웹 주소(끝 「/」 제거) — 이슈 주소를 앱 링크 칩이 알아보는 모양으로 만든다. */
  private final String baseUrl;

  public ReportIssueDetails(
      DSLContext dsl, @Value("${workplace.public-base-url:}") String publicBaseUrl) {
    this.dsl = dsl;
    this.baseUrl = CapabilityTokens.normalizeBaseUrl(publicBaseUrl);
  }

  /**
   * 후보 한 건 — 정렬을 마친 뒤의 이슈 id 와 이유·에픽·마감, 그리고 상한 밖으로 밀렸을 때 셀 묶음 이름.
   *
   * @param id 이슈 id
   * @param reason {@link ReportIssue#reason} 에 실을 이유
   * @param epic 부모 에픽 제목, 없으면 null
   * @param due 마감일, 없으면 null
   * @param group 밀린 이슈를 셀 묶음 이름(프로젝트는 에픽 제목 또는 「에픽 없음」, 개인은 에픽 제목 또는 프로젝트 이름)
   * @param lateDays 늦게 끝낸 날수(개인 DONE 만), 아니면 null
   * @param withAi 「AI와 함께」 끝냈는가(개인 DONE 만), 아니면 false
   */
  public record Candidate(
      long id,
      String reason,
      String epic,
      LocalDate due,
      String group,
      Integer lateDays,
      boolean withAi) {

    /** 에픽 제목·묶음 이름만 채운 사본 — 나머지(이유·마감·늦은 날수·AI와 함께)는 그대로 둔다. */
    public Candidate withEpic(String epic, String group) {
      return new Candidate(id, reason, epic, due, group, lateDays, withAi);
    }
  }

  /**
   * 상한 안 후보의 표시 정보(키·제목·상태·프로젝트 이름·담당자·마지막 코멘트)를 읽어 후보 순서대로 만든다. 지워져 못 읽은 후보는 뺀다. 후보가 마감일을
   * 모르면(null) 이슈의 지금 마감일을 싣는다 — 개인 보고의 끝냄·상태 바꿈 후보는 마감을 따로 읽지 않는다(프로젝트 후보는 같은 값을 이미 넣어 온다).
   */
  public List<ReportIssue> details(List<Candidate> shown) {
    if (shown.isEmpty()) return List.of();
    List<Long> ids = shown.stream().map(Candidate::id).toList();
    Map<Long, org.jooq.Record> rows = new HashMap<>();
    dsl.select(
            ISSUE.ID,
            PROJECT.KEY,
            PROJECT.NAME,
            ISSUE.NUMBER,
            ISSUE.TITLE,
            ISSUE.STATUS,
            ISSUE.DUE_DATE,
            PROJECT_STATUS.NAME)
        .from(ISSUE)
        .join(PROJECT)
        .on(PROJECT.ID.eq(ISSUE.PROJECT_ID))
        .leftJoin(PROJECT_STATUS)
        .on(PROJECT_STATUS.ID.eq(ISSUE.STATUS_ID))
        .where(ISSUE.ID.in(ids))
        .fetch()
        .forEach(r -> rows.put(r.get(ISSUE.ID), r));
    Map<Long, List<String>> assignees = assigneeNames(ids);
    Map<Long, String> comments = lastComments(ids);

    List<ReportIssue> out = new ArrayList<>(shown.size());
    for (Candidate c : shown) {
      var r = rows.get(c.id());
      if (r == null) continue;
      String key = r.get(PROJECT.KEY);
      int number = r.get(ISSUE.NUMBER);
      String comment = comments.get(c.id());
      out.add(
          new ReportIssue(
              key + "-" + number,
              baseUrl + "/projects/" + key + "/issues/" + number,
              cut(oneLine(r.get(ISSUE.TITLE)), TITLE_MAX),
              r.get(PROJECT_STATUS.NAME),
              r.get(ISSUE.STATUS),
              assignees.getOrDefault(c.id(), List.of()),
              c.epic(),
              c.due() != null ? c.due() : r.get(ISSUE.DUE_DATE),
              comment == null ? null : cut(oneLine(comment), COMMENT_MAX),
              c.reason(),
              r.get(PROJECT.NAME),
              c.lateDays(),
              c.withAi()));
    }
    return out;
  }

  /** 밀린 후보를 묶음 이름별로 센다(많은 순, 같으면 이름순). */
  public static Map<String, Integer> countByGroup(List<Candidate> rest) {
    Map<String, Integer> counts = new HashMap<>();
    for (Candidate c : rest) {
      counts.merge(c.group(), 1, Integer::sum);
    }
    Map<String, Integer> sorted = new LinkedHashMap<>();
    counts.entrySet().stream()
        .sorted(
            Map.Entry.<String, Integer>comparingByValue()
                .reversed()
                .thenComparing(Map.Entry.comparingByKey()))
        .forEach(e -> sorted.put(e.getKey(), e.getValue()));
    return sorted;
  }

  /** 이슈별 담당자 이름(이름순, 같으면 id 순). */
  private Map<Long, List<String>> assigneeNames(Collection<Long> ids) {
    return dsl
        .select(ISSUE_ASSIGNEE.ISSUE_ID, USER.NAME)
        .from(ISSUE_ASSIGNEE)
        .join(USER)
        .on(USER.ID.eq(ISSUE_ASSIGNEE.USER_ID))
        .where(ISSUE_ASSIGNEE.ISSUE_ID.in(ids))
        .orderBy(USER.NAME.asc(), USER.ID.asc())
        .fetch()
        .stream()
        .collect(
            Collectors.groupingBy(
                r -> r.value1(), Collectors.mapping(r -> r.value2(), Collectors.toList())));
  }

  /** 이슈별 지워지지 않은 마지막 코멘트 본문(DISTINCT ON). */
  private Map<Long, String> lastComments(Collection<Long> ids) {
    Map<Long, String> out = new HashMap<>();
    dsl.select(ISSUE_COMMENT.ISSUE_ID, ISSUE_COMMENT.BODY)
        .distinctOn(ISSUE_COMMENT.ISSUE_ID)
        .from(ISSUE_COMMENT)
        .where(ISSUE_COMMENT.ISSUE_ID.in(ids), ISSUE_COMMENT.DELETED_AT.isNull())
        .orderBy(ISSUE_COMMENT.ISSUE_ID, ISSUE_COMMENT.CREATED_AT.desc(), ISSUE_COMMENT.ID.desc())
        .fetch()
        .forEach(r -> out.put(r.value1(), r.value2()));
    return out;
  }

  /** 줄바꿈·연속 공백을 한 칸으로 — AI 입력 한 줄로 만든다. */
  private static String oneLine(String s) {
    return s == null ? null : s.strip().replaceAll("\\s+", " ");
  }

  /** 코드포인트 기준 {@code max} 자로 자른다(넘치면 마지막 자리에 「…」). */
  static String cut(String s, int max) {
    if (s == null || s.codePointCount(0, s.length()) <= max) return s;
    return s.substring(0, s.offsetByCodePoints(0, max - 1)) + "…";
  }
}
