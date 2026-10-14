package com.workplace.fileai.dto;

/**
 * 모델 입력용으로 그린 첨부 이미지(WP-250).
 *
 * @param data 이미지 바이트(PNG 또는 JPEG)
 * @param contentType "image/png" 또는 "image/jpeg"
 * @param pageCount PDF 전체 쪽수 — 이미지이거나 아직 모르면 null
 */
public record ViewImage(byte[] data, String contentType, Integer pageCount) {}
