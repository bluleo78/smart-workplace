package com.workplace.global.config;

import com.workplace.global.exception.UnsupportedDateException;
import com.workplace.global.time.SupportedDates;
import java.time.LocalDate;
import org.springframework.boot.jackson.JacksonComponent;
import tools.jackson.core.JsonParser;
import tools.jackson.databind.DeserializationContext;
import tools.jackson.databind.ValueDeserializer;
import tools.jackson.databind.ext.javatime.deser.LocalDateDeserializer;

/**
 * 요청 본문의 모든 LocalDate 를 지원 범위(1900-01-01 ~ 9999-12-31)로 제한한다(WP-725). 이슈 마감·시작일, 마일스톤, 사이클 등 DTO 마다
 * 검사를 두지 않아도 한 곳에서 같은 규칙이 걸린다. 해석 자체는 기본 ISO 해석기에 맡기고 결과만 검사한다 — 범위를 벗어나면 {@link
 * UnsupportedDateException} 이 원인으로 실린 400 이 된다(GlobalExceptionHandler).
 *
 * <p>Jackson 3(WP-1609)에서는 java.time 해석기가 databind 에 내장돼 있어 그 기본 해석기({@code ext.javatime})를 그대로
 * 부르고, Boot 의 {@code @JacksonComponent} 로 Boot 매퍼에 등록한다.
 */
@JacksonComponent
public class SupportedLocalDateDeserializer extends ValueDeserializer<LocalDate> {

  @Override
  public LocalDate deserialize(JsonParser p, DeserializationContext ctxt) {
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
