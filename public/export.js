// تصدير الامتحان لـ Word (للطباعة) والدرجات لـ Excel — من غير أي مكتبات خارجية
(function (root) {
  'use strict';

  /* ---------------- ZIP بسيط (من غير ضغط) ---------------- */
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
  })();
  function crc32(buf) { let c = 0xFFFFFFFF; for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  const utf8 = s => new TextEncoder().encode(s);

  function zip(files) {
    const parts = [], central = [];
    let offset = 0;
    const d = new Date();
    const dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    files.forEach(f => {
      const name = utf8(f.name);
      const data = typeof f.data === 'string' ? utf8(f.data) : f.data;
      const crc = crc32(data);
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
      lh.setUint16(10, dosTime, true); lh.setUint16(12, dosDate, true); lh.setUint32(14, crc, true);
      lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
      parts.push(new Uint8Array(lh.buffer), name, data);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true);
      ch.setUint16(12, dosTime, true); ch.setUint16(14, dosDate, true); ch.setUint32(16, crc, true);
      ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true); ch.setUint16(28, name.length, true);
      ch.setUint16(30, 0, true); ch.setUint16(32, 0, true); ch.setUint16(34, 0, true); ch.setUint16(36, 0, true); ch.setUint32(38, 0, true);
      ch.setUint32(42, offset, true);
      central.push(new Uint8Array(ch.buffer), name);
      offset += 30 + name.length + data.length;
    });
    const cdSize = central.reduce((a, p) => a + p.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
    const all = parts.concat(central, [new Uint8Array(end.buffer)]);
    const out = new Uint8Array(all.reduce((a, p) => a + p.length, 0));
    let p = 0; all.forEach(x => { out.set(x, p); p += x.length; });
    return out;
  }

  const xml = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

  /* ---------------- Word ---------------- */
  // أسماء الخطوط زي ما هي متسطّبة على الويندوز (عشان الكلام القبطي يظهر صح في Word)
  const WORD_FONTS = { ath: 'Athanasius', newath: 'New Athanasius', cs: 'CS New Athanasius', shen: 'Avva_Shenouda' };
  const AR_FONT = 'Arial';
  const LETTERS = ['أ', 'ب', 'ج', 'د', 'هـ', 'و', 'ز', 'ح', 'ط', 'ي'];

  function segments(str) {   // [ath]..[/ath] → [{text, font}]
    const out = [];
    const re = /\[(ath|newath|cs|shen)\]([\s\S]*?)\[\/\1\]/gi;
    let last = 0, m;
    str = String(str || '');
    while ((m = re.exec(str))) {
      if (m.index > last) out.push({ text: str.slice(last, m.index) });
      out.push({ text: m[2], font: WORD_FONTS[m[1].toLowerCase()] });
      last = re.lastIndex;
    }
    if (last < str.length) out.push({ text: str.slice(last) });
    return out;
  }

  function run(text, o) {
    o = o || {};
    if (!text) return '';
    const props = [];
    if (o.font) props.push('<w:rFonts w:ascii="' + xml(o.font) + '" w:hAnsi="' + xml(o.font) + '" w:cs="' + xml(o.font) + '"/>');
    else props.push('<w:rFonts w:ascii="' + AR_FONT + '" w:hAnsi="' + AR_FONT + '" w:cs="' + AR_FONT + '"/>');
    if (o.bold) props.push('<w:b/><w:bCs/>');
    if (o.color) props.push('<w:color w:val="' + o.color + '"/>');
    const sz = o.font ? (o.size || 28) + 4 : (o.size || 28);
    props.push('<w:sz w:val="' + sz + '"/><w:szCs w:val="' + sz + '"/>');
    if (!o.font) props.push('<w:rtl/>');
    return '<w:r><w:rPr>' + props.join('') + '</w:rPr><w:t xml:space="preserve">' + xml(text) + '</w:t></w:r>';
  }
  const richRuns = (str, o) => segments(str).map(s => run(s.text, Object.assign({}, o, s.font ? { font: s.font } : {}))).join('');

  function para(content, o) {
    o = o || {};
    const pp = ['<w:bidi/>'];
    if (o.align) pp.push('<w:jc w:val="' + o.align + '"/>');
    pp.push('<w:spacing w:before="' + (o.before || 0) + '" w:after="' + (o.after == null ? 80 : o.after) + '"/>');
    if (o.indent) pp.push('<w:ind w:start="' + o.indent + '"/>');
    if (o.keepNext) pp.push('<w:keepNext/>');
    if (o.border) pp.push('<w:pBdr><w:bottom w:val="single" w:sz="8" w:space="4" w:color="8F6D25"/></w:pBdr>');
    return '<w:p><w:pPr>' + pp.join('') + '</w:pPr>' + content + '</w:p>';
  }

  function drawing(rid, n, wPx, hPx, maxEmu) {
    let cx = Math.round(wPx * 9525), cy = Math.round(hPx * 9525);
    if (cx > maxEmu) { cy = Math.round(cy * maxEmu / cx); cx = maxEmu; }
    const maxH = 3600000;
    if (cy > maxH) { cx = Math.round(cx * maxH / cy); cy = maxH; }
    return '<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="' + cx + '" cy="' + cy + '"/>' +
      '<wp:docPr id="' + n + '" name="صورة ' + n + '"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>' +
      '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic>' +
      '<pic:nvPicPr><pic:cNvPr id="' + n + '" name="image' + n + '"/><pic:cNvPicPr/></pic:nvPicPr>' +
      '<pic:blipFill><a:blip r:embed="' + rid + '"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
      '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + cx + '" cy="' + cy + '"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>' +
      '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>';
  }

  // getImage(id) → { bytes: Uint8Array, width, height, ext: 'jpeg'|'png'|'gif' } أو null
  async function buildDocx({ exam, questions, withAnswers, school, getImage }) {
    const media = [], rels = [];
    let imgN = 0;
    async function image(id, maxEmu) {
      if (!id || !getImage) return '';
      let im = null;
      try { im = await getImage(id); } catch (e) {}
      if (!im) return '';
      imgN++;
      const rid = 'rIdImg' + imgN, file = 'image' + imgN + '.' + im.ext;
      media.push({ name: 'word/media/' + file, data: im.bytes, ext: im.ext });
      rels.push('<Relationship Id="' + rid + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/' + file + '"/>');
      return drawing(rid, imgN, im.width, im.height, maxEmu);
    }

    const total = questions.reduce((a, q) => a + Number(q.points || 0), 0);
    const body = [];
    body.push(para(run(school || '', { bold: true, size: 26, color: '6B1F14' }), { align: 'center', after: 40 }));
    body.push(para(richRuns(exam.title + (withAnswers ? ' — نموذج الإجابة' : ''), { bold: true, size: 36, color: '6B1F14' }), { align: 'center', after: 120 }));
    if (!withAnswers) {
      body.push(para(run('الاسم: ............................................................', { size: 26 }) , { after: 60 }));
      body.push(para(run('الدرجة: ........ / ' + total + '        الزمن: ' + exam.minutes + ' دقيقة', { size: 26 }), { after: 120, border: true }));
    } else {
      body.push(para(run('الدرجة الكلية: ' + total + '        الزمن: ' + exam.minutes + ' دقيقة', { size: 26 }), { after: 120, border: true }));
    }

    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      const pts = Number(q.points || 0);
      body.push(para(run((i + 1) + ') ', { bold: true, color: '6B1F14' }) + richRuns(q.text, { bold: true }) +
        run('   (' + pts + (pts === 1 ? ' درجة' : ' درجات') + ')', { size: 22, color: '8F6D25' }), { before: 200, after: 80, keepNext: true }));
      if (q.image) { const d = await image(q.image, 4800000); if (d) body.push(para(d, { align: 'center', keepNext: true })); }
      if (q.type === 'multi') body.push(para(run('(اختار كل الإجابات الصحيحة)', { size: 22, color: '8F6D25' }), { indent: 360, keepNext: true }));
      if (q.type === 'text') {
        if (withAnswers) {
          const ans = (q.answer || []).map(String);
          let runs = run('الإجابة: ', { bold: true, color: '2E7D32' });
          ans.forEach((a, k) => { if (k) runs += run(' أو ', { color: '2E7D32' }); runs += richRuns(a, { bold: true, color: '2E7D32' }); });
          body.push(para(runs, { indent: 360 }));
        } else {
          body.push(para(run('..............................................................................................', { color: '999999' }), { indent: 360, before: 120 }));
          body.push(para(run('..............................................................................................', { color: '999999' }), { indent: 360, before: 120 }));
        }
      } else {
        const correct = new Set((q.answer || []).map(Number));
        for (let j = 0; j < q.choices.length; j++) {
          const c = q.choices[j];
          const ok = withAnswers && correct.has(j + 1);
          const o = ok ? { bold: true, color: '2E7D32' } : {};
          let content = run((ok ? '✔ ' : '') + (LETTERS[j] || (j + 1)) + ') ', Object.assign({ bold: true }, o)) + richRuns(c.text || '', o);
          body.push(para(content, { indent: 360, after: 40 }));
          if (c.image) { const d = await image(c.image, 2400000); if (d) body.push(para(d, { indent: 720 })); }
        }
      }
    }

    const doc = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
      'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
      'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
      'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>' + body.join('') +
      '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1000" w:right="1000" w:bottom="1000" w:left="1000" w:header="500" w:footer="500" w:gutter="0"/><w:bidi/></w:sectPr>' +
      '</w:body></w:document>';
    const styles = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr>' +
      '<w:rFonts w:ascii="' + AR_FONT + '" w:hAnsi="' + AR_FONT + '" w:cs="' + AR_FONT + '"/><w:sz w:val="28"/><w:szCs w:val="28"/><w:lang w:val="ar-EG" w:bidi="ar-EG"/>' +
      '</w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:bidi/></w:pPr></w:pPrDefault></w:docDefaults>' +
      '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>';
    const exts = [...new Set(media.map(m => m.ext))];
    const types = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
      exts.map(e => '<Default Extension="' + e + '" ContentType="image/' + e + '"/>').join('') +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>';
    const rootRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>';
    const docRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' + rels.join('') + '</Relationships>';
    return zip([
      { name: '[Content_Types].xml', data: types },
      { name: '_rels/.rels', data: rootRels },
      { name: 'word/document.xml', data: doc },
      { name: 'word/styles.xml', data: styles },
      { name: 'word/_rels/document.xml.rels', data: docRels }
    ].concat(media));
  }

  /* ---------------- Excel ---------------- */
  function colName(n) { let s = ''; n++; while (n) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }

  // rows: مصفوفة صفوف، أول صف العناوين. القيم: رقم أو نص
  function buildXlsx({ sheetName, title, header, rows, widths }) {
    const allRows = [];
    if (title) allRows.push({ cells: [title], style: 2 });
    allRows.push({ cells: header, style: 1 });
    rows.forEach(r => allRows.push({ cells: r, style: 0 }));
    const sheetRows = allRows.map((r, ri) => '<row r="' + (ri + 1) + '">' + r.cells.map((v, ci) => {
      const ref = colName(ci) + (ri + 1);
      const s = r.style ? ' s="' + r.style + '"' : '';
      if (typeof v === 'number' && isFinite(v)) return '<c r="' + ref + '"' + s + '><v>' + v + '</v></c>';
      if (v == null || v === '') return '';
      return '<c r="' + ref + '"' + s + ' t="inlineStr"><is><t xml:space="preserve">' + xml(v) + '</t></is></c>';
    }).join('') + '</row>').join('');
    const cols = (widths || []).map((w, i) => '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>').join('');
    const headerRow = title ? 2 : 1;
    const sheet = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheetViews><sheetView workbookViewId="0" rightToLeft="1"><pane ySplit="' + headerRow + '" topLeftCell="A' + (headerRow + 1) + '" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
      (cols ? '<cols>' + cols + '</cols>' : '') + '<sheetData>' + sheetRows + '</sheetData>' +
      (rows.length ? '<autoFilter ref="A' + headerRow + ':' + colName(header.length - 1) + (headerRow + rows.length) + '"/>' : '') +
      '</worksheet>';
    const styles = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<fonts count="3"><font><sz val="11"/><name val="Arial"/></font><font><b/><sz val="11"/><color rgb="FF6B1F14"/><name val="Arial"/></font><font><b/><sz val="14"/><color rgb="FF6B1F14"/><name val="Arial"/></font></fonts>' +
      '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF3E7C9"/><bgColor indexed="64"/></patternFill></fill></fills>' +
      '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      '<cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"><alignment vertical="top" wrapText="1"/></xf>' +
      '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>' +
      '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
    const name = xml(String(sheetName || 'النتائج').replace(/[\\/?*\[\]:]/g, ' ').slice(0, 31));
    return zip([
      { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>' },
      { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
      { name: 'xl/workbook.xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        '<bookViews><workbookView/></bookViews><sheets><sheet name="' + name + '" sheetId="1" r:id="rId1"/></sheets>' +
        (rows.length ? '<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">\'' + name + '\'!$A$' + headerRow + ':$' + colName(header.length - 1) + '$' + (headerRow + rows.length) + '</definedName></definedNames>' : '') +
        '</workbook>' },
      { name: 'xl/_rels/workbook.xml.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>' },
      { name: 'xl/worksheets/sheet1.xml', data: sheet },
      { name: 'xl/styles.xml', data: styles }
    ]);
  }

  const api = { zip, buildDocx, buildXlsx };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ExamExport = api;
})(typeof window !== 'undefined' ? window : globalThis);
