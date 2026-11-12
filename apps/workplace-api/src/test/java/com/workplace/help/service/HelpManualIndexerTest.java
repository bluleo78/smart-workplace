package com.workplace.help.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.help.outbound.HelpBundle;
import com.workplace.help.outbound.HelpBundle.Chapter;
import com.workplace.help.outbound.HelpBundle.Section;
import com.workplace.help.outbound.HelpBundleSource;
import com.workplace.help.repository.HelpManualSectionRepository;
import com.workplace.help.service.HelpManualIndexer.SyncResult;
import com.workplace.support.FakeTextEmbedder;
import com.workplace.support.IntegrationTestBase;
import java.io.IOException;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;

/** 도움말 색인기 통합 시험(WP-1509) — 묶음 동기화·해시 유지·임베딩 채우기·부분 가져오기 보호. */
@Import(HelpManualIndexerTest.TestSourceConfig.class)
public class HelpManualIndexerTest extends IntegrationTestBase {

  /**
   * 시험용 가변 묶음 — 운영 구현이 없어도 주입되게 @Primary 로 둔다. 절 조회 API 시험(HelpSectionApiTest)도 같은 설정을 써 스프링 컨텍스트를
   * 하나 더 띄우지 않게 public 으로 연다. fetches 는 묶음을 몇 번 읽었는지(빈 목록 첫 요청이 한 번만 읽는지 확인용).
   */
  public static class MutableSource implements HelpBundleSource {
    public volatile HelpBundle bundle;
    public volatile IOException failure;
    public final AtomicInteger fetches = new AtomicInteger();

    @Override
    public HelpBundle fetch() throws IOException {
      fetches.incrementAndGet();
      if (failure != null) throw failure;
      return bundle;
    }
  }

  /** 가변 묶음을 @Primary 빈으로 올린다 — 다른 도움말 시험도 @Import 해 같은 컨텍스트를 함께 쓴다. */
  @TestConfiguration
  public static class TestSourceConfig {
    @Bean
    @Primary
    MutableSource helpTestSource() {
      return new MutableSource();
    }
  }

  @Autowired HelpManualIndexer indexer;
  @Autowired HelpManualSectionRepository repo;
  @Autowired MutableSource source;
  @Autowired FakeTextEmbedder fake;

  @BeforeEach
  void clean() {
    fake.reset();
    source.failure = null;
    baseDsl.execute("DELETE FROM help_manual_section");
  }

  private static HelpBundle bundle(String body2) {
    return new HelpBundle(
        List.of(
            new Chapter(
                "01",
                "시작하기",
                List.of("member"),
                List.of(
                    new Section("a.one", "하나", "첫째", "본문 하나"),
                    new Section("a.two", "", "둘째", body2))),
            new Chapter(
                "02",
                "관리",
                List.of("admin"),
                List.of(new Section("b.one", "관리하나", "셋째", "관리 본문")))));
  }

  @Test
  void syncAddsAllSectionsWithNullEmbedding() {
    SyncResult r = indexer.sync(bundle("본문 둘"));
    assertThat(r).isEqualTo(new SyncResult(3, 0, 0));
    assertThat(repo.missingEmbedding(10)).hasSize(3);
    // 빈 label 은 title 로
    assertThat(repo.missingEmbedding(10).get(1).label()).isEqualTo("둘째");
    assertThat(repo.missingEmbedding(10).get(2).ord()).isEqualTo(1000);
  }

  @Test
  void unchangedHashKeepsEmbedding() {
    indexer.sync(bundle("본문 둘"));
    assertThat(indexer.embedMissing(10)).isEqualTo(3);
    SyncResult r = indexer.sync(bundle("본문 둘"));
    assertThat(r.updated()).isZero();
    assertThat(repo.missingEmbedding(10)).isEmpty();
    assertThat(fake.documentCalls()).isEqualTo(3);
  }

  @Test
  void changedBodyClearsEmbedding() {
    indexer.sync(bundle("본문 둘"));
    indexer.embedMissing(10);
    SyncResult r = indexer.sync(bundle("바뀐 본문"));
    assertThat(r.updated()).isEqualTo(1);
    assertThat(repo.missingEmbedding(10)).extracting("sectionId").containsExactly("a.two");
  }

  @Test
  void removedSectionDeleted() {
    indexer.sync(bundle("본문 둘"));
    HelpBundle fewer =
        new HelpBundle(
            List.of(
                new Chapter(
                    "01",
                    "시작하기",
                    List.of("member"),
                    List.of(new Section("a.one", "하나", "첫째", "본문 하나")))));
    SyncResult r = indexer.sync(fewer);
    assertThat(r.removed()).isEqualTo(2);
    assertThat(repo.snapshot()).containsOnlyKeys("a.one");
  }

  @Test
  void embedFailureLeavesNull() {
    indexer.sync(bundle("본문 둘"));
    fake.setFailing(true);
    assertThat(indexer.embedMissing(10)).isZero();
    assertThat(repo.missingEmbedding(10)).hasSize(3);
  }

  @Test
  void partialFetchKeepsIndex() {
    indexer.sync(bundle("본문 둘"));
    source.failure = new IOException("장 하나 실패");
    assertThat(indexer.refresh()).isFalse();
    assertThat(repo.snapshot()).hasSize(3);
  }

  @Test
  void refreshSyncsAndEmbeds() {
    source.bundle = bundle("본문 둘");
    assertThat(indexer.refresh()).isTrue();
    assertThat(repo.missingEmbedding(10)).isEmpty();
  }

  @Test
  void embedDocumentFormatAndTruncation() {
    String longBody = "가".repeat(3000);
    indexer.sync(bundle(longBody));
    indexer.embedMissing(10);
    List<String> texts = fake.documentTexts();
    assertThat(texts.get(0)).isEqualTo("시작하기 › 하나\n첫째\n본문 하나");
    assertThat(texts.get(1)).hasSize(2000).startsWith("시작하기 › 둘째\n둘째\n가가");
  }

  @Test
  void visibleSectionsAppliesAudienceAndDistance() {
    indexer.sync(bundle("본문 둘"));
    indexer.embedMissing(10);
    float[] q = fake.expected("본문 하나");
    assertThat(repo.visibleSections(false, q))
        .extracting("sectionId")
        .containsExactly("a.one", "a.two");
    assertThat(repo.visibleSections(true, q)).hasSize(3);
    assertThat(repo.visibleSections(false, q).get(0).distance()).isNotNull().isLessThan(1.0);
    assertThat(repo.visibleSections(false, null).get(0).distance()).isNull();
  }

  @Test
  void staleEmbeddingDoesNotOverwriteChangedContent() {
    indexer.sync(bundle("본문 둘"));
    // 임베딩 전에 읽은 행(옛 해시)
    var stale = repo.missingEmbedding(10).get(1);
    // 그사이 다른 sync 가 내용을 바꿔 embedding 이 NULL 로 되돌아간다
    indexer.sync(bundle("바뀐 본문"));
    assertThat(repo.saveEmbedding(stale.sectionId(), stale.contentHash(), fake.expected("옛")))
        .isZero();
    assertThat(repo.missingEmbedding(10)).extracting("sectionId").contains("a.two");
  }

  @Test
  void emptyBundleKeepsIndex() {
    indexer.sync(bundle("본문 둘"));
    source.bundle = new HelpBundle(List.of());
    assertThat(indexer.refresh()).isFalse();
    assertThat(repo.snapshot()).hasSize(3);
  }

  @Test
  void bundleWithoutSectionsKeepsIndex() {
    indexer.sync(bundle("본문 둘"));
    // 장은 있는데 절이 하나도 없는 묶음 — 빈 묶음과 같은 장애로 보아 색인을 지우지 않는다
    source.bundle = new HelpBundle(List.of(new Chapter("a", "시작하기", List.of(), List.of())));
    assertThat(indexer.refresh()).isFalse();
    assertThat(repo.snapshot()).hasSize(3);
  }

  @Test
  void embedFailureOnOneRowSkipsItAndFillsTheRest() {
    indexer.sync(bundle("본문 둘"));
    // 둘째 절의 임베딩 문서만 워커가 거절한다
    fake.failOn("시작하기 › 둘째\n둘째\n본문 둘");
    assertThat(indexer.embedMissing(10)).isEqualTo(2);
    assertThat(repo.missingEmbedding(10)).extracting("sectionId").containsExactly("a.two");
  }

  @Test
  void unchangedSectionsAreNotRewritten() {
    indexer.sync(bundle("본문 둘"));
    baseDsl.execute("UPDATE help_manual_section SET updated_at = '2020-01-01'");
    // 같은 묶음 — 어떤 행도 쓰지 않으므로 updated_at 이 그대로다
    SyncResult same = indexer.sync(bundle("본문 둘"));
    assertThat(same).isEqualTo(new SyncResult(0, 0, 0));
    assertThat(
            baseDsl
                .fetchOne(
                    "SELECT count(*) FROM help_manual_section WHERE updated_at > '2021-01-01'")
                .get(0, Integer.class))
        .isZero();
  }

  @Test
  void audienceOrChapterChangeIsWrittenEvenWithSameHash() {
    indexer.sync(bundle("본문 둘"));
    indexer.embedMissing(10);
    // 장 제목·라벨·제목·본문(=해시 입력)은 그대로, 대상만 바꾼다
    HelpBundle changed =
        new HelpBundle(
            List.of(
                new Chapter(
                    "01",
                    "시작하기",
                    List.of("member", "admin"),
                    List.of(
                        new Section("a.one", "하나", "첫째", "본문 하나"),
                        new Section("a.two", "", "둘째", "본문 둘"))),
                new Chapter(
                    "02",
                    "관리",
                    List.of("admin"),
                    List.of(new Section("b.one", "관리하나", "셋째", "관리 본문")))));
    SyncResult r = indexer.sync(changed);
    assertThat(r).isEqualTo(new SyncResult(0, 2, 0));
    assertThat(repo.snapshot().get("a.one").audience()).containsExactly("member", "admin");
    // 해시가 같아 임베딩은 유지된다
    assertThat(repo.missingEmbedding(10)).isEmpty();
  }
}
