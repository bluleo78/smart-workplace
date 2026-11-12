package com.workplace.help.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.workplace.global.ai.TextEmbedder;
import com.workplace.help.outbound.HelpBundle;
import com.workplace.help.outbound.HelpBundle.Chapter;
import com.workplace.help.outbound.HelpBundle.Section;
import com.workplace.help.repository.HelpManualSectionRepository;
import com.workplace.help.repository.HelpManualSectionRepository.ScoredRow;
import com.workplace.help.service.HelpIndexSchedulerTest.MutableClock;
import com.workplace.help.service.HelpManualIndexerTest.MutableSource;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;

/**
 * 검색 결과 경로(WP-1510) — 이 파드의 절 목록이 비어 있으면 검색은 묶음을 읽지 않고 [label] 경로로 답하고, 목록이 차면 화면 칸 경로를 쓴다.
 * 색인(DB)·임베더는 가짜로 둔다 — 목록과의 관계만 본다.
 */
class HelpSearchServicePathTest {

  @Test
  void searchUsesLabelPathWhileCatalogIsEmptyWithoutReadingBundle() {
    MutableSource source = new MutableSource();
    source.bundle =
        new HelpBundle(
            List.of(
                new Chapter(
                    "home",
                    "홈",
                    List.of(),
                    List.of(
                        new Section("home.widget", "홈 위젯", "위젯", "위젯 본문"),
                        new Section(
                            "home.order",
                            "순서",
                            "순서 바꾸기",
                            "home.widget",
                            "위젯 순서",
                            List.of(),
                            List.of())))));
    HelpManualCatalog catalog = new HelpManualCatalog(source, new MutableClock());

    HelpManualSectionRepository repo = mock(HelpManualSectionRepository.class);
    when(repo.visibleSections(anyBoolean(), any()))
        .thenReturn(
            List.of(
                new ScoredRow("home.order", "home", "순서 바꾸기", "순서", "위젯 순서", 1, null),
                new ScoredRow("home.widget", "home", "위젯", "홈 위젯", "위젯 본문", 0, null)));
    TextEmbedder embedder = mock(TextEmbedder.class);
    when(embedder.embedQuery(any(), any())).thenReturn(Optional.empty());
    HelpSearchService search = new HelpSearchService(repo, embedder, catalog);

    // 목록이 비었으면 경로는 [label] — 검색은 묶음을 읽지 않는다
    assertThat(search.search("위젯", false, 8).hits())
        .extracting("path")
        .containsExactly(List.of("홈 위젯"), List.of("순서"));
    assertThat(source.fetches.get()).isZero();

    // 목록이 찬 뒤의 검색은 화면 칸 경로를 쓴다
    catalog.replace(source.bundle);
    assertThat(search.search("위젯", false, 8).hits())
        .extracting("path")
        .containsExactly(List.of("홈 위젯"), List.of("홈 위젯", "순서"));
  }
}
