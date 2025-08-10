/* eslint-disable no-undef */
/*!
 * downloadHLSAsMP4.js
 * 將 HLS (m3u8) 以純 JS 下載（支援 AES-128）並用 mux.js 轉封裝(MP4 transmux)
 * Author: extracted & refactored from XPRAMT’s userscript logic
 * License: MIT
 */
(function (global) {
  'use strict';

  /**
   * 主函式：下載 HLS 為 MP4（包含：master/media m3u8 解析、TS 下載、AES-128 解密、mux.js 轉封裝）
   * @param {Object} options
   * @param {string} options.m3u8Url  Master 或 Media 的 m3u8 URL
   * @param {Object} [options.headers]  下載時要加的 HTTP 標頭（Userscript 環境可含 Referer/Origin）
   * @param {Object} [options.hearder]  同上，為相容舊拼字
   * @param {string} [options.fileName='video.mp4'] 輸出檔名
   * @param {boolean} [options.autoDownload=true]  是否自動觸發下載
   * @param {number} [options.concurrency=8]  同時下載切片數
   * @param {(p:Progress)=>void} [options.onProgress]  進度回呼：每完成一片段或進入新階段會呼叫
   * @param {(msg:string)=>void} [options.onStatus]  狀態訊息回呼（文字）
   * @param {AbortSignal} [options.signal]  可中止（AbortController.signal）
   * @param {string[]} [options.muxCdnCandidates]  自動載入 mux.js 的 CDN 候選
   * @returns {Promise<{blob: Blob, fileName: string, save: ()=>void}>}
   */
// ===================== 小工具 =====================
  const hasGM = typeof GM_xmlhttpRequest === 'function';

  function gmFetchText(url, headers = {}) {
    if (!hasGM) return fetch(url, { headers }).then(r => r.text());
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({ method: 'GET', url, headers, responseType: 'text', onload: r => resolve(r.responseText), onerror: reject, ontimeout: reject });
    });
  }
  function gmFetchArrayBuffer(url, headers = {}) {
    if (!hasGM) return fetch(url, { headers }).then(r => r.arrayBuffer());
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({ method: 'GET', url, headers, responseType: 'arraybuffer', onload: r => resolve(r.response), onerror: reject, ontimeout: reject });
    });
  }

  async function ensureMuxJS() {
    if (typeof muxjs !== 'undefined' || (typeof self !== 'undefined' && typeof self.muxjs !== 'undefined')) return;
    const candidates = [
      'https://cdn.jsdelivr.net/npm/mux.js@6.3.0/dist/mux.min.js',
      'https://unpkg.com/mux.js@6.3.0/dist/mux.min.js',
      'https://cdnjs.cloudflare.com/ajax/libs/mux.js/6.3.0/mux.min.js'
    ];
    let lastErr = null;
    for (const u of candidates) {
      try {
        const code = await gmFetchText(u);
        (new Function(code))();
        if (typeof muxjs !== 'undefined' || (typeof self !== 'undefined' && typeof self.muxjs !== 'undefined')) return;
      } catch (e) { lastErr = e; }
    }
    throw new Error('mux.js 載入失敗' + (lastErr ? `：${lastErr}` : ''));
  }

  function formatMB(n) {
    if (!Number.isFinite(n)) return 0;
    return Math.floor(n / 1048576);
  }

  function toAbs(u, base) { return new URL(u, base).href; }

  function parseMediaM3U8(text, base) {
    const lines = String(text).trim().split(/\r?\n/);
    const segments = [];
    let seq = 0, keyInfo = null, hasFMP4 = false;
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i].trim();
      if (!l) continue;
      if (l.startsWith('#EXT-X-MAP') && l.includes('URI=')) {
        hasFMP4 = true; // fMP4 流（.m4s），此流程不處理
      } else if (l.startsWith('#EXT-X-MEDIA-SEQUENCE')) {
        seq = parseInt(l.split(':')[1], 10) || 0;
      } else if (l.startsWith('#EXT-X-KEY')) {
        const raw = l.slice(l.indexOf(':') + 1);
        const attrs = {};
        raw.split(',').forEach(kv => {
          const [k, v] = kv.split('=');
          attrs[k.trim()] = v ? v.trim().replace(/^"|"$/g, '') : '';
        });
        keyInfo = { method: attrs.METHOD, uri: attrs.URI ? toAbs(attrs.URI, base) : null, iv: attrs.IV || null };
      } else if (!l.startsWith('#')) {
        const url = toAbs(l, base);
        segments.push({ url, sn: seq++ });
      }
    }
    return { segments, keyInfo, hasFMP4 };
  }

  function ivFromHex(ivStr) {
    const hex = ivStr.startsWith('0x') ? ivStr.slice(2) : ivStr;
    const out = new Uint8Array(16);
    for (let i = 0; i < 16; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    return out;
  }
  function ivFromSeq(sn) {
    const iv = new Uint8Array(16);
    const dv = new DataView(iv.buffer);
    dv.setUint32(12, sn >>> 0);
    return iv;
  }
  async function aes128cbcDecrypt(keyBytes, ivBytes, cipherBytes) {
    const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-CBC' }, false, ['decrypt']);
    const plain = await crypto.subtle.decrypt({ name: 'AES-CBC', iv: ivBytes }, key, cipherBytes);
    return new Uint8Array(plain);
  }

  async function yieldToUI() {
    await new Promise(requestAnimationFrame);
    await new Promise(r => setTimeout(r, 0));
  }

  // ===================== 訊息產生（集中於本檔） =====================
  function buildMsg(p) {
    const pct = (v) => (typeof v === 'number' ? `(${Math.max(0, Math.min(100, Math.round(v)))}%)` : '');
    switch (p.phase) {
      case 'prepare':
        return '準備中...';
      case 'master':
        return '解析清單...';
      case 'downloading': {
        const hasSeg = Number.isFinite(p.done) && Number.isFinite(p.total);
        const hasBytes = Number.isFinite(p.bytesDownloaded);
        const hasTotalBytes = Number.isFinite(p.totalBytes);
        let msg = '下載中';
        if (hasBytes && hasTotalBytes) msg += ` ${formatMB(p.bytesDownloaded)}/${formatMB(p.totalBytes)}MB`;
        else if (hasBytes) msg += ` ${formatMB(p.bytesDownloaded)}MB`;
        if (hasSeg) msg += ` ${p.done}/${p.total}`;
        if (typeof p.percent === 'number') msg += ` ${pct(p.percent)}`;
        return msg;
      }
      case 'transmux':
      case 'finalize':
        return '合併中...';
      case 'done':
        return '完成！';
      default:
        return p.status || '處理中...';
    }
  }

  function makeReporter(onProgress) {
    let last = {};
    return function report(patch) {
      const p = Object.assign({}, last, patch);
      if (!p.msg) p.msg = buildMsg(p);
      last = p;
      if (typeof onProgress === 'function') onProgress(p);
    };
  }

  // ===================== 主函式 =====================
  async function downloadHLSAsMP4(opts) {
    const {
      m3u8Url,
      fileName = 'video.mp4',
      headers = {},
      signal,
      onProgress
      // onStatus 不再必須，若外部仍傳入也不會破壞相容性
    } = opts || {};

    if (!m3u8Url) throw new Error('m3u8Url 必填');

    const report = makeReporter(onProgress);

    // ---- 準備 ----
    report({ phase: 'prepare', percent: 0 });

    const m3u8Text = await gmFetchText(m3u8Url, headers);
    report({ phase: 'master' });

    const { segments, keyInfo, hasFMP4 } = parseMediaM3U8(m3u8Text, m3u8Url);
    if (hasFMP4) throw new Error('偵測到 fMP4（.m4s）切片，目前僅支援 TS。');
    if (!segments.length) throw new Error('解析不到任何切片。');

    // ---- 金鑰 ----
    let keyBytes = null, useAES = false;
    if (keyInfo && keyInfo.method === 'AES-128' && keyInfo.uri) {
      const keyBuf = await gmFetchArrayBuffer(keyInfo.uri, headers);
      keyBytes = new Uint8Array(keyBuf);
      useAES = true;
    } else if (keyInfo && keyInfo.method && keyInfo.method !== 'NONE') {
      throw new Error('遇到非 AES-128 的加密（例如 SAMPLE-AES/DRM），純 JS 無法處理。');
    }

    // ---- 下載 ----
    const total = segments.length;
    const outTS = new Array(total);
    let done = 0, bytesDownloaded = 0;
    let aborted = false; if (signal) signal.addEventListener('abort', () => { aborted = true; });

    report({ phase: 'downloading', done, total, percent: 0, bytesDownloaded });

    const CONCURRENCY = 8;
    let cursor = 0;
    async function worker() {
      while (true) {
        const i = cursor++;
        if (i >= total) break;
        if (aborted) throw new DOMException('Aborted', 'AbortError');
        const seg = segments[i];
        const enc = new Uint8Array(await gmFetchArrayBuffer(seg.url, headers));
        let plain = enc;
        if (useAES) {
          const iv = keyInfo.iv ? ivFromHex(keyInfo.iv) : ivFromSeq(seg.sn);
          plain = await aes128cbcDecrypt(keyBytes, iv, enc);
        }
        outTS[i] = plain;
        done++;
        bytesDownloaded += plain.byteLength;
        const percent = Math.round((done / total) * 100);
        if (done % 2 === 0 || percent >= 99) { // 控制更新頻率
          report({ phase: 'downloading', done, total, percent, bytesDownloaded });
          await yieldToUI();
        }
      }
    }
    await Promise.all(Array(CONCURRENCY).fill(0).map(worker));

    // 讓「100%」能先畫出來
    await yieldToUI();

    // ---- 轉封裝 ----
    report({ phase: 'transmux', percent: 0 }); // 這裡會使呼叫端顯示「合併中...」
    await yieldToUI();

    await ensureMuxJS();
    const MUX = (typeof muxjs !== 'undefined') ? muxjs : (typeof self !== 'undefined' ? self.muxjs : null);
    const TransmuxerClass =
      (MUX && MUX.Transmuxer) ||
      (MUX && MUX.mp4 && MUX.mp4.Transmuxer) ||
      (MUX && MUX.flv && MUX.flv.Transmuxer) ||
      (MUX && MUX.partial && MUX.partial.Transmuxer);
    if (!MUX || !TransmuxerClass) throw new Error('mux.js 已載入，但未找到 Transmuxer 類別。');

    const transmuxer = new TransmuxerClass({ keepOriginalTimestamps: true });
    const mp4Parts = [];
    transmuxer.on('data', (segment) => {
      if (segment.initSegment) mp4Parts.push(segment.initSegment);
      if (segment.data) mp4Parts.push(segment.data);
    });

    // 簡易轉封裝進度（依筆數估計）：最多 50 次更新
    const batch = Math.max(1, Math.ceil(total / 50));
    for (let i = 0; i < outTS.length; i++) {
      transmuxer.push(outTS[i]);
      if ((i + 1) % batch === 0 || i === outTS.length - 1) {
        const percent = Math.round(((i + 1) / outTS.length) * 100);
        report({ phase: 'transmux', percent });
        await yieldToUI();
      }
    }
    transmuxer.flush();

    report({ phase: 'finalize' }); // 呼叫端仍會顯示「合併中...」
    await yieldToUI();

    const blob = new Blob(mp4Parts, { type: 'video/mp4' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = fileName.endsWith('.mp4') ? fileName : `${fileName}.mp4`;
    a.click();
    URL.revokeObjectURL(a.href);

    report({ phase: 'done', percent: 100, msg: '完成！' });
  }

  // 導出到全域（Userscript 以 @require 載入後可直接呼叫）
  if (typeof window !== 'undefined') window.downloadHLSAsMP4 = downloadHLSAsMP4;
  else if (typeof self !== 'undefined') self.downloadHLSAsMP4 = downloadHLSAsMP4;

})();
