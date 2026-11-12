package com.workplace.help.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.help.outbound.HelpBundle;
import com.workplace.help.outbound.HelpBundle.Chapter;
import com.workplace.help.service.HelpIndexSchedulerTest.MutableClock;
import com.workplace.help.service.HelpManualIndexerTest.MutableSource;
import java.io.IOException;
import java.util.List;
import org.junit.jupiter.api.Test;

/** HelpCatalogRefresher(WP-1510) — 주기 갱신이 목록을 갈아 끼우고, 읽기 실패·절 없는 묶음이면 옛 목록을 지킨다. */
class HelpCatalogRefresherTest {

  private final MutableSource source = new MutableSource();
  private final HelpManualCatalog catalog = new HelpManualCatalog(source, new MutableClock());
  private final HelpCatalogRefresher refresher = new HelpCatalogRefresher(source, catalog);

  /** 목록에서 고르기 절의 제목. */
  private String pickTitle() {
    return catalog.entries().get("home#위젯-고르기").section().title();
  }

  @Test
  void refreshReplacesSnapshot() {
    catalog.replace(HelpManualCatalogTest.bundle("옛 이름"));
    source.bundle = HelpManualCatalogTest.bundle("새 이름");
    refresher.refresh();
    assertThat(pickTitle()).isEqualTo("새 이름");
  }

  @Test
  void failedReadKeepsOldSnapshot() {
    catalog.replace(HelpManualCatalogTest.bundle("옛 이름"));
    source.failure = new IOException("일시 장애");
    refresher.refresh();
    assertThat(pickTitle()).isEqualTo("옛 이름");
  }

  @Test
  void bundleWithoutSectionsKeepsOldSnapshot() {
    catalog.replace(HelpManualCatalogTest.bundle("옛 이름"));
    source.bundle = new HelpBundle(List.of(new Chapter("home", "홈", List.of(), List.of())));
    refresher.refresh();
    assertThat(pickTitle()).isEqualTo("옛 이름");
  }
}
