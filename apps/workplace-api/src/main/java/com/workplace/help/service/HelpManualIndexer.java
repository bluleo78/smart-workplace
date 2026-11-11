package com.workplace.help.service;

import com.workplace.global.ai.TextEmbedder;
import com.workplace.global.util.CapabilityTokens;
import com.workplace.global.util.Texts;
import com.workplace.help.outbound.HelpBundle;
import com.workplace.help.outbound.HelpBundleSource;
import com.workplace.help.repository.HelpManualSectionRepository;
import com.workplace.help.repository.HelpManualSectionRepository.SectionRow;
import com.workplace.help.repository.HelpManualSectionRepository.StoredMeta;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 도움말 매뉴얼 절 색인기(WP-1509) — 묶음을 표에 맞추고(sync), 임베딩이 빈 절을 채운다(embedMissing).
 *
 * <p>HelpBundleSource 는 직접 주입한다 — 운영 구현(HttpHelpBundleSource)이 무조건 @Component 라 어느 컨텍스트에서나 빈이 있고,
 * 시험은 @Primary 가짜로 갈아 끼운다.
 */
@Slf4j
@Service
public class HelpManualIndexer {

  /** 임베딩 입력 글자 수 상한 — 워커 입력 한도를 넘기지 않게. */
  static final int EMBED_MAX_CHARS = 2000;

  /** refresh() 한 번에 채울 임베딩 수. */
  static final int REFRESH_EMBED_MAX = 500;

  /** sync 결과 — 새로 넣은 수·바뀐 수·지운 수. */
  public record SyncResult(int added, int updated, int removed) {}

  private final HelpBundleSource source;
  private final HelpManualSectionRepository repo;
  private final TextEmbedder embedder;
  private final TransactionTemplate tx;

  public HelpManualIndexer(
      HelpBundleSource source,
      HelpManualSectionRepository repo,
      TextEmbedder embedder,
      PlatformTransactionManager txManager) {
    this.source = source;
    this.repo = repo;
    this.embedder = embedder;
    this.tx = new TransactionTemplate(txManager);
  }

  /** 묶음을 가져와 맞추고 임베딩을 채운다. 가져오기·처리가 실패하면 경고만 남기고 false — 색인은 그대로 둔다(부분 묶음으로 지우지 않는다). */
  public boolean refresh() {
    try {
      HelpBundle b = source.fetch();
      // 빈 묶음은 정상 응답이 아닌 장애로 본다 — sync 가 색인 전체를 지우지 않게.
      if (b == null || b.chapters() == null || b.chapters().isEmpty()) {
        log.warn("도움말 묶음이 비어 있어 색인을 유지한다");
        return false;
      }
      sync(b);
      embedMissing(REFRESH_EMBED_MAX);
      return true;
    } catch (Exception e) {
      log.warn("도움말 색인 갱신 실패(기존 색인 유지): {}", e.toString());
      return false;
    }
  }

  /**
   * 묶음을 표에 맞춘다 — 한 트랜잭션에서 upsert 와 삭제를 함께. 해시·장 id·대상·순서가 모두 같은 절은 쓰지 않는다(매 갱신마다 전 행을 다시 쓰지 않게).
   * 해시가 달라진 절만 임베딩이 비워진다.
   */
  public SyncResult sync(HelpBundle bundle) {
    List<SectionRow> rows = toRows(bundle);
    return tx.execute(
        s -> {
          Map<String, StoredMeta> before = repo.snapshot();
          int added = 0;
          int updated = 0;
          Set<String> ids = new HashSet<>();
          for (SectionRow r : rows) {
            ids.add(r.sectionId());
            StoredMeta old = before.get(r.sectionId());
            if (old != null && unchanged(old, r)) continue;
            repo.upsert(r);
            if (old == null) added++;
            else updated++;
          }
          int removed = repo.deleteNotIn(ids);
          return new SyncResult(added, updated, removed);
        });
  }

  /** 저장된 값과 새 행이 같은가 — 해시는 장 제목·라벨·제목·본문만 덮으므로 장 id·대상·순서를 따로 견준다. */
  private static boolean unchanged(StoredMeta old, SectionRow r) {
    return old.contentHash().equals(r.contentHash())
        && old.ord() == r.ord()
        && old.chapter().equals(r.chapter())
        && old.audience().equals(r.audience());
  }

  /**
   * 임베딩이 빈 절을 최대 max 개 채운다(채운 수). 워커 호출은 트랜잭션 밖에서 한다. 한 건이 실패해도 건너뛰고 나머지를 이어 시도한다 — 한 행이 계속 거절당해도 뒤
   * 행이 영영 굶지 않게. 실패한 행은 비어 있어 다음 refresh 가 다시 시도한다. 채운 수는 실제로 쓴 행만 센다.
   */
  public int embedMissing(int max) {
    if (!embedder.enabled()) return 0;
    int filled = 0;
    for (SectionRow r : repo.missingEmbedding(max)) {
      Optional<float[]> v = embedder.embedDocument(embedText(r));
      if (v.isEmpty()) continue;
      if (repo.saveEmbedding(r.sectionId(), r.contentHash(), v.get()) > 0) filled++;
    }
    return filled;
  }

  /** 임베딩 문서 = 장 제목 › 라벨 / 제목 / 본문, 2000자까지(서로게이트 쌍 한가운데서 자르지 않는다 — Texts.headUtf16). */
  static String embedText(SectionRow r) {
    String t = r.chapterTitle() + " › " + r.label() + "\n" + r.title() + "\n" + r.body();
    return Texts.headUtf16(t, EMBED_MAX_CHARS);
  }

  /** 묶음 → 행 목록. 본문은 평문으로, 빈 label 은 title 로, ord 는 장 순서 x 1000 + 절 순서. */
  private static List<SectionRow> toRows(HelpBundle bundle) {
    List<SectionRow> rows = new ArrayList<>();
    List<HelpBundle.Chapter> chapters = bundle.chapters();
    for (int ci = 0; ci < chapters.size(); ci++) {
      HelpBundle.Chapter c = chapters.get(ci);
      List<HelpBundle.Section> sections = c.sections() == null ? List.of() : c.sections();
      for (int si = 0; si < sections.size(); si++) {
        HelpBundle.Section s = sections.get(si);
        String label = s.label() == null || s.label().isBlank() ? s.title() : s.label();
        String body = HelpMarkdownText.toPlain(s.markdown());
        rows.add(
            new SectionRow(
                s.id(),
                c.chapter(),
                c.title(),
                s.title(),
                label,
                c.audience() == null ? List.of() : c.audience(),
                body,
                CapabilityTokens.sha256Hex(c.title() + "|" + label + "|" + s.title() + "|" + body),
                ci * 1000 + si));
      }
    }
    return rows;
  }
}
