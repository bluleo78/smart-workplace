package com.workplace.messaging.service;

import com.workplace.global.ai.AiMemoryLine;
import com.workplace.messaging.outbound.dto.CatchupSummarizeResult;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.stereotype.Component;

/**
 * 캐치업 AI 요약 인메모리 캐시. 키 = (메모리 지문, channelId, watermark, maxMessageId). channelId 가 공유 DB 전역 유일이라
 * 테넌트 안전(내 차례는 별도 계산). 비영속·재생성 가능하므로 마이그레이션/DB 불필요. TTL 10분, 최대 500 엔트리.
 *
 * <p>WP-381: 요약에 요청자 메모리가 실리므로 사용자 id 대신 실린 메모리 줄의 지문(SHA-256)을 키에 둔다. A 의 메모리로 만든 요약은 메모리 줄이 완전히
 * 같지 않으면(메모리 id 포함 — 다른 사용자끼리는 사실상 메모리가 없을 때뿐) B 에게 나가지 않고, 메모리가 없는 사용자끼리는 같은 요약을 다시 함께 쓴다. 메모리를
 * 고치면 지문이 바뀌어 캐시를 쓰지 않는다. 충돌로 남의 요약이 나가지 않게 32비트 해시가 아닌 SHA-256 을 쓰고, 필드는 길이를 붙여 이어 붙여(구분자 섞임 없음)
 * 서로 다른 목록이 같은 바이트가 되지 않게 한다.
 */
@Component
public class CatchupSummaryCache {
  private static final Duration TTL = Duration.ofMinutes(10);
  private static final int MAX_ENTRIES = 500;

  /** 메모리가 없을 때(꺼짐·조회 실패 포함)의 지문 — 16진 SHA-256 과 겹치지 않는 고정값. */
  private static final String NO_MEMORY = "none";

  private record Key(String memoryFingerprint, long channelId, long watermark, long maxMessageId) {}

  private record Entry(CatchupSummarizeResult value, Instant expiresAt) {}

  private final Map<Key, Entry> map = new ConcurrentHashMap<>();
  private final Clock clock;

  public CatchupSummaryCache() {
    this(Clock.systemUTC());
  }

  public CatchupSummaryCache(Clock clock) {
    this.clock = clock;
  }

  /** 같은 메모리·채널·미읽음 구간의 유효 요약. 없거나 TTL 이 지났으면 null. */
  public CatchupSummarizeResult get(
      List<AiMemoryLine> memories, long channelId, long watermark, long maxMessageId) {
    Key key = new Key(fingerprint(memories), channelId, watermark, maxMessageId);
    var e = map.get(key);
    if (e == null) {
      return null;
    }
    if (clock.instant().isAfter(e.expiresAt())) {
      map.remove(key);
      return null;
    }
    return e.value();
  }

  /** 그 메모리로 만든 요약을 TTL 과 함께 저장한다. 상한에 닿으면 전부 비운다. */
  public void put(
      List<AiMemoryLine> memories,
      long channelId,
      long watermark,
      long maxMessageId,
      CatchupSummarizeResult value) {
    if (map.size() >= MAX_ENTRIES) {
      map.clear(); // 단순 상한 — 캐치업은 재생성 저렴.
    }
    map.put(
        new Key(fingerprint(memories), channelId, watermark, maxMessageId),
        new Entry(value, clock.instant().plus(TTL)));
  }

  /**
   * 메모리 줄 목록의 지문 — 빈 목록이면 {@link #NO_MEMORY}, 아니면 줄마다 id·종류·내용·범위·기한·고정(WP-383)을 차례로 넣은
   * SHA-256(16진).
   */
  static String fingerprint(List<AiMemoryLine> memories) {
    if (memories == null || memories.isEmpty()) {
      return NO_MEMORY;
    }
    MessageDigest md = sha256();
    for (AiMemoryLine m : memories) {
      field(md, Long.toString(m.id()));
      field(md, m.kind());
      field(md, m.content());
      field(md, m.scope());
      field(md, m.expiresOn());
      field(md, Boolean.TRUE.equals(m.pinned()) ? "1" : null);
    }
    return HexFormat.of().formatHex(md.digest());
  }

  /** 필드 하나 — null 표시(0) 또는 표시(1) + 바이트 길이 + UTF-8 바이트. null 과 빈 문자열, 필드 경계가 섞이지 않는다. */
  private static void field(MessageDigest md, String v) {
    if (v == null) {
      md.update((byte) 0);
      return;
    }
    byte[] b = v.getBytes(StandardCharsets.UTF_8);
    md.update((byte) 1);
    md.update(ByteBuffer.allocate(Integer.BYTES).putInt(b.length).array());
    md.update(b);
  }

  private static MessageDigest sha256() {
    try {
      return MessageDigest.getInstance("SHA-256");
    } catch (NoSuchAlgorithmException e) {
      throw new IllegalStateException("SHA-256 을 쓸 수 없어요", e); // 모든 JVM 이 제공해야 하는 알고리즘이라 오지 않는다.
    }
  }
}
