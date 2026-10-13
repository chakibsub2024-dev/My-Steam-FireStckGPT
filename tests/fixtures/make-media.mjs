// Generates small, license-free test media with ffmpeg (test pattern + tones):
// MP4, multi-audio HLS (English + French), multi-audio DASH, and an SRT file.
// Codecs: VP9 video + Opus audio in MP4/fMP4 containers. Open-source Chromium
// (used by the automated browser tests) has no H.264/AAC decoder, while VP9/Opus
// plays in Chromium, Chrome, Edge, Firefox and Electron.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), 'media');
const ff = (args) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' });
const SECONDS = '24';
const src = [
  '-f', 'lavfi', '-i', `testsrc2=size=640x360:rate=25:duration=${SECONDS}`,
  '-f', 'lavfi', '-i', `sine=frequency=440:duration=${SECONDS}`,
  '-f', 'lavfi', '-i', `sine=frequency=660:duration=${SECONDS}`,
];
const enc = ['-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '8', '-row-mt', '1', '-b:v', '400k', '-pix_fmt', 'yuv420p', '-g', '50', '-keyint_min', '50',
  '-c:a', 'libopus', '-b:a', '64k', '-ac', '2', '-strict', '-2'];

export function makeMedia(force = false) {
  if (!force && fs.existsSync(path.join(out, 'dash', 'manifest.mpd'))) return out;
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(path.join(out, 'hls'), { recursive: true });
  fs.mkdirSync(path.join(out, 'dash'), { recursive: true });
  // MP4 (single audio)
  ff([...src.slice(0, 8), '-map', '0:v', '-map', '1:a', ...enc, '-movflags', '+faststart', path.join(out, 'movie.mp4')]);
  // HLS: one video rendition + two audio renditions (en, fr)
  ff([...src, '-map', '0:v', '-map', '1:a', '-map', '2:a', ...enc,
    '-f', 'hls', '-hls_time', '4', '-hls_playlist_type', 'vod', '-hls_segment_type', 'fmp4',
    '-hls_fmp4_init_filename', '%v_init.mp4', '-hls_segment_filename', path.join(out, 'hls', '%v_%03d.m4s'),
    '-master_pl_name', 'master.m3u8',
    '-var_stream_map', 'v:0,agroup:aud,name:video a:0,agroup:aud,language:en,name:audio_en,default:yes a:1,agroup:aud,language:fr,name:audio_fr',
    path.join(out, 'hls', '%v.m3u8')]);
  // DASH: video + two audio adaptation sets with language tags
  ff([...src, '-map', '0:v', '-map', '1:a', '-map', '2:a', ...enc,
    '-metadata:s:a:0', 'language=eng', '-metadata:s:a:1', 'language=fra',
    '-f', 'dash', '-dash_segment_type', 'mp4', '-seg_duration', '4', '-use_template', '1', '-use_timeline', '0',
    '-adaptation_sets', 'id=0,streams=v id=1,streams=1 id=2,streams=2',
    path.join(out, 'dash', 'manifest.mpd')]);
  fs.writeFileSync(path.join(out, 'subs-en.srt'), '1\r\n00:00:01,000 --> 00:00:04,000\r\nHello from MyStream\r\n\r\n2\r\n00:00:05,000 --> 00:00:08,500\r\nSecond <i>subtitle</i> line\r\n');
  fs.writeFileSync(path.join(out, 'subs-fr.srt'), '1\n00:00:01,000 --> 00:00:04,000\nBonjour de MyStream\n');
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  makeMedia(process.argv.includes('--force'));
  console.log('media ready in', out);
}
