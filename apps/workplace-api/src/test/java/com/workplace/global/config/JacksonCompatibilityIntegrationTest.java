package com.workplace.global.config;

import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.global.json.JsonMappers;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.UUID;
import org.hamcrest.Matchers;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.json.JsonMapper;

/**
 * Jackson 3 전환(WP-1609) 뒤에도 응답 JSON 과 요청 해석이 Jackson 2 때와 같은지 고정한다.
 *
 * <p>Jackson 3 기본값(속성 알파벳 정렬, 알 수 없는 속성 실패, null → 기본형 실패 등)은 Jackson 2 와 달라, {@code
 * spring.jackson.use-jackson2-defaults} 설정이 빠지거나 어긋나면 오류 없이 조용히 동작이 바뀐다. Boot 가 쓰는 {@code
 * JsonMapper} 빈과 실제 MVC 요청(이슈 생성)으로 그 동작을 못 박는다. 기대값은 Jackson 2 빌드(ef0abe326)에서 측정한 값이다.
 */
@Transactional
class JacksonCompatibilityIntegrationTest extends IntegrationTestBase {

  /** application-test.yml 의 workplace.ai-agent.internal-token 값. */
  private static final String INTERNAL_TOKEN = "test-token";

  @Autowired private JsonMapper jsonMapper;
  @Autowired private MockMvc mockMvc;
  @Autowired private ProjectService projectService;
  @Autowired private DSLContext dsl;

  /** 직렬화 속성 순서 확인용 — 선언 순서가 알파벳 순서와 반대다. */
  record Ordered(String zeta, String alpha) {}

  /** 날짜·시각 직렬화 확인용. */
  record Times(Instant instant, OffsetDateTime offset, LocalDate date) {}

  /** null 포함 여부 확인용. */
  record Nullable(String name, Integer count) {}

  /** 역직렬화 확인용 — 기본형 필드. */
  record Primitive(int n, String s) {}

  /**
   * Boot 매퍼(application.yml 의 spring.jackson.factory.constraints)와 빈이 아닌 매퍼(JsonMappers)가 같은
   * Jackson 2 크기 한도를 쓰는지 확인한다 — 한쪽만 바꾸면 같은 JSON 이 경로에 따라 읽히기도 하고 거절되기도 한다.
   */
  @Test
  void Boot_매퍼와_JsonMappers_의_크기_한도가_같다() {
    var bootRead = jsonMapper.tokenStreamFactory().streamReadConstraints();
    var sharedRead = JsonMappers.JACKSON2.tokenStreamFactory().streamReadConstraints();
    assertThat(sharedRead.getMaxStringLength()).isEqualTo(bootRead.getMaxStringLength());
    assertThat(sharedRead.getMaxNestingDepth()).isEqualTo(bootRead.getMaxNestingDepth());
    assertThat(
            JsonMappers.JACKSON2.tokenStreamFactory().streamWriteConstraints().getMaxNestingDepth())
        .isEqualTo(jsonMapper.tokenStreamFactory().streamWriteConstraints().getMaxNestingDepth());
  }

  /** 이슈 생성을 시도할 프로젝트와 소유자(Internal 토큰의 대리 사용자). */
  private record Seed(String projectKey, Long ownerId) {}

  /** 프로젝트 소유자가 될 HUMAN 유저와 프로젝트를 만든다(롤백으로 회수). */
  private Seed seed() {
    String suffix = UUID.randomUUID().toString().substring(0, 8);
    Long id =
        dsl.insertInto(USER)
            .set(USER.USERNAME, "jk-" + suffix)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, "Jackson")
            .set(USER.EMAIL, "jk-" + suffix + "@example.com")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    Long roleId = dsl.select(ROLE.ID).from(ROLE).where(ROLE.NAME.eq("USER")).fetchOne(ROLE.ID);
    dsl.insertInto(USER_ROLE).set(USER_ROLE.USER_ID, id).set(USER_ROLE.ROLE_ID, roleId).execute();
    Long ownerId = withMembership(id);
    String key = "JK" + UUID.randomUUID().toString().replace("-", "").toUpperCase().substring(0, 4);
    var project = projectService.create(ownerId, new CreateProjectRequest(key, "Jackson 호환", "x"));
    return new Seed(project.key(), ownerId);
  }

  /** 이슈 생성 요청을 실제 MVC 경로로 보낸다. */
  private ResultActions createIssue(Seed seed, String body) throws Exception {
    return mockMvc.perform(
        post("/api/v1/projects/" + seed.projectKey() + "/issues")
            .header("Authorization", "Internal " + INTERNAL_TOKEN)
            .header("X-On-Behalf-Of", String.valueOf(seed.ownerId()))
            .contentType(MediaType.APPLICATION_JSON)
            .content(body));
  }

  @Test
  void 레코드_직렬화_속성_순서는_선언_순서다() throws Exception {
    assertThat(jsonMapper.writeValueAsString(new Ordered("z", "a")))
        .isEqualTo("{\"zeta\":\"z\",\"alpha\":\"a\"}");
  }

  @Test
  void 날짜_시각은_숫자_타임스탬프가_아니라_ISO_문자열로_나간다() throws Exception {
    Times times =
        new Times(
            Instant.parse("2026-03-04T05:06:07Z"),
            OffsetDateTime.of(2026, 3, 4, 14, 6, 7, 0, ZoneOffset.ofHours(9)),
            LocalDate.of(2026, 3, 4));
    assertThat(jsonMapper.writeValueAsString(times))
        .isEqualTo(
            "{\"instant\":\"2026-03-04T05:06:07Z\","
                + "\"offset\":\"2026-03-04T14:06:07+09:00\",\"date\":\"2026-03-04\"}");
  }

  @Test
  void 실제_이슈_생성_응답의_시각과_날짜도_ISO_문자열이다() throws Exception {
    Seed seed = seed();
    createIssue(seed, "{\"title\":\"x\",\"dueDate\":\"2026-03-04\"}")
        .andExpect(status().is2xxSuccessful())
        .andExpect(jsonPath("$.dueDate").value("2026-03-04"))
        .andExpect(
            jsonPath("$.createdAt")
                .value(Matchers.matchesPattern("\\d{4}-\\d{2}-\\d{2}T[\\d:.]+Z")));
  }

  @Test
  void 알_수_없는_속성은_무시하고_null_은_기본형에_0_으로_들어간다() throws Exception {
    Primitive p = jsonMapper.readValue("{\"n\":null,\"s\":\"a\",\"unknown\":1}", Primitive.class);
    assertThat(p.n()).isZero();
    assertThat(p.s()).isEqualTo("a");
  }

  @Test
  void 본문_뒤에_토큰이_더_붙어도_첫_값만_읽고_받아들인다() throws Exception {
    // Jackson 2 때 FAIL_ON_TRAILING_TOKENS 는 꺼져 있어, 이슈 생성 본문 뒤에 다른 JSON 이 붙어도 거절하지 않았다.
    Primitive p = jsonMapper.readValue("{\"n\":1} {\"n\":2}", Primitive.class);
    assertThat(p.n()).isEqualTo(1);
    createIssue(seed(), "{\"title\":\"x\"} {\"title\":\"y\"}")
        .andExpect(status().is2xxSuccessful())
        .andExpect(jsonPath("$.title").value("x"));
  }

  @Test
  void 잘못된_JSON_본문은_400_과_고정_문구로_답하고_errors_는_null_이다() throws Exception {
    createIssue(seed(), "{\"title\":")
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.message").value("요청 본문을 해석할 수 없습니다."))
        .andExpect(jsonPath("$.errors").value(Matchers.nullValue()));
  }

  @Test
  void 날짜_형식이_틀리면_errors_에_칸_이름과_안내가_담긴다() throws Exception {
    createIssue(seed(), "{\"title\":\"x\",\"dueDate\":\"abc\"}")
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.message").value("요청 본문을 해석할 수 없습니다."))
        .andExpect(jsonPath("$.errors.dueDate").value("날짜 형식(YYYY-MM-DD)이어야 합니다."));
  }

  @Test
  void 목록_원소_타입이_틀리면_errors_에_원소_경로가_담긴다() throws Exception {
    createIssue(seed(), "{\"title\":\"x\",\"assigneeIds\":[\"a\"]}")
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.message").value("요청 본문을 해석할 수 없습니다."))
        .andExpect(jsonPath("$.errors['assigneeIds[0]']").value("정수여야 합니다."));
  }

  @Test
  void null_값_필드도_JSON_에_null_로_포함된다() throws Exception {
    // default-property-inclusion 설정이 없어 Boot 기본(ALWAYS)이다 — 응답에서 null 칸이 사라지지 않는다.
    assertThat(jsonMapper.writeValueAsString(new Nullable(null, null)))
        .isEqualTo("{\"name\":null,\"count\":null}");
  }
}
