// MyStream player: source selection + automatic failover, custom controls,
// subtitles/audio/quality/speed, resume, next episode, keyboard and TV remote.
import { get, patch, post } from '../api.js';
import { Engine, nextAction } from '../player/engine.js';
import { fmtTime, h, isBackKey, mount, toast } from '../ui.js';
import { moveFocus } from '../spatial.js';
import { sourcesTable } from './title.js';

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];
const LANG = new Intl.DisplayNames(['en'], { type: 'language' });
const langName = (c) => { try { return c ? LANG.of(c) : ''; } catch { return c; } };

function nextEpisodeOf(details, s, e) {
  const idx = details.seasons.findIndex((x) => x.number === s);
  if (idx < 0) return null;
  if (e < details.seasons[idx].episodes) return { season: s, episode: e + 1 };
  const nxt = details.seasons[idx + 1];
  return nxt ? { season: nxt.number, episode: 1 } : null;
}

export async function playerView({ params, query, navigate, setCleanup }) {
  const type = params.type;
  const id = Number(params.id);
  const season = type === 'tv' ? Number(query.get('s') || 1) : null;
  const episode = type === 'tv' ? Number(query.get('e') || 1) : null;
  const wanted = query.get('src');
  const key = `${type}:${id}`;
  const epQ = type === 'tv' ? `?season=${season}&episode=${episode}` : '';

  const [details, session, streams, subsRes, seasonData] = await Promise.all([
    get(`/media/${type}/${id}`),
    post('/playback/session', { key, season, episode }),
    get(`/media/${type}/${id}/streams${epQ}`),
    get(`/media/${type}/${id}/subtitles${epQ}`).catch(() => ({ subtitles: [] })),
    type === 'tv' ? get(`/media/tv/${id}/season/${season}`).catch(() => null) : null,
  ]);
  const prefs = session.preferences;
  const epInfo = seasonData?.episodes.find((x) => x.number === episode);
  const next = type === 'tv' ? nextEpisodeOf(details, season, episode) : null;
  const backHref = `/title/${type}/${id}`;

  // ---------------------------------------------------------------- DOM
  // No crossOrigin attribute: direct MP4 hosts often send no CORS headers. Subtitle
  // tracks are same-origin (served by the API), so they still load.
  const video = h('video', { class: 'video', playsInline: true, preload: 'auto' });
  const embedHost = h('div', { class: 'embed-host', hidden: true });
  const status = h('div', { class: 'player-status', role: 'status' });
  const errorPanel = h('div', { class: 'player-error', hidden: true });
  const titleText = type === 'tv' ? `${details.title} · S${season} E${episode}${epInfo ? ` · ${epInfo.name}` : ''}` : details.title;
  const seek = h('input', { type: 'range', class: 'seek', min: 0, max: 1000, value: 0, step: 1, 'aria-label': 'Seek' });
  const timeLabel = h('span', { class: 'time' }, '0:00 / 0:00');
  const btn = (label, text, onclick, extra = {}) => h('button', { class: 'pbtn', type: 'button', 'aria-label': label, title: label, onclick, ...extra }, text);
  const playBtn = btn('Play/Pause (Space)', '▶', () => togglePlay());
  const muteBtn = btn('Mute (M)', '🔊', () => { video.muted = !video.muted; paintVolume(); });
  const vol = h('input', { type: 'range', class: 'vol', min: 0, max: 1, step: 0.05, value: 1, 'aria-label': 'Volume' });
  const menuHost = h('div', { class: 'menu', hidden: true, role: 'menu' });
  const subBtn = btn('Subtitles (C)', 'CC', () => openMenu('subs'));
  const audioBtn = btn('Audio', '🎧', () => openMenu('audio'));
  const qualBtn = btn('Quality', 'HD', () => openMenu('quality'));
  const speedBtn = btn('Speed', '1×', () => openMenu('speed'));
  const srcBtn = btn('Sources', '☰', () => openMenu('sources'));
  const pipBtn = document.pictureInPictureEnabled ? btn('Picture in picture', '⧉', () => togglePip()) : null;
  const fsBtn = btn('Full screen (F)', '⛶', () => toggleFs());
  const nextBtn = next ? btn('Next episode (N)', '⏭', () => goNext()) : null;
  const controls = h('div', { class: 'controls' },
    h('div', { class: 'seek-row' }, seek),
    h('div', { class: 'ctrl-row' },
      playBtn, btn('Back 10s (←)', '↺10', () => skip(-10)), btn('Forward 10s (→)', '10↻', () => skip(10)),
      muteBtn, vol, timeLabel, h('span', { class: 'spacer' }),
      nextBtn, subBtn, audioBtn, qualBtn, speedBtn, srcBtn, pipBtn, fsBtn));
  const topbar = h('div', { class: 'player-top' },
    h('button', { class: 'pbtn back', type: 'button', 'aria-label': 'Back', onclick: () => leave() }, '←'),
    h('div', { class: 'player-title' }, h('strong', {}, titleText), h('span', { class: 'muted small source-label' })));
  const nextOverlay = h('div', { class: 'next-overlay', hidden: true });
  const root = h('div', { class: 'player sub-' + (prefs.subtitleStyle?.size || 'medium') + ' subbg-' + (prefs.subtitleStyle?.background || 'shadow'), 'data-own-keys': '', tabindex: '-1' },
    video, embedHost, status, errorPanel, nextOverlay, topbar, controls, menuHost);

  // ---------------------------------------------------------------- sources & failover
  const engine = new Engine(video);
  const candidates = streams.sources.filter((s) => s.compatible && (s.native || s.format === 'embed'));
  let index = Math.max(0, wanted ? candidates.findIndex((s) => s.id === wanted) : 0);
  let attempts = 0;
  let lastTime = session.resumeAt || 0;
  const tried = [];
  let current = null;
  let destroyed = false;

  function setStatus(text) {
    status.textContent = text || '';
    status.hidden = !text;
  }

  function showError(title, detail) {
    setStatus('');
    mount(errorPanel,
      h('h2', {}, title), h('p', { class: 'muted' }, detail),
      tried.length ? h('ul', { class: 'tried' }, tried.map((t) => h('li', {}, `${t.provider} (${t.format.toUpperCase()}): ${t.error}`))) : null,
      h('div', { class: 'btn-row center' },
        h('button', { class: 'btn btn-primary', onclick: () => { tried.length = 0; index = 0; attempts = 0; errorPanel.hidden = true; start(); } }, 'Try again'),
        h('button', { class: 'btn', onclick: () => openMenu('sources') }, 'Choose source'),
        h('button', { class: 'btn btn-ghost', onclick: () => leave() }, 'Back')));
    errorPanel.hidden = false;
    errorPanel.querySelector('button')?.focus();
  }

  async function start() {
    if (destroyed) return;
    current = candidates[index];
    if (!current) {
      if (!candidates.length) {
        const why = streams.sources.length ? 'Sources were found but none can play in MyStream (e.g. torrents or links needing special headers).' : (streams.addons.length ? 'Your add-ons returned no sources for this title.' : 'No add-ons are installed and embedded players are turned off.');
        showError('No playable source', why);
      } else {
        showError('Could not play this title', 'Every available source failed.');
      }
      return;
    }
    errorPanel.hidden = true;
    root.querySelector('.source-label').textContent = ` · ${current.provider}${current.quality ? ` ${current.quality}` : ''} · ${current.format.toUpperCase()}`;
    if (current.format === 'embed') return startEmbed(current);
    embedHost.hidden = true;
    embedHost.replaceChildren();
    video.hidden = false;
    controls.hidden = false;
    setStatus(`Loading ${current.provider}${index ? ` (source ${index + 1} of ${candidates.length})` : ''}…`);
    try {
      await engine.load(current, { startAt: lastTime });
      if (destroyed) return;
      engine.started();
      attempts = 0;
      setStatus('');
      addSubtitleTracks(current);
      applyPreferences();
      await video.play().catch(() => { /* autoplay blocked: user presses play */ });
      paintAll();
    } catch (err) {
      if (!destroyed) fail(err);
    }
  }

  function fail(err) {
    if (Number.isFinite(video.currentTime) && video.currentTime > 1) lastTime = video.currentTime;
    attempts += 1;
    const action = nextAction(err, attempts, streams.failover);
    if (action === 'retry') {
      setStatus(`${err.message}. Retrying…`);
      setTimeout(start, 1500);
      return;
    }
    tried.push({ provider: current.provider, format: current.format, error: err.message });
    if (action === 'stop') {
      showError('Playback failed', `${err.message}. Automatic failover is off; choose another source.`);
      return;
    }
    index += 1;
    attempts = 0;
    if (candidates[index]) {
      toast(`${current.provider} failed (${err.message}). Trying the next source…`, 'error');
      start();
    } else {
      start(); // shows the final error
    }
  }

  engine.on('fatal', (err) => fail(err));

  function startEmbed(s) {
    engine.destroy();
    setStatus('');
    video.hidden = true;
    controls.hidden = true;
    embedHost.hidden = false;
    // Third-party player page: no access to MyStream (cross-origin). The desktop
    // app additionally blocks its pop-ups and navigation.
    mount(embedHost, h('iframe', {
      src: s.url, title: `${s.provider} player`, allow: 'autoplay; fullscreen; picture-in-picture; encrypted-media',
      allowFullscreen: true, referrerPolicy: 'strict-origin-when-cross-origin',
    }), h('p', { class: 'embed-note small' }, `${s.provider} is a third-party player: its own controls, subtitles and ads apply. Progress cannot be tracked inside it.`));
    saveProgress(true);
  }

  // ---------------------------------------------------------------- subtitles / audio / quality
  const external = subsRes.subtitles || [];
  function addSubtitleTracks(s) {
    const seen = new Set();
    for (const t of [...(s.subtitles || []), ...external]) {
      if (seen.has(t.url)) continue;
      seen.add(t.url);
      video.append(h('track', { kind: 'subtitles', src: t.url, srclang: t.lang || 'und', label: t.label || langName(t.lang) || 'Subtitles', onload: () => liftCues() }));
    }
    for (const tt of video.textTracks) tt.mode = 'disabled';
  }

  function textTracks() {
    return [...video.textTracks].filter((t) => t.kind === 'subtitles' || t.kind === 'captions');
  }

  let lastSub = -1;
  function toggleSubtitles() {
    const tracks = textTracks();
    if (tracks.some((t) => t.mode === 'showing')) return setSubtitle(-1);
    let i = lastSub;
    if (i < 0 || i >= tracks.length) i = tracks.findIndex((t) => prefs.subtitleLang && (t.language || '').toLowerCase().startsWith(prefs.subtitleLang));
    return setSubtitle(i >= 0 ? i : 0);
  }

  // Remember the viewer's choice (language, or off) on their profile for next time.
  function rememberSubtitle(i) {
    const t = textTracks()[i];
    const lang = i >= 0 && t ? (t.language || '').toLowerCase().split('-')[0] : '';
    if (lang === (prefs.subtitleLang || '')) return;
    prefs.subtitleLang = lang;
    patch('/profiles/me/preferences', { subtitleLang: lang }).catch(() => {});
  }

  function setSubtitle(i, { remember = true } = {}) {
    if (remember) rememberSubtitle(i);
    if (i >= 0) lastSub = i;
    textTracks().forEach((t, n) => { t.mode = n === i ? 'showing' : 'disabled'; });
    liftCues();
    paintAll();
  }

  // Keep subtitles above the control bar while it is visible.
  function liftCues() {
    const up = root.classList.contains('show-ui');
    for (const t of textTracks()) {
      if (t.mode !== 'showing' || !t.cues) continue;
      for (const c of t.cues) { try { c.line = up ? -4 : 'auto'; } catch { /* some cue types are read-only */ } }
    }
  }
  video.textTracks.addEventListener?.('change', liftCues);
  new MutationObserver(liftCues).observe(root, { attributes: true, attributeFilter: ['class'] });

  function applyPreferences() {
    if (prefs.audioLang) {
      const a = engine.audioTracks().find((t) => (t.lang || '').toLowerCase().startsWith(prefs.audioLang));
      if (a && !a.active) engine.setAudio(a.id);
    }
    // HLS/DASH text tracks may appear slightly later; try now and once more.
    const pick = () => {
      if (!prefs.subtitleLang) return;
      const tracks = textTracks();
      const i = tracks.findIndex((t) => (t.language || '').toLowerCase().startsWith(prefs.subtitleLang));
      if (i >= 0 && !tracks.some((t) => t.mode === 'showing')) setSubtitle(i, { remember: false });
    };
    pick();
    setTimeout(pick, 1500);
  }

  function openMenu(kind) {
    const items = [];
    let title = '';
    if (kind === 'subs') {
      // On/Off switch on top; picking a language below also turns subtitles on.
      const tracks = textTracks();
      const showing = tracks.findIndex((t) => t.mode === 'showing');
      const on = showing >= 0;
      const sw = h('button', {
        class: `switch ${on ? 'on' : ''}`, role: 'switch', 'aria-checked': String(on), 'aria-label': 'Subtitles', disabled: !tracks.length,
        onclick: () => { toggleSubtitles(); openMenu('subs'); },
      }, h('span', { class: 'switch-knob' }), h('span', { class: 'switch-label' }, on ? 'On' : 'Off'));
      mount(menuHost, h('div', { class: 'menu-head' }, h('strong', {}, 'Subtitles'), sw, h('button', { class: 'pbtn', 'aria-label': 'Close', onclick: closeMenu }, '✕')),
        tracks.length
          ? tracks.map((t, i) => h('button', { class: `menu-item ${i === showing ? 'on' : ''}`, role: 'menuitemradio', 'aria-checked': String(i === showing), onclick: () => { setSubtitle(i); closeMenu(); } },
            i === showing ? '✓ ' : '', t.label || langName(t.language) || `Track ${i + 1}`))
          : h('p', { class: 'muted small menu-empty' }, 'No subtitles for this source'));
      menuHost.classList.remove('wide');
      menuHost.hidden = false;
      sw.focus();
      return;
    } else if (kind === 'audio') {
      title = 'Audio';
      const tracks = engine.audioTracks();
      if (!tracks.length) items.push({ label: 'Only one audio track', disabled: true });
      tracks.forEach((t) => items.push({ label: t.label + (t.lang && !t.label.includes(t.lang) ? ` (${langName(t.lang)})` : ''), active: t.active, run: () => engine.setAudio(t.id) }));
    } else if (kind === 'quality') {
      title = 'Quality';
      const q = engine.qualities();
      if (q.length <= 2) items.push({ label: q.length ? 'Single quality stream' : 'Fixed quality (direct file)', disabled: true });
      else q.forEach((x) => items.push({ label: x.label, active: x.active, run: () => engine.setQuality(x.id) }));
    } else if (kind === 'speed') {
      title = 'Playback speed';
      SPEEDS.forEach((s) => items.push({ label: s === 1 ? 'Normal' : `${s}×`, active: video.playbackRate === s, run: () => { video.playbackRate = s; paintAll(); } }));
    } else if (kind === 'sources') {
      title = 'Sources';
      mount(menuHost, h('div', { class: 'menu-head' }, h('strong', {}, title), h('button', { class: 'pbtn', 'aria-label': 'Close', onclick: closeMenu }, '✕')),
        sourcesTable(streams.sources, (s) => {
          closeMenu();
          const i = candidates.findIndex((c) => c.id === s.id);
          if (i < 0) return;
          if (Number.isFinite(video.currentTime) && video.currentTime > 1) lastTime = video.currentTime;
          index = i;
          attempts = 0;
          start();
        }),
        streams.addons.filter((a) => a.error).map((a) => h('p', { class: 'small form-error' }, `${a.addon}: ${a.error}`)));
      menuHost.classList.add('wide');
      menuHost.hidden = false;
      menuHost.querySelector('button.source:not([disabled])')?.focus();
      return;
    }
    menuHost.classList.remove('wide');
    mount(menuHost, h('div', { class: 'menu-head' }, h('strong', {}, title), h('button', { class: 'pbtn', 'aria-label': 'Close', onclick: closeMenu }, '✕')),
      items.map((it) => h('button', { class: `menu-item ${it.active ? 'on' : ''}`, role: 'menuitemradio', 'aria-checked': String(!!it.active), disabled: !!it.disabled, onclick: () => { it.run?.(); closeMenu(); } }, it.active ? '✓ ' : '', it.label)));
    menuHost.hidden = false;
    (menuHost.querySelector('.menu-item.on') || menuHost.querySelector('.menu-item:not([disabled])') || menuHost.querySelector('button'))?.focus();
  }

  function closeMenu() {
    menuHost.hidden = true;
    playBtn.focus({ preventScroll: true });
  }

  // ---------------------------------------------------------------- controls
  const togglePlay = () => (video.paused ? video.play().catch(() => {}) : video.pause());
  const skip = (d) => { if (Number.isFinite(video.duration)) video.currentTime = Math.max(0, Math.min(video.duration - 1, video.currentTime + d)); showControls(); };
  const toggleFs = () => (document.fullscreenElement ? document.exitFullscreen() : root.requestFullscreen?.()).catch?.(() => {});
  const togglePip = () => (document.pictureInPictureElement ? document.exitPictureInPicture() : video.requestPictureInPicture()).catch(() => toast('Picture-in-picture not available for this source'));
  function paintVolume() {
    muteBtn.textContent = video.muted || video.volume === 0 ? '🔇' : '🔊';
    vol.value = video.muted ? 0 : video.volume;
  }
  function paintAll() {
    playBtn.textContent = video.paused ? '▶' : '❚❚';
    speedBtn.textContent = `${video.playbackRate}×`;
    subBtn.classList.toggle('on', textTracks().some((t) => t.mode === 'showing'));
    audioBtn.hidden = engine.audioTracks().length < 2;
    qualBtn.hidden = engine.qualities().length <= 2;
    paintVolume();
  }
  vol.addEventListener('input', () => { video.volume = Number(vol.value); video.muted = video.volume === 0; paintVolume(); });
  let seeking = false;
  seek.addEventListener('input', () => { seeking = true; if (Number.isFinite(video.duration)) timeLabel.textContent = `${fmtTime((seek.value / 1000) * video.duration)} / ${fmtTime(video.duration)}`; });
  seek.addEventListener('change', () => { if (Number.isFinite(video.duration)) video.currentTime = (seek.value / 1000) * video.duration; seeking = false; });
  video.addEventListener('timeupdate', () => {
    if (!Number.isFinite(video.duration)) return;
    if (!seeking) seek.value = String(Math.round((video.currentTime / video.duration) * 1000));
    timeLabel.textContent = `${fmtTime(video.currentTime)} / ${fmtTime(video.duration)}`;
    if (video.currentTime > 1) lastTime = video.currentTime;
    if (nextBtn) nextBtn.classList.toggle('pulse', video.duration - video.currentTime < 60);
  });
  // Android app: keep the TV/phone screen on while a video plays.
  const keepAwake = (on) => { try { window.MyStreamAndroid?.keepScreenOn(!!on); } catch { /* not in the app */ } };
  video.addEventListener('play', () => { paintAll(); showControls(); keepAwake(true); });
  video.addEventListener('pause', () => { paintAll(); showControls(true); saveProgress(); keepAwake(false); });
  video.addEventListener('waiting', () => setStatus('Buffering…'));
  video.addEventListener('playing', () => setStatus(''));
  video.addEventListener('volumechange', paintVolume);
  video.addEventListener('click', () => togglePlay());
  video.addEventListener('dblclick', () => toggleFs());
  video.addEventListener('ended', () => {
    keepAwake(false);
    saveProgress();
    if (next) countdownNext();
  });
  video.textTracks.addEventListener?.('addtrack', () => paintAll());
  engine.on('tracks', paintAll);
  engine.on('quality', paintAll);

  let hideTimer;
  function showControls(sticky = false) {
    root.classList.add('show-ui');
    clearTimeout(hideTimer);
    if (!sticky && !video.paused) hideTimer = setTimeout(() => { if (menuHost.hidden && !video.paused) root.classList.remove('show-ui'); }, 3500);
  }
  root.addEventListener('mousemove', () => showControls());
  root.addEventListener('focusin', () => showControls());

  // ---------------------------------------------------------------- next episode
  function goNext() {
    if (!next) return;
    saveProgress();
    navigate(`/watch/tv/${id}?s=${next.season}&e=${next.episode}`, { replace: true });
  }
  function countdownNext() {
    let n = 8;
    const cancel = h('button', { class: 'btn btn-ghost', onclick: () => { clearInterval(t); nextOverlay.hidden = true; } }, 'Cancel');
    const go = h('button', { class: 'btn btn-primary', onclick: goNext }, 'Play now');
    const label = h('p', {});
    mount(nextOverlay, h('strong', {}, `Next: S${next.season} E${next.episode}`), label, h('div', { class: 'btn-row' }, go, cancel));
    nextOverlay.hidden = false;
    go.focus();
    const tick = () => { label.textContent = `Starting in ${n}s`; if (n-- <= 0) { clearInterval(t); goNext(); } };
    const t = setInterval(tick, 1000);
    tick();
  }

  // ---------------------------------------------------------------- progress
  let lastSaved = 0;
  function progressBody() {
    return {
      key, season, episode, position: Math.floor(lastTime), duration: Math.floor(Number.isFinite(video.duration) ? video.duration : 0),
      title: details.title, poster: details.poster, backdrop: details.backdrop, year: details.year, episodeName: epInfo?.name || '',
    };
  }
  function saveProgress(force = false) {
    const body = progressBody();
    if (!force && (!body.duration || body.position < 5)) return;
    lastSaved = Date.now();
    post('/playback/progress', body).catch(() => {});
  }
  const saveTimer = setInterval(() => { if (!video.paused && Date.now() - lastSaved > 10000) saveProgress(); }, 2000);
  const onUnload = () => {
    const body = progressBody();
    if (body.duration) fetch('/api/playback/progress', { method: 'POST', keepalive: true, credentials: 'include', headers: { 'Content-Type': 'application/json', 'X-MyStream': '1' }, body: JSON.stringify(body) }).catch(() => {});
  };
  addEventListener('pagehide', onUnload);

  // ---------------------------------------------------------------- keys (keyboard + TV remote)
  function leave() {
    saveProgress();
    if (history.length > 1) history.back();
    else navigate(backHref);
  }
  root.addEventListener('keydown', (e) => {
    showControls();
    if (isBackKey(e)) {
      e.preventDefault();
      e.stopPropagation();
      if (!menuHost.hidden) return closeMenu();
      if (document.fullscreenElement) return document.exitFullscreen();
      return leave();
    }
    const inUi = e.target.closest('.controls, .menu, .player-top, .player-error, .next-overlay') && e.target !== seek;
    const arrows = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
    if (arrows.includes(e.key) && inUi) {
      // Navigating between buttons with the D-pad.
      const dir = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' }[e.key];
      const scope = !menuHost.hidden ? menuHost : !errorPanel.hidden ? errorPanel : !nextOverlay.hidden ? nextOverlay : root;
      if (moveFocus(dir, scope) || dir !== 'down') { e.preventDefault(); return undefined; }
    }
    const k = e.key;
    if (k === ' ' || k === 'k' || k === 'MediaPlayPause' || (k === 'Enter' && !inUi)) { e.preventDefault(); togglePlay(); }
    else if (k === 'MediaPlay') video.play();
    else if (k === 'MediaPause') video.pause();
    else if (k === 'ArrowLeft' || k === 'j' || k === 'MediaRewind') { e.preventDefault(); skip(-10); }
    else if (k === 'ArrowRight' || k === 'l' || k === 'MediaFastForward') { e.preventDefault(); skip(10); }
    else if (k === 'ArrowUp') { e.preventDefault(); if (e.target === video || e.target === root) { playBtn.focus(); } else { video.volume = Math.min(1, video.volume + 0.1); } }
    else if (k === 'ArrowDown') { e.preventDefault(); video.volume = Math.max(0, video.volume - 0.1); }
    else if (k === 'm') { video.muted = !video.muted; }
    else if (k === 'f') toggleFs();
    else if (k === 'c') toggleSubtitles();
    else if (k === 'n' || k === 'MediaTrackNext') goNext();
    else if (/^[0-9]$/.test(k) && Number.isFinite(video.duration)) video.currentTime = (Number(k) / 10) * video.duration;
    return undefined;
  });

  setCleanup(() => {
    destroyed = true;
    keepAwake(false);
    saveProgress();
    clearInterval(saveTimer);
    clearTimeout(hideTimer);
    removeEventListener('pagehide', onUnload);
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    engine.destroy();
  });

  setTimeout(() => { root.focus({ preventScroll: true }); start(); }, 0);
  showControls(true);
  return root;
}
