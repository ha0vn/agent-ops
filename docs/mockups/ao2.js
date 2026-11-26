// Agent Ops — shared runtime for mockups v2: i18n (vi/en), global range, formatters, tooltip, orbit, aggregates.
(function () {
  const D = window.AO_DATA, NOW = D.generatedAt, TZ = 'Asia/Ho_Chi_Minh';
  const ls = { get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} } };
  const qs = new URLSearchParams(location.search);

  const T = {
    'nav.sessions': ['Tất cả phiên', 'All sessions'], 'nav.wall': ['Màn hình tổng', 'Live wall'], 'nav.session': ['Phiên', 'Session'],
    'nav.graph': ['Sơ đồ đội', 'Team graph'], 'nav.universe': ['Vũ trụ', 'Universe'], 'nav.skills': ['Skill & công cụ', 'Skills & tools'], 'nav.cost': ['Chi phí', 'Cost'],
    'range.today': ['Hôm nay', 'Today'], 'range.7d': ['7 ngày', '7 days'], 'range.30d': ['30 ngày', '30 days'],
    'vs.yesterday': ['so với hôm qua', 'vs yesterday'], 'vs.prev': ['so với kỳ trước', 'vs previous'],
    'st.run': ['Đang chạy', 'Running'], 'st.wait': ['Chờ bạn', 'Needs you'], 'st.stop': ['Đã dừng', 'Stopped'], 'st.done': ['Hoàn tất', 'Done'],
    'k.running': ['Đang chạy', 'Running'], 'k.waiting': ['Chờ bạn', 'Needs you'], 'k.sessions': ['Phiên', 'Sessions'], 'k.tokens': ['Token', 'Tokens'],
    'k.cost': ['Quy đổi', 'Est. cost'], 'k.subagents': ['Agent con', 'Sub-agents'], 'k.errors': ['Lỗi tool', 'Tool errors'], 'k.topskill': ['Skill dùng nhiều', 'Top skill'],
    'k.context': ['Ngữ cảnh', 'Context'], 'k.calls': ['Lệnh tool', 'Tool calls'], 'k.turns': ['Lượt model', 'Model turns'], 'k.files': ['File thay đổi', 'Files changed'],
    'k.skills': ['Skill', 'Skills'], 'k.mcp': ['MCP', 'MCP'], 'k.duration': ['Thời lượng', 'Duration'], 'k.cache': ['Đọc cache', 'Cache reads'],
    'p.live': ['Đang hoạt động', 'Active now'], 'p.parallel': ['Song song hôm nay', 'Today in parallel'], 'p.attention': ['Cần chú ý', 'Needs attention'],
    'p.byday': ['Theo ngày', 'By day'], 'p.all': ['Tất cả phiên', 'All sessions'], 'p.agents': ['Agent', 'Agents'], 'p.orbit': ['Quỹ đạo agent', 'Agent orbit'],
    'p.tokens': ['Token', 'Tokens'], 'p.matrix': ['Công cụ theo agent', 'Tools by agent'], 'p.timeline': ['Dòng thời gian', 'Timeline'], 'p.activity': ['Hoạt động', 'Activity'],
    'p.phases': ['Skill & giai đoạn', 'Skills & phases'], 'p.tools': ['Công cụ', 'Tools'], 'p.files': ['File', 'Files'], 'p.mcp': ['MCP server', 'MCP servers'],
    'p.skills': ['Skill', 'Skills'], 'p.chains': ['Chuỗi skill', 'Skill chains'], 'p.toolday': ['Tool theo ngày', 'Tools by day'], 'p.submodel': ['Agent con theo model', 'Sub-agents by model'],
    'p.where': ['Tiền đi đâu', 'Where it goes'], 'p.top': ['Phiên tốn nhất', 'Costliest sessions'], 'p.price': ['Bảng giá', 'Price table'], 'p.budget': ['Ngân sách tháng', 'Monthly budget'],
    'c.session': ['Phiên', 'Session'], 'c.started': ['Bắt đầu', 'Started'], 'c.last': ['Hoạt động cuối', 'Last activity'], 'c.status': ['Trạng thái', 'Status'],
    'c.agent': ['Agent', 'Agent'], 'c.model': ['Model', 'Model'], 'c.doing': ['Đang làm', 'Doing'], 'c.tools': ['Công cụ', 'Tools'], 'c.errs': ['Lỗi', 'Errors'],
    'c.time': ['Thời gian', 'Time'], 'c.calls': ['Lệnh', 'Calls'], 'c.rate': ['Tỉ lệ', 'Rate'], 'c.avg': ['TB', 'Avg'], 'c.date': ['Ngày', 'Date'],
    'a.resume': ['Sao chép lệnh resume', 'Copy resume command'], 'a.open': ['Mở', 'Open'], 'a.copied': ['Đã sao chép', 'Copied'], 'a.folder': ['Mở thư mục', 'Open folder'],
    'v.compact': ['Gọn', 'Compact'], 'v.detail': ['Chi tiết', 'Detailed'],
    't.cr': ['đọc cache', 'cache read'], 't.cw': ['ghi cache', 'cache write'], 't.out': ['output', 'output'], 't.in': ['input', 'input'],
    'r.main': ['chính', 'main'], 'r.worker': ['làm việc', 'worker'], 'r.review': ['review', 'review'],
    'f.all': ['Tất cả', 'All'], 'f.tool': ['Tool', 'Tool'], 'f.skill': ['Skill', 'Skill'], 'f.mcp': ['MCP', 'MCP'], 'f.agent': ['Giao việc', 'Delegation'], 'f.err': ['Lỗi', 'Errors'],
    'x.now': ['bây giờ', 'now'], 'x.ago': ['trước', 'ago'], 'x.none': ['—', '—'], 'x.more': ['khác', 'more'], 'x.est': ['ước tính', 'estimate'],
    'tip.cost': ['Giá trị quy đổi theo bảng giá API ($/1M token). Dùng gói thuê bao thì đây không phải tiền bị trừ.', 'Equivalent value at API list prices ($/1M tokens). On a subscription plan this is not what you are charged.'],
    'tip.ctx': ['Ngữ cảnh lượt cuối so với cửa sổ 1M token.', 'Last-turn context vs the 1M-token window.'],
    'tip.saved': ['Nếu mọi lần đọc cache phải trả giá input đầy đủ.', 'If every cache read were billed at the full input price.'],
    'tip.mockup': ['Mockup dùng ảnh chụp dữ liệu thật lúc dựng; bản thật cập nhật trực tiếp.', 'Mockup uses a snapshot of real data; the real app updates live.'],
    'empty.title': ['Chưa có phiên nào', 'No sessions yet'], 'empty.body': ['Chạy Claude Code một lần, phiên sẽ hiện ở đây.', 'Run Claude Code once and sessions appear here.'],
    'err.banner': ['Không đọc được 2 file log — đang hiện dữ liệu cũ.', 'Could not read 2 log files — showing older data.'],
    'stale.banner': ['Đang cập nhật…', 'Updating…'],
  };
  const AO = window.AO = { D, NOW };
  AO.lang = ls.get('aoLang', 'vi');
  AO.t = k => (T[k] ? T[k][AO.lang === 'en' ? 1 : 0] : k);
  AO.L = AO.lang === 'en' ? 'en-US' : 'vi-VN';
  AO.state = qs.get('state') || 'normal';

  // formatters
  const nf = (d) => new Intl.NumberFormat(AO.L, { minimumFractionDigits: d, maximumFractionDigits: d });
  AO.n = (v, d = 0) => nf(d).format(v);
  AO.tok = v => v >= 1e9 ? AO.n(v / 1e9, 2) + 'B' : v >= 1e6 ? AO.n(v / 1e6, v >= 1e8 ? 0 : 1) + 'M' : v >= 1e3 ? AO.n(v / 1e3, 0) + 'k' : AO.n(v, 0);
  AO.usd = (v, d) => v == null ? '—' : '$' + AO.n(v, d ?? (v >= 100 ? 0 : 2));
  AO.pct = (v, d = 1) => v > 0 && v < .001 ? '<0.1%' : AO.n(v * 100, d) + '%';
  AO.time = ts => new Intl.DateTimeFormat(AO.L, { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(ts);
  AO.time2 = ts => new Intl.DateTimeFormat(AO.L, { timeZone: TZ, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(ts);
  AO.date = ts => { const k = new Date(ts + 7 * 3600e3).toISOString(); return k.slice(8, 10) + '/' + k.slice(5, 7); };
  AO.dt = ts => AO.date(ts) + ' ' + AO.time(ts);
  AO.dur = ms => { const m = Math.round(ms / 60e3); if (m < 1) return Math.max(1, Math.round(ms / 1e3)) + 's'; if (m < 60) return m + 'm'; const h = Math.floor(m / 60); return h < 48 ? h + 'h ' + (m % 60) + 'm' : Math.floor(h / 24) + 'd ' + (h % 24) + 'h'; };
  AO.ago = ts => { const ms = NOW - ts; if (ms < 60e3) return AO.t('x.now'); return AO.lang === 'en' ? AO.dur(ms) + ' ago' : AO.dur(ms) + ' trước'; };
  AO.dayKey = ts => new Date(ts + 7 * 3600e3).toISOString().slice(0, 10);
  AO.esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  AO.model = m => !m ? '—' : m.replace('claude-', '').replace(/-(\d)-(\d)$/, ' $1.$2').replace(/^./, c => c.toUpperCase());

  // global range (shared by every screen)
  AO.range = ls.get('aoRange', '7d');
  const DAY = 864e5, todayStart = Date.parse(AO.dayKey(NOW) + 'T00:00:00+07:00');
  AO.win = (r = AO.range) => r === 'today' ? [todayStart, NOW] : r === '30d' ? [todayStart - 29 * DAY, NOW] : [todayStart - 6 * DAY, NOW];
  // previous window of the same elapsed length (today 00:00→now vs yesterday 00:00→same time)
  AO.prevWin = (r = AO.range) => { const [a, b] = AO.win(r); return r === 'today' ? [a - DAY, b - DAY] : [a - (b - a), a]; };
  AO.inWin = (s, w) => s.t1 >= w[0] && s.t0 <= w[1];
  AO.sessions = (w = AO.win()) => D.sessions.filter(s => AO.inWin(s, w));
  // cost/tokens attributed to days inside a window (byDay is per local day)
  AO.sumDays = (list, w) => { const o = { in: 0, out: 0, cw: 0, cr: 0, cost: 0 }; const a = AO.dayKey(w[0]), b = AO.dayKey(w[1]);
    for (const s of list) for (const [d, v] of Object.entries(s.byDay)) if (d >= a && d <= b) { for (const k of ['in', 'out', 'cw', 'cr']) { o[k] += v[k]; o.cost += v[k]; } } return o; };

  AO.role = a => a.key === 'main' ? 'main' : /^R\d|review/i.test(a.label + ' ' + (a.desc || '')) ? 'review' : 'worker';
  AO.color = a => ({ main: 'var(--gold)', worker: 'var(--worker)', review: 'var(--review)' })[AO.role(a)];
  AO.status = st => `<span class="st ${st}"><i></i>${AO.t('st.' + st)}</span>`;
  AO.problems = s => { const out = []; const rate = s.calls ? s.errs / s.calls : 0;
    if (s.t1 - s.t0 > 8 * 3600e3) out.push(['warn', AO.dur(s.t1 - s.t0)]);
    if (s.tokTotal > 150e6) out.push(['warn', AO.tok(s.tokTotal)]);
    if (s.errs > 20 && rate > .03) out.push(['bad', s.errs + ' · ' + AO.pct(rate)]);
    return out; };

  // header
  AO.header = active => {
    const items = [['sessions', 'nav.sessions'], ['graph', 'nav.graph'], ['wall', 'nav.wall'], ['session', 'nav.session'], ['skills', 'nav.skills'], ['cost', 'nav.cost']];
    return `<header class="top">
      <div class="mark"><svg viewBox="0 0 26 26" width="24" height="24" fill="none" stroke="var(--gold)" stroke-width="1"><circle cx="13" cy="13" r="12" opacity=".5"/><circle cx="13" cy="13" r="3.2" fill="var(--gold)" stroke="none"/><circle cx="13" cy="13" r="7.5" stroke-dasharray="2 3"/><circle cx="20.5" cy="13" r="1.6" fill="var(--gold)" stroke="none"/></svg>Agent Ops</div>
      <span class="badge" data-tip="${AO.esc(AO.t('tip.mockup'))}">MOCKUP · ${AO.dt(NOW)}</span>
      <nav class="nav">${items.map(([k, t]) => `<a class="${k === active ? 'on' : ''}" href="/files/${k}.html">${AO.t(t)}</a>`).join('')}</nav>
      <div class="tools">
        <div class="seg" id="rangeSeg">${['today', '7d', '30d'].map(r => `<button data-r="${r}" class="${r === AO.range ? 'on' : ''}">${AO.t('range.' + r)}</button>`).join('')}</div>
        <div class="seg" id="langSeg"><button data-l="vi" class="${AO.lang === 'vi' ? 'on' : ''}">VI</button><button data-l="en" class="${AO.lang === 'en' ? 'on' : ''}">EN</button></div>
        <div class="seg" id="palSeg"><button data-p="">Graphite</button><button data-p="ice">Ice</button><button data-p="pearl">Pearl</button></div>
      </div>
    </header>`;
  };
  AO.init = () => {
    const pal = ls.get('aoPal', ''); document.body.dataset.pal = pal;
    document.querySelectorAll('#palSeg button').forEach(b => { b.classList.toggle('on', (b.dataset.p || '') === pal);
      b.onclick = () => { ls.set('aoPal', b.dataset.p || ''); document.body.dataset.pal = b.dataset.p || ''; document.querySelectorAll('#palSeg button').forEach(x => x.classList.toggle('on', x === b)); }; });
    document.querySelectorAll('#rangeSeg button').forEach(b => b.onclick = () => { ls.set('aoRange', b.dataset.r); location.reload(); });
    document.querySelectorAll('#langSeg button').forEach(b => b.onclick = () => { ls.set('aoLang', b.dataset.l); location.reload(); });
    // tooltip
    const tip = document.createElement('div'); tip.id = 'tip'; document.body.appendChild(tip);
    document.addEventListener('mouseover', e => { const el = e.target.closest('[data-tip]'); if (!el) { tip.classList.remove('on'); return; }
      tip.innerHTML = el.dataset.tip; tip.classList.add('on'); const r = el.getBoundingClientRect();
      const x = Math.min(innerWidth - tip.offsetWidth - 8, Math.max(8, r.left + r.width / 2 - tip.offsetWidth / 2));
      const y = r.top - tip.offsetHeight - 8 < 8 ? r.bottom + 8 : r.top - tip.offsetHeight - 8; tip.style.left = x + 'px'; tip.style.top = y + 'px'; });
    const toast = document.createElement('div'); toast.id = 'toast'; document.body.appendChild(toast);
    AO.toast = m => { toast.textContent = m; toast.classList.add('on'); clearTimeout(AO._tt); AO._tt = setTimeout(() => toast.classList.remove('on'), 1600); };
    document.addEventListener('click', e => { const b = e.target.closest('[data-resume]'); if (!b) return; e.stopPropagation(); e.preventDefault();
      const cmd = 'claude --resume ' + b.dataset.resume; (navigator.clipboard ? navigator.clipboard.writeText(cmd) : Promise.reject()).catch(() => {}); AO.toast(AO.t('a.copied') + ': ' + cmd); });
    if (AO.state === 'loading') document.querySelectorAll('.strip .v, .panel .ph ~ *').forEach(el => el.classList.add('skel'));
  };
  AO.resumeBtn = (s, primary) => `<button class="act ${primary ? 'primary' : ''}" data-resume="${s.id}" data-tip="claude --resume ${s.short}…">⧉ ${AO.t('a.resume')}</button>`;
  AO.banner = () => AO.state === 'error' ? `<div class="banner">⚠ ${AO.t('err.banner')}</div>` : AO.state === 'loading' ? `<div class="banner stale">⟳ ${AO.t('stale.banner')}</div>` : '';
  AO.list = (w) => AO.state === 'empty' ? [] : AO.sessions(w);
  AO.emptyState = () => `<div class="empty-state"><div class="big">∅</div><b>${AO.t('empty.title')}</b><span>${AO.t('empty.body')}</span></div>`;

  // orbit: clusters agents by role; >max per cluster collapses into "+N"
  AO.orbit = (s, o = {}) => {
    const W = o.size || 420, C = W / 2, R1 = W * .3, R2 = W * .42, maxPer = o.maxPer || 7;
    const main = s.agents[0], subs = s.agents.slice(1);
    const groups = { worker: subs.filter(a => AO.role(a) === 'worker'), review: subs.filter(a => AO.role(a) === 'review') };
    const maxTok = Math.max(...s.agents.map(a => a.tok.cr + a.tok.cw + a.tok.out + a.tok.in), 1);
    const rad = a => Math.max(o.mini ? 3.5 : 5, Math.sqrt((a.tok.cr + a.tok.cw + a.tok.out + a.tok.in) / maxTok) * (o.mini ? 15 : 30));
    let nodes = '', edges = '', packets = '', labels = '';
    const place = (list, a0, a1, r, role) => {
      const shown = list.length > maxPer ? list.slice(-(maxPer - 1)) : list, more = list.length - shown.length;
      const items = more ? [{ more }].concat(shown) : shown;
      items.forEach((a, i) => {
        const ang = items.length === 1 ? (a0 + a1) / 2 : a0 + (a1 - a0) * i / (items.length - 1), x = C + r * Math.cos(ang), y = C + r * Math.sin(ang);
        const col = role === 'review' ? 'var(--review)' : 'var(--worker)';
        if (a.more) { nodes += `<g data-tip="+${a.more} ${AO.t('x.more')}"><circle cx="${x}" cy="${y}" r="${o.mini ? 8 : 13}" fill="var(--bg-hi)" stroke="${col}" stroke-dasharray="2 2"/><text x="${x}" y="${y + 3.5}" text-anchor="middle" font-size="${o.mini ? 7.5 : 10}" fill="var(--dim)">+${a.more}</text></g>`; return; }
        const rr = rad(a), on = a.status === 'run';
        edges += `<line x1="${C}" y1="${C}" x2="${x}" y2="${y}" stroke="${col}" stroke-opacity="${on ? .55 : .2}"/>`;
        if (on) packets += `<circle r="${o.mini ? 1.6 : 2.2}" fill="${col}"><animateMotion dur="3.2s" repeatCount="indefinite" path="M${x} ${y} L${C} ${C}"/><animate attributeName="opacity" values="0;1;1;0" dur="3.2s" repeatCount="indefinite"/></circle>`;
        const tip = `<b>${AO.esc(a.label)}</b>${AO.esc(a.desc || '')}<br>${AO.model(a.model)} · ${AO.tok(a.tok.cr + a.tok.cw + a.tok.out + a.tok.in)} · ${AO.usd(a.cost)}<br>${AO.t('st.' + a.status)}`;
        nodes += `<g data-tip="${AO.esc(tip)}"><circle cx="${x}" cy="${y}" r="${rr}" fill="var(--bg-hi)" stroke="${col}" stroke-opacity="${a.status === 'done' || a.status === 'stop' ? .55 : .95}"/>` +
          (on ? `<circle cx="${x}" cy="${y}" r="${rr + 5}" fill="none" stroke="${col}" stroke-width="1.2" stroke-dasharray="${rr} ${rr * 6}" stroke-linecap="round"><animateTransform attributeName="transform" type="rotate" from="0 ${x} ${y}" to="360 ${x} ${y}" dur="5s" repeatCount="indefinite"/></circle>` : '') + `</g>`;
        if (!o.mini) labels += `<text x="${x}" y="${y + (y >= C ? rr + (o.mini ? 10 : 14) : -rr - (o.mini ? 5 : 8))}" text-anchor="middle" font-size="${o.mini ? 8 : 11}" fill="var(--dim)">${AO.esc(a.label)}</text>`;
      });
    };
    place(groups.worker, Math.PI * .55, Math.PI * 1.45, groups.review.length ? R1 + 8 : R1 + 4, 'worker');
    place(groups.review, -Math.PI * .4, Math.PI * .4, R1 + 8, 'review');
    const cc = s.status === 'wait' ? 'var(--warn)' : 'var(--gold)', cr = o.mini ? 18 : 34;
    return `<svg viewBox="0 0 ${W} ${W}" width="100%" style="display:block;max-width:${W}px;margin:auto">
      <g style="transform-origin:${C}px ${C}px;animation:rot 140s linear infinite" fill="none"><circle cx="${C}" cy="${C}" r="${R2}" stroke="var(--txt)" stroke-opacity=".06"/><circle cx="${C}" cy="${C}" r="${R2}" stroke="${cc}" stroke-opacity=".5" stroke-dasharray="${R2 * .4} ${R2 * 6}" stroke-linecap="round"/></g>
      <circle cx="${C}" cy="${C}" r="${R1 + 8}" fill="none" stroke="var(--txt)" stroke-opacity=".05" stroke-dasharray="1 6"/>
      ${edges}${packets}
      <circle cx="${C}" cy="${C}" r="${cr * 1.8}" fill="${cc}" opacity=".07"><animate attributeName="r" values="${cr * 1.5};${cr * 1.9};${cr * 1.5}" dur="6s" repeatCount="indefinite"/></circle>
      <g data-tip="${AO.esc(`<b>${AO.t('r.main')}</b>${AO.model(main.model)} · ${AO.tok(main.ctx)} ${AO.t('k.context').toLowerCase()}`)}"><circle cx="${C}" cy="${C}" r="${cr}" fill="var(--bg-hi)" stroke="${cc}" stroke-opacity=".75"/>
      <text x="${C}" y="${C - (o.mini ? 1 : 3)}" text-anchor="middle" font-size="${o.mini ? 7 : 9}" letter-spacing="2" fill="var(--dim)">${subs.length ? subs.length + ' ' + (AO.lang === 'en' ? 'SUB' : 'CON') : (AO.lang === 'en' ? 'SOLO' : 'ĐƠN')}</text>
      <text x="${C}" y="${C + (o.mini ? 9 : 14)}" text-anchor="middle" font-size="${o.mini ? 9.5 : 14}" font-weight="300" fill="var(--txt)">${AO.tok(main.ctx)}</text></g>
      ${nodes}${labels}</svg>`;
  };
})();
