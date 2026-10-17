(() => {
  const $ = (id) => document.getElementById(id);
  const views = { form: $('view-form'), progress: $('view-progress'), results: $('view-results') };
  const state = { config: null, mode: 'upload', file: null, controller: null, analyzers: [], reports: {}, summary: '', meta: '' };

  const show = (name) => {
    for (const [k, el] of Object.entries(views)) el.hidden = k !== name;
    window.scrollTo({ top: 0 });
  };

  // ---------- Markdown ----------
  const render = (md) => {
    const html = DOMPurify.sanitize(marked.parse(md || '', { gfm: true, breaks: false }));
    const tpl = document.createElement('template');
    tpl.innerHTML = html;
    tpl.content.querySelectorAll('table').forEach((t) => {
      const wrap = document.createElement('div');
      wrap.className = 'table-wrap';
      t.replaceWith(wrap);
      wrap.append(t);
    });
    tpl.content.querySelectorAll('a').forEach((a) => { a.target = '_blank'; a.rel = 'noopener noreferrer'; });
    return tpl.content;
  };

  // ---------- Form ----------
  const typeSel = $('type'), limitInput = $('wordLimit'), essayBox = $('essay'), counter = $('counter'), fileInput = $('file');
  const countWords = (s) => (s.trim() ? s.trim().split(/\s+/).length : 0);

  const currentType = () => state.config.types.find((t) => t.id === typeSel.value);
  const syncType = () => {
    const t = currentType();
    $('type-hint').textContent = t.hint;
    limitInput.value = t.limit;
    updateCounter();
  };

  function updateCounter() {
    const limit = parseInt(limitInput.value, 10) || currentType()?.limit || 0;
    counter.classList.remove('over');
    if (state.mode === 'paste') {
      const n = countWords(essayBox.value);
      counter.textContent = n ? `${n.toLocaleString()} words (limit ${limit.toLocaleString()})` : '';
      if (n > limit) { counter.classList.add('over'); counter.textContent += ` — ${n - limit} over`; }
    } else {
      counter.textContent = '';
    }
  }

  function setMode(mode) {
    state.mode = mode;
    for (const m of ['upload', 'paste']) {
      const tab = $('tab-' + m);
      tab.setAttribute('aria-selected', String(m === mode));
      tab.tabIndex = m === mode ? 0 : -1;
      $('panel-' + m).hidden = m !== mode;
    }
    updateCounter();
  }

  function setFile(file) {
    state.file = file || null;
    $('drop').classList.toggle('has-file', !!file);
    $('drop-main').textContent = file ? file.name : 'Drop your essay here, or browse';
    $('drop-sub').textContent = file ? `${(file.size / 1024).toFixed(0)} KB. Click to choose a different file.` : 'Word, PDF, text, or RTF. 5 MB max.';
    if (!file) fileInput.value = '';
  }

  function showError(el, msg) {
    el.textContent = msg || '';
    el.hidden = !msg;
  }

  // ---------- Progress ----------
  function buildSteps(analyzers) {
    const list = $('steps');
    list.replaceChildren();
    const mk = (id, name, desc, cls) => {
      const li = document.createElement('li');
      li.id = 'step-' + id;
      li.className = cls;
      li.innerHTML = '<span class="dot" aria-hidden="true"></span><div><div class="name"></div><div class="desc"></div></div>';
      li.querySelector('.name').textContent = name;
      li.querySelector('.desc').textContent = desc;
      list.append(li);
    };
    analyzers.forEach((a) => mk(a.id, a.name, a.tagline, 'running'));
    mk('summary', 'Final report', 'Combines all four reviews into one summary', 'waiting final');
  }
  const setStep = (id, cls, desc) => {
    const li = $('step-' + id);
    if (!li) return;
    li.className = cls + (id === 'summary' ? ' final' : '');
    if (desc) li.querySelector('.desc').textContent = desc;
  };

  // ---------- Submit ----------
  async function submit(e) {
    e.preventDefault();
    const err = $('form-error');
    showError(err, '');
    const fd = new FormData();
    fd.append('type', typeSel.value);
    fd.append('prompt', $('prompt').value);
    fd.append('college', $('college').value);
    fd.append('wordLimit', limitInput.value);
    if (state.mode === 'upload') {
      if (!state.file) return showError(err, 'Choose a file to upload, or switch to "Paste text".');
      fd.append('file', state.file);
    } else {
      if (countWords(essayBox.value) < 25) return showError(err, 'Paste your full essay (at least 25 words).');
      fd.append('essay', essayBox.value);
    }

    state.reports = {};
    state.summary = '';
    state.meta = `${currentType().label}${$('college').value.trim() ? ' · ' + $('college').value.trim() : ''}`;
    state.controller = new AbortController();
    $('submit').disabled = true;

    try {
      const res = await fetch('/api/analyze', { method: 'POST', body: fd, signal: state.controller.signal });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Something went wrong. Please try again.');
      }
      showError($('progress-error'), '');
      show('progress');
      await readStream(res);
    } catch (ex) {
      if (ex.name === 'AbortError') return;
      if (views.progress.hidden) showError(err, ex.message);
      else showError($('progress-error'), ex.message);
    } finally {
      $('submit').disabled = false;
    }
  }

  async function readStream(res) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let finished = false;
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
    if (!finished && !state.controller.signal.aborted) {
      showError($('progress-error'), 'The connection ended before your report was ready. Please try again.');
    }
  }

  // returns true when the run completed
  function handle(ev) {
    switch (ev.type) {
      case 'start':
        state.analyzers = ev.analyzers;
        buildSteps(ev.analyzers);
        break;
      case 'analyzer':
        if (ev.status === 'done') { state.reports[ev.id] = ev.text; setStep(ev.id, 'done'); }
        else setStep(ev.id, 'failed', ev.error);
        break;
      case 'summary_start':
        setStep('summary', 'running');
        break;
      case 'summary':
        state.summary = ev.text;
        setStep('summary', 'done');
        break;
      case 'done':
        showResults();
        return true;
      case 'error':
        showError($('progress-error'), ev.error);
        break;
    }
    return false;
  }

  // ---------- Results ----------
  function showResults() {
    $('result-meta').textContent = state.meta;
    $('report').replaceChildren(render(state.summary));
    const box = $('reviews');
    box.replaceChildren();
    for (const a of state.analyzers) {
      const text = state.reports[a.id];
      const d = document.createElement('details');
      const s = document.createElement('summary');
      s.append(a.name + (text ? '' : ' (unavailable)'));
      const sub = document.createElement('span');
      sub.className = 'desc';
      sub.textContent = a.tagline;
      s.append(sub);
      d.append(s);
      if (text) {
        const body = document.createElement('div');
        body.className = 'review-body';
        body.append(render(text));
        d.append(body);
      }
      box.append(d);
    }
    show('results');
  }

  function fullMarkdown() {
    const parts = [`# Alial report\n\n_${state.meta}_\n\n${state.summary}`];
    for (const a of state.analyzers) if (state.reports[a.id]) parts.push(`\n\n---\n\n# ${a.name}\n\n${state.reports[a.id]}`);
    return parts.join('');
  }

  // ---------- Wire up ----------
  async function init() {
    state.config = await (await fetch('/api/config')).json();
    $('mock-banner').hidden = !state.config.mock;
    for (const t of state.config.types) typeSel.add(new Option(`${t.label}`, t.id));
    syncType();
  }

  typeSel.addEventListener('change', syncType);
  limitInput.addEventListener('input', updateCounter);
  essayBox.addEventListener('input', updateCounter);
  fileInput.addEventListener('change', () => setFile(fileInput.files[0]));
  $('tab-upload').addEventListener('click', () => setMode('upload'));
  $('tab-paste').addEventListener('click', () => setMode('paste'));
  $('form').addEventListener('submit', submit);

  const drop = $('drop');
  ['dragenter', 'dragover'].forEach((n) => drop.addEventListener(n, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((n) => drop.addEventListener(n, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', (e) => {
    const f = e.dataTransfer.files[0];
    if (f) { fileInput.files = e.dataTransfer.files; setFile(f); }
  });

  $('cancel').addEventListener('click', () => { state.controller?.abort(); show('form'); });
  $('again').addEventListener('click', () => { setFile(null); essayBox.value = ''; updateCounter(); show('form'); });
  $('copy').addEventListener('click', async (e) => {
    try { await navigator.clipboard.writeText(fullMarkdown()); e.target.textContent = 'Copied'; } catch { e.target.textContent = 'Copy failed'; }
    setTimeout(() => (e.target.textContent = 'Copy'), 1500);
  });
  $('download').addEventListener('click', () => {
    const url = URL.createObjectURL(new Blob([fullMarkdown()], { type: 'text/markdown' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: 'alial-report.md' });
    a.click();
    URL.revokeObjectURL(url);
  });
  $('print').addEventListener('click', () => {
    document.querySelectorAll('#reviews details').forEach((d) => (d.open = true));
    window.print();
  });

  init().catch(() => showError($('form-error'), 'Could not load Alial. Refresh the page.'));
})();
