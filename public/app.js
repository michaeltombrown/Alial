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

  function drawOutput() {
    const out = $('out');
    const tab = state.tabs.find((t) => t.id === state.active);
    const d = state.data[state.active];
    out.classList.toggle('busy', d.status === 'running');
    out.replaceChildren();
    if (tab.tagline) {
      const p = document.createElement('p');
      p.className = 'tabdesc';
      p.textContent = tab.tagline;
      out.append(p);
    }
    if (d.text) out.append(render(d.text));
    else {
      const p = document.createElement('p');
      p.className = 'placeholder' + (d.status === 'running' ? ' pending' : '');
      p.textContent =
        d.status === 'failed' ? d.error || 'This analysis could not be completed.'
        : d.status === 'running' ? 'Reading your essay'
        : 'Waiting for the four analyses to finish';
      out.append(p);
    }
    const hasAny = Object.values(state.data).some((x) => x.text);
    $('copy').disabled = !d.text;
    $('download').disabled = !hasAny;
  }

  function beginRun(analyzers) {
    state.tabs = [{ id: 'summary', name: 'Summary' }, ...analyzers.map((a) => ({ id: a.id, name: a.name, tagline: a.tagline }))];
    state.data = { summary: { status: 'waiting' } };
    analyzers.forEach((a) => (state.data[a.id] = { status: 'running' }));
    state.active = 'summary';
    drawTabs();
    drawOutput();
  }

  function fullMarkdown() {
    const parts = [`# Alial report\n\n_${state.meta}_`];
    for (const t of state.tabs) if (state.data[t.id].text) parts.push(`# ${t.name}\n\n${state.data[t.id].text}`);
    return parts.join('\n\n---\n\n');
  }

  // ---------- Run ----------
  function handle(ev) {
    switch (ev.type) {
      case 'start': beginRun(ev.analyzers); break;
      case 'analyzer':
        state.data[ev.id] = ev.status === 'done' ? { status: 'done', text: ev.text } : { status: 'failed', error: ev.error };
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

  async function submit(e) {
    e.preventDefault();
    const err = $('form-error');
    showError(err, '');
    showError($('run-error'), '');
    const fd = new FormData();
    fd.append('type', typeSel.value);
    fd.append('length', document.querySelector('input[name=length]:checked').value);
    fd.append('prompt', $('prompt').value);
    fd.append('college', $('college').value);
    fd.append('wordLimit', limitInput.value);
    if (state.file) fd.append('file', state.file);
    else {
      if (countWords(essayBox.value) < 25) return showError(err, 'Paste your full essay or upload a file (at least 25 words).');
      fd.append('essay', essayBox.value);
    }
    state.meta = currentType().label + ($('college').value.trim() ? ` · ${$('college').value.trim()}` : '');
    state.controller = new AbortController();
    setRunning(true);
    try {
      const res = await fetch('/api/analyze', { method: 'POST', body: fd, signal: state.controller.signal });
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
    try { await navigator.clipboard.writeText(state.data[state.active].text || ''); btn.textContent = 'Copied'; }
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
