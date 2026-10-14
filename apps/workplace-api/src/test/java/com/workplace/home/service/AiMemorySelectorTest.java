package com.workplace.home.service;

import static com.workplace.jooq.Tables.AI_MEMORY;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.global.ai.AiMemoryLine;
import com.workplace.home.AiMemoryTestFixtures;
import com.workplace.home.repository.AiMemoryRepository;
import com.workplace.home.repository.AiMemoryRepository.NewMemory;
import com.workplace.home.repository.TextEmbeddingRepository;
import com.workplace.support.FakeTextEmbedder;
import com.workplace.support.FakeTextEmbedderConfig;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import com.workplace.user.service.AiPreferenceService;
import java.time.Duration;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.List;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.transaction.annotation.Transactional;

/**
 * WP-383 매 턴 메모리 선택 — 30줄 이하 전부(고정 먼저), 많으면 고정 + RRF 상위 20, 빈 질의는 최신, 의미 일치(가짜 임베딩 동의어), 워커 실패·기호
 * 질의 강등, 홈은 공통만 + "더 있음" 수, 토큰 예산, 꺼짐. 테스트 트랜잭션 안에서 돈다(선택기의 읽기는 바깥 트랜잭션에 참여한다). 커밋 뒤 임베딩 채우기가 돌지
 * 않으므로 필요한 임베딩은 직접 써 넣는다.
 */
@Transactional
@Import(FakeTextEmbedderConfig.class)
class AiMemorySelectorTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired AiMemoryService service;
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

  /** 메모리 1건 — scope null = 공통. */
  private long add(long uid, String content, String scope) {
    return repo.insert(uid, new NewMemory("PREFERENCE", content, "USER", null, scope, null)).id();
  }

  /** 오래된 행으로 만든다 — fill 로 넣은 최신 행들보다 뒤로 밀어 "최신순이면 빠지는" 행을 만든다. */
  private void age(long id) {
    dsl.update(AI_MEMORY)
        .set(AI_MEMORY.UPDATED_AT, OffsetDateTime.parse("2020-01-01T00:00:00Z"))
        .where(AI_MEMORY.ID.eq(id))
        .execute();
  }

  /** 가짜 임베딩을 직접 써 넣는다(커밋 뒤 채우기 대신). */
  private void embed(long id, String content) {
    embeddings.writeMemory(
        id, content, TextEmbeddingRepository.vectorLiteral(fake.expected(content)));
  }

  private static List<String> contents(AiMemoryService.ChatMemories m) {
    return m.items().stream().map(AiMemoryLine::content).toList();
  }

  @Test
  void 서른_줄_이하면_전부_고정_먼저_그다음_최신순이다() {
    long uid = TestFixtures.createHuman(dsl);
    add(uid, "가장 오래됨", null);
    long pinned = add(uid, "고정한 것", null);
    add(uid, "가장 최신", null);
    repo.setPinned(uid, pinned, true);

    AiMemoryService.ChatMemories m = service.loadForChat(uid, null, "아무 질문");

    assertThat(contents(m)).containsExactly("고정한 것", "가장 최신", "가장 오래됨");
    assertThat(m.items().get(0).pinned()).isTrue();
    assertThat(m.items().get(1).pinned()).isNull();
    assertThat(m.moreCount()).isZero();
  }

  @Test
  void 많으면_고정_전부와_키워드가_맞은_오래된_메모리를_고른다() {
    long uid = TestFixtures.createHuman(dsl);
    long cat = add(uid, "고양이를 좋아한다", null);
    long pin = add(uid, "답은 존댓말로 한다", null);
    repo.setPinned(uid, pin, true);
    age(cat);
    age(pin);
    AiMemoryTestFixtures.fill(dsl, uid, null, 40);

    AiMemoryService.ChatMemories m = service.loadForChat(uid, null, "고양이 좋아해?");

    assertThat(contents(m)).contains("고양이를 좋아한다").startsWith("답은 존댓말로 한다");
    assertThat(m.items()).hasSize(1 + AiMemorySelector.TOP_UNPINNED);
    assertThat(m.moreCount()).isEqualTo(42 - m.items().size());
  }

  @Test
  void 질의가_비면_고정과_최신_20개다() {
    long uid = TestFixtures.createHuman(dsl);
    long old = add(uid, "고양이를 좋아한다", null);
    age(old);
    AiMemoryTestFixtures.fill(dsl, uid, null, 40);

    AiMemoryService.ChatMemories m = service.loadForChat(uid, null, "  ");

    assertThat(m.items()).hasSize(AiMemorySelector.TOP_UNPINNED);
    assertThat(contents(m)).doesNotContain("고양이를 좋아한다");
    assertThat(fake.lastQueryTimeout()).isNull(); // 빈 질의는 임베딩을 부르지 않는다
  }

  @Test
  void 낱말이_달라도_뜻이_같으면_고르고_대기는_1_5초다() {
    long uid = TestFixtures.createHuman(dsl);
    // 가짜 임베딩에서 의미 거리 상한(0.5) 안에 들도록 질의의 조사 뗀 형태("고양")까지 묶고 내용을 짧게 둔다.
    fake.synonyms(List.of(List.of("고양이", "고양", "냥이")));
    long cat = add(uid, "냥이 사진", null);
    age(cat);
    embed(cat, "냥이 사진");
    AiMemoryTestFixtures.fill(dsl, uid, null, 40);

    AiMemoryService.ChatMemories m = service.loadForChat(uid, null, "고양이");

    assertThat(contents(m)).contains("냥이 사진");
    assertThat(fake.lastQueryTimeout()).isEqualTo(Duration.ofMillis(1500));
  }

  @Test
  void 워커가_실패해도_키워드와_최신으로_고르고_대기는_1_5초다() {
    long uid = TestFixtures.createHuman(dsl);
    fake.setFailing(true);
    long cat = add(uid, "고양이를 좋아한다", null);
    age(cat);
    AiMemoryTestFixtures.fill(dsl, uid, null, 40);

    AiMemoryService.ChatMemories m = service.loadForChat(uid, null, "고양이 얘기");

    assertThat(m.enabled()).isTrue();
    assertThat(contents(m)).contains("고양이를 좋아한다");
    assertThat(fake.lastQueryTimeout()).isEqualTo(AiMemoryService.CHAT_EMBED_WAIT);
  }

  @Test
  void 기호뿐인_질의도_실패하지_않고_최신_순으로_고른다() {
    long uid = TestFixtures.createHuman(dsl);
    long odd = add(uid, "할인율 50%_특가 메모", null);
    age(odd);
    AiMemoryTestFixtures.fill(dsl, uid, null, 40);

    for (String q : List.of("%_", "?", "ㅋ")) {
      AiMemoryService.ChatMemories m = service.loadForChat(uid, null, q);
      assertThat(m.items()).hasSize(AiMemorySelector.TOP_UNPINNED);
      // LIKE 와일드카드가 질의에서 새지 않는다 — 기호 낱말이 없으니 오래된 행이 키워드로 끌려 오지 않는다.
      assertThat(contents(m)).doesNotContain("할인율 50%_특가 메모");
    }
  }

  @Test
  void 홈은_공통만_고르고_다른_범위는_더_있음에_센다() {
    long uid = TestFixtures.createHuman(dsl);
    add(uid, "이슈 목록은 짧게", "ISSUE");
    add(uid, "이슈 제목은 동사로", "ISSUE");
    add(uid, "메일은 세 줄 요약", "MAIL");
    repo.insert(
        uid, new NewMemory("PREFERENCE", "지난 일", "USER", null, "ISSUE", LocalDate.of(2020, 1, 1)));

    AiMemoryService.ChatMemories home = service.loadForChat(uid, null, "안녕");
    AiMemoryService.ChatMemories issue = service.loadForChat(uid, "ISSUE", "안녕");

    assertThat(home.enabled()).isTrue();
    assertThat(home.items()).isEmpty();
    assertThat(home.moreCount()).isEqualTo(3); // 만료 행은 세지 않는다
    assertThat(contents(issue)).containsExactlyInAnyOrder("이슈 목록은 짧게", "이슈 제목은 동사로");
    assertThat(issue.moreCount()).isEqualTo(1);
  }

  @Test
  void 예산을_넘으면_고정_먼저_넣고_나머지는_더_있음에_센다() {
    long uid = TestFixtures.createHuman(dsl);
    String longText = "가".repeat(300);
    long pinned = add(uid, longText, null);
    repo.setPinned(uid, pinned, true);
    for (int i = 0; i < 9; i++) add(uid, longText, null);

    AiMemoryService.ChatMemories m = service.loadForChat(uid, null, "질문");

    int left =
        AiMemoryService.MEMORY_BLOCK_TOKEN_BUDGET
            - AiMemoryService.BLOCK_HEADER_TOKENS
            - AiMemoryService.MORE_LINE_TOKENS
            - AiMemoryService.lineTokens(longText, true);
    int expected = 1 + left / AiMemoryService.lineTokens(longText, false);
    assertThat(m.items()).hasSize(expected);
    assertThat(m.items().get(0).id()).isEqualTo(pinned);
    assertThat(m.moreCount()).isEqualTo(10 - expected);
    assertThat(AiMemoryService.estimateBlockTokens(m))
        .isLessThanOrEqualTo(AiMemoryService.MEMORY_BLOCK_TOKEN_BUDGET);
  }

  @Test
  void 꺼져_있으면_꺼짐과_빈_목록이다() {
    long uid = TestFixtures.createHuman(dsl);
    add(uid, "x", null);
    preferences.update(uid, null, false);

    AiMemoryService.ChatMemories m = service.loadForChat(uid, null, "질문");

    assertThat(m.enabled()).isFalse();
    assertThat(m.items()).isEmpty();
    assertThat(m.moreCount()).isZero();
  }
}
