// Builds the downloadable PDF report with pdfmake. Loaded on demand (with pdfmake and its fonts) when the student downloads.
(() => {
  const ACCENT = '#0d6e6e';
  const INK = '#17202e';
  const MUTED = '#5d6b7e';
  const LINE = '#dbe1ea';
  const SOFT = '#dff1f0';
  const WIDTH = 516; // content width on US Letter with 48pt side margins

  const LOGO =
    '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M20 17H4M4 17L8 13M4 17L8 21M4 7H20M20 7L16 3M20 7L16 11" stroke="#0d6e6e" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&#x27;': "'", '&nbsp;': ' ' };
  const decode = (s) => s.replace(/&(amp|lt|gt|quot|nbsp|#39|#x27);/g, (m) => ENTITIES[m] ?? m);
  const stripTags = (s) => decode(s.replace(/<[^>]*>/g, ''));

  // Inline markdown tokens to pdfmake text runs.
  function runs(tokens, style = {}) {
    const out = [];
    for (const t of tokens || []) {
      switch (t.type) {
        case 'strong': out.push(...runs(t.tokens, { ...style, bold: true })); break;
        case 'em': out.push(...runs(t.tokens, { ...style, italics: true })); break;
        case 'del': out.push(...runs(t.tokens, { ...style, decoration: 'lineThrough' })); break;
        case 'codespan': out.push({ ...style, text: decode(t.text), background: '#eef1f5' }); break;
        case 'br': out.push({ ...style, text: '\n' }); break;
        case 'link':
          if (/^https?:\/\//i.test(t.href)) out.push(...runs(t.tokens, { ...style, color: ACCENT, decoration: 'underline', link: t.href }));
          else out.push(...runs(t.tokens, style));
          break;
        case 'image': break;
        case 'html': out.push({ ...style, text: stripTags(t.raw || '') }); break;
        case 'escape': out.push({ ...style, text: t.text }); break;
        default:
          if (t.tokens) out.push(...runs(t.tokens, style));
          else out.push({ ...style, text: decode(t.text ?? t.raw ?? '') });
      }
    }
    return out;
  }

  const plain = (tokens) => runs(tokens).map((r) => r.text).join('');

  // Relative column widths from the amount of text each column holds, as percentages that sum to 100.
  function columnWidths(header, rows) {
    const cols = header.length;
    const weight = Array.from({ length: cols }, (_, c) => {
      const lens = [header[c], ...rows.map((r) => r[c])].map((cell) => (cell ? plain(cell.tokens).length : 0));
      const avg = lens.reduce((a, b) => a + b, 0) / lens.length;
      return Math.min(Math.max(avg, 10), 90);
    });
    const total = weight.reduce((a, b) => a + b, 0);
    return weight.map((w) => `${((w / total) * 100).toFixed(1)}%`);
  }

  const headingStyle = (depth) => (depth <= 1 ? 'h2' : depth === 2 ? 'h3' : 'h4');

  // Block markdown tokens to pdfmake content.
  function blocks(tokens) {
    const out = [];
    for (const t of tokens || []) {
      switch (t.type) {
        case 'space': break;
        case 'heading': out.push({ text: runs(t.tokens), style: headingStyle(t.depth) }); break;
        case 'paragraph': out.push({ text: runs(t.tokens), margin: [0, 0, 0, 6] }); break;
        case 'text': out.push({ text: t.tokens ? runs(t.tokens) : decode(t.text || ''), margin: [0, 0, 0, 2] }); break;
        case 'hr': out.push({ canvas: [{ type: 'line', x1: 0, y1: 0, x2: WIDTH, y2: 0, lineWidth: 0.6, lineColor: LINE }], margin: [0, 8, 0, 8] }); break;
        case 'code': out.push({ text: t.text, fontSize: 9, background: '#eef1f5', margin: [0, 2, 0, 8], preserveLeadingSpaces: true }); break;
        case 'html': { const txt = stripTags(t.raw || '').trim(); if (txt) out.push({ text: txt, margin: [0, 0, 0, 6] }); break; }
        case 'list': {
          const items = t.items.map((it) => ({ stack: blocks(it.tokens) }));
          out.push(t.ordered ? { ol: items, start: Number(t.start) || 1, margin: [0, 0, 0, 6] } : { ul: items, margin: [0, 0, 0, 6] });
          break;
        }
        case 'blockquote':
          out.push({
            table: { widths: ['*'], body: [[{ stack: blocks(t.tokens), italics: true }]] },
            layout: { hLineWidth: () => 0, vLineWidth: (i) => (i === 0 ? 3 : 0), vLineColor: () => ACCENT, paddingLeft: () => 10, paddingRight: () => 4, paddingTop: () => 2, paddingBottom: () => 2 },
            margin: [0, 2, 0, 8],
          });
          break;
        case 'table': {
          const head = t.header.map((c) => ({ text: runs(c.tokens, { bold: true }), fillColor: SOFT, fontSize: 9 }));
          const body = t.rows.map((r) => r.map((c) => ({ text: runs(c.tokens), fontSize: 9 })));
          out.push({
            table: { headerRows: 1, widths: columnWidths(t.header, t.rows), body: [head, ...body] },
            layout: { hLineWidth: () => 0.6, vLineWidth: () => 0.6, hLineColor: () => LINE, vLineColor: () => LINE, paddingLeft: () => 5, paddingRight: () => 5, paddingTop: () => 3, paddingBottom: () => 3 },
            margin: [0, 2, 0, 10],
          });
          break;
        }
        default:
          if (t.tokens) out.push({ text: runs(t.tokens), margin: [0, 0, 0, 6] });
          else if (t.raw && t.raw.trim()) out.push({ text: decode(t.raw), margin: [0, 0, 0, 6] });
      }
    }
    return out;
  }

  const markdownToContent = (md) => blocks(marked.lexer(md || ''));

  // One section per report tab. Every section after the first starts on a new page.
  function section(sec, index) {
    const content = [{ text: sec.name, style: 'h1', pageBreak: index ? 'before' : undefined }];
    if (sec.angle) {
      content.push({
        table: { widths: ['*'], body: [[{ text: [{ text: 'Viewpoint: ', bold: true, color: ACCENT }, sec.angle], fontSize: 9.5 }]] },
        layout: { hLineWidth: () => 0, vLineWidth: () => 0, fillColor: () => SOFT, paddingLeft: () => 10, paddingRight: () => 10, paddingTop: () => 6, paddingBottom: () => 6 },
        margin: [0, 0, 0, 10],
      });
    }
    content.push(...markdownToContent(sec.markdown));
    return content;
  }

  function buildDoc({ title, subtitle, date, sections, context, essay }) {
    const content = [
      {
        columns: [
          { svg: LOGO, width: 22, margin: [0, 2, 0, 0] },
          { text: 'Alial report', style: 'title', margin: [8, 0, 0, 0] },
        ],
        columnGap: 0,
      },
      { text: subtitle, color: MUTED, margin: [0, 2, 0, 0] },
      { text: date, color: MUTED, fontSize: 9, margin: [0, 0, 0, 14] },
    ];
    sections.forEach((s, i) => content.push(...section(s, i)));
    content.push({ text: 'Your essay and context', style: 'h1', pageBreak: 'before' });
    content.push({ ul: context.map((c) => ({ text: [{ text: `${c.label}: `, bold: true }, c.value] })), margin: [0, 0, 0, 10] });
    content.push({ text: 'Essay', style: 'h2' });
    essay.split(/\n\s*\n/).forEach((p) => content.push({ text: p.trim(), margin: [0, 0, 0, 6] }));

    return {
      info: { title, author: 'Alial', subject: 'College essay report' },
      pageSize: 'LETTER',
      pageMargins: [48, 54, 48, 54],
      defaultStyle: { font: 'Roboto', fontSize: 10.5, lineHeight: 1.25, color: INK },
      styles: {
        title: { fontSize: 24, bold: true, color: INK },
        h1: { fontSize: 18, bold: true, color: INK, margin: [0, 0, 0, 8] },
        h2: { fontSize: 13.5, bold: true, color: ACCENT, margin: [0, 10, 0, 4] },
        h3: { fontSize: 11.5, bold: true, color: INK, margin: [0, 8, 0, 3] },
        h4: { fontSize: 10.5, bold: true, color: MUTED, margin: [0, 6, 0, 2] },
      },
      content,
      footer: (current, total) => ({
        columns: [{ text: 'Alial report', color: MUTED }, { text: `Page ${current} of ${total}`, alignment: 'right', color: MUTED }],
        margin: [48, 18, 48, 0],
        fontSize: 8,
      }),
    };
  }

  async function download(report) {
    await window.pdfMake.createPdf(buildDoc(report)).download(report.filename);
  }

  window.AlialPdf = { markdownToContent, buildDoc, download };
})();
