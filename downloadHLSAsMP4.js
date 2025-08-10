/*
 * downloadHLSAsMP4.js — 集中產生訊息（msg）版
 * -------------------------------------------------
 * 用法（Usage）
 * -------------------------------------------------
 * await downloadHLSAsMP4({
 *   m3u8Url: 'https://.../chunklist.m3u8',         // 必填：媒體 m3u8（非 master）
 *   fileName: 'video.mp4',                          // 選填：輸出檔名（副檔名可省略）
 *   headers: { Origin: 'https://ani.gamer.com.tw',  // 選填：自訂標頭，常用為 Origin/Referer
 *             Referer: location.href },
 *   signal: abortController?.signal,                // 選填：AbortSignal（中止下載）
 *   onProgress: (p) => {                            // 回呼：每次進度更新都會帶出 p.msg
 *     // p: { phase, percent, done, total, bytesDownloaded, msg }
 *     infoDisplay.textContent = p.msg;              // 主程式只需顯示 p.msg
 *   },
 *   concurrency: 8                                  // 選填：同時下載分段數（預設 8）
 * });
 *
 * 注意（Notes）
 * - 僅支援 TS 切片 + 可選 AES-128 (AES-CBC)；不支援 SAMPLE-AES/DRM 與 fMP4(.m4s) 切片。
 * - 若頁面已有 mux.js，此檔會直接使用；否則會嘗試從 CDN 載入。
 * - 訊息（msg）統一由本檔產生，階段：prepare → master → downloading → transmux → finalize → done。
 * - 下載完成後會觸發瀏覽器下載（Blob 連結）。
 */
(function () {
  'use strict';

  // ===================== 型別註解（JSDoc） =====================
  /**
   * @typedef {Object} ProgressPayload
   * @property {'prepare'|'master'|'downloading'|'transmux'|'finalize'|'done'} phase
   * @property {number} [percent]
   * @property {number} [done]
   * @property {number} [total]
   * @property {number} [bytesDownloaded]
   * @property {string} msg
   */

  /**
   * @typedef {Object} HLSOptions
   * @property {string} m3u8Url
   * @property {string} [fileName]
   * @property {Object.<string,string>} [headers]
   * @property {AbortSignal} [signal]
   * @property {(p: ProgressPayload)=>void} [onProgress]
   * @property {number} [concurrency]
   */

  // ===================== 小工具 =====================
  const hasGM = typeof GM_xmlhttpRequest === 'function';

  function gmFetchText(url, headers = {}) {
    if (!hasGM) return fetch(url, { headers }).then(r => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.text();
    });
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({ method: 'GET', url, headers, responseType: 'text', onload: r => resolve(r.responseText), onerror: reject, ontimeout: reject });
    });
  }
  function gmFetchArrayBuffer(url, headers = {}) {
    if (!hasGM) return fetch(url, { headers }).then(r => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.arrayBuffer();
    });
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

  function toAbs(u, base) { return new URL(u, base).href; }

  function parseMediaM3U8(text, base) {
    const lines = String(text).trim().split(/
?
/);
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
  function formatMB(n) {
    if (!Number.isFinite(n)) return 0;
    return Math.floor(n / 1048576);
  }
  function pctStr(v) {
    return (typeof v === 'number') ? `(${Math.max(0, Math.min(100, Math.round(v)))}%)` : '';
  }
  function buildMsg(p) {
    switch (p.phase) {
      case 'prepare': return '準備中...';
      case 'master': return '解析清單...';
      case 'downloading': {
        const parts = ['下載中'];
        if (Number.isFinite(p.bytesDownloaded)) parts.push(`${formatMB(p.bytesDownloaded)}MB`);
        if (Number.isFinite(p.done) && Number.isFinite(p.total)) parts.push(`${p.done}/${p.total}`);
        if (Number.isFinite(p.percent)) parts.push(pctStr(p.percent));
        return parts.join(' ');
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
      const p = Object.assign({ phase: 'prepare', done: 0, total: 0, percent: 0, bytesDownloaded: 0 }, last, patch);
      p.msg = buildMsg(p);
      console.log(p.msg)
      last = p;
      if (typeof onProgress === 'function') onProgress(p);
    };
  }

  // ===================== 主函式 =====================
  /** @param {HLSOptions} opts */
  async function downloadHLSAsMP4(opts) {
    const {
      m3u8Url,
      fileName = 'video.mp4',
      headers = {},
      signal,
      onProgress,
      concurrency = 8
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

    const CONCURRENCY = Math.max(1, Math.floor(concurrency));
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
        if (done % 2 === 0 || percent >= 99) {
          report({ phase: 'downloading', done, total, percent, bytesDownloaded });
          await yieldToUI();
        }
      }
    }

    await Promise.all(Array(CONCURRENCY).fill(0).map(worker));

    // 讓 100% 與最後一筆下載進度先呈現
    report({ phase: 'downloading', done, total, percent: 100, bytesDownloaded });
    await yieldToUI();

    // ---- 轉封裝 ----
    report({ phase: 'transmux', percent: 0 }); // 呼叫端會顯示「合併中...」
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
    const batch = Math.max(1, Math.ceil(outTS.length / 50));
    for (let i = 0; i < outTS.length; i++) {
      transmuxer.push(outTS[i]);
      if ((i + 1) % batch === 0 || i === outTS.length - 1) {
        const percent = Math.round(((i + 1) / outTS.length) * 100);
        report({ phase: 'transmux', percent });
        await yieldToUI();
      }
    }
    transmuxer.flush();

    report({ phase: 'finalize' }); // 仍顯示「合併中...」
    await yieldToUI();

    const blob = new Blob(mp4Parts, { type: 'video/mp4' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = fileName.endsWith('.mp4') ? fileName : `${fileName}.mp4`;
    a.click();
    URL.revokeObjectURL(a.href);

    report({ phase: 'done', percent: 100, msg: '完成！' });
  }

  // 導出到全域
  if (typeof window !== 'undefined') window.downloadHLSAsMP4 = downloadHLSAsMP4;
  else if (typeof self !== 'undefined') self.downloadHLSAsMP4 = downloadHLSAsMP4;
})();
