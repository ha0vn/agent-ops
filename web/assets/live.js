// Agent Ops — live data loader. Every page calls AO.live(render).
(function () {
  const AO = window.AO;
  const forced = new URLSearchParams(location.search).get('state'); // QA hook: ?state=… stays as is
  let renderFn = null, es = null, debounce = null, retry = null, loading = false, pending = false;

  const setError = (on) => {
    if (forced) return false;
    const was = AO.state === 'error';
    if (on) AO.state = 'error'; else if (was) AO.state = 'normal';
    return was !== on;
  };

  function paint() {
    if (!renderFn) return;
    const y = window.scrollY;
    try { renderFn(AO.D); } catch (e) { if (e !== 0) console.error(e); }
    window.scrollTo(0, y);
    AO.setConn();
  }

  async function load() {
    if (loading) { pending = true; return; }
    loading = true;
    try {
      const r = await fetch('/api/data', { cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const data = await r.json();
      AO.D = data; AO.NOW = Date.now();
      clearTimeout(retry); retry = null;
      setError(false);
      paint();
    } catch (e) {
      const changed = setError(true);
      if (changed) paint(); else AO.setConn();
      clearTimeout(retry); retry = setTimeout(load, 5000);
    } finally {
      loading = false;
      if (pending) { pending = false; load(); }
    }
  }

  function connect() {
    if (typeof EventSource === 'undefined') return;
    es = new EventSource('/events');
    es.addEventListener('change', () => { clearTimeout(debounce); debounce = setTimeout(load, 800); });
    es.onerror = () => {
      // EventSource retries by itself; surface the outage and keep polling every 5 s until data flows again
      if (setError(true)) paint();
      AO.setConn();
      clearTimeout(retry); retry = setTimeout(load, 5000);
    };
    es.onopen = () => { if (AO.state === 'error') load(); };
  }

  AO.reload = load;
  AO.live = function (render) {
    renderFn = render;
    // keep the loading skeleton hook of the mockup: ?state=loading renders once without data and stays
    load().then(() => { if (!es) connect(); });
  };
})();
