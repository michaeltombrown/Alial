(() => {
  const $ = (id) => document.getElementById(id);
  const state = { config: null, file: null, controller: null, tabs: [], data: {}, active: 'summary', meta: '' };

  const countWords = (s) => (s.trim() ? s.trim().split(/\s+/).length : 0);
  const fmt = (n) => n.toLocaleString();
  const typeSel = $('type'), limitInput = $('wordLimit'), essayBox = $('essay');

  // ---------- Markdown ----------
  function render(md) {
    const tpl = document.createElement('template');
    tpl.innerHTML = DOMPurify.sanitize(marked.parse(md || '', { gfm: true }));
    tpl.content.querySelectorAll('table').forEach((t) => {
      const wrap = document.createElement('div');
      wrap.className = 'table-wrap';
      t.replaceWith(wrap);
      wrap.append(t);
    });
    tpl.content.querySelectorAll('a').forEach((a) => { a.target = '_blank'; a.rel = 'noopener noreferrer'; });
    return tpl.content;
  }

  // ---------- Left pane ----------
  const currentType = () => state.config.types.find((t) => t.id === typeSel.value);
  const currentLimit = () => parseInt(limitInput.value, 10) || currentType()?.limit || 0;

  function updateCount() {
    const el = $('in-count');
    el.classList.remove('over');
    if (state.file) { el.textContent = ''; return; }
    const n = countWords(essayBox.value);
    el.textContent = n ? `${fmt(n)} words (limit ${fmt(currentLimit())})` : '';
    if (n > currentLimit()) { el.classList.add('over'); el.textContent += `, ${n - currentLimit()} over`; }
  }

  function syncType() {
    const t = currentType();
    $('type-hint').textContent = t.hint;
    if (t.promptHint) $('prompt').placeholder = t.promptHint;
    limitInput.value = t.limit;
    updateCount();
  }

  function setFile(file) {
    state.file = file || null;
    $('paste-box').hidden = !!file;
    $('file-chip').hidden = !file;
    if (file) $('file-name').textContent = `${file.name} (${Math.max(1, Math.round(file.size / 1024))} KB)`;
    else $('file').value = '';
    updateCount();
  }

  const showError = (el, msg) => { el.textContent = msg || ''; el.hidden = !msg; };

  // ---------- Right pane ----------
  function drawTabs() {
    const bar = $('tabs');
    bar.replaceChildren();
    for (const t of state.tabs) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tab';
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(t.id === state.active));
      b.dataset.status = state.data[t.id].status;
      b.innerHTML = '<span class="dot" aria-hidden="true"></span><span></span>';
      b.lastChild.textContent = t.name;
      b.addEventListener('click', () => { state.active = t.id; drawTabs(); drawOutput(); });
      bar.append(b);
    }
    bar.hidden = state.tabs.length === 0;
  }

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  };
  const snippet = (t, max = 300) => (t.length > max ? t.slice(0, max).replace(/\s+\S*$/, '') + '…' : t);

  // Paragraph-by-paragraph review: original words, the issues, and one or more suggestions.
  function renderInline(paragraphs) {
    const frag = document.createDocumentFragment();
    for (const p of paragraphs) {
      const sec = el('section', 'para');
      const head = el('div', 'para-head');
      head.append(el('span', 'para-n', `Paragraph ${p.n} of ${paragraphs.length}`));
      if (p.purpose) head.append(el('span', 'para-purpose', p.purpose));
      sec.append(head);
      if (p.works) {
        const w = el('p', 'works');
        w.append(el('strong', '', 'What works: '), document.createTextNode(p.works));
        sec.append(w);
      }
      if (!p.comments.length) sec.append(el('p', 'no-issues', 'No major issues in this paragraph.'));
      for (const c of p.comments) {
        const box = el('div', 'comment');
        box.append(el('div', 'lbl', 'Original'), el('blockquote', 'orig', c.quote || snippet(p.text)));
        if (c.issues.length) {
          box.append(el('div', 'lbl issues', 'Issues'));
          const ul = el('ul');
          c.issues.forEach((i) => ul.append(el('li', '', i)));
          box.append(ul);
        }
        if (c.suggestions.length) {
          box.append(el('div', 'lbl suggest', c.suggestions.length > 1 ? 'Suggestions' : 'Suggestion'));
          const ul = el('ul');
          c.suggestions.forEach((i) => ul.append(el('li', '', i)));
          box.append(ul);
        }
        sec.append(box);
      }
      if (p.text.length > 300) {
        const d = el('details', 'full-para');
        d.append(el('summary', '', 'Show full paragraph'), el('p', '', p.text));
        sec.append(d);
      }
      frag.append(sec);
    }
    return frag;
  }

  function inlineToMarkdown(paragraphs) {
    return paragraphs
      .map((p) => {
        const lines = [`## Paragraph ${p.n} of ${paragraphs.length}`];
        if (p.purpose) lines.push(`Purpose: ${p.purpose}`);
        if (p.works) lines.push(`What works: ${p.works}`);
        if (!p.comments.length) lines.push('No major issues in this paragraph.');
        for (const c of p.comments) {
          lines.push('**Original**', `> ${c.quote || snippet(p.text)}`);
          if (c.issues.length) lines.push('**Issues**', ...c.issues.map((i) => `- ${i}`));
          if (c.suggestions.length) lines.push('**Suggestions**', ...c.suggestions.map((i) => `- ${i}`));
        }
        return lines.join('\n\n');
      })
      .join('\n\n');
  }

  // The text a tab contributes to Copy and Download.
  const tabText = (id) => {
    const d = state.data[id];
    return d.paragraphs ? inlineToMarkdown(d.paragraphs) : d.text || '';
  };

  function drawOutput() {
    const out = $('out');
    const tab = state.tabs.find((t) => t.id === state.active);
    const d = state.data[state.active];
    out.classList.toggle('busy', d.status === 'running');
    out.replaceChildren();
    if (tab.angle) {
      const v = el('p', 'viewpoint');
      v.append(el('strong', '', 'Viewpoint: '), document.createTextNode(tab.angle));
      out.append(v);
    }
    if (d.paragraphs) out.append(renderInline(d.paragraphs));
    else if (d.text) out.append(render(d.text));
    else {
      const p = el('p', 'placeholder' + (d.status === 'running' ? ' pending' : ''));
      p.textContent =
        d.status === 'failed' ? d.error || 'This analysis could not be completed.'
        : d.status === 'running' ? (state.active === 'inline' ? 'Reading your essay paragraph by paragraph' : 'Reading your essay')
        : 'Waiting for the four analyses to finish';
      out.append(p);
    }
    $('copy').disabled = !tabText(state.active);
    $('download').disabled = !state.tabs.some((t) => tabText(t.id));
  }

  function beginRun(ev) {
    state.tabs = [
      { id: 'summary', name: 'Summary', angle: ev.summaryAngle },
      { id: 'inline', name: 'In-Line Review', angle: ev.inlineAngle },
      ...ev.analyzers.map((a) => ({ id: a.id, name: a.name, tagline: a.tagline, angle: a.angle })),
    ];
    state.data = { summary: { status: 'waiting' }, inline: { status: 'running' } };
    ev.analyzers.forEach((a) => (state.data[a.id] = { status: 'running' }));
    state.active = 'summary';
    drawTabs();
    drawOutput();
  }

  function fullMarkdown() {
    const parts = [`# Alial report\n\n_${state.meta}_`];
    for (const t of state.tabs) {
      if (!tabText(t.id)) continue;
      parts.push(`# ${t.name}\n\n${t.angle ? `_Viewpoint: ${t.angle}_\n\n` : ''}${tabText(t.id)}`);
    }
    return parts.join('\n\n---\n\n');
  }

  // ---------- Run ----------
  function handle(ev) {
    switch (ev.type) {
      case 'ping': return false;
      case 'start': beginRun(ev); break;
      case 'analyzer':
        state.data[ev.id] = ev.status === 'done' ? { status: 'done', text: ev.text } : { status: 'failed', error: ev.error };
        break;
      case 'inline':
        state.data.inline = ev.status === 'done' ? { status: 'done', paragraphs: ev.paragraphs } : { status: 'failed', error: ev.error };
        break;
      case 'summary_start': state.data.summary = { status: 'running' }; break;
      case 'summary': state.data.summary = { status: 'done', text: ev.text }; break;
      case 'error': showError($('run-error'), ev.error); break;
      case 'done': setRunning(false); return true;
    }
    drawTabs();
    drawOutput();
    return false;
  }

  function setRunning(on) {
    $('submit').disabled = on;
    $('stop').hidden = !on;
  }

  async function readStream(res) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '', finished = false;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (line && handle(JSON.parse(line))) finished = true;
      }
    }
    if (!finished && !state.controller.signal.aborted) showError($('run-error'), 'The connection ended before your report was ready. Please try again.');
  }

  async function readEssayFile(file) {
    const name = file.name.toLowerCase();
    if (file.size > 5 * 1024 * 1024) throw new Error('That file is too large (5 MB max).');
    if (name.endsWith('.docx')) return (await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })).value.trim();
    if (name.endsWith('.rtf')) return rtfToText(await file.text()).replace(/\n{3,}/g, '\n\n').trim();
    if (/\.(txt|md)$/.test(name)) return (await file.text()).trim();
    throw new Error('Upload a .docx, .txt, or .rtf file, or paste your essay.');
  }

  async function submit(e) {
    e.preventDefault();
    const err = $('form-error');
    showError(err, '');
    showError($('run-error'), '');
    let essay;
    try {
      essay = state.file ? await readEssayFile(state.file) : essayBox.value.trim();
    } catch (ex) {
      return showError(err, ex.message || 'Could not read that file. Try pasting the text instead.');
    }
    if (countWords(essay) < 25) return showError(err, 'Add your full essay (at least 25 words).');

    const payload = {
      type: typeSel.value,
      essay,
      length: document.querySelector('input[name=length]:checked').value,
      prompt: $('prompt').value,
      college: $('college').value,
      wordLimit: limitInput.value,
    };
    state.meta = currentType().label + ($('college').value.trim() ? ` · ${$('college').value.trim()}` : '');
    state.controller = new AbortController();
    setRunning(true);
    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: state.controller.signal,
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Something went wrong. Please try again.');
      await readStream(res);
    } catch (ex) {
      if (ex.name !== 'AbortError') showError(err, ex.message);
    } finally {
      setRunning(false);
    }
  }

  // ---------- Wire up ----------
  async function init() {
    state.config = await (await fetch('/api/config')).json();
    $('mock-banner').hidden = !state.config.mock;
    for (const t of state.config.types) typeSel.add(new Option(t.label, t.id));
    syncType();
  }

  typeSel.addEventListener('change', syncType);
  limitInput.addEventListener('input', updateCount);
  essayBox.addEventListener('input', updateCount);
  $('file').addEventListener('change', (e) => setFile(e.target.files[0]));
  $('file-remove').addEventListener('click', () => setFile(null));
  $('clear').addEventListener('click', () => { setFile(null); essayBox.value = ''; updateCount(); showError($('form-error'), ''); essayBox.focus(); });
  $('form').addEventListener('submit', submit);
  $('stop').addEventListener('click', () => { state.controller?.abort(); setRunning(false); });

  $('copy').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    try { await navigator.clipboard.writeText(tabText(state.active)); btn.textContent = 'Copied'; }
    catch { btn.textContent = 'Copy failed'; }
    setTimeout(() => (btn.textContent = 'Copy'), 1500);
  });
  $('download').addEventListener('click', () => {
    const url = URL.createObjectURL(new Blob([fullMarkdown()], { type: 'text/markdown' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: 'alial-report.md' });
    a.click();
    URL.revokeObjectURL(url);
  });

  init().catch(() => showError($('form-error'), 'Could not load Alial. Refresh the page.'));
})();
