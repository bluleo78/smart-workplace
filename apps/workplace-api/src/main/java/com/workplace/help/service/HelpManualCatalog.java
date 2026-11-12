package com.workplace.help.service;

import com.workplace.help.outbound.HelpBundle;
import com.workplace.help.outbound.HelpBundleSource;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

/**
 * 매뉴얼 절 목록(메모리, 인스턴스마다 — WP-1510). 색인 표(help_manual_section)에는 parent·그림·원문이 없어 절 조회와 검색 결과 경로는 여기서
 * 답한다 — 마이그레이션 없이.
 *
 * <p>채우는 길은 둘이다. ① 파드마다 도는 HelpCatalogRefresher 가 5분마다 묶음을 읽어 갈아 끼운다(색인 스케줄러는 ShedLock 으로 한 파드에서만
 * 돌아 다른 파드의 목록을 채울 수 없으므로 따로 둔다). ② 기동 직후처럼 목록이 비었을 때 절 조회(lookup)가 한 번 읽는다 — 답할 것이 없으니. 이 읽기는 모니터로
 * 하나만 돌고, 동시에 온 요청은 그 읽기를 기다렸다가 채워진 목록을 쓴다. 읽기가 실패하면 RETRY_AFTER 동안 다시 읽지 않는다 — 요청마다 웹을 두드려 응답이
 * 늘어지지 않게(실패 동안은 빈 목록이라 404).
 *
 * <p>검색 결과 경로(entries)는 묶음 읽기를 결코 하지 않는다 — 지금 목록으로 답한다. 검색은 DB 색인만으로 답할 수 있어 웹이 느리거나 죽어도 검색이 늘어지지
 * 않게.
 */
@Slf4j
@Component
public class HelpManualCatalog {

  /** 빈 목록 읽기가 실패한 뒤 다시 읽기까지 기다리는 시간. */
  static final Duration RETRY_AFTER = Duration.ofMinutes(1);

  /**
   * 절 하나와 그 장 정보 — path 는 장 최상위부터 이 절까지 화면 칸 이름(label, 비면 title).
   *
   * @param audience 장 대상 — 관리자 장 판단용
   */
  public record Entry(
      String chapter,
      String chapterTitle,
      List<String> audience,
      HelpBundle.Section section,
      List<String> path) {

    /**
     * 대상 규칙 — 색인 검색(HelpManualSectionRepository.visibleSections)과 같다: 비었거나 member 면 모두, admin 은
     * 관리자에게만.
     */
    boolean visibleTo(boolean admin) {
      return audience.isEmpty()
          || audience.contains("member")
          || (admin && audience.contains("admin"));
    }
  }

  /**
   * 절 조회 결과 — 절과, 같은 목록 판으로 거른 links(호출자가 볼 수 있고 목록에 있는 id 만).
   *
   * @param links 관리자 아닌 이에게 관리자 장 절 id 를 드러내지 않게 거른 링크
   */
  public record Found(Entry entry, List<String> links) {}

  private final HelpBundleSource source;
  private final Clock clock;

  /** id 별 절 — 바꿀 때 통째로 갈아 끼워 읽는 쪽이 잠금 없이 한 판을 본다. */
  private volatile Map<String, Entry> byId = Map.of();

  /** 마지막으로 실패한 빈 목록 읽기 시각(없으면 null). */
  private volatile Instant lastFailure;

  @Autowired
  public HelpManualCatalog(HelpBundleSource source) {
    this(source, Clock.systemUTC());
  }

  /** 시험용 — 재시도 간격을 가짜 시계로 감는다. */
  HelpManualCatalog(HelpBundleSource source, Clock clock) {
    this.source = source;
    this.clock = clock;
  }

  /** 묶음으로 목록을 갈아 끼운다. 절이 없는 묶음을 거르는 것은 부르는 쪽 몫이다(HelpCatalogRefresher·loadIfEmpty). 실패 대기도 푼다. */
  public void replace(HelpBundle bundle) {
    byId = build(bundle);
    lastFailure = null;
  }

  /**
   * 이 호출자가 볼 수 있는 절과 그 links. 없거나 관리자 장을 관리자 아닌 이가 찾으면 빈 값 — 둘을 구분하지 않아 관리자 장의 존재를 드러내지 않는다. 목록이
   * 비었으면 먼저 한 번 읽는다. links 는 절을 찾은 그 목록 판으로 거른다.
   */
  public Optional<Found> lookup(String id, boolean admin) {
    if (byId.isEmpty()) loadIfEmpty();
    Map<String, Entry> s = byId;
    Entry e = s.get(id);
    if (e == null || !e.visibleTo(admin)) return Optional.empty();
    return Optional.of(new Found(e, visibleLinks(s, e, admin)));
  }

  /** 검색 결과 경로용 지금 목록 — 읽기를 하지 않는다. 검색 한 번에 한 번 불러 모든 결과에 같은 판을 쓴다(비었으면 호출자가 [label] 로 답한다). */
  public Map<String, Entry> entries() {
    return byId;
  }

  /**
   * 빈 목록을 한 번 읽어 채운다. 모니터로 하나만 읽고, 기다리던 요청은 들어와서 이미 찼으면 그냥 돌아간다(이중 확인). 묶음 읽기는 HTTP 연결·요청 시간 제한이
   * 있어(HttpHelpBundleSource) 기다림에 끝이 있다. 실패(예외·절 없는 묶음)면 빈 목록 그대로 두고 시각을 남긴다.
   */
  private synchronized void loadIfEmpty() {
    Instant now = clock.instant();
    if (!byId.isEmpty() || backingOff(now)) return;
    try {
      HelpBundle b = source.fetch();
      // 절이 없는 묶음은 장애로 본다 — 색인기와 같은 판단(HelpBundle.hasNoSections)
      if (HelpBundle.hasNoSections(b)) throw new IllegalStateException("도움말 묶음에 절이 없다");
      replace(b);
    } catch (Exception e) {
      log.warn("도움말 목록 읽기 실패(빈 목록으로 답한다): {}", e.toString());
      lastFailure = now;
    }
  }

  /** 최근(RETRY_AFTER 안) 읽기가 실패했는가. */
  private boolean backingOff(Instant now) {
    Instant failed = lastFailure;
    return failed != null && failed.plus(RETRY_AFTER).isAfter(now);
  }

  /** 절의 links 중 이 판에서 호출자가 볼 수 있는 id 만 — 목록에 없는 id 도 뺀다(읽어도 404 라서). */
  private static List<String> visibleLinks(Map<String, Entry> s, Entry entry, boolean admin) {
    return entry.section().links().stream()
        .filter(
            id -> {
              Entry target = s.get(id);
              return target != null && target.visibleTo(admin);
            })
        .toList();
  }

  /**
   * 묶음 → id 별 절. id 가 없는 절은 건너뛰고, 같은 id 가 둘이면 앞의 것을 쓴다. 장을 한 번 돌며 절과 그 장을 모으고, 경로는 모은 절로 만든다 —
   * parent 가 뒤에 나오는 절도 따라갈 수 있게.
   */
  private static Map<String, Entry> build(HelpBundle bundle) {
    List<HelpBundle.Chapter> chapters =
        bundle == null || bundle.chapters() == null ? List.of() : bundle.chapters();
    Map<String, HelpBundle.Section> sections = new HashMap<>();
    Map<String, HelpBundle.Chapter> chapterOf = new HashMap<>();
    for (HelpBundle.Chapter c : chapters) {
      if (c.sections() == null) continue;
      for (HelpBundle.Section s : c.sections()) {
        if (s.id() != null && sections.putIfAbsent(s.id(), s) == null) chapterOf.put(s.id(), c);
      }
    }
    Map<String, Entry> byId = new HashMap<>();
    sections.forEach(
        (id, s) -> {
          HelpBundle.Chapter c = chapterOf.get(id);
          List<String> audience = c.audience() == null ? List.of() : List.copyOf(c.audience());
          byId.put(id, new Entry(c.chapter(), c.title(), audience, s, pathOf(s, sections)));
        });
    return Map.copyOf(byId);
  }

  /** parent 를 따라 위로 올라가 뒤집는다. 이미 지난 절을 다시 만나면(잘못된 묶음의 순환) 멈춘다. */
  private static List<String> pathOf(
      HelpBundle.Section s, Map<String, HelpBundle.Section> sections) {
    List<String> path = new ArrayList<>();
    Set<String> seen = new HashSet<>();
    for (HelpBundle.Section cur = s;
        cur != null && seen.add(cur.id());
        cur = cur.parent() == null ? null : sections.get(cur.parent())) {
      path.add(labelOf(cur));
    }
    Collections.reverse(path);
    return List.copyOf(path);
  }

  /** 화면 칸 이름 — label 이 비면 title(색인기와 같은 규칙), 둘 다 없으면 빈 글. */
  public static String labelOf(HelpBundle.Section s) {
    if (s.label() != null && !s.label().isBlank()) return s.label();
    return s.title() == null ? "" : s.title();
  }
}
