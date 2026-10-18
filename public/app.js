(() => {
  const $ = (id) => document.getElementById(id);
  const state = { config: null, file: null, controller: null, tabs: [], data: {}, active: 'summary', meta: '', started: false, running: false, mainTab: 'essay' };

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

  // The in-line review: the essay read as one continuous piece, then each paragraph as part of that thought.
  function renderInline(d) {
    const frag = document.createDocumentFragment();
    if (d.arc) {
      const box = el('div', 'arc');
      box.append(el('div', 'lbl', 'How the essay reads as one piece'), el('p', '', d.arc));
      frag.append(box);
    }
    const unit = d.synthetic ? 'Section' : 'Paragraph';
    for (const p of d.paragraphs) {
      const sec = el('section', 'para');
      const head = el('div', 'para-head');
      head.append(el('span', 'para-n', `${unit} ${p.n} of ${d.paragraphs.length}`));
      if (p.role) head.append(el('span', 'para-purpose', p.role));
      sec.append(head);
      if (!p.reviewed) {
        sec.append(el('p', 'no-issues', 'This part was not reviewed. Run the analysis again to include it.'));
      } else {
        const box = el('div', 'comment');
        box.append(el('div', 'lbl', 'Original'), el('blockquote', 'orig', p.focus || snippet(p.text)));
        if (p.flow) box.append(el('div', 'lbl flow', 'How it connects'), el('p', 'flow-text', p.flow));
        if (p.issues.length) {
          box.append(el('div', 'lbl issues', 'Issues'));
          const ul = el('ul');
          p.issues.forEach((i) => ul.append(el('li', '', i)));
          box.append(ul);
        }
        if (p.suggestions.length) {
          box.append(el('div', 'lbl suggest', p.suggestions.length > 1 ? 'Suggestions' : 'Suggestion'));
          const ul = el('ul');
          p.suggestions.forEach((i) => ul.append(el('li', '', i)));
          box.append(ul);
        }
        sec.append(box);
      }
      const dt = el('details', 'full-para');
      dt.append(el('summary', '', `Show full ${unit.toLowerCase()}`), el('p', '', p.text));
      sec.append(dt);
      frag.append(sec);
    }
    return frag;
  }

  function inlineToMarkdown(d) {
    const unit = d.synthetic ? 'Section' : 'Paragraph';
    const parts = [];
    if (d.arc) parts.push(`**How the essay reads as one piece**\n\n${d.arc}`);
    for (const p of d.paragraphs) {
      const lines = [`## ${unit} ${p.n} of ${d.paragraphs.length}`];
      if (p.role) lines.push(`Role: ${p.role}`);
      if (!p.reviewed) lines.push('This part was not reviewed.');
      else {
        lines.push('**Original**', `> ${p.focus || snippet(p.text)}`);
        if (p.flow) lines.push('**How it connects**', p.flow);
        if (p.issues.length) lines.push('**Issues**', p.issues.map((i) => `- ${i}`).join('\n'));
        if (p.suggestions.length) lines.push('**Suggestions**', p.suggestions.map((i) => `- ${i}`).join('\n'));
      }
      parts.push(lines.join('\n\n'));
    }
    return parts.join('\n\n');
  }

  // The text a tab contributes to Copy and Download.
  const tabText = (id) => {
    const d = state.data[id];
    return d.paragraphs ? inlineToMarkdown(d) : d.text || '';
  };

  const statusWord = { done: 'Done', running: 'Working', waiting: 'Waiting', failed: 'Could not finish' };

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
    if (d.paragraphs) out.append(renderInline(d));
    else if (d.text) {
      out.append(render(d.text));
      if (d.unverifiedQuotes?.length) {
        const note = el('div', 'notice warn');
        note.append(el('strong', '', 'Check these quoted passages. '), document.createTextNode('They could not be matched to your essay, your context, or the reviews, so treat them with caution: '));
        const ul = el('ul');
        d.unverifiedQuotes.forEach((q) => ul.append(el('li', '', `\u201c${q}\u201d`)));
        note.append(ul);
        out.append(note);
      }
    }
    else if (state.active === 'summary' && d.status !== 'failed') {
      // The summary is written last, from all of the analyses. Show what it is waiting on.
      const p = el('p', 'placeholder' + (d.status === 'running' ? ' pending' : ''));
      p.textContent = d.status === 'running' ? 'Writing the summary from all four analyses' : 'The summary is written last, once every analysis and the in-line review are finished.';
      out.append(p);
      const ul = el('ul', 'waitlist');
      for (const t of state.tabs.filter((x) => x.id !== 'summary')) {
        const li = el('li', state.data[t.id].status);
        li.append(el('span', 'wl-name', t.name), el('span', 'wl-state', statusWord[state.data[t.id].status] || ''));
        ul.append(li);
      }
      out.append(ul);
    } else {
      const p = el('p', 'placeholder' + (d.status === 'running' ? ' pending' : ''));
      p.textContent =
        d.status === 'failed' ? d.error || 'This analysis could not be completed.'
        : state.active === 'inline' ? 'Reading your essay as one piece, then paragraph by paragraph'
        : 'Reading your essay';
      out.append(p);
      if (d.status === 'failed' && d.retry) {
        const b = el('button', 'ghost retry', 'Retry the summary');
        b.type = 'button';
        b.addEventListener('click', retrySummary);
        out.append(b);
      }
    }
    $('copy').disabled = !tabText(state.active);
    $('download').disabled = !state.tabs.some((t) => tabText(t.id));
  }

  function restoreReport() {
    $('out').classList.remove('busy');
    if (state.prev) {
      Object.assign(state, state.prev);
      drawTabs();
      drawOutput();
    } else {
      $('out').replaceChildren(el('p', 'placeholder', 'Your summary, the In-Line Review, and the four full analyses will appear here after you analyze an essay.'));
    }
    updateReportStatus();
  }

  function beginRun(ev) {
    state.started = true;
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
        state.data.inline = ev.status === 'done' ? { status: 'done', arc: ev.arc, paragraphs: ev.paragraphs, synthetic: ev.synthetic } : { status: 'failed', error: ev.error };
        break;
      case 'summary_start': state.data.summary = { status: 'running' }; break;
      case 'summary': state.data.summary = { status: 'done', text: ev.text, unverifiedQuotes: ev.unverifiedQuotes || [] }; break;
      case 'summary_error': state.data.summary = { status: 'failed', error: ev.error, retry: true }; break;
      case 'error':
        showError($('run-error'), ev.error);
        if (['waiting', 'running'].includes(state.data.summary?.status)) state.data.summary = { status: 'failed', error: ev.error };
        break;
      case 'done': setRunning(false); return true;
    }
    drawTabs();
    drawOutput();
    return false;
  }

  // The two main tabs. The Report tab shows a dot while an analysis is running or after it has finished.
  function setMainTab(name) {
    state.mainTab = name;
    for (const t of ['essay', 'report']) {
      const tab = $('mt-' + t);
      tab.setAttribute('aria-selected', String(t === name));
      tab.tabIndex = t === name ? 0 : -1;
      $('view-' + t).hidden = t !== name;
    }
    window.scrollTo({ top: 0 });
  }

  function updateReportStatus() {
    $('mt-report').dataset.status = state.running ? 'running' : state.tabs.length ? 'done' : 'idle';
  }

  function setRunning(on) {
    state.running = on;
    $('submit').disabled = on;
    $('stop').hidden = !on;
    updateReportStatus();
  }

  // Clears the previous report so nothing stale shows when a new analysis starts.
  function resetReport() {
    // Keep the previous report so it can be restored if the request is refused before any results arrive.
    state.prev = state.tabs.length ? { tabs: state.tabs, data: state.data, active: state.active, meta: state.meta } : null;
    state.started = false;
    state.tabs = [];
    state.data = {};
    $('tabs').hidden = true;
    $('tabs').replaceChildren();
    $('out').classList.add('busy');
    const p = el('p', 'placeholder pending', 'Starting your analysis');
    $('out').replaceChildren(p);
    $('copy').disabled = true;
    $('download').disabled = true;
    showError($('run-error'), '');
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

  // The in-line review as the server needs it to rewrite the summary.
  function inlineForRetry() {
    const d = state.data.inline;
    if (!d?.paragraphs) return null;
    return {
      arc: d.arc,
      synthetic: d.synthetic,
      paragraphs: d.paragraphs.map(({ n, reviewed, role, flow, issues, suggestions, focus }) => ({ n, reviewed, role, flow, issues, suggestions, focus })),
    };
  }

  // Rewrites only the summary from the essay, the analyses, and the in-line review already on screen.
  async function retrySummary() {
    const reports = state.tabs
      .filter((t) => !['summary', 'inline'].includes(t.id) && state.data[t.id].text)
      .map((t) => ({ id: t.id, text: state.data[t.id].text }));
    showError($('run-error'), '');
    state.data.summary = { status: 'running' };
    drawTabs();
    drawOutput();
    state.controller = new AbortController();
    setRunning(true);
    try {
      const res = await fetch('/api/summarize', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...state.facts, reports, inline: inlineForRetry() }),
        signal: state.controller.signal,
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Something went wrong. Please try again.');
      await readStream(res);
    } catch (ex) {
      if (ex.name !== 'AbortError') {
        state.data.summary = { status: 'failed', error: ex.message, retry: true };
        drawTabs();
        drawOutput();
      }
    } finally {
      setRunning(false);
    }
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
    state.facts = { type: payload.type, length: payload.length, prompt: payload.prompt, college: payload.college, wordLimit: payload.wordLimit, essay, summaryLength: payload.length };
    state.controller = new AbortController();
    resetReport();
    setMainTab('report');
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
      if (ex.name === 'AbortError') return;
      if (state.started) showError($('run-error'), ex.message);
      else {
        // The request was refused before any results arrived (for example too many requests): go back to the essay.
        setMainTab('essay');
        showError(err, ex.message);
        restoreReport();
      }
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
  for (const t of ['essay', 'report']) $('mt-' + t).addEventListener('click', () => setMainTab(t));
  $('mt-essay').parentElement.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      const next = state.mainTab === 'essay' ? 'report' : 'essay';
      setMainTab(next);
      $('mt-' + next).focus();
    }
  });
  $('stop').addEventListener('click', () => { state.controller?.abort(); setRunning(false); });

  $('copy').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    try { await navigator.clipboard.writeText(tabText(state.active)); btn.textContent = 'Copied'; }
    catch { btn.textContent = 'Copy failed'; }
    setTimeout(() => (btn.textContent = 'Copy'), 1500);
  });
  const loaded = new Set();
  const loadScript = (src) =>
    new Promise((resolve, reject) => {
      if (loaded.has(src)) return resolve();
      const tag = document.createElement('script');
      tag.src = src;
      tag.onload = () => { loaded.add(src); resolve(); };
      tag.onerror = () => reject(new Error(`Could not load ${src}`));
      document.head.append(tag);
    });

  const slug = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

  // The whole report as one PDF: every tab, then the essay and context. The PDF tools load only when needed.
  $('download').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Preparing PDF…';
    showError($('run-error'), '');
    try {
      await loadScript('/vendor/pdfmake.js');
      await loadScript('/vendor/pdfmake-fonts.js');
      await loadScript('/pdf.js');
      const f = state.facts || {};
      const type = state.config.types.find((t) => t.id === f.type);
      const today = new Date();
      const date = today.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
      await AlialPdf.download({
        title: `Alial report: ${state.meta}`,
        subtitle: state.meta,
        date,
        filename: `alial-report-${slug(type?.label || 'essay')}-${today.toISOString().slice(0, 10)}.pdf`,
        sections: state.tabs.filter((t) => tabText(t.id)).map((t) => {
          const quotes = t.id === 'summary' ? state.data.summary.unverifiedQuotes || [] : [];
          const note = quotes.length
            ? `\n\n**Check these quoted passages.** They could not be matched to your essay, your context, or the reviews, so treat them with caution:\n\n${quotes.map((q) => `- \u201c${q}\u201d`).join('\n')}`
            : '';
          return { name: t.name, angle: t.angle, markdown: tabText(t.id) + note };
        }),
        context: [
          { label: 'Essay type', value: type?.label || '' },
          { label: 'Question or context', value: f.prompt?.trim() || 'None supplied' },
          ...(f.college?.trim() ? [{ label: 'College', value: f.college.trim() }] : []),
          { label: 'Word count', value: `${countWords(f.essay || '')} (limit ${f.wordLimit || type?.limit || ''})` },
          { label: 'Summary length', value: f.summaryLength || 'medium' },
        ],
        essay: f.essay || '',
      });
    } catch (ex) {
      showError($('run-error'), 'The PDF could not be created. Check your connection and try again.');
    } finally {
      btn.textContent = label;
      btn.disabled = !state.tabs.some((t) => tabText(t.id));
    }
  });

  init().catch(() => showError($('form-error'), 'Could not load Alial. Refresh the page.'));
})();
