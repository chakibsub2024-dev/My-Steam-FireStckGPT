// Playback engine: attaches a source to a <video> using the right technology
// (hls.js, dash.js or native), exposes tracks/qualities, and reports classified
// fatal errors so the player can retry or fail over.

const scripts = {};
function loadScript(src) {
  scripts[src] ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = resolve;
    s.onerror = () => { delete scripts[src]; reject(new Error(`Could not load ${src}`)); };
    document.head.append(s);
  });
  return scripts[src];
}

export class PlaybackError extends Error {
  constructor(kind, message, { transient = false } = {}) {
    super(message);
    this.kind = kind; // network | media | format | timeout
    this.transient = transient;
  }
}

const MEDIA_ERR = { 1: ['media', 'Playback aborted'], 2: ['network', 'Network error while loading video'], 3: ['media', 'The video could not be decoded'], 4: ['format', 'This format/codec is not supported by this device'] };

export class Engine {
  constructor(video) {
    this.video = video;
    this.kind = null;
    this.hls = null;
    this.dash = null;
    this.listeners = {};
    this.recovered = { network: 0, media: 0 };
  }

  on(evt, fn) { (this.listeners[evt] ||= []).push(fn); }
  emit(evt, ...a) { (this.listeners[evt] || []).forEach((fn) => fn(...a)); }

  /** Load a source; resolves once metadata is ready, rejects with PlaybackError. */
  load(source, { startAt = 0, timeoutMs = 25000 } = {}) {
    this.destroy();
    this.source = source;
    this.recovered = { network: 0, media: 0 };
    const v = this.video;
    return new Promise((resolve, reject) => {
      let settled = false;
      const done = (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        v.removeEventListener('loadedmetadata', onMeta);
        if (err) reject(err); else resolve();
      };
      const onMeta = () => {
        if (startAt > 0 && Number.isFinite(v.duration) && startAt < v.duration - 5) v.currentTime = startAt;
        done();
      };
      const timer = setTimeout(() => done(new PlaybackError('timeout', 'The source took too long to start', { transient: true })), timeoutMs);
      this.failStart = done;
      v.addEventListener('loadedmetadata', onMeta);
      this.#attach(source).catch((err) => done(err instanceof PlaybackError ? err : new PlaybackError('format', err.message)));
    });
  }

  /** Called on errors after startup; before startup errors reject load(). */
  #fatal(err) {
    if (this.failStart) {
      // Still starting: reject load() only, so the caller handles it once.
      const f = this.failStart;
      this.failStart = null;
      f(err);
      return;
    }
    this.emit('fatal', err);
  }

  async #attach(s) {
    const v = this.video;
    v.addEventListener('error', this.onVideoError = () => {
      if (this.hls || this.dash) return; // handled by the library
      const [kind, msg] = MEDIA_ERR[v.error?.code] || ['media', 'Playback error'];
      this.#fatal(new PlaybackError(kind, msg, { transient: kind === 'network' }));
    });
    if (s.format === 'hls') {
      const nativeHls = v.canPlayType('application/vnd.apple.mpegurl');
      await loadScript('/vendor/hls.min.js').catch(() => null);
      if (window.Hls?.isSupported()) return this.#attachHls(s);
      if (nativeHls) { this.kind = 'native'; v.src = s.url; return undefined; }
      throw new PlaybackError('format', 'HLS is not supported on this device');
    }
    if (s.format === 'dash') {
      await loadScript('/vendor/dash.all.min.js');
      if (!window.dashjs?.supportsMediaSource?.()) throw new PlaybackError('format', 'DASH is not supported on this device');
      return this.#attachDash(s);
    }
    if (s.format === 'mkv' && !v.canPlayType('video/x-matroska') && !v.canPlayType('video/webm')) {
      throw new PlaybackError('format', 'MKV is not supported on this device');
    }
    this.kind = 'native';
    v.src = s.url;
    return undefined;
  }

  #attachHls(s) {
    const Hls = window.Hls;
    const hls = new Hls({ enableWorker: true, lowLatencyMode: false, backBufferLength: 60, renderTextTracksNatively: true, manifestLoadingMaxRetry: 2, levelLoadingMaxRetry: 2, fragLoadingMaxRetry: 3 });
    this.hls = hls;
    this.kind = 'hls';
    hls.on(Hls.Events.ERROR, (_e, data) => {
      if (!data.fatal) return;
      if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
        const notFound = data.response && [401, 403, 404, 410].includes(data.response.code);
        if (!notFound && this.recovered.network < 1 && !this.failStart) { this.recovered.network++; hls.startLoad(); return; }
        this.#fatal(new PlaybackError('network', notFound ? `Source unavailable (HTTP ${data.response.code})` : `Network error (${data.details})`, { transient: !notFound }));
      } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR && this.recovered.media < 2) {
        this.recovered.media++;
        hls.recoverMediaError();
      } else {
        this.#fatal(new PlaybackError(data.type === Hls.ErrorTypes.MEDIA_ERROR ? 'media' : 'format', `HLS error: ${data.details}`));
      }
    });
    hls.on(Hls.Events.MANIFEST_PARSED, () => this.emit('tracks'));
    hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, () => this.emit('tracks'));
    hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, () => this.emit('tracks'));
    hls.on(Hls.Events.LEVEL_SWITCHED, () => this.emit('quality'));
    hls.loadSource(s.url);
    hls.attachMedia(this.video);
  }

  #attachDash(s) {
    const player = window.dashjs.MediaPlayer().create();
    this.dash = player;
    this.kind = 'dash';
    player.updateSettings({ debug: { logLevel: 1 }, streaming: { abr: { autoSwitchBitrate: { video: true } } } });
    const E = window.dashjs.MediaPlayer.events;
    player.on(E.ERROR, (e) => {
      const code = e?.error?.code;
      const msg = e?.error?.message || 'DASH error';
      // 25-27: manifest / download errors
      this.#fatal(new PlaybackError(code >= 25 && code <= 31 ? 'network' : 'media', `DASH: ${msg}`, { transient: false }));
    });
    player.on(E.STREAM_INITIALIZED, () => this.emit('tracks'));
    player.on(E.QUALITY_CHANGE_RENDERED, () => this.emit('quality'));
    player.initialize(this.video, s.url, false);
  }

  started() { this.failStart = null; }

  // ------------------------------------------------------------------ tracks
  audioTracks() {
    if (this.hls) return this.hls.audioTracks.map((t, i) => ({ id: i, label: t.name || t.lang || `Track ${i + 1}`, lang: t.lang || '', active: i === this.hls.audioTrack }));
    if (this.dash) {
      const cur = this.dash.getCurrentTrackFor('audio');
      return this.dash.getTracksFor('audio').map((t, i) => ({ id: i, label: (t.labels?.[0]?.text) || t.lang || `Track ${i + 1}`, lang: t.lang || '', active: cur && t.id === cur.id && t.lang === cur.lang, _t: t }));
    }
    const at = this.video.audioTracks;
    if (at && at.length > 1) return [...at].map((t, i) => ({ id: i, label: t.label || t.language || `Track ${i + 1}`, lang: t.language || '', active: t.enabled }));
    return [];
  }

  setAudio(id) {
    if (this.hls) this.hls.audioTrack = id;
    else if (this.dash) this.dash.setCurrentTrack(this.dash.getTracksFor('audio')[id]);
    else if (this.video.audioTracks) [...this.video.audioTracks].forEach((t, i) => { t.enabled = i === id; });
    this.emit('tracks');
  }

  qualities() {
    if (this.hls) {
      return [{ id: -1, label: 'Auto', active: this.hls.autoLevelEnabled }, ...this.hls.levels.map((l, i) => ({ id: i, label: l.height ? `${l.height}p` : `${Math.round(l.bitrate / 1000)} kbps`, active: !this.hls.autoLevelEnabled && this.hls.currentLevel === i }))];
    }
    if (this.dash) {
      const list = this.dash.getBitrateInfoListFor('video') || [];
      const auto = this.dash.getSettings().streaming.abr.autoSwitchBitrate.video;
      const cur = this.dash.getQualityFor('video');
      return [{ id: -1, label: 'Auto', active: auto }, ...list.map((b, i) => ({ id: i, label: b.height ? `${b.height}p` : `${Math.round(b.bitrate / 1000)} kbps`, active: !auto && cur === i }))];
    }
    return [];
  }

  setQuality(id) {
    if (this.hls) {
      this.hls.currentLevel = id;
    } else if (this.dash) {
      this.dash.updateSettings({ streaming: { abr: { autoSwitchBitrate: { video: id === -1 } } } });
      if (id >= 0) this.dash.setQualityFor('video', id, true);
    }
    this.emit('quality');
  }

  destroy() {
    try { this.hls?.destroy(); } catch { /* ignore */ }
    try { this.dash?.reset(); } catch { /* ignore */ }
    this.hls = null;
    this.dash = null;
    this.failStart = null;
    if (this.onVideoError) this.video.removeEventListener('error', this.onVideoError);
    const v = this.video;
    [...v.querySelectorAll('track')].forEach((t) => t.remove());
    v.removeAttribute('src');
    try { v.load(); } catch { /* ignore */ }
  }
}

/** Decide what to do after a failure: retry the same source once if transient, else move on. */
export function nextAction(err, attemptsOnSource, failoverEnabled) {
  if (err.transient && attemptsOnSource < 2) return 'retry';
  return failoverEnabled ? 'next' : 'stop';
}
