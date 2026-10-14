package com.workplace.home.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.hasSize;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.global.tenant.TenantContext;
import com.workplace.home.repository.AiMemoryRepository;
import com.workplace.home.repository.AiMemoryRepository.NewMemory;
import com.workplace.home.repository.TextEmbeddingRepository;
import com.workplace.home.service.AiMemoryRanker;
import com.workplace.support.FakeTextEmbedder;
import com.workplace.support.FakeTextEmbedderConfig;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import com.workplace.user.service.AiPreferenceService;
import java.time.Duration;
import java.time.LocalDate;
import java.util.List;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.transaction.annotation.Transactional;

/**
 * WP-383 search_memory API — 키워드·의미(가짜 임베딩, 5초 대기)로 본인 유효 메모리만, 범위 필터, 꺼짐이면 memoryEnabled=false + 빈
 * 목록, limit 기본 10·최대 20, 빈 질의 400, 기호뿐인 질의는 400 이 아니다(판정 9). 결과 줄은 범위·고정을 싣는다(#id 로 바로 고치기·지우기).
 */
@Transactional
@Import(FakeTextEmbedderConfig.class)
class AiMemorySearchApiTest extends IntegrationTestBase {

  private static final String SEARCH = "/api/v1/users/me/ai-memories/search";
  private static final double MAX_DISTANCE = AiMemoryRanker.SEMANTIC_MAX_DISTANCE;

  @Autowired MockMvc mvc;
  @Autowired DSLContext dsl;
  @Autowired AiMemoryRepository repo;
  @Autowired TextEmbeddingRepository embeddings;
  @Autowired AiPreferenceService preferences;
  @Autowired FakeTextEmbedder fake;

  @BeforeEach
  void setUp() {
    fake.reset();
  }

  @AfterEach
  void tearDown() {
    fake.reset();
  }

  private ResultActions call(long uid, MockHttpServletRequestBuilder rb) throws Exception {
    return mvc.perform(
        rb.with(authentication(new UsernamePasswordAuthenticationToken(uid, "n/a", List.of()))));
  }

  /** ai-agent 처럼 Internal + 대행 헤더로 부른다. 필터가 지운 테스트 스레드 TenantContext 를 되돌린다. */
  private ResultActions internal(long uid, MockHttpServletRequestBuilder rb) throws Exception {
    try {
      return mvc.perform(
          rb.header("Authorization", "Internal test-token")
              .header("X-On-Behalf-Of", String.valueOf(uid)));
    } finally {
      TenantContext.set(1L);
    }
  }

  private long add(long uid, String content, String scope) {
    return repo.insert(uid, new NewMemory("PREFERENCE", content, "USER", null, scope, null)).id();
  }

  /** 공통 메모리를 만들고 가짜 임베딩을 바로 써 넣는다(@Transactional 이라 커밋 뒤 채우기가 돌지 않는다). */
  private long embedded(long uid, String content) {
    long id = add(uid, content, null);
    embeddings.writeMemory(
        id, content, TextEmbeddingRepository.vectorLiteral(fake.expected(content)));
    return id;
  }

  @Test
  void 키워드로_찾고_범위와_고정을_싣는다() throws Exception {
    long uid = TestFixtures.createHuman(dsl);
    long cat = add(uid, "고양이를 좋아한다", "ISSUE");
    repo.setPinned(uid, cat, true);
    add(uid, "커피는 디카페인", null);

    call(uid, get(SEARCH).param("q", "고양이"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.memoryEnabled").value(true))
        .andExpect(jsonPath("$.items", hasSize(1)))
        .andExpect(jsonPath("$.items[0].id").value(cat))
        .andExpect(jsonPath("$.items[0].scope").value("ISSUE"))
        .andExpect(jsonPath("$.items[0].pinned").value(true));
  }

  @Test
  void 범위로_거르고_모르는_범위는_400() throws Exception {
    long uid = TestFixtures.createHuman(dsl);
    add(uid, "회의록은 개조식", "WIKI");
    add(uid, "회의는 오전에", null);

    call(uid, get(SEARCH).param("q", "회의").param("scope", "COMMON"))
        .andExpect(jsonPath("$.items", hasSize(1)))
        .andExpect(jsonPath("$.items[0].content").value("회의는 오전에"));
    call(uid, get(SEARCH).param("q", "회의").param("scope", "WIKI"))
        .andExpect(jsonPath("$.items", hasSize(1)))
        .andExpect(jsonPath("$.items[0].content").value("회의록은 개조식"));
    call(uid, get(SEARCH).param("q", "회의").param("scope", "ALL"))
        .andExpect(jsonPath("$.items", hasSize(2)));
    call(uid, get(SEARCH).param("q", "회의").param("scope", "FOO"))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.errors.code").value("AI_MEMORY_INVALID"));
  }

  @Test
  void 본인의_유효한_메모리만_찾는다() throws Exception {
    long uid = TestFixtures.createHuman(dsl);
    long other = TestFixtures.createHuman(dsl);
    add(other, "고양이 사진", null);
    repo.insert(
        uid, new NewMemory("PREFERENCE", "고양이 지난 일", "USER", null, null, LocalDate.of(2020, 1, 1)));

    call(uid, get(SEARCH).param("q", "고양이")).andExpect(jsonPath("$.items", hasSize(0)));
  }

  @Test
  void 꺼져_있으면_memoryEnabled_false_와_빈_목록() throws Exception {
    long uid = withMembership(TestFixtures.createHuman(dsl));
    add(uid, "고양이를 좋아한다", null);
    preferences.update(uid, null, false);

    internal(uid, get(SEARCH).param("q", "고양이"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.memoryEnabled").value(false))
        .andExpect(jsonPath("$.items", hasSize(0)));
  }

  @Test
  void 낱말이_달라도_뜻으로_찾고_대기는_5초다() throws Exception {
    long uid = TestFixtures.createHuman(dsl);
    // 가짜 임베딩에서 의미 거리 상한(0.5) 안에 들도록 질의의 조사 뗀 형태("고양")까지 묶고 내용을 짧게 둔다.
    fake.synonyms(List.of(List.of("고양이", "고양", "냥이")));
    long cat = embedded(uid, "냥이 사진");

    call(uid, get(SEARCH).param("q", "고양이"))
        .andExpect(jsonPath("$.items", hasSize(1)))
        .andExpect(jsonPath("$.items[0].id").value(cat));
    assertThat(fake.lastQueryTimeout()).isEqualTo(Duration.ofSeconds(5));
  }

  @Test
  void 임베딩돼_있어도_뜻이_먼_메모리는_돌려주지_않는다() throws Exception {
    long uid = TestFixtures.createHuman(dsl);
    fake.synonyms(List.of(List.of("고양이", "고양", "냥이")));
    long near = embedded(uid, "냥이 사진");
    List<String> far = List.of("커피는 디카페인", "회의는 오전에", "보고서는 표로 정리", "출장 일정은 메일로");
    for (String c : far) embedded(uid, c);
    // 전제: 가까운 것은 상한 안, 먼 것은 상한 밖(해시 충돌로 우연히 통과하지 않게). 먼 것은 질의 낱말도 담지 않는다.
    assertThat(fake.distance("고양이", "냥이 사진")).isLessThanOrEqualTo(MAX_DISTANCE);
    for (String c : far) assertThat(fake.distance("고양이", c)).isGreaterThan(MAX_DISTANCE);

    // 상위 50 만으로 거르면 임베딩된 다섯 행이 모두 나온다 — 거리 상한으로 가까운 것만.
    call(uid, get(SEARCH).param("q", "고양이"))
        .andExpect(jsonPath("$.items", hasSize(1)))
        .andExpect(jsonPath("$.items[0].id").value(near));
  }

  @Test
  void 개수는_기본_10_최대_20_최소_1() throws Exception {
    long uid = TestFixtures.createHuman(dsl);
    for (int i = 0; i < 25; i++) add(uid, "회의 메모 " + i, null);

    call(uid, get(SEARCH).param("q", "회의")).andExpect(jsonPath("$.items", hasSize(10)));
    call(uid, get(SEARCH).param("q", "회의").param("limit", "50"))
        .andExpect(jsonPath("$.items", hasSize(20)));
    call(uid, get(SEARCH).param("q", "회의").param("limit", "0"))
        .andExpect(jsonPath("$.items", hasSize(1)));
  }

  @Test
  void 빈_질의는_400() throws Exception {
    long uid = TestFixtures.createHuman(dsl);
    call(uid, get(SEARCH).param("q", "   "))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.errors.code").value("AI_MEMORY_INVALID"));
    call(uid, get(SEARCH))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.errors.code").value("AI_MEMORY_INVALID"));
  }

  @Test
  void 기호뿐인_질의는_400_이_아니다() throws Exception {
    long uid = TestFixtures.createHuman(dsl);
    add(uid, "할인율 50%_특가 메모", null);

    // 낱말이 없어 키워드로는 아무것도 맞지 않고(와일드카드가 새지 않는다), 임베딩된 행이 없어 의미로도 없다.
    call(uid, get(SEARCH).param("q", "%_"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.items", hasSize(0)));
  }
}
