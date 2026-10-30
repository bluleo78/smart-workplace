// 매뉴얼 시드가 올리는 작은 가상 파일(PDF·PNG)을 그 자리에서 만든다(WP-1197).
// 저장소에 바이너리를 두지 않고, 실제 문서·사진을 쓰지 않기 위해서다. 외부 라이브러리 없이 node:zlib 만 쓴다.
import { crc32, deflateSync } from 'node:zlib'; // crc32: PNG 청크 검사값(Node 22.2+)

/**
 * 한 쪽짜리 PDF — 제목 한 줄과 본문 몇 줄(ASCII, 기본 글꼴 Helvetica). xref 오프셋을 계산해 미리보기·본문 추출이 되는 올바른 파일을 만든다.
 * @param {string[]} lines 쪽에 찍을 줄(첫 줄은 크게)
 * @returns {Buffer}
 */
export function makePdf(lines) {
  const esc = (t) => t.replace(/[\\()]/g, (c) => `\\${c}`);
  const text = lines
    .map((t, i) => (i === 0 ? `BT /F1 18 Tf 72 760 Td (${esc(t)}) Tj ET` : `BT /F1 11 Tf 72 ${730 - i * 18} Td (${esc(t)}) Tj ET`))
    .join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((o, i) => {
    offsets.push(Buffer.byteLength(out));
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((n) => `${String(n).padStart(10, '0')} 00000 n \n`).join('');
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

/**
 * 단색 바탕에 가로 띠 하나를 그린 RGB PNG — 썸네일에서 「그림」으로 보일 만큼의 크기.
 * @param {{ width?: number, height?: number, bg?: number[], band?: number[] }} opts 색은 [r, g, b]
 * @returns {Buffer}
 */
export function makePng({ width = 320, height = 200, bg = [238, 242, 255], band = [79, 70, 229] } = {}) {
  const row = 1 + width * 3; // 각 줄 앞의 필터 바이트(0) + RGB
  const raw = Buffer.alloc(row * height);
  for (let y = 0; y < height; y++) {
    const color = y > height * 0.4 && y < height * 0.6 ? band : bg;
    for (let x = 0; x < width; x++) raw.set(color, y * row + 1 + x * 3);
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 2, 0, 0, 0], 8); // 8비트, 트루컬러, 압축·필터·인터레이스 기본
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
