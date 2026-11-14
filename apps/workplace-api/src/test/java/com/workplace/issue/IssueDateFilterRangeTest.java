package com.workplace.issue;

import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.global.tenant.TenantContext;
import com.workplace.global.time.SupportedDates;
import com.workplace.issue.dto.IssueResponse;
import com.workplace.issue.exception.InvalidCursorException;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.issue.service.IssueSearchService;
import com.workplace.issue.support.IssueSeeds;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Stream;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/**
 * WP-1579: 이슈 검색 날짜 필터의 지원 범위(1900-01-01 ~ 9999-12-31) 검증.
 *
 * <p>LocalDate 는 +999999999-12-31 같은 극단 연도도 읽어서, *To 필터는 하루 끝 계산(plusDays(1))에서 500, 나머지는 DB 범위 초과로
 * 409 가 났다. 이제 파싱 단계에서 앱 공통 문구({@link SupportedDates#MESSAGE})의 InvalidCursorException(400)으로
 * 거절하는지, 경계값은 그대로 통과하는지 확인한다.
 */
@Transactional
class IssueDateFilterRangeTest extends IntegrationTestBase {

  @Autowired private IssueSearchService searchService;
  @Autowired private IssueRepository issueRepository;
  @Autowired private ProjectService projectService;

  private long userId;
  private String projKey;
  private long projectId;

  @BeforeEach
  void setUp() {
    String suffix = UUID.randomUUID().toString().replaceAll("-", "").substring(0, 8);
    userId =
        baseDsl
            .insertInto(USER)
            .set(USER.USERNAME, "dr-" + suffix)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, "dr")
            .set(USER.EMAIL, "dr-" + suffix + "@example.com")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    TenantContext.set(1L);
    projKey = "DR" + suffix.substring(0, 4).toUpperCase();
    projectId =
        projectService.create(userId, new CreateProjectRequest(projKey, "DateRange", "x")).id();
  }

  /** 이슈 검색이 받는 날짜 필터 10개 — 모든 파라미터화 테스트가 같은 목록을 쓴다. */
  static Stream<String> dateFilters() {
    return Stream.of(
        "dueFrom",
        "dueTo",
        "closedFrom",
        "closedTo",
        "createdFrom",
        "createdTo",
        "updatedFrom",
        "updatedTo",
        "startFrom",
        "startTo");
  }

  /** 10개 날짜 필터 모두 상한 밖 극단 연도(+999999999-12-31)를 범위 문구의 400 예외로 거절한다 — 500·409 가 아니다. */
  @ParameterizedTest
  @MethodSource("dateFilters")
  void extremeYear_rejectedForEveryDateFilter(String filter) {
    assertThatThrownBy(
            () -> searchService.search(userId, projKey, Map.of(filter, "+999999999-12-31")))
        .isInstanceOf(InvalidCursorException.class)
        .hasMessage(SupportedDates.MESSAGE);
  }

  /** 하한(1900-01-01) 바로 앞 날짜도 같은 예외로 거절한다. */
  @ParameterizedTest
  @MethodSource("dateFilters")
  void belowMinimum_rejected(String filter) {
    assertThatThrownBy(() -> searchService.search(userId, projKey, Map.of(filter, "1899-12-31")))
        .isInstanceOf(InvalidCursorException.class)
        .hasMessage(SupportedDates.MESSAGE);
  }

  /**
   * 경계값 1900-01-01·9999-12-31 은 모든 필터에서 통과한다. 특히 *To=9999-12-31 은 하루 끝 계산으로 10000-01-01 이 되지만
   * PostgreSQL timestamptz 범위 안이라 오류 없이 결과가 나와야 한다.
   */
  @ParameterizedTest
  @MethodSource("dateFilters")
  void boundaryDates_accepted(String filter) {
    IssueSeeds.insert(issueRepository, baseDsl, projectId, 1, "경계 이슈", null, "MID", null, userId);

    var atMin = searchService.search(userId, projKey, Map.of(filter, "1900-01-01"));
    var atMax = searchService.search(userId, projKey, Map.of(filter, "9999-12-31"));

    assertThat(atMin.items()).isNotNull();
    assertThat(atMax.items()).isNotNull();
  }

  /** 생성·수정일 전 범위(1900-01-01 ~ 9999-12-31)로 거르면 방금 만든 이슈가 실제로 잡힌다 — 경계 비교가 깨지지 않는다. */
  @Test
  void fullRange_includesExistingIssue() {
    long id =
        IssueSeeds.insert(issueRepository, baseDsl, projectId, 1, "전 범위", null, "MID", null, userId)
            .id();

    var resp =
        searchService.search(
            userId,
            projKey,
            Map.of(
                "createdFrom", "1900-01-01",
                "createdTo", "9999-12-31",
                "updatedFrom", "1900-01-01",
                "updatedTo", "9999-12-31"));

    assertThat(resp.items()).extracting(IssueResponse::id).containsExactly(id);
  }

  /** 프로젝트 횡단 검색(내 이슈, projectKey 없음)도 같은 파서를 지나 극단 연도를 거절한다. */
  @Test
  void crossProjectSearch_rejectsExtremeYear() {
    assertThatThrownBy(
            () -> searchService.searchMine(userId, Map.of("updatedTo", "+999999999-12-31")))
        .isInstanceOf(InvalidCursorException.class)
        .hasMessage(SupportedDates.MESSAGE);
  }

  /** 목록 그룹별 총계(group-counts)도 같은 파서를 지나 극단 연도를 거절한다. */
  @Test
  void groupCounts_rejectsExtremeYear() {
    assertThatThrownBy(
            () ->
                searchService.groupCounts(
                    userId, projKey, Map.of("groupBy", "status", "dueTo", "+999999999-12-31")))
        .isInstanceOf(InvalidCursorException.class)
        .hasMessage(SupportedDates.MESSAGE);
  }

  /** 형식이 틀린 날짜는 범위 문구가 아니라 기존 「날짜 형식 오류」 문구 그대로다. */
  @Test
  void malformedDate_keepsFormatErrorMessage() {
    assertThatThrownBy(() -> searchService.search(userId, projKey, Map.of("dueFrom", "2026-13-01")))
        .isInstanceOf(InvalidCursorException.class)
        .hasMessage("날짜 형식 오류: 2026-13-01");
  }
}
