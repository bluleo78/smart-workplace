package com.workplace.help.service;

import com.workplace.help.outbound.HelpBundle;
import com.workplace.help.outbound.HelpBundleSource;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * 매뉴얼 절 목록 주기 갱신(WP-1510) — 파드마다 5분마다 묶음을 읽어 이 파드의 절 목록(HelpManualCatalog)을 갈아 끼운다.
 *
 * <p>잠금(ShedLock)을 걸지 않는다 — 목록은 파드 메모리라 모든 파드에서 돌아야 한다(색인 스케줄러처럼 한 파드에서만 돌면 다른 파드의 목록이 낡는다). 읽기가
 * 실패하거나 절이 없는 묶음이면 알던 목록을 그대로 두고 경고만 남긴다 — 다음 회차가 다시 읽는다. 테스트에서는 scheduling.enabled=false 라 돌지
 * 않는다(SchedulingConfig) — 시험은 refresh() 를 직접 부른다.
 */
@Slf4j
@Component
public class HelpCatalogRefresher {

  private final HelpBundleSource source;
  private final HelpManualCatalog catalog;

  public HelpCatalogRefresher(HelpBundleSource source, HelpManualCatalog catalog) {
    this.source = source;
    this.catalog = catalog;
  }

  /** 스케줄 진입점 — 묶음을 읽어 목록을 갈아 끼운다. 실패·절 없는 묶음이면 옛 목록 유지. */
  @Scheduled(fixedDelay = 300_000, initialDelay = 20_000)
  public void refresh() {
    try {
      HelpBundle b = source.fetch();
      // 절이 없는 묶음은 장애로 본다 — 빈 목록으로 갈아 끼워 모든 절 조회가 404 가 되지 않게(HelpBundle.hasNoSections)
      if (HelpBundle.hasNoSections(b)) {
        log.warn("도움말 묶음에 절이 없어 절 목록을 유지한다");
        return;
      }
      catalog.replace(b);
    } catch (Exception e) {
      log.warn("도움말 절 목록 갱신 실패(옛 목록 유지): {}", e.toString());
    }
  }
}
