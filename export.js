/* Agenda Trajets - exports (xlsx, pdf) and backup encryption. No external library. */
const Exporter = (() => {
  const enc = new TextEncoder();

  /* ---------- ZIP (stored) + CRC32, used by xlsx ---------- */
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }
  function zip(files) { // files: [{name, data(Uint8Array)}]
    const parts = [], central = [];
    let offset = 0;
    const u16 = v => [v & 255, (v >>> 8) & 255];
    const u32 = v => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];
    for (const f of files) {
      const name = enc.encode(f.name), crc = crc32(f.data), size = f.data.length;
      const local = new Uint8Array([0x50,0x4b,3,4, ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21),
        ...u32(crc), ...u32(size), ...u32(size), ...u16(name.length), ...u16(0)]);
      parts.push(local, name, f.data);
      central.push({ name, crc, size, offset });
      offset += local.length + name.length + size;
    }
    const cdStart = offset;
    for (const c of central) {
      const h = new Uint8Array([0x50,0x4b,1,2, ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21),
        ...u32(c.crc), ...u32(c.size), ...u32(c.size), ...u16(c.name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
        ...u32(0), ...u32(c.offset)]);
      parts.push(h, c.name);
      offset += h.length + c.name.length;
    }
    const end = new Uint8Array([0x50,0x4b,5,6, ...u16(0), ...u16(0), ...u16(central.length), ...u16(central.length),
      ...u32(offset - cdStart), ...u32(cdStart), ...u16(0)]);
    parts.push(end);
    return new Blob(parts, { type: 'application/zip' });
  }

  /* ---------- XLSX ---------- */
  const xmlEsc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const colName = i => { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
  // sheet: {name, widths:[..], rows:[[cell,...]]} ; cell: string | number | {v, bold, num}
  function sheetXml(sh) {
    let x = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">';
    if (sh.widths) x += '<cols>' + sh.widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('') + '</cols>';
    x += '<sheetData>';
    sh.rows.forEach((row, r) => {
      x += `<row r="${r + 1}">`;
      row.forEach((cell, c) => {
        if (cell === null || cell === undefined || cell === '') return;
        const ref = colName(c) + (r + 1);
        const o = typeof cell === 'object' ? cell : { v: cell };
        const style = o.bold ? 1 : (o.num ? 2 : 0);
        if (typeof o.v === 'number') x += `<c r="${ref}" s="${style}"><v>${o.v}</v></c>`;
        else x += `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xmlEsc(o.v)}</t></is></c>`;
      });
      x += '</row>';
    });
    return x + '</sheetData></worksheet>';
  }
  function xlsx(sheets) {
    const stylesXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
      '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
      '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      '<cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
      '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
      '<xf numFmtId="2" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>' +
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
    const files = [
      { name: '[Content_Types].xml', data: enc.encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') + '</Types>') },
      { name: '_rels/.rels', data: enc.encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>') },
      { name: 'xl/workbook.xml', data: enc.encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
        sheets.map((s, i) => `<sheet name="${xmlEsc(s.name.slice(0, 31))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') + '</sheets></workbook>') },
      { name: 'xl/_rels/workbook.xml.rels', data: enc.encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
        `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`) },
      { name: 'xl/styles.xml', data: enc.encode(stylesXml) }
    ];
    sheets.forEach((s, i) => files.push({ name: `xl/worksheets/sheet${i + 1}.xml`, data: enc.encode(sheetXml(s)) }));
    const blob = zip(files);
    return new Blob([blob], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }

  /* ---------- PDF (Helvetica, WinAnsi) ---------- */
  const CP1252 = { '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85, '†': 0x86, '‡': 0x87, 'ˆ': 0x88, '‰': 0x89, 'Š': 0x8a, '‹': 0x8b, 'Œ': 0x8c, 'Ž': 0x8e,
    '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, '˜': 0x98, '™': 0x99, 'š': 0x9a, '›': 0x9b, 'œ': 0x9c, 'ž': 0x9e, 'Ÿ': 0x9f };
  function toWin(s) {
    let out = '';
    for (const ch of String(s)) {
      const cp = ch.codePointAt(0);
      if (CP1252[ch] !== undefined) out += String.fromCharCode(CP1252[ch]);
      else if (cp < 256) out += ch;
      else if (ch === '→') out += '>';
      else out += '?';
    }
    return out;
  }
  const pdfEsc = s => s.replace(/[\\()]/g, m => '\\' + m);
  function textWidth(s, size) { // rough Helvetica metrics
    let w = 0;
    for (const ch of toWin(s)) {
      if ('il.,;:\'|!'.includes(ch)) w += 0.25;
      else if ('fjrt() -/'.includes(ch)) w += 0.33;
      else if ('mwMW'.includes(ch)) w += 0.8;
      else if (ch >= '0' && ch <= '9') w += 0.556;
      else if (ch >= 'A' && ch <= 'Z') w += 0.68;
      else w += 0.53;
    }
    return w * size;
  }
  function fit(s, width, size) {
    s = String(s);
    if (textWidth(s, size) <= width) return s;
    while (s.length > 1 && textWidth(s + '…', size) > width) s = s.slice(0, -1);
    return s + '…';
  }
  /* doc: {title, subtitle, blocks:[{heading?, columns:[{label,w,align}], rows:[[..]], bold?:[rowIdx]}], footer}
     columns widths are relative weights; table spans page width. */
  function pdf(doc) {
    const W = 595, H = 842, M = 40, usable = W - 2 * M;
    const pages = [];
    let ops = [], y = 0;
    const newPage = () => { if (ops.length) pages.push(ops.join('\n')); ops = []; y = H - M; };
    const text = (s, x, yy, size, bold) => ops.push(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${x.toFixed(1)} ${yy.toFixed(1)} Td (${pdfEsc(toWin(s))}) Tj ET`);
    const line = (x1, y1, x2, y2, gray) => ops.push(`${gray} G 0.5 w ${x1} ${y1} m ${x2} ${y2} l S`);
    newPage();
    text(doc.title, M, y - 14, 16, true); y -= 24;
    if (doc.subtitle) { text(doc.subtitle, M, y - 8, 10, false); y -= 18; }
    for (const b of doc.blocks) {
      if (b.heading) {
        if (y < M + 60) newPage();
        y -= 8; text(b.heading, M, y - 10, 12, true); y -= 20;
      }
      const total = b.columns.reduce((a, c) => a + c.w, 0);
      const cols = []; let cx = M;
      b.columns.forEach(c => { const w = usable * c.w / total; cols.push({ x: cx, w, align: c.align || 'left', label: c.label }); cx += w; });
      const header = () => {
        cols.forEach(c => { const lab = fit(c.label, c.w - 6, 9); const tx = c.align === 'right' ? c.x + c.w - 3 - textWidth(lab, 9) : c.x + 3; text(lab, tx, y - 9, 9, true); });
        y -= 14; line(M, y, W - M, y, 0.4);
      };
      if (y < M + 50) newPage();
      header();
      b.rows.forEach((row, ri) => {
        if (y < M + 20) { newPage(); header(); }
        const bold = b.bold && b.bold.includes(ri);
        row.forEach((cell, ci) => {
          const c = cols[ci], s = fit(cell, c.w - 6, 9);
          const tx = c.align === 'right' ? c.x + c.w - 3 - textWidth(s, 9) : c.x + 3;
          text(s, tx, y - 9, 9, bold);
        });
        y -= 13; line(M, y, W - M, y, 0.9);
      });
      y -= 6;
    }
    if (doc.footer) { if (y < M + 14) newPage(); text(doc.footer, M, M - 12, 8, false); }
    pages.push(ops.join('\n'));
    // assemble
    const objs = [];
    const add = s => { objs.push(s); return objs.length; };
    const catalog = add('<< /Type /Catalog /Pages 2 0 R >>');
    add(''); // pages placeholder (obj 2)
    const f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    const f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    const kids = [];
    pages.forEach(content => {
      const cId = add(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
      const pId = add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${cId} 0 R >>`);
      kids.push(pId + ' 0 R');
    });
    objs[1] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${kids.length} >>`;
    let out = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
    const offsets = [];
    objs.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
    const xref = out.length;
    out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('');
    out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF`;
    const bytes = new Uint8Array(out.length);
    for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 255;
    return new Blob([bytes], { type: 'application/pdf' });
  }

  /* ---------- Backup encryption (AES-GCM, PBKDF2) ---------- */
  const b64 = buf => { let s = ''; const b = new Uint8Array(buf); for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); };
  const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  async function deriveKey(pwd, salt) {
    const base = await crypto.subtle.importKey('raw', enc.encode(pwd), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 200000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  async function encryptJson(obj, pwd) {
    const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(pwd, salt);
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(obj)));
    return { app: 'agenda-trajets', encrypted: true, v: 1, salt: b64(salt), iv: b64(iv), data: b64(ct) };
  }
  async function decryptJson(wrapper, pwd) {
    const key = await deriveKey(pwd, unb64(wrapper.salt));
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(wrapper.iv) }, key, unb64(wrapper.data));
    return JSON.parse(new TextDecoder().decode(pt));
  }

  return { xlsx, pdf, encryptJson, decryptJson, crc32, textWidth };
})();
