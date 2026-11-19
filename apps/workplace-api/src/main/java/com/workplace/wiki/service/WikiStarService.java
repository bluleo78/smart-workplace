package com.workplace.wiki.service;

import com.workplace.global.util.AppWebLinks;
import com.workplace.wiki.dto.WikiPageCard;
import com.workplace.wiki.dto.WikiStarredIdsResponse;
import com.workplace.wiki.dto.WikiStarredPageItem;
import com.workplace.wiki.dto.WikiStarredPageResponse;
import com.workplace.wiki.exception.WikiPageNotFoundException;
import com.workplace.wiki.repository.WikiPageRepository;
import com.workplace.wiki.repository.WikiPageStarRepository;
import com.workplace.wiki.repository.WikiPageStarRepository.Cursor;
import com.workplace.wiki.repository.WikiPageStarRepository.StarRow;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 노트 페이지 「즐겨찾기」(WP-1765) — 내가 즐겨찾기한 노트를 공간을 가로질러 즐겨찾기한 순으로 쪽 단위로 준다. 넣을 때는 읽을 수 있는 노트만 받고, 목록을 읽을
 * 때마다 {@link WikiPageReadAccess} 로 다시 거른다(기록은 권한을 주지 않는다). 거르면 쪽이 짧아지므로 묶음을 더 읽어 채운다. 목록 루프·커서는
 * {@link WikiRecentService} 와 같은 방식이다(행 타입이 달라 공용화하지 않았다).
 */
@Service
@RequiredArgsConstructor
public class WikiStarService {
  /** 한 쪽 크기이자 요청 limit 의 상한(기본값도 같다). */
  public static final int PAGE_SIZE = 50;

  /** 한 번에 읽는 기록 묶음 크기 — 거를 것을 감안해 쪽보다 넉넉히 읽는다. */
  private static final int BATCH = 100;

  /**
   * 한 요청이 훑는 묶음 수의 상한 — 즐겨찾기는 사람당 개수 제한이 없어, 읽을 수 없게 된 줄이 수천 개면 쪽이 찰 때까지 표 전체를 훑게 된다. 상한에 닿으면 모은
   * 만큼만 돌려주고 nextCursor 를 마지막 <b>훑은</b> 줄로 두어 클라이언트가 이어 받게 한다.
   */
  static final int MAX_BATCHES = 10;

  private final WikiPageStarRepository stars;
  private final WikiPageReadAccess readAccess;
  private final WikiPageRepository pages;
  private final AppWebLinks webLinks;

  /** 즐겨찾기 넣기(멱등). 없거나 읽을 수 없는 노트는 같은 404(WikiPageNotFoundException)로 거절해 존재 여부를 드러내지 않는다. */
  @Transactional
  public void star(long userId, long pageId) {
    readAccess.requireReadable(userId, pageId);
    try {
      stars.star(userId, pageId);
    } catch (DataIntegrityViolationException e) {
      // 읽기 확인과 넣기 사이에 노트가 지워지면 FK 위반이 난다 — 500 대신 없는 노트와 같은 404 로 답한다.
      throw new WikiPageNotFoundException(pageId);
    }
  }

  /** 즐겨찾기 빼기(멱등). 내 행만 지우므로 읽기 권한을 따지지 않는다 — 공간을 나간 뒤에도 정리할 수 있어야 한다. */
  @Transactional
  public void unstar(long userId, long pageId) {
    stars.unstar(userId, pageId);
  }

  /** 내가 즐겨찾기한 노트 id 전부(거르지 않음). */
  @Transactional(readOnly = true)
  public WikiStarredIdsResponse ids(long userId) {
    return new WikiStarredIdsResponse(stars.pageIdsForUser(userId));
  }

  /**
   * 내 즐겨찾기 한 쪽. limit 은 1~50 으로 자른다(null 이면 50). 묶음으로 읽어 읽을 수 있는 노트만 모으고, limit 만큼 차면 멈춘다.
   * nextCursor 는 마지막으로 <b>돌려준</b> 줄 기준이라 거른 줄이 건너뛰어지거나 되풀이되지 않고, 그 뒤에 행이 더 남았을 때만 채운다.
   *
   * <p>해석할 수 없는 커서는 첫 쪽으로 되돌리지 않고 400(IllegalArgumentException)이다.
   */
  @Transactional(readOnly = true)
  public WikiStarredPageResponse list(long userId, String cursor, Integer limit) {
    return list(userId, cursor, limit, BATCH, MAX_BATCHES);
  }

  /**
   * {@link #list(long, String, Integer)} 의 본체 — 묶음 크기·훑기 상한을 받는다. 통합 테스트가 작은 값으로 상한 동작을 보려고 열어 둔
   * 것이라 운영 코드는 공개 메서드만 부른다. 상한(maxBatches)에 닿았는데 행이 더 남았으면 모은 만큼과 마지막 훑은 줄의 커서를 돌려준다(쪽이 비거나 짧아도
   * 된다).
   */
  public WikiStarredPageResponse list(
      long userId, String cursor, Integer limit, int batch, int maxBatches) {
    int size = limit == null ? PAGE_SIZE : Math.max(1, Math.min(limit, PAGE_SIZE));
    Cursor after = decode(cursor);
    List<Picked> picked = new ArrayList<>();
    int scanned = 0;
    while (true) {
      // batch+1 줄을 읽어, 덤 한 줄로 이 묶음 뒤에 행이 더 있는지 알아낸다.
      List<StarRow> fetched = stars.listForUser(userId, after, batch + 1);
      boolean hasMoreRows = fetched.size() > batch;
      List<StarRow> rows = hasMoreRows ? fetched.subList(0, batch) : fetched;
      if (rows.isEmpty()) {
        break;
      }
      Map<Long, WikiPageCard> readable =
          readAccess.readableCards(userId, rows.stream().map(StarRow::pageId).toList());
      for (int i = 0; i < rows.size(); i++) {
        StarRow r = rows.get(i);
        WikiPageCard card = readable.get(r.pageId());
        if (card == null) {
          continue;
        }
        picked.add(new Picked(r, card));
        if (picked.size() == size) {
          // 이 묶음에 더 남았거나, 묶음이 끝났어도 뒤에 행이 있으면 다음 쪽이 있다.
          boolean more = i + 1 < rows.size() || hasMoreRows;
          return build(picked, more ? encode(r) : null);
        }
      }
      if (!hasMoreRows) {
        break; // 행이 더 없다.
      }
      StarRow last = rows.get(rows.size() - 1);
      scanned++;
      if (scanned >= maxBatches) {
        // 상한 — 더 훑지 않고 지금까지 모은 것을 돌려준다. 커서는 돌려준 줄이 아니라 마지막 훑은 줄이라 거른 줄을 다시 훑지 않는다.
        return build(picked, encode(last));
      }
      after = new Cursor(last.createdAt(), last.id());
    }
    return build(picked, null);
  }

  /** 읽을 수 있어 거르고 남은 즐겨찾기 한 줄과 그 노트 카드. */
  private record Picked(StarRow row, WikiPageCard card) {}

  /** 거른 줄들로 응답을 만든다 — 조상 제목은 쪽 전체를 쿼리 한 번으로 채운다. */
  private WikiStarredPageResponse build(List<Picked> picked, String next) {
    Map<Long, List<String>> chains =
        pages.ancestorTitleChains(picked.stream().map(p -> p.row().pageId()).toList());
    List<WikiStarredPageItem> items = new ArrayList<>();
    for (Picked p : picked) {
      StarRow r = p.row();
      WikiPageCard c = p.card();
      items.add(
          new WikiStarredPageItem(
              r.pageId(),
              c.title(),
              c.spaceId(),
              c.spaceName(),
              chains.getOrDefault(r.pageId(), List.of()),
              r.createdAt(),
              webLinks.wikiPage(c.spaceId(), r.pageId())));
    }
    return new WikiStarredPageResponse(items, next);
  }

  /** 커서 = createdAt 의 epoch 마이크로초 + "_" + id 를 base64url(패딩 없음). 마이크로초라야 DB 시각과 한 틱도 어긋나지 않는다. */
  static String encode(StarRow last) {
    Instant t = last.createdAt().toInstant();
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
