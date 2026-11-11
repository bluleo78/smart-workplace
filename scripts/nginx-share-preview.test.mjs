// 공유 링크 미리보기 SSI 설정의 글자 검사(WP-1473) — `node --test scripts/nginx-share-preview.test.mjs`
// 노트(/wiki/share/…)·드라이브(/s/sl_…) 공유 링크가 같은 index.html block 두 개를 SSI 로 바꿔 끼운다. 실제 응답은 nginx 컨테이너로 확인했고,
// 여기서는 location·변수·내부 하위 요청 설정이 서로 맞물리는지(한쪽만 고쳐 어긋나는 일)를 설정 글자로 막는다.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { locationBody, readWebNginxConf } from './nginx-conf-test-utils.mjs'

// 저장소 루트 — 실행 위치(cwd)와 상관없이 파일을 찾는다(다른 scripts/*.test.mjs 와 같은 방식).
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const conf = readWebNginxConf()
const html = readFileSync(path.join(root, 'apps/workplace-web/index.html'), 'utf8')

const drive = locationBody(conf, (h) => h.includes('/s/'))
const wiki = locationBody(conf, (h) => h.includes('/wiki/share/'))
const shareImage = locationBody(conf, (h) => h === '= /__share-image')
const shareMeta = locationBody(conf, (h) => h === '= /__share-meta')

test('/s/sl_ location 이 SSI 를 켜고 드라이브 preview-meta 주소를 변수로 정한다', () => {
  assert.ok(drive, '/s/ location 이 없다')
  assert.match(conf, /location\s+~\s+\^\/s\/\(\?<drive_share_token>sl_\[A-Za-z0-9_-\]\+\)/)
  assert.match(drive, /\bssi\s+on;/)
  assert.match(drive, /set\s+\$share_meta_uri\s+\/api\/v1\/public\/drive\/share\/\$drive_share_token\/preview-meta;/)
  assert.match(drive, /set\s+\$share_image_uri\s+\/api\/v1\/public\/drive\/share\/\$drive_share_token\/preview-meta\?part=image;/)
  assert.match(drive, /try_files\s+\/index\.html\s+=404;/)
  assert.match(drive, /add_header\s+X-Robots-Tag\s+"noindex, nofollow"\s+always;/)
  assert.match(drive, /add_header\s+Cache-Control\s+"no-cache";/)
})

test('노트 location 이 메타 주소를 정하고 그림 주소는 비워 공통 그림을 쓴다', () => {
  assert.ok(wiki, '노트 location 이 없다')
  assert.match(wiki, /\bssi\s+on;/)
  assert.match(wiki, /set\s+\$share_meta_uri\s+\/api\/v1\/public\/wiki\/shares\/\$wiki_share_token\/preview-meta\?pageId=\$wiki_share_page;/)
  assert.match(wiki, /set\s+\$share_image_uri\s+"";/)
})

test('/__share-meta 는 internal 이고 $share_meta_uri 로 프록시한다', () => {
  assert.ok(shareMeta, '/__share-meta 가 없다')
  assert.match(shareMeta, /\binternal;/)
  assert.match(shareMeta, /proxy_pass\s+http:\/\/workplace_api\$share_meta_uri;/)
  assert.doesNotMatch(conf, /__wiki-share-meta/)
})

test('/__share-image 는 internal 이고, 주소가 비면 204 이며, 호스트 자리표시를 스스로 바꾼다', () => {
  assert.ok(shareImage, '/__share-image 가 없다')
  assert.match(shareImage, /\binternal;/)
  assert.match(shareImage, /if\s*\(\$share_image_uri\s*=\s*""\)\s*\{\s*return\s+204;\s*\}/)
  assert.match(shareImage, /proxy_pass\s+http:\/\/workplace_api\$share_image_uri;/)
  assert.match(shareImage, /sub_filter\s+'__PUBLIC_HOST__'\s+'\$host';/)
  assert.match(shareImage, /sub_filter_once\s+off;/)
})

test('index.html 의 include 두 개가 stub 으로 공통 block 을 쓴다', () => {
  assert.match(html, /<!--# include virtual="\/__share-meta" stub="common_meta" wait="yes" -->/)
  assert.match(html, /<!--# include virtual="\/__share-image" stub="common_image" wait="yes" -->/)
  assert.match(html, /<!--# block name="common_meta" -->/)
  assert.match(html, /<!--# block name="common_image" -->/)
})
