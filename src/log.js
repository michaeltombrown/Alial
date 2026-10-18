// Server-side request log in D1, for testing with many testers. Every function is a no-op without a DB binding,
// and a logging failure is reported to the console but never reaches the student.

const SCHEMA = `CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, started_at TEXT NOT NULL, kind TEXT NOT NULL, status TEXT NOT NULL, duration_ms INTEGER, essay_type TEXT, college TEXT, summary_length TEXT, word_count INTEGER, prompt TEXT, essay TEXT, results TEXT, error TEXT, visitor TEXT, country TEXT, user_agent TEXT)`;
let schemaReady = null;

const ensureSchema = (db) => (schemaReady ||= db.prepare(SCHEMA).run().catch((err) => { schemaReady = null; throw err; }));

// A short stable id for a visitor so testers can be told apart. The IP itself is never stored.
async function visitorId(request, env) {
  const ip = request.headers.get('cf-connecting-ip');
  if (!ip) return null;
  const bytes = new TextEncoder().encode(`${ip}|${env.LOG_SALT || 'alial'}`);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].slice(0, 6).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Starts a log entry. `parsed` is the validated request. Returns { capture(event), finish(status, error) }.
export function startRunLog({ env, request, kind, parsed }) {
  const db = env.DB;
  const noop = { capture() {}, finish: async () => {} };
  if (!db) return noop;

  const input = kind === 'summarize' ? parsed.input : parsed;
  const id = `${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  const results = { analyzers: {}, inline: null, summary: null };

  const ready = (async () => {
    try {
      await ensureSchema(db);
      await db
        .prepare('INSERT INTO runs (id, started_at, kind, status, essay_type, college, summary_length, word_count, prompt, essay, visitor, country, user_agent) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)')
        .bind(
          id, startedAt, kind, 'running', input.type?.id || null, input.college || null, input.length || null,
          input.essay.trim().split(/\s+/).length, input.prompt || null, input.essay,
          await visitorId(request, env), request.cf?.country || null, (request.headers.get('user-agent') || '').slice(0, 300),
        )
        .run();
      return true;
    } catch (err) {
      console.error('[alial] could not start run log:', err.message);
      return false;
    }
  })();

  return {
    capture(e) {
      if (e.type === 'analyzer') results.analyzers[e.id] = e.status === 'done' ? { status: 'done', text: e.text } : { status: 'error', error: e.error };
      else if (e.type === 'inline') results.inline = e.status === 'done' ? { status: 'done', arc: e.arc, paragraphs: e.paragraphs } : { status: 'error', error: e.error };
      else if (e.type === 'summary') results.summary = { status: 'done', text: e.text, truncated: Boolean(e.truncated), unverifiedQuotes: e.unverifiedQuotes };
      else if (e.type === 'summary_error') results.summary = { status: 'error', error: e.error };
    },
    async finish(status, error) {
      if (!(await ready)) return;
      try {
        const final = status || (results.summary?.status === 'done' ? 'complete' : results.summary ? 'summary_failed' : 'error');
        await db
          .prepare('UPDATE runs SET status = ?1, duration_ms = ?2, results = ?3, error = ?4 WHERE id = ?5')
          .bind(final, Date.now() - t0, JSON.stringify(results), error || null, id)
          .run();
      } catch (err) {
        console.error('[alial] could not finish run log:', err.message);
      }
    },
  };
}

// ---- Admin read access. Needs the ADMIN_TOKEN secret; without it these routes do not exist.

function authorized(request, env) {
  if (!env.ADMIN_TOKEN) return false;
  const given = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (given.length !== env.ADMIN_TOKEN.length) return false;
  let diff = 0;
  for (let i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ env.ADMIN_TOKEN.charCodeAt(i);
  return diff === 0;
}

const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

export async function adminRuns(request, env) {
  if (!env.ADMIN_TOKEN || !env.DB) return reply({ error: 'Not found.' }, 404);
  if (!authorized(request, env)) return reply({ error: 'Unauthorized.' }, 401);
  try {
    await ensureSchema(env.DB);
    const url = new URL(request.url);
    const id = url.searchParams.get('id');
    if (id) {
      const row = await env.DB.prepare('SELECT * FROM runs WHERE id = ?1').bind(id).first();
      if (!row) return reply({ error: 'Not found.' }, 404);
      return reply({ ...row, results: row.results ? JSON.parse(row.results) : null });
    }
    const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit')) || 50));
    const { results } = await env.DB
      .prepare('SELECT id, started_at, kind, status, duration_ms, essay_type, college, summary_length, word_count, visitor, country FROM runs ORDER BY started_at DESC LIMIT ?1')
      .bind(limit)
      .all();
    return reply({ runs: results });
  } catch (err) {
    console.error('[alial] admin read failed:', err.message);
    return reply({ error: 'Could not read the log.' }, 500);
  }
}
