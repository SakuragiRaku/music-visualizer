// app.js - ミュージックビジュアライザー

(() => {
  'use strict';

  // ============================================================
  // 定数 & 設定
  // ============================================================
  const SETTINGS_KEY = 'music-vis-settings';
  const MODES = ['bars', 'wave', 'circle', 'particles', 'kaleidoscope'];
  const COLORS = ['rainbow', 'neon', 'mono', 'ocean'];

  const defaults = {
    mode: 'bars',
    colorTheme: 'rainbow',
    fftSize: 2048,
    sensitivity: 1.5,
    bgAlpha: 0.15,
    videoBg: true,
    videoOpacity: 0.4,
  };

  function loadSettings() {
    try { return { ...defaults, ...JSON.parse(localStorage.getItem(SETTINGS_KEY)) }; }
    catch { return { ...defaults }; }
  }

  function saveSettings() {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }

  let settings = loadSettings();

  // ============================================================
  // DOM
  // ============================================================
  const canvas = document.getElementById('visualizer');
  const ctx = canvas.getContext('2d');
  const bgVideo = document.getElementById('bg-video');
  const startScreen = document.getElementById('start-screen');
  const startBtn = document.getElementById('start-btn');
  const controls = document.getElementById('controls');
  const toggleBtn = document.getElementById('toggle-btn');
  const toggleIcon = document.getElementById('toggle-icon');
  const modePills = document.getElementById('mode-pills');
  const colorPills = document.getElementById('color-pills');
  const sensitivitySlider = document.getElementById('sensitivity');
  const fullscreenBtn = document.getElementById('fullscreen-btn');
  const settingsBtn = document.getElementById('settings-btn');
  const settingsPanel = document.getElementById('settings-panel');
  const fftSelect = document.getElementById('fft-size');
  const bgAlphaSlider = document.getElementById('bg-alpha');
  const bgAlphaValue = document.getElementById('bg-alpha-value');
  const keyHint = document.getElementById('key-hint');
  const videoToggle = document.getElementById('video-toggle');
  const videoOpacitySlider = document.getElementById('video-opacity');

  // ============================================================
  // Canvas セットアップ
  // ============================================================
  let dpr = window.devicePixelRatio || 1;

  function resizeCanvas() {
    dpr = window.devicePixelRatio || 1;
    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  window.addEventListener('resize', resizeCanvas);
  resizeCanvas();

  // ============================================================
  // Audio セットアップ
  // ============================================================
  let audioContext = null;
  let analyser = null;
  let source = null;
  let stream = null;
  let isPlaying = false;
  let dataArray = null;
  let timeDataArray = null;

  async function startCapture() {
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
      });

      // 映像トラックを背景動画に接続
      const videoTracks = stream.getVideoTracks();
      if (videoTracks.length > 0 && settings.videoBg) {
        const videoStream = new MediaStream(videoTracks);
        bgVideo.srcObject = videoStream;
        bgVideo.play().catch(() => {});
        bgVideo.classList.remove('hidden-video');
        bgVideo.style.opacity = settings.videoOpacity;
      }

      const audioTracks = stream.getAudioTracks();
      if (audioTracks.length === 0) {
        alert('音声が取得できませんでした。\nタブを共有する際に「タブの音声も共有」にチェックを入れてください。');
        return false;
      }

      audioContext = new AudioContext();
      source = audioContext.createMediaStreamSource(stream);
      analyser = audioContext.createAnalyser();
      analyser.fftSize = settings.fftSize;
      analyser.smoothingTimeConstant = 0.8;
      source.connect(analyser);

      dataArray = new Uint8Array(analyser.frequencyBinCount);
      timeDataArray = new Uint8Array(analyser.fftSize);

      // トラック終了時
      audioTracks[0].addEventListener('ended', () => {
        stopCapture();
      });

      isPlaying = true;
      return true;
    } catch (err) {
      if (err.name !== 'NotAllowedError') {
        console.error('キャプチャエラー:', err);
      }
      return false;
    }
  }

  function stopCapture() {
    isPlaying = false;
    if (source) { try { source.disconnect(); } catch {} }
    if (stream) { stream.getTracks().forEach(t => t.stop()); }
    if (audioContext && audioContext.state !== 'closed') {
      audioContext.close().catch(() => {});
    }
    // 映像をクリーンアップ
    bgVideo.srcObject = null;
    bgVideo.classList.add('hidden-video');
    source = null;
    stream = null;
    audioContext = null;
    analyser = null;
    toggleIcon.textContent = '▶';
    toggleBtn.classList.remove('active');
  }

  function updateAnalyser() {
    if (!analyser) return;
    analyser.fftSize = settings.fftSize;
    dataArray = new Uint8Array(analyser.frequencyBinCount);
    timeDataArray = new Uint8Array(analyser.fftSize);
  }

  // ============================================================
  // カラーテーマ
  // ============================================================
  function getColor(i, total, value) {
    const norm = value / 255;
    switch (settings.colorTheme) {
      case 'rainbow': {
        const hue = (i / total) * 360;
        return `hsl(${hue}, 85%, ${45 + norm * 30}%)`;
      }
      case 'neon': {
        const colors = ['#00ffff', '#ff00ff', '#ffff00', '#00ff88', '#ff4488'];
        const idx = Math.floor((i / total) * colors.length);
        return colors[idx % colors.length];
      }
      case 'mono': {
        const b = Math.floor(150 + norm * 105);
        return `rgb(${b},${b},${b})`;
      }
      case 'ocean': {
        const hue = 180 + (i / total) * 40;
        return `hsl(${hue}, 70%, ${35 + norm * 40}%)`;
      }
      default:
        return '#58a6ff';
    }
  }

  function getGlowColor() {
    switch (settings.colorTheme) {
      case 'rainbow': return 'rgba(88, 166, 255, 0.3)';
      case 'neon': return 'rgba(255, 0, 255, 0.3)';
      case 'mono': return 'rgba(255, 255, 255, 0.2)';
      case 'ocean': return 'rgba(0, 200, 200, 0.3)';
      default: return 'rgba(88, 166, 255, 0.3)';
    }
  }

  // ============================================================
  // パーティクルシステム
  // ============================================================
  const particles = [];
  const MAX_PARTICLES = 200;

  function spawnParticles(energy) {
    const count = Math.floor(energy * 3 * settings.sensitivity);
    const w = window.innerWidth;
    const h = window.innerHeight;
    for (let i = 0; i < count && particles.length < MAX_PARTICLES; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 1 + Math.random() * 3 * energy;
      particles.push({
        x: w / 2 + (Math.random() - 0.5) * 100,
        y: h / 2 + (Math.random() - 0.5) * 100,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: 1 + Math.random() * 3,
        life: 1,
        decay: 0.005 + Math.random() * 0.02,
        hue: Math.random() * 360,
      });
    }
  }

  function updateParticles() {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.life -= p.decay;
      if (p.life <= 0) { particles.splice(i, 1); }
    }
  }

  // ============================================================
  // 描画ループ
  // ============================================================
  function draw() {
    requestAnimationFrame(draw);

    const w = window.innerWidth;
    const h = window.innerHeight;

    // 背景 (トレイル効果) - 映像背景時はclearRectで透過
    if (settings.videoBg && bgVideo.srcObject) {
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = `rgba(0, 0, 0, ${Math.max(0.02, settings.bgAlpha * 0.3)})`;
      ctx.fillRect(0, 0, w, h);
    } else {
      ctx.fillStyle = `rgba(0, 0, 0, ${settings.bgAlpha})`;
      ctx.fillRect(0, 0, w, h);
    }

    if (!isPlaying || !analyser) return;

    analyser.getByteFrequencyData(dataArray);
    analyser.getByteTimeDomainData(timeDataArray);

    const bufferLength = dataArray.length;
    const sens = settings.sensitivity;

    // 平均エネルギー
    let sum = 0;
    for (let i = 0; i < bufferLength; i++) sum += dataArray[i];
    const avgEnergy = (sum / bufferLength / 255) * sens;

    switch (settings.mode) {
      case 'bars': drawBars(w, h, bufferLength, sens); break;
      case 'wave': drawWave(w, h, sens); break;
      case 'circle': drawCircle(w, h, bufferLength, sens); break;
      case 'particles': drawParticles(w, h, avgEnergy, bufferLength, sens); break;
      case 'kaleidoscope': drawKaleidoscope(w, h, bufferLength, sens); break;
    }
  }

  // --- バー ---
  function drawBars(w, h, bufferLength, sens) {
    const bars = Math.min(bufferLength, 128);
    const barW = (w / bars) * 0.8;
    const gap = (w / bars) * 0.2;

    for (let i = 0; i < bars; i++) {
      const value = Math.min(255, dataArray[i] * sens);
      const barH = (value / 255) * h * 0.8;
      const x = i * (barW + gap);
      const y = h - barH;

      ctx.fillStyle = getColor(i, bars, value);
      ctx.shadowColor = getColor(i, bars, value);
      ctx.shadowBlur = value > 150 ? 15 : 0;

      ctx.beginPath();
      ctx.roundRect(x, y, barW, barH, barW / 3);
      ctx.fill();
      ctx.shadowBlur = 0;
    }
  }

  // --- ウェーブ ---
  function drawWave(w, h, sens) {
    const len = timeDataArray.length;
    const sliceW = w / len;

    ctx.lineWidth = 2.5;
    ctx.beginPath();

    for (let i = 0; i < len; i++) {
      const v = (timeDataArray[i] / 128.0 - 1) * sens;
      const y = h / 2 + v * h * 0.35;
      const x = i * sliceW;

      ctx.strokeStyle = getColor(i, len, Math.abs(v) * 255);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }

    ctx.shadowColor = getGlowColor();
    ctx.shadowBlur = 10;
    ctx.stroke();
    ctx.shadowBlur = 0;

    // ミラー
    ctx.globalAlpha = 0.3;
    ctx.beginPath();
    for (let i = 0; i < len; i++) {
      const v = (timeDataArray[i] / 128.0 - 1) * sens;
      const y = h / 2 - v * h * 0.35;
      const x = i * sliceW;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = getGlowColor();
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // --- サークル ---
  function drawCircle(w, h, bufferLength, sens) {
    const cx = w / 2;
    const cy = h / 2;
    const bars = Math.min(bufferLength, 180);
    const baseRadius = Math.min(w, h) * 0.15;

    for (let i = 0; i < bars; i++) {
      const value = Math.min(255, dataArray[i] * sens);
      const angle = (i / bars) * Math.PI * 2 - Math.PI / 2;
      const barLen = (value / 255) * Math.min(w, h) * 0.3;

      const x1 = cx + Math.cos(angle) * baseRadius;
      const y1 = cy + Math.sin(angle) * baseRadius;
      const x2 = cx + Math.cos(angle) * (baseRadius + barLen);
      const y2 = cy + Math.sin(angle) * (baseRadius + barLen);

      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.strokeStyle = getColor(i, bars, value);
      ctx.lineWidth = 2;
      ctx.shadowColor = getColor(i, bars, value);
      ctx.shadowBlur = value > 180 ? 12 : 0;
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    // 中心円
    let sum = 0;
    for (let i = 0; i < 20; i++) sum += dataArray[i];
    const bassEnergy = (sum / 20 / 255) * sens;

    ctx.beginPath();
    ctx.arc(cx, cy, baseRadius * (0.8 + bassEnergy * 0.3), 0, Math.PI * 2);
    ctx.strokeStyle = getGlowColor();
    ctx.lineWidth = 2;
    ctx.shadowColor = getGlowColor();
    ctx.shadowBlur = 20;
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  // --- パーティクル ---
  function drawParticles(w, h, avgEnergy, bufferLength, sens) {
    spawnParticles(avgEnergy);
    updateParticles();

    particles.forEach(p => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      const color = settings.colorTheme === 'mono'
        ? `rgba(255,255,255,${p.life})`
        : `hsla(${p.hue}, 80%, 60%, ${p.life})`;
      ctx.fillStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = 8;
      ctx.fill();
      ctx.shadowBlur = 0;
    });

    // バックグラウンドのサークル
    const bars = Math.min(bufferLength, 64);
    const cx = w / 2;
    const cy = h / 2;
    for (let i = 0; i < bars; i++) {
      const value = Math.min(255, dataArray[i] * sens);
      const angle = (i / bars) * Math.PI * 2;
      const r = 50 + (value / 255) * 100;
      const x = cx + Math.cos(angle) * r;
      const y = cy + Math.sin(angle) * r;
      ctx.beginPath();
      ctx.arc(x, y, 1.5, 0, Math.PI * 2);
      ctx.fillStyle = getColor(i, bars, value) + '60';
      ctx.fill();
    }
  }

  // --- 万華鏡 ---
  function drawKaleidoscope(w, h, bufferLength, sens) {
    const cx = w / 2;
    const cy = h / 2;
    const segments = 8;
    const bars = Math.min(bufferLength, 64);
    const time = Date.now() * 0.001;

    ctx.save();
    ctx.translate(cx, cy);

    for (let s = 0; s < segments; s++) {
      ctx.save();
      ctx.rotate((s / segments) * Math.PI * 2);
      if (s % 2 === 1) ctx.scale(1, -1);

      for (let i = 0; i < bars; i++) {
        const value = Math.min(255, dataArray[i] * sens);
        const norm = value / 255;
        const angle = (i / bars) * Math.PI * 0.25;
        const r = 30 + norm * Math.min(w, h) * 0.25;
        const x = Math.cos(angle + time * 0.3) * r;
        const y = Math.sin(angle + time * 0.3) * r;
        const size = 1 + norm * 4;

        ctx.beginPath();
        ctx.arc(x, y, size, 0, Math.PI * 2);
        ctx.fillStyle = getColor(i, bars, value);
        ctx.globalAlpha = 0.6 + norm * 0.4;
        ctx.fill();
      }

      ctx.restore();
    }

    ctx.restore();
    ctx.globalAlpha = 1;
  }

  // ============================================================
  // UI イベント
  // ============================================================

  // 開始ボタン
  startBtn.addEventListener('click', async () => {
    const success = await startCapture();
    if (success) {
      startScreen.classList.add('hidden');
      toggleIcon.textContent = '⏸';
      toggleBtn.classList.add('active');
    }
  });

  // トグルボタン
  toggleBtn.addEventListener('click', async () => {
    if (isPlaying) {
      stopCapture();
    } else {
      const success = await startCapture();
      if (success) {
        toggleIcon.textContent = '⏸';
        toggleBtn.classList.add('active');
      }
    }
  });

  // モード切替
  modePills.addEventListener('click', e => {
    const pill = e.target.closest('.pill');
    if (!pill) return;
    settings.mode = pill.dataset.mode;
    modePills.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
    pill.classList.add('active');
    saveSettings();
  });

  // カラー切替
  colorPills.addEventListener('click', e => {
    const pill = e.target.closest('.pill');
    if (!pill) return;
    settings.colorTheme = pill.dataset.color;
    colorPills.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
    pill.classList.add('active');
    saveSettings();
  });

  // 感度
  sensitivitySlider.addEventListener('input', e => {
    settings.sensitivity = parseFloat(e.target.value);
    saveSettings();
  });

  // フルスクリーン
  fullscreenBtn.addEventListener('click', toggleFullscreen);

  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  }

  // 設定パネル
  settingsBtn.addEventListener('click', () => {
    settingsPanel.classList.toggle('hidden');
  });

  document.getElementById('settings-close').addEventListener('click', () => {
    settingsPanel.classList.add('hidden');
  });

  fftSelect.addEventListener('change', e => {
    settings.fftSize = parseInt(e.target.value);
    updateAnalyser();
    saveSettings();
  });

  bgAlphaSlider.addEventListener('input', e => {
    settings.bgAlpha = parseFloat(e.target.value);
    bgAlphaValue.textContent = settings.bgAlpha.toFixed(2);
    saveSettings();
  });

  // --- 映像背景 ---
  videoToggle.addEventListener('click', () => {
    settings.videoBg = !settings.videoBg;
    videoToggle.classList.toggle('active', settings.videoBg);
    if (settings.videoBg && stream) {
      const videoTracks = stream.getVideoTracks();
      if (videoTracks.length > 0) {
        const videoStream = new MediaStream(videoTracks);
        bgVideo.srcObject = videoStream;
        bgVideo.play().catch(() => {});
        bgVideo.classList.remove('hidden-video');
        bgVideo.style.opacity = settings.videoOpacity;
      }
    } else {
      bgVideo.classList.add('hidden-video');
    }
    saveSettings();
  });

  videoOpacitySlider.addEventListener('input', e => {
    settings.videoOpacity = parseFloat(e.target.value);
    bgVideo.style.opacity = settings.videoOpacity;
    saveSettings();
  });

  // --- UI 自動隠し ---
  let uiTimeout = null;

  function showUI() {
    document.body.classList.add('show-cursor');
    controls.classList.remove('hidden-ui');
    keyHint.classList.remove('hidden-ui');
    clearTimeout(uiTimeout);
    uiTimeout = setTimeout(hideUI, 3000);
  }

  function hideUI() {
    if (settingsPanel.classList.contains('hidden')) {
      document.body.classList.remove('show-cursor');
      controls.classList.add('hidden-ui');
      keyHint.classList.add('hidden-ui');
    }
  }

  document.addEventListener('mousemove', showUI);
  document.addEventListener('click', showUI);
  showUI();

  // --- キーボードショートカット ---
  document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;

    showUI();

    switch (e.code) {
      case 'Space':
        e.preventDefault();
        toggleBtn.click();
        break;
      case 'Digit1': case 'Digit2': case 'Digit3': case 'Digit4': case 'Digit5': {
        const idx = parseInt(e.key) - 1;
        const mode = MODES[idx];
        if (mode) {
          settings.mode = mode;
          modePills.querySelectorAll('.pill').forEach(p =>
            p.classList.toggle('active', p.dataset.mode === mode)
          );
          saveSettings();
        }
        break;
      }
      case 'KeyC': {
        const idx = COLORS.indexOf(settings.colorTheme);
        const next = COLORS[(idx + 1) % COLORS.length];
        settings.colorTheme = next;
        colorPills.querySelectorAll('.pill').forEach(p =>
          p.classList.toggle('active', p.dataset.color === next)
        );
        saveSettings();
        break;
      }
      case 'KeyV':
        videoToggle.click();
        break;
      case 'KeyF':
        toggleFullscreen();
        break;
    }
  });

  // --- 設定復元 ---
  function restoreUI() {
    modePills.querySelectorAll('.pill').forEach(p =>
      p.classList.toggle('active', p.dataset.mode === settings.mode)
    );
    colorPills.querySelectorAll('.pill').forEach(p =>
      p.classList.toggle('active', p.dataset.color === settings.colorTheme)
    );
    sensitivitySlider.value = settings.sensitivity;
    fftSelect.value = settings.fftSize;
    bgAlphaSlider.value = settings.bgAlpha;
    bgAlphaValue.textContent = settings.bgAlpha.toFixed(2);
    videoToggle.classList.toggle('active', settings.videoBg);
    videoOpacitySlider.value = settings.videoOpacity;
    bgVideo.style.opacity = settings.videoOpacity;
    if (!settings.videoBg) bgVideo.classList.add('hidden-video');
  }

  restoreUI();

  // 描画ループ開始
  draw();
})();
