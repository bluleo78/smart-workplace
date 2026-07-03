package com.workplace.auth.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;

/** Task10 — 등록 전/후 공통 모델 프로브 요청. providerConfig.options.baseURL/apiKey 는 컨트롤러가 검증한다. */
public record ProbeModelsRequest(@NotNull @Valid ProviderConfig providerConfig) {}
