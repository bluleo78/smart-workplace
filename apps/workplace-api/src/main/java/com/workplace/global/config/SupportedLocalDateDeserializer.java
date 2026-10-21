package com.workplace.global.config;

import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.databind.DeserializationContext;
import com.fasterxml.jackson.databind.JsonDeserializer;
import com.fasterxml.jackson.datatype.jsr310.deser.LocalDateDeserializer;
import com.workplace.global.exception.UnsupportedDateException;
import com.workplace.global.time.SupportedDates;
import java.io.IOException;
import java.time.LocalDate;
import org.springframework.boot.jackson.JsonComponent;

/**
 * 요청 본문의 모든 LocalDate 를 지원 범위(1900-01-01 ~ 9999-12-31)로 제한한다(WP-725). 이슈 마감·시작일, 마일스톤, 사이클 등 DTO 마다
 * 검사를 두지 않아도 한 곳에서 같은 규칙이 걸린다. 해석 자체는 기본 ISO 해석기에 맡기고 결과만 검사한다 — 범위를 벗어나면 {@link
 * UnsupportedDateException} 이 원인으로 실린 400 이 된다(GlobalExceptionHandler).
 */
@JsonComponent
public class SupportedLocalDateDeserializer extends JsonDeserializer<LocalDate> {

  @Override
  public LocalDate deserialize(JsonParser p, DeserializationContext ctxt) throws IOException {
    LocalDate date = LocalDateDeserializer.INSTANCE.deserialize(p, ctxt);
    if (date != null && !SupportedDates.isSupported(date)) {
      throw new UnsupportedDateException();
    }
    return date;
  }

  @Override
  public Class<?> handledType() {
    return LocalDate.class;
  }
}
