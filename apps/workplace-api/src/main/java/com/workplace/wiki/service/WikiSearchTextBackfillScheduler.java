package com.workplace.wiki.service;

import com.workplace.global.tenant.TenantScopedRunner;
import com.workplace.wiki.repository.WikiPageRepository;
import com.workplace.wiki.repository.WikiPageRepository.SearchTextSource;
import java.util.List;
import java.util.concurrent.atomic.AtomicBoolean;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * 노트 검색 평문 백필(WP-1243) — {@code wiki_page.search_text} 가 비어 있는 행(열을 더하기 전에 저장된 노트, 롤링 배포 중 옛 코드가 만든
 * 노트)을 {@link WikiPlainText} 로 채운다.
 *
 * <p>SQL 로는 마크다운·HTML 블록 펜스·스타일 컨테이너를 Java 추출기와 같게 걷어 낼 수 없어 마이그레이션이 아니라 여기서 채운다. 채워지기 전 행은 검색이 본문
 * 원문으로 찾고(예전 동작), 스니펫은 그 자리에서 평문으로 바꿔 보인다 — 백필이 늦어도 검색이 빠지지는 않는다.
 *
 * <p>테이블이 테넌트 RLS 라 {@link TenantScopedRunner} 로 테넌트마다 GUC 가 주입된 트랜잭션에서 돈다. 러너는 테넌트 하나를 트랜잭션 하나로
 * 돌리므로 묶음({@link #BATCH_SIZE} 건)마다 러너를 새로 불러 묶음 하나 = 트랜잭션 하나로 둔다 — 채운 행의 잠금이 묶음이 끝나면 풀려 사용자 저장을 오래
 * 막지 않고, 한 묶음이 실패해도 앞서 채운 묶음은 남는다. 한 회차는 최대 {@link #MAX_BATCHES} 묶음이고 남은 행은 다음 회차에. 다 채운 뒤에는 부분
 * 인덱스가 비어 회차마다 빈 조회 한 번뿐이다.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class WikiSearchTextBackfillScheduler {

  /** 한 번에 읽는 행 수 — 본문이 클 수 있어(최대 100만 자) 작게 나눈다. */
  static final int BATCH_SIZE = 50;

  /** 테넌트당 회차 묶음 상한 — 한 테넌트의 트랜잭션이 오래 열려 있지 않게. */
  static final int MAX_BATCHES = 20;

  private final TenantScopedRunner tenantRunner;
  private final WikiPageRepository pages;

  /** 기동 1분 뒤 첫 실행, 이후 직전 실행 종료 5분 뒤. */
  @Scheduled(initialDelay = 60_000, fixedDelay = 300_000)
  @SchedulerLock(name = "WikiSearchTextBackfillScheduler.scheduled")
  public void scheduled() {
    backfillAllTenants();
  }

  /**
   * 활성 테넌트마다 비어 있는 검색 평문을 채운다(테스트 진입점). 한 테넌트 실패는 러너가 격리한다. 묶음 하나씩 모든 테넌트를 한 바퀴 돌고, 묶음을 가득 채운 테넌트가
   * 하나도 없으면(남은 행 없음) 멈춘다.
   */
  public void backfillAllTenants() {
    for (int batch = 0; batch < MAX_BATCHES; batch++) {
      AtomicBoolean anyFull = new AtomicBoolean(false);
      tenantRunner.forEachActiveTenant(
          tenantId -> {
            List<SearchTextSource> rows = pages.findMissingSearchText(BATCH_SIZE);
            int filled = fillBatch(rows);
            if (filled > 0) {
              log.info("테넌트 {} 노트 검색 평문 {} 건 채움", tenantId, filled);
            }
            if (rows.size() == BATCH_SIZE) {
              anyFull.set(true);
            }
          });
      if (!anyFull.get()) {
        break;
      }
    }
  }

  /** 지금 테넌트(GUC)에서 읽은 묶음을 채우고 채운 수를 돌려준다. */
  private int fillBatch(List<SearchTextSource> rows) {
    int filled = 0;
    for (SearchTextSource row : rows) {
      // 읽은 판 그대로일 때만 채운다 — 사이에 저장이 끼었으면 그 저장이 이미 평문을 썼다(옛 코드의 저장이면 다음 회차에 다시 본다).
      if (pages.fillSearchText(row.id(), row.version(), WikiPlainText.fromMarkdown(row.body()))) {
        filled++;
      }
    }
    return filled;
  }
}
