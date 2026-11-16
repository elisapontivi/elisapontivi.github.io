'use strict';
/* 5ª Turismo 2026/27 · accesso e registro video.
   Studenti: numero di registro + compleanno (ggmm), controllato da tur_login in Supabase.
   Insegnante: email e password del suo account Supabase (lo stesso della 5AFM).
   Va caricato nel <head> DOPO config.js.
   Espone window.Cloud e window.Accesso = { ready: Promise<profilo>, profile, logout() } */
(() => {
  const STUDENTI = 20;
  const config = window.CLASSE_CONFIG || {};
  const KEY = 'tur5_session';

  /* ------------------------------ archivio ------------------------------ */
  let session = null, refreshing = null;
  const load = () => { try { session = JSON.parse(sessionStorage.getItem(KEY) || 'null'); } catch (e) { session = null; } };
  const save = () => { try { session ? sessionStorage.setItem(KEY, JSON.stringify(session)) : sessionStorage.removeItem(KEY); } catch (e) { /* solo in memoria */ } };

  /* Compleanno in qualsiasi forma (16/09, 16-9, 16 09, 1609, 169, 16/09/2008) -> codici ggmm possibili. */
  function dateCodes(text) {
    const t = String(text || '').trim(), out = [];
    const ok = (d, m) => /^\d{1,2}$/.test(d) && /^\d{1,2}$/.test(m) && +d >= 1 && +d <= 31 && +m >= 1 && +m <= 12;
    const c = (d, m) => d.padStart(2, '0') + m.padStart(2, '0');
    if (/\D/.test(t)) { const p = t.split(/\D+/).filter(Boolean); if (p.length >= 2 && p.length <= 3 && ok(p[0], p[1])) out.push(c(p[0], p[1])); }
    else if ([4, 6, 8].includes(t.length)) { if (ok(t.slice(0, 2), t.slice(2, 4))) out.push(t.slice(0, 4)); }
    else if (t.length === 3) { if (ok(t.slice(0, 2), t.slice(2))) out.push(c(t.slice(0, 2), t.slice(2))); if (ok(t.slice(0, 1), t.slice(1))) out.push(c(t.slice(0, 1), t.slice(1))); }
    else if (t.length === 2 && ok(t[0], t[1])) out.push(c(t[0], t[1]));
    return [...new Set(out)];
  }

  async function call(path, body, token = null, keepalive = false) {
    let r;
    try {
      r = await fetch(config.supabaseUrl + path, {
        method: 'POST', cache: 'no-store', keepalive,
        headers: { 'Content-Type': 'application/json', apikey: config.publishableKey, ...(token ? { Authorization: 'Bearer ' + token } : {}) },
        body: JSON.stringify(body), signal: AbortSignal.timeout(20000)
      });
    } catch (e) { throw Error('Connessione non disponibile. Controlla la rete e riprova.'); }
    let data = null; try { data = await r.json(); } catch (e) { /* risposta vuota */ }
    if (!r.ok) {
      if (r.status === 401 || r.status === 403) throw Error('Accesso non valido o scaduto. Entra di nuovo.');
      if (r.status === 429) throw Error('Troppi tentativi. Attendi qualche minuto prima di riprovare.');
      throw Error(data && typeof data.message === 'string' ? data.message : 'Operazione non completata. Riprova.');
    }
    return data;
  }

  // chiamate dello studente: senza account, con il gettone
  const pub = (name, args, keepalive) => call('/rest/v1/rpc/' + name, args, null, keepalive);

  // chiamate dell'insegnante: con l'account Supabase
  async function auth(name, args = {}) {
    if (!session || session.role !== 'teacher') throw Error('Entra come insegnante.');
    if (Date.now() >= session.expires_at * 1000 - 60000) {
      if (!refreshing) refreshing = call('/auth/v1/token?grant_type=refresh_token', { refresh_token: session.refresh_token })
        .then(d => { Object.assign(session, d, { expires_at: Math.floor(Date.now() / 1000) + Number(d.expires_in || 3600) }); save(); })
        .finally(() => { refreshing = null; });
      await refreshing;
    }
    return call('/rest/v1/rpc/' + name, args, session.access_token);
  }

  const Cloud = window.Cloud = {
    async loginStudent(n, text) {
      const codes = dateCodes(text);
      if (!codes.length) throw Error('Scrivi giorno e mese così: 16/09');
      const r = await pub('tur_login', { p_numero: n, p_codici: codes });
      if (!r || !r.ok) throw Error(r && r.motivo === 'troppi' ? 'Troppi tentativi sbagliati. Riprova tra 10 minuti.' : 'Numero di registro o compleanno non corretti.');
      session = { role: 'student', student: r.student, token: r.token }; save();
      return { role: 'student', student: r.student };
    },
    async loginTeacher(email, password) {
      const d = await call('/auth/v1/token?grant_type=password', { email, password });
      session = { role: 'teacher', access_token: d.access_token, refresh_token: d.refresh_token, expires_at: Math.floor(Date.now() / 1000) + Number(d.expires_in || 3600) };
      save();
      try {
        // verifica che sia davvero l'account insegnante
        await auth('tur_video_report');
      } catch (e) { session = null; save(); throw Error('Questo account non è l’account insegnante.'); }
      return { role: 'teacher' };
    },
    async resume() {
      load();
      if (!session) return null;
      try {
        if (session.role === 'student') {
          const n = await pub('tur_me', { p_token: session.token });
          if (n) return { role: 'student', student: n };
        } else if (session.role === 'teacher') {
          await auth('tur_video_report');
          return { role: 'teacher' };
        }
      } catch (e) { /* sessione scaduta */ }
      session = null; save(); return null;
    },
    async logout() {
      const s = session; session = null; save();
      try {
        if (s && s.role === 'student') await pub('tur_logout', { p_token: s.token });
        if (s && s.role === 'teacher') await call('/auth/v1/logout', {}, s.access_token);
      } catch (e) { /* già uscito in locale */ }
    },
    video(args, keepalive = false) {
      if (!session || session.role !== 'student') return Promise.resolve();
      return pub('tur_video_event', { p_token: session.token, ...args }, keepalive);
    },
    videoReport: () => auth('tur_video_report'),
    videoDetail: (student, video) => auth('tur_video_detail', { p_student: student, p_video: video }),
    videoReset: () => auth('tur_video_reset')
  };

  /* ------------------------------ accesso ------------------------------ */
  const root = document.documentElement;
  root.classList.add('gated');
  const style = document.createElement('style');
  style.textContent = `
.gated body>*:not(#gate){visibility:hidden}
#gate{position:fixed;inset:0;z-index:1000;display:grid;place-items:center;padding:16px;background:#0e4a5a;font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#1d2b33;overflow:auto}
#gate form{background:#fff;border-radius:16px;padding:28px 24px 22px;width:min(400px,100%);box-shadow:0 18px 50px rgba(0,0,0,.25)}
#gate .k{margin:0 0 4px;color:#8a2e3b;font-size:13px;font-weight:800;letter-spacing:.1em;text-transform:uppercase}
#gate h1{margin:0 0 6px;font-size:25px;line-height:1.2;color:#0e4a5a}
#gate p.sub{margin:0 0 16px;color:#5e6b72;font-size:15px}
#gate label{display:block;font-weight:700;font-size:14px;margin:14px 0 6px}
#gate select,#gate input{width:100%;font:inherit;padding:11px 12px;border:1.5px solid #d3c9b6;border-radius:9px;background:#fff;color:inherit}
#gate select:focus,#gate input:focus{outline:3px solid #d99a2b;outline-offset:1px}
#gate .hint{font-size:13px;color:#5e6b72;margin:5px 0 0}
#gate .err{color:#a32121;font-size:14px;min-height:21px;margin:12px 0 4px}
#gate button.go{width:100%;font:inherit;font-weight:800;padding:12px;border:0;border-radius:9px;background:#0e4a5a;color:#fff;cursor:pointer}
#gate button.go:disabled{opacity:.6;cursor:wait}
#gate button.link{background:none;border:0;padding:0;margin:12px 0 0;font:inherit;font-size:13px;color:#0e4a5a;text-decoration:underline;cursor:pointer}
#gate .note{font-size:12.5px;color:#5e6b72;margin:14px 0 0;border-top:1px solid #e2dacb;padding-top:10px}
#who{position:fixed;right:12px;bottom:12px;z-index:900;display:flex;align-items:center;gap:10px;background:#0e4a5a;color:#fff;border-radius:999px;padding:7px 8px 7px 15px;font:600 14px/1.2 system-ui,-apple-system,"Segoe UI",sans-serif;box-shadow:0 6px 18px rgba(0,0,0,.2)}
#who a{color:#ffd9a0}
#who button{font:inherit;font-size:13px;border:0;border-radius:999px;padding:6px 12px;background:rgba(255,255,255,.18);color:#fff;cursor:pointer}
#who button:focus-visible,#who a:focus-visible,#gate button.link:focus-visible{outline:3px solid #d99a2b;outline-offset:2px}
@media print{#who,#gate{display:none}}`;
  document.head.appendChild(style);

  let resolveReady;
  const Accesso = window.Accesso = {
    profile: null,
    ready: new Promise(r => { resolveReady = r; }),
    logout: async () => { await Cloud.logout(); location.reload(); }
  };

  function entra(profile) {
    Accesso.profile = profile;
    document.getElementById('gate')?.remove();
    root.classList.remove('gated');
    const who = document.createElement('div');
    who.id = 'who';
    who.innerHTML = profile.role === 'teacher'
      ? `<span>Insegnante · <a href="registro-video.html">Registro video</a></span><button type="button">Esci</button>`
      : `<span>N. ${String(profile.student).padStart(2, '0')}</span><button type="button">Esci</button>`;
    who.querySelector('button').onclick = Accesso.logout;
    document.body.appendChild(who);
    resolveReady(profile);
  }

  function mostraAccesso() {
    let docente = false;
    const gate = document.createElement('div');
    gate.id = 'gate';
    gate.innerHTML = `
<form novalidate aria-labelledby="gateTitle">
  <p class="k">5ª Turismo · DTA 2026/27</p>
  <h1 id="gateTitle">Accedi al materiale</h1>
  <p class="sub" id="gSub">Scegli il tuo numero di registro e scrivi il tuo compleanno.</p>
  <div id="gStud">
    <label for="gNum">Numero di registro</label>
    <select id="gNum" required><option value="">Scegli…</option>${Array.from({ length: STUDENTI }, (_, i) => `<option value="${i + 1}">${String(i + 1).padStart(2, '0')}</option>`).join('')}</select>
    <label for="gData">Compleanno (giorno e mese)</label>
    <input id="gData" inputmode="numeric" autocomplete="off" placeholder="gg/mm" aria-describedby="gHint">
    <p class="hint" id="gHint">Per esempio 16/09 se sei nato il 16 settembre</p>
  </div>
  <div id="gDoc" hidden>
    <label for="gMail">Email</label>
    <input id="gMail" type="email" autocomplete="username">
    <label for="gPass">Password</label>
    <input id="gPass" type="password" autocomplete="current-password">
  </div>
  <p class="err" id="gErr" role="alert"></p>
  <button class="go" type="submit">Entra</button>
  <button class="link" type="button" id="gSwitch">Accesso insegnante</button>
  <p class="note">Si entra con il proprio numero: l’insegnante vede chi ha guardato i video.</p>
</form>`;
    document.body.appendChild(gate);
    const $ = id => gate.querySelector('#' + id);
    const err = $('gErr');
    $('gSwitch').onclick = () => {
      docente = !docente;
      $('gStud').hidden = docente; $('gDoc').hidden = !docente;
      $('gSub').textContent = docente ? 'Entra con la tua email e la tua password.' : 'Scegli il tuo numero di registro e scrivi il tuo compleanno.';
      $('gSwitch').textContent = docente ? 'Sono uno studente' : 'Accesso insegnante';
      err.textContent = '';
      $(docente ? 'gMail' : 'gNum').focus();
    };
    gate.querySelector('form').onsubmit = async e => {
      e.preventDefault();
      err.textContent = '';
      const btn = gate.querySelector('button.go');
      try {
        let profile;
        if (docente) {
          const mail = $('gMail').value.trim(), pass = $('gPass').value;
          if (!mail || !pass) { err.textContent = 'Scrivi email e password.'; return; }
          btn.disabled = true; btn.textContent = 'Accesso in corso…';
          try { profile = await Cloud.loginTeacher(mail, pass); }
          catch (ex) { throw /Connessione|Troppi|account/.test(ex.message) ? ex : Error('Email o password non corrette.'); }
        } else {
          const n = Number($('gNum').value), d = $('gData').value.trim();
          if (!n) { err.textContent = 'Scegli il tuo numero di registro.'; $('gNum').focus(); return; }
          if (!d) { err.textContent = 'Scrivi giorno e mese così: 16/09'; $('gData').focus(); return; }
          btn.disabled = true; btn.textContent = 'Accesso in corso…';
          profile = await Cloud.loginStudent(n, d);
        }
        entra(profile);
      } catch (ex) {
        err.textContent = ex.message;
        btn.disabled = false; btn.textContent = 'Entra';
      }
    };
    $('gNum').focus();
  }

  async function avvio() {
    const p = await Cloud.resume();
    p ? entra(p) : mostraAccesso();
  }
  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', avvio) : avvio();
})();
