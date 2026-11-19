package com.workplace.wiki.service;

import com.workplace.global.util.AppWebLinks;
import com.workplace.wiki.dto.WikiPageCard;
import com.workplace.wiki.dto.WikiRecentPageItem;
import com.workplace.wiki.dto.WikiRecentPageResponse;
import com.workplace.wiki.repository.WikiPageActivityRepository;
import com.workplace.wiki.repository.WikiPageActivityRepository.ActivityRow;
import com.workplace.wiki.repository.WikiPageActivityRepository.Cursor;
import com.workplace.wiki.repository.WikiPageRepository;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 노트 「최근」(WP-1764) — 내가 열거나 고친 노트를 공간을 가로질러 최근 순으로 쪽 단위로 준다. 휴지통은 없고 삭제는 CASCADE 라 기록도 같이 사라진다. 읽기
 * 권한은 목록을 읽을 때마다 {@link WikiPageReadAccess} 로 다시 거른다(기록은 권한을 주지 않는다). 거르면 쪽이 짧아지므로 묶음을 더 읽어 채운다.
 */
@Service
@RequiredArgsConstructor
public class WikiRecentService {
  /** 한 쪽 크기이자 요청 limit 의 상한(기본값도 같다). */
  public static final int PAGE_SIZE = 50;

  /** 한 번에 읽는 기록 묶음 크기 — 거를 것을 감안해 쪽보다 넉넉히 읽는다. */
  private static final int BATCH = 100;

  private final WikiPageActivityRepository activities;
  private final WikiPageReadAccess readAccess;
  private final WikiPageRepository pages;
  private final AppWebLinks webLinks;

  /**
   * 내 최근 한 쪽. limit 은 1~50 으로 자른다(null 이면 50). 기록을 묶음으로 읽어 읽을 수 있는 노트만 모으고, limit 만큼 차면 멈춘다.
   * nextCursor 는 마지막으로 <b>돌려준</b> 줄 기준이라 거른 줄이 건너뛰어지거나 되풀이되지 않고, 그 뒤에 기록이 더 남았을 때만 채운다.
   *
   * <p>해석할 수 없는 커서는 첫 쪽으로 되돌리지 않고 400(IllegalArgumentException)이다 — 조용히 첫 쪽을 주면 무한 스크롤이 같은 쪽을 반복해
   * 붙일 수 있다.
   */
  @Transactional(readOnly = true)
  public WikiRecentPageResponse list(long userId, String cursor, Integer limit) {
    int size = limit == null ? PAGE_SIZE : Math.max(1, Math.min(limit, PAGE_SIZE));
    Cursor after = decode(cursor);
    List<Picked> picked = new ArrayList<>();
    while (true) {
      // size 가 아니라 BATCH+1 줄을 읽어, 덤 한 줄로 이 묶음 뒤에 기록이 더 있는지 알아낸다.
      List<ActivityRow> fetched = activities.listForUser(userId, after, BATCH + 1);
      boolean hasMoreRows = fetched.size() > BATCH;
      List<ActivityRow> rows = hasMoreRows ? fetched.subList(0, BATCH) : fetched;
      if (rows.isEmpty()) {
        break;
      }
      Map<Long, WikiPageCard> readable =
          readAccess.readableCards(userId, rows.stream().map(ActivityRow::pageId).toList());
      for (int i = 0; i < rows.size(); i++) {
        ActivityRow r = rows.get(i);
        WikiPageCard card = readable.get(r.pageId());
        if (card == null) {
          continue;
        }
        picked.add(new Picked(r, card));
        if (picked.size() == size) {
          // 이 묶음에 더 남았거나, 묶음이 끝났어도 뒤에 기록이 있으면 다음 쪽이 있다.
          boolean more = i + 1 < rows.size() || hasMoreRows;
          return build(picked, more ? encode(r) : null);
        }
      }
      if (!hasMoreRows) {
        break; // 기록이 더 없다.
      }
      after = cursorOf(rows.get(rows.size() - 1));
    }
    return build(picked, null);
  }

  /** 읽을 수 있어 거르고 남은 기록 한 줄과 그 노트 카드. */
  private record Picked(ActivityRow row, WikiPageCard card) {}

  /** 거른 줄들로 응답을 만든다 — 조상 제목은 쪽 전체를 쿼리 한 번으로 채운다. */
  private WikiRecentPageResponse build(List<Picked> picked, String next) {
    Map<Long, List<String>> chains =
        pages.ancestorTitleChains(picked.stream().map(p -> p.row().pageId()).toList());
    List<WikiRecentPageItem> items = new ArrayList<>();
    for (Picked p : picked) {
      ActivityRow r = p.row();
      WikiPageCard c = p.card();
      items.add(
          new WikiRecentPageItem(
              r.pageId(),
              c.title(),
              c.spaceId(),
              c.spaceName(),
              chains.getOrDefault(r.pageId(), List.of()),
              r.lastAction().name(),
              r.lastAt(),
              webLinks.wikiPage(c.spaceId(), r.pageId())));
    }
    return new WikiRecentPageResponse(items, next);
  }

  private static Cursor cursorOf(ActivityRow r) {
    return new Cursor(r.lastAt(), r.id());
  }

  /** 커서 = lastAt 의 epoch 마이크로초 + "_" + id 를 base64url(패딩 없음). 마이크로초라야 DB 시각과 한 틱도 어긋나지 않는다. */
  static String encode(ActivityRow last) {
    Instant t = last.lastAt().toInstant();
    long micros = t.getEpochSecond() * 1_000_000L + t.getNano() / 1000;
    String raw = micros + "_" + last.id();
    return Base64.getUrlEncoder()
        .withoutPadding()
        .encodeToString(raw.getBytes(StandardCharsets.UTF_8));
  }

  /** 커서 해석. null·빈 값이면 첫 쪽(null), 깨졌으면 IllegalArgumentException(400). */
  static Cursor decode(String cursor) {
    if (cursor == null || cursor.isBlank()) {
      return null;
    }
    try {
      String raw = new String(Base64.getUrlDecoder().decode(cursor), StandardCharsets.UTF_8);
      int sep = raw.indexOf('_');
      long micros = Long.parseLong(raw.substring(0, sep));
      long id = Long.parseLong(raw.substring(sep + 1));
      OffsetDateTime at =
          Instant.ofEpochSecond(
                  Math.floorDiv(micros, 1_000_000L), Math.floorMod(micros, 1_000_000L) * 1000)
              .atOffset(ZoneOffset.UTC);
      return new Cursor(at, id);
    } catch (RuntimeException e) {
      throw new IllegalArgumentException("잘못된 cursor 입니다.");
    }
  }
}
