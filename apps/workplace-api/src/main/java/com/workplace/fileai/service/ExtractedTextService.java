package com.workplace.fileai.service;

import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.FILE_EXTRACTION;

import com.workplace.fileai.dto.ExtractedTextSlice;
import com.workplace.fileai.dto.ExtractionInfo;
import com.workplace.fileai.exception.InvalidTextRangeException;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.function.BiFunction;
import java.util.function.Function;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.jooq.Field;
import org.jooq.Record;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 추출 텍스트 공용 읽기(WP-242) — 첨부 목록의 extraction 블록과 글자 구간 읽기.
 *
 * <p>권한은 판정하지 않는다. 호출하는 도메인 엔드포인트가 "이 사용자가 이 대상을 볼 수 있고, fileId 가 그 대상의 첨부인지"를 먼저 확인한다. 자르기는
 * SQL(substr/char_length)로 한다 — 워커(Python len)와 Postgres 는 코드포인트 기준이고 Java String 은 UTF-16 기준이라
 * Java 에서 자르면 이모지 등 서로게이트 쌍에서 offset 이 어긋난다.
 */
@Service
@RequiredArgsConstructor
public class ExtractedTextService {

  /** 구간 읽기 상한 — WP-232 메시지당 128k 토큰의 1/4 = 32k 토큰을 한글 1자=1토큰으로 보수 환산. */
  public static final int MAX_LIMIT = 32_000;

  private final DSLContext dsl;

  /** 목록용 일괄 조회(텍스트 본문은 읽지 않는다). 추출 행이 없는 fileId 는 결과 맵에 없다. */
  @Transactional(readOnly = true)
  public Map<Long, ExtractionInfo> info(Collection<Long> fileIds) {
    Map<Long, ExtractionInfo> out = new HashMap<>();
    if (fileIds == null || fileIds.isEmpty()) return out;
    Field<Boolean> hasText = DSL.field(FILE_EXTRACTION.EXTRACTED_TEXT.isNotNull()).as("has_text");
    dsl.select(
            FILE_EXTRACTION.FILE_ID,
            FILE_EXTRACTION.STATUS,
            FILE_EXTRACTION.ERROR,
            FILE_EXTRACTION.CHAR_COUNT,
            FILE_EXTRACTION.TRUNCATED,
            FILE.MIME_TYPE,
            hasText)
        .from(FILE_EXTRACTION)
        .join(FILE)
        .on(FILE.ID.eq(FILE_EXTRACTION.FILE_ID))
        .where(FILE_EXTRACTION.FILE_ID.in(fileIds))
        .forEach(
            r ->
                out.put(
                    r.get(FILE_EXTRACTION.FILE_ID),
                    toInfo(
                        r,
                        r.get(FILE_EXTRACTION.CHAR_COUNT),
                        Boolean.TRUE.equals(r.get(hasText)))));
    return out;
  }

  /**
   * 목록 항목에 추출 상태를 붙여 돌려준다 — 도메인별 첨부 목록의 "info 조회 + NONE 기본값" 중복을 모은 공용 헬퍼.
   *
   * <p>info() 를 한 번만 호출(쿼리 1회)하고, 추출 행이 없는 항목(배포 전 첨부)은 {@link ExtractionInfo#NONE} 으로 채운다.
   *
   * @param fileId 항목에서 코어 file.id 를 꺼내는 함수
   * @param withExtraction 항목에 추출 정보를 붙인 사본을 만드는 함수
   */
  @Transactional(readOnly = true)
  public <T> List<T> attach(
      List<T> items, Function<T, Long> fileId, BiFunction<T, ExtractionInfo, T> withExtraction) {
    if (items.isEmpty()) return List.of();
    Map<Long, ExtractionInfo> infos = info(items.stream().map(fileId).toList());
    return items.stream()
        .map(i -> withExtraction.apply(i, infos.getOrDefault(fileId.apply(i), ExtractionInfo.NONE)))
        .toList();
  }

  /**
   * info()/read() 공용 변환 — status/error/truncated/mime 컬럼을 가진 조회 행을 외부 계약({@link ExtractionInfo})으로
   * 바꾼다.
   *
   * @param totalChars 전체 글자 수(info 는 char_count 컬럼, read 는 SQL char_length)
   * @param hasText extracted_text 가 null 이 아닌지
   */
  private static ExtractionInfo toInfo(Record r, Integer totalChars, boolean hasText) {
    return ExtractionInfo.of(
        r.get(FILE_EXTRACTION.STATUS),
        r.get(FILE_EXTRACTION.ERROR),
        r.get(FILE.MIME_TYPE),
        totalChars,
        r.get(FILE_EXTRACTION.TRUNCATED),
        hasText);
  }

  /**
   * 글자 구간 읽기. limit 은 {@link #MAX_LIMIT} 로 클램프한다.
   *
   * @throws InvalidTextRangeException offset &lt; 0 또는 limit &lt; 1
   */
  @Transactional(readOnly = true)
  public ExtractedTextSlice read(long fileId, int offset, int limit) {
    if (offset < 0) throw new InvalidTextRangeException("offset 은 0 이상이어야 합니다.");
    if (limit < 1) throw new InvalidTextRangeException("limit 은 1 이상이어야 합니다.");
    int lim = Math.min(limit, MAX_LIMIT);

    Field<Integer> total = DSL.charLength(FILE_EXTRACTION.EXTRACTED_TEXT).as("total_chars");
    // SQL substr 은 1부터 센다.
    Field<String> slice =
        DSL.substring(FILE_EXTRACTION.EXTRACTED_TEXT, DSL.val(offset + 1), DSL.val(lim))
            .as("slice");
    var r =
        dsl.select(
                FILE_EXTRACTION.STATUS,
                FILE_EXTRACTION.ERROR,
                FILE_EXTRACTION.TRUNCATED,
                FILE.MIME_TYPE,
                total,
                slice)
            .from(FILE)
            .leftJoin(FILE_EXTRACTION)
            .on(FILE_EXTRACTION.FILE_ID.eq(FILE.ID))
            .where(FILE.ID.eq(fileId))
            .fetchOne();

    Integer totalChars = r == null ? null : r.get(total);
    ExtractionInfo info =
        r == null ? ExtractionInfo.NONE : toInfo(r, totalChars, totalChars != null);
    if (!"READY".equals(info.status())) {
      return new ExtractedTextSlice(
          fileId, info.status(), offset, null, null, null, null, info.reasonCode(), info.reason());
    }
    String text = Objects.requireNonNullElse(r.get(slice), "");
    int returned = text.codePointCount(0, text.length());
    int end = offset + returned;
    Integer next = returned > 0 && end < totalChars ? end : null;
    return new ExtractedTextSlice(
        fileId, "READY", offset, totalChars, info.truncated(), next, text, null, null);
  }
}
