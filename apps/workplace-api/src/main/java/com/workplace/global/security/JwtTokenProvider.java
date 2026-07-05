package com.workplace.global.security;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.JwtException;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import java.util.Base64;
import java.util.Date;
import java.util.UUID;
import javax.crypto.SecretKey;
import org.springframework.stereotype.Component;

@Component
public class JwtTokenProvider {

  private final SecretKey key;
  private final long accessExpiration;
  private final long refreshExpiration;

  public JwtTokenProvider(JwtProperties jwtProperties) {
    byte[] keyBytes = Base64.getDecoder().decode(jwtProperties.secret());
    if (keyBytes.length < 32) {
      throw new IllegalStateException("JWT secret must be at least 256 bits (32 bytes)");
    }
    this.key = Keys.hmacShaKeyFor(keyBytes);
    this.accessExpiration = jwtProperties.accessExpiration();
    this.refreshExpiration = jwtProperties.refreshExpiration();
  }

  /** tenant 가 null 이면 pre-auth(테넌트 미선택) 토큰. */
  public String generateAccessToken(Long userId, String username, Long tenantId) {
    Date now = new Date();
    var builder =
        Jwts.builder()
            .id(UUID.randomUUID().toString()) // jti — 같은 초 내 재발급이어도 토큰 바이트가 항상 달라지도록 함(#686)
            .subject(userId.toString())
            .claim("username", username)
            .claim("type", "access")
            .issuedAt(now)
            .expiration(new Date(now.getTime() + accessExpiration));
    if (tenantId != null) {
      builder.claim("tenant", tenantId);
    }
    return builder.signWith(key).compact();
  }

  /** 하위호환 — pre-auth(테넌트 미선택) 토큰. */
  public String generateAccessToken(Long userId, String username) {
    return generateAccessToken(userId, username, null);
  }

  public String generateRefreshToken(Long userId, Long tenantId) {
    Date now = new Date();
    var builder =
        Jwts.builder()
            .id(
                UUID.randomUUID()
                    .toString()) // jti — 같은 초 내 재로그인 시 refresh_token.token_hash 유니크 충돌 방지(#686)
            .subject(userId.toString())
            .claim("type", "refresh")
            .issuedAt(now)
            .expiration(new Date(now.getTime() + refreshExpiration));
    if (tenantId != null) {
      builder.claim("tenant", tenantId);
    }
    return builder.signWith(key).compact();
  }

  /** 하위호환. */
  public String generateRefreshToken(Long userId) {
    return generateRefreshToken(userId, null);
  }

  /** 플랫폼(운영자) access 토큰 — tenant 없음, platform=true 클레임. */
  public String generatePlatformAccessToken(Long userId, String username) {
    Date now = new Date();
    return Jwts.builder()
        .id(UUID.randomUUID().toString()) // jti — 동일 초 재발급 시 토큰 충돌 방지(#686)
        .subject(userId.toString())
        .claim("username", username)
        .claim("type", "access")
        .claim("platform", true)
        .issuedAt(now)
        .expiration(new Date(now.getTime() + accessExpiration))
        .signWith(key)
        .compact();
  }

  /** 플랫폼 refresh 토큰 — platform=true 클레임. */
  public String generatePlatformRefreshToken(Long userId) {
    Date now = new Date();
    return Jwts.builder()
        .id(UUID.randomUUID().toString()) // jti — 동일 초 재발급 시 refresh_token 충돌 방지(#686)
        .subject(userId.toString())
        .claim("type", "refresh")
        .claim("platform", true)
        .issuedAt(now)
        .expiration(new Date(now.getTime() + refreshExpiration))
        .signWith(key)
        .compact();
  }

  /** platform 클레임이 true 인 토큰인지. 일반 테넌트 토큰/파싱 실패는 false. */
  public boolean isPlatformToken(String token) {
    try {
      Object p = parseClaims(token).get("platform");
      return Boolean.TRUE.equals(p);
    } catch (JwtException | IllegalArgumentException e) {
      return false;
    }
  }

  /** active-tenant. pre-auth 토큰이면 null. */
  public Long getTenantIdFromToken(String token) {
    Object t = parseClaims(token).get("tenant");
    return t == null ? null : ((Number) t).longValue();
  }

  public Long getUserIdFromToken(String token) {
    String subject = parseClaims(token).getSubject();
    return Long.parseLong(subject);
  }

  public boolean validateToken(String token) {
    try {
      parseClaims(token);
      return true;
    } catch (JwtException | IllegalArgumentException e) {
      return false;
    }
  }

  public boolean validateAccessToken(String token) {
    try {
      Claims claims = parseClaims(token);
      return "access".equals(claims.get("type", String.class));
    } catch (JwtException | IllegalArgumentException e) {
      return false;
    }
  }

  public boolean validateRefreshToken(String token) {
    try {
      Claims claims = parseClaims(token);
      return "refresh".equals(claims.get("type", String.class));
    } catch (JwtException | IllegalArgumentException e) {
      return false;
    }
  }

  private Claims parseClaims(String token) {
    return Jwts.parser().verifyWith(key).build().parseSignedClaims(token).getPayload();
  }
}
