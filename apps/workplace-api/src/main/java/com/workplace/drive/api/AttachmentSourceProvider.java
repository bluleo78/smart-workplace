// AttachmentSourceProvider.java — 가상 첨부 뷰 SPI (직접 업로드 첨부 노출)
package com.workplace.drive.api;

import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.format.DateTimeParseException;
import java.util.List;
import org.jooq.Condition;
import org.jooq.Field;
import org.jooq.SortField;
import org.jooq.impl.DSL;

/**
 * 내가 접근 가능한 이슈·이슈챗·메시지·노트의 첨부와 내 메일의 첨부를 제공(「첨부 모아보기」). 각 도메인이 구현 — drive 가 다른 도메인을 import 하지 않게
 * SPI 로 뒤집는다.
 */
public interface AttachmentSourceProvider {
  /** 출처 종류. "ISSUE" | "CHAT_MESSAGE"(이슈챗) | "MESSAGE" | "WIKI"(노트) | "MAIL". */
  String sourceType();

  /**
   * callerId 가 접근 가능한 첨부를 (attachedAt desc, {@link Entry#sortId()} desc) 로 limit+1 개까지(다음 페이지 판단용).
   * 구현은 커서 조건을 {@link Cursor#after(Cursor, String, Field, Field)}, 정렬을 {@link Cursor#order} 로 만든다 —
   * 같은 시각의 첨부(한 메일의 첨부 여러 개 등)가 페이지 경계에서 빠지거나 겹치지 않게(WP-1392).
   *
   * @param q 파일명 부분일치(null=전체)
   * @param cursor 이 위치 「다음」(더 오래된 쪽)부터. null=최신부터
   */
  List<Entry> list(long callerId, String q, Cursor cursor, int limit);

  /**
   * callerId 가 fileId(file 행 id)에 접근할 수 있는지 확인. 해당 파일이 caller 가 접근 가능한 소스(이슈/메시지/노트 등)에 첨부된 경우
   * true. importAttachment 인가 검증용 — file 행이 없는 출처(MAIL)는 항상 false 여야 한다(다른 id 공간의 값으로 진짜 file 을
   * 인가하지 않게).
   */
  boolean canAccessFile(long callerId, long fileId);

  /**
   * 가상 첨부 한 건.
   *
   * @param fileId file 행 id. file 행이 없는 출처(MAIL)는 null
   * @param kind 출처 안의 세부 종류 — 이슈 본문 이미지면 {@code "BODY_IMAGE"}, 그 밖은 null. 드라이브로 가져올 수 있는지는 fileId
   *     유무로 정해진다(file 행이 있어야 가져온다)
   * @param mailAttachmentId MAIL 전용 — 메일 첨부 내려받기 엔드포인트가 받는 email_attachment.id. 그 밖은 null
   */
  record Entry(
      Long fileId,
      String name,
      String mimeType,
      long sizeBytes,
      boolean hasThumbnail,
      String sourceLabel,
      String deepLink,
      String downloadUrl,
      Instant attachedAt,
      String kind,
      Long mailAttachmentId) {

    /**
     * 같은 출처 안에서 유일한 정렬 보조 키(WP-1392) — 같은 attachedAt 끼리의 순서를 고정해 커서가 경계의 첨부를 빠뜨리지 않게 한다. file 행이 있는
     * 출처는 file id(각 첨부 표의 PK 가 file_id 라 출처 안에서 유일), MAIL 은 email_attachment.id.
     */
    public long sortId() {
      return fileId != null ? fileId : mailAttachmentId;
    }

    /** file 행을 가진 일반 첨부(가져오기 가능, 세부 종류 없음) — 기존 출처들이 쓰는 형태. */
    public Entry(
        long fileId,
        String name,
        String mimeType,
        long sizeBytes,
        boolean hasThumbnail,
        String sourceLabel,
        String deepLink,
        String downloadUrl,
        Instant attachedAt) {
      this(
          fileId,
          name,
          mimeType,
          sizeBytes,
          hasThumbnail,
          sourceLabel,
          deepLink,
          downloadUrl,
          attachedAt,
          null,
          null);
    }
  }

  /**
   * 「첨부 모아보기」 커서(WP-1392) — 마지막으로 받은 행의 (attachedAt, sourceType, sortId). 전체 순서는 (attachedAt desc,
   * sourceType desc, sortId desc) 이고, 커서 「다음」은 이 순서에서 커서보다 뒤에 오는 행이다. 시각만으로 자르면(예전 커서) 같은 시각의 행 중
   * 다음 페이지 몫이 통째로 빠졌다.
   *
   * <p>문자열 형식: {@code <ISO-8601 instant>~<sourceType>~<sortId>}. 예전 형식(ISO-8601 instant 만)도 받는다 —
   * 그때는 sourceType 이 null 이고 「그 시각보다 엄격히 이전」으로 읽는다(예전 동작 그대로). 웹은 이 값을 해석하지 않고 그대로 돌려준다.
   *
   * @param sourceType null 이면 예전 커서(시각만)
   */
  record Cursor(Instant at, String sourceType, long sortId) {

    private static final char SEP = '~';

    /**
     * 문자열 커서 해석. null 이면 null. 형식이 틀리면 IllegalArgumentException(전역 핸들러가 400) — 문구는 채널 메시지 목록의 잘못된
     * 커서 응답과 같다(WP-668).
     */
    public static Cursor parse(String raw) {
      if (raw == null) return null;
      try {
        int first = raw.indexOf(SEP);
        if (first < 0) {
          // 예전 커서 — 시각만
          return new Cursor(Instant.parse(raw), null, 0L);
        }
        int second = raw.indexOf(SEP, first + 1);
        if (second < 0) throw new IllegalArgumentException("목록 위치(cursor)가 올바르지 않습니다");
        String type = raw.substring(first + 1, second);
        if (type.isEmpty()) throw new IllegalArgumentException("목록 위치(cursor)가 올바르지 않습니다");
        return new Cursor(
            Instant.parse(raw.substring(0, first)),
            type,
            Long.parseLong(raw.substring(second + 1)));
      } catch (DateTimeParseException | NumberFormatException e) {
        throw new IllegalArgumentException("목록 위치(cursor)가 올바르지 않습니다", e);
      }
    }

    /** 문자열 형식으로 — {@link #parse} 의 역. */
    public String encode() {
      return sourceType == null ? at.toString() : at.toString() + SEP + sourceType + SEP + sortId;
    }

    /**
     * 출처 mySourceType 의 행 중 cursor 「다음」인 행의 조건 — cursor 가 null(첫 페이지)이면 조건 없음. time·sortId 는 그 출처가
     * {@link #order} 에 넘기는 시각 식과 sortId 컬럼이어야 한다(식이 갈리면 페이지가 어긋난다).
     *
     * <ul>
     *   <li>예전 커서(sourceType null): time &lt; at
     *   <li>내 출처가 커서 출처보다 앞(문자열로 작음 — desc 정렬에서 뒤에 옴): time &lt;= at
     *   <li>내 출처가 커서 출처보다 뒤: time &lt; at
     *   <li>같은 출처: time &lt; at 또는 (time = at 이고 sortId &lt; 커서 sortId)
     * </ul>
     */
    public static Condition after(
        Cursor cursor, String mySourceType, Field<OffsetDateTime> time, Field<Long> sortIdField) {
      if (cursor == null) return DSL.noCondition();
      OffsetDateTime t = cursor.at().atOffset(ZoneOffset.UTC);
      if (cursor.sourceType() == null) return time.lt(t);
      int cmp = mySourceType.compareTo(cursor.sourceType());
      if (cmp < 0) return time.le(t);
      if (cmp > 0) return time.lt(t);
      return time.lt(t).or(time.eq(t).and(sortIdField.lt(cursor.sortId())));
    }

    /** 한 출처 안의 행 순서 — (time desc, sortId desc). {@link #after} 와 같은 식을 넘겨야 커서와 맞는다. */
    public static List<SortField<?>> order(Field<OffsetDateTime> time, Field<Long> sortIdField) {
      return List.of(time.desc(), sortIdField.desc());
    }
  }
}
