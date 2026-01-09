import {
  extractSerialFromQRText,
  extractZFromQRText,
  normalizeSerial,
  serialFromZHex,
} from "./src/serial.js";
import QrScanner from "https://unpkg.com/qr-scanner@1.4.2/qr-scanner.min.js";

const PERSIST_KEY = "hue-reset-settings";
const DEFAULTS = {
  mqttUrl: "ws://localhost:9001",
  username: "",
  password: "",
  baseTopic: "zigbee2mqtt",
  subscribeResponses: true,
  autoConnect: true,
  clientId: "",
  extendedPanId: "",
};

const els = {
  mqttForm: document.getElementById("mqtt-form"),
  mqttUrl: document.getElementById("mqtt-url"),
  mqttUser: document.getElementById("mqtt-username"),
  mqttPass: document.getElementById("mqtt-password"),
  baseTopic: document.getElementById("base-topic"),
  subscribeResponses: document.getElementById("subscribe-responses"),
  autoConnect: document.getElementById("auto-connect"),
  clientId: document.getElementById("client-id"),
  extendedPanId: document.getElementById("extended-pan-id"),
  connectBtn: document.getElementById("connect-btn"),
  disconnectBtn: document.getElementById("disconnect-btn"),
  cameraStatus: document.getElementById("camera-status"),
  startScanBtn: document.getElementById("start-scan"),
  stopScanBtn: document.getElementById("stop-scan"),
  scanSection: document.getElementById("scan-section"),
  video: document.getElementById("video"),
  cameraSelect: document.getElementById("camera-select"),
  zoomSlider: document.getElementById("zoom-slider"),
  zoomValue: document.getElementById("zoom-value"),
  torchBtn: document.getElementById("torch-btn"),
  photoBtn: document.getElementById("photo-btn"),
  photoInput: document.getElementById("photo-input"),
  dropZone: document.getElementById("drop-zone"),
  detectedSerial: document.getElementById("detected-serial"),
  manualSerial: document.getElementById("manual-serial"),
  sendManualBtn: document.getElementById("send-manual"),
  qrText: document.getElementById("qr-text"),
  log: document.getElementById("log"),
};

const state = {
  mqttClient: null,
  mqttConnected: false,
  scanControls: null,
  qrReader: null,
  qrScanner: null,
  scanning: false,
  lastQrText: "",
  lastQrAt: 0,
  lastSerial: "",
  lastSentAt: 0,
  processing: false,
  audioCtx: null,
  lastBeepAt: 0,
  torchOn: false,
  zoomMode: "virtual",
  virtualZoom: 1,
  autoCamera: true,
};

function logLine(message, level = "info") {
  const line = document.createElement("div");
  line.className = `log-line log-${level}`;
  line.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
  els.log.prepend(line);
}

function setStatus(el, text, level = "idle") {
  if (!el) return;
  el.textContent = text;
  el.dataset.state = level;
}

function setConnectState(state) {
  const button = els.connectBtn;
  if (!button) return;
  button.dataset.state = state;
  switch (state) {
    case "busy":
      button.textContent = "Connecting…";
      button.disabled = true;
      break;
    case "connected":
      button.textContent = "Connected";
      button.disabled = true;
      break;
    default:
      button.textContent = "Connect";
      button.disabled = false;
  }
}

function focusScanSection() {
  if (!els.scanSection) return;
  els.scanSection.scrollIntoView({ behavior: "smooth", block: "start" });
}


function saveSettings() {
  const settings = {
    mqttUrl: els.mqttUrl.value.trim(),
    username: els.mqttUser.value,
    password: els.mqttPass.value,
    baseTopic: els.baseTopic.value.trim(),
    subscribeResponses: els.subscribeResponses.checked,
    autoConnect: els.autoConnect.checked,
    extendedPanId: els.extendedPanId.value.trim(),
  };
  localStorage.setItem(PERSIST_KEY, JSON.stringify(settings));
}

function loadSettings() {
  let stored = {};
  try {
    stored = JSON.parse(localStorage.getItem(PERSIST_KEY)) || {};
  } catch (err) {
    stored = {};
  }
  const clientId = `hue-reset-${Math.random().toString(16).slice(2, 10)}`;
  els.mqttUrl.value = stored.mqttUrl || DEFAULTS.mqttUrl;
  els.mqttUser.value = stored.username ?? DEFAULTS.username;
  els.mqttPass.value = stored.password ?? DEFAULTS.password;
  els.baseTopic.value = stored.baseTopic || DEFAULTS.baseTopic;
  els.subscribeResponses.checked =
    stored.subscribeResponses ?? DEFAULTS.subscribeResponses;
  els.autoConnect.checked = stored.autoConnect ?? DEFAULTS.autoConnect;
  els.clientId.value = clientId;
  els.extendedPanId.value = stored.extendedPanId ?? DEFAULTS.extendedPanId;
}

function isWebSocketUrl(url) {
  return /^wss?:\/\//i.test(url);
}

function connectMqtt() {
  if (!window.mqtt) {
    logLine("MQTT library failed to load.", "error");
    return;
  }

  const url = els.mqttUrl.value.trim();
  if (!url) {
    logLine("Enter a WebSocket URL first.", "error");
    return;
  }
  if (!isWebSocketUrl(url)) {
    logLine("WebSocket URL must start with ws:// or wss://", "error");
    return;
  }

  disconnectMqtt();
  const options = {
    username: els.mqttUser.value.trim() || undefined,
    password: els.mqttPass.value || undefined,
    clientId: els.clientId.value.trim() || undefined,
    clean: true,
    keepalive: 30,
    reconnectPeriod: 2000,
    connectTimeout: 5000,
  };

  setConnectState("busy");
  state.mqttClient = window.mqtt.connect(url, options);

  state.mqttClient.on("connect", () => {
    state.mqttConnected = true;
    setConnectState("connected");
    logLine("MQTT connected.", "ok");

    const base = els.baseTopic.value.trim();
    if (base && els.subscribeResponses.checked) {
      const responseTopic = `${base}/bridge/response/action`;
      state.mqttClient.subscribe(responseTopic, (err) => {
        if (err) {
          logLine(`Subscribe failed: ${err.message}`, "error");
        } else {
          logLine(`Subscribed to ${responseTopic}`, "ok");
        }
      });
    }

    focusScanSection();
    if (!state.scanning && state.autoCamera) {
      startScan();
    }
  });

  state.mqttClient.on("reconnect", () => {
    setConnectState("busy");
    logLine("MQTT reconnecting…", "warn");
  });

  state.mqttClient.on("close", () => {
    if (state.mqttConnected) {
      logLine("MQTT disconnected.", "warn");
    }
    state.mqttConnected = false;
    setConnectState("idle");
  });

  state.mqttClient.on("offline", () => {
    logLine("MQTT offline.", "warn");
  });

  state.mqttClient.on("disconnect", (packet) => {
    if (packet?.reasonCode != null) {
      logLine(`MQTT disconnect: reason ${packet.reasonCode}`, "warn");
    }
    if (packet?.reasonString) {
      logLine(`MQTT disconnect: ${packet.reasonString}`, "warn");
    }
  });

  state.mqttClient.on("error", (err) => {
    logLine(`MQTT error: ${err.message}`, "error");
    setConnectState("idle");
  });

  state.mqttClient.on("message", (topic, payload) => {
    try {
      const message = JSON.parse(payload.toString());
      logLine(`Response on ${topic}: ${JSON.stringify(message)}`, "ok");
    } catch (err) {
      logLine(`Response on ${topic}: ${payload.toString()}`, "ok");
    }
  });

  saveSettings();
}

function disconnectMqtt() {
  if (!state.mqttClient) return;
  state.mqttClient.end(true);
  state.mqttClient = null;
  state.mqttConnected = false;
  setConnectState("idle");
}

function canSendSerial(serial) {
  const now = Date.now();
  if (serial === state.lastSerial && now - state.lastSentAt < 20000) {
    return false;
  }
  return true;
}

function publishReset(serial, source) {
  if (!state.mqttConnected || !state.mqttClient) {
    logLine(`Serial ${serial} detected from ${source}, but MQTT is not connected.`, "warn");
    return;
  }

  const base = els.baseTopic.value.trim() || DEFAULTS.baseTopic;
  const topic = `${base}/bridge/request/action`;
  const payload = {
    action: "philips_hue_factory_reset",
    params: {
      serial_numbers: [serial],
    },
  };

  const panId = els.extendedPanId.value.trim();
  if (panId) {
    payload.params.extended_pan_id = panId;
  }

  state.mqttClient.publish(topic, JSON.stringify(payload), (err) => {
    if (err) {
      logLine(`Failed to publish reset: ${err.message}`, "error");
    } else {
      logLine(`Reset sent for serial ${serial} (${source}).`, "ok");
    }
  });
}

function handleSerial(serial, source) {
  const normalized = normalizeSerial(serial);
  if (!normalized) {
    logLine(`Invalid serial '${serial}' from ${source}.`, "warn");
    return;
  }

  els.detectedSerial.value = normalized;
  if (!canSendSerial(normalized)) {
    return;
  }

  state.lastSerial = normalized;
  state.lastSentAt = Date.now();
  void beep();
  publishReset(normalized, source);
}

function getScanRegion(video) {
  const base = Math.round((2 / 3) * Math.min(video.videoWidth, video.videoHeight));
  const zoom = state.zoomMode === "virtual" ? state.virtualZoom || 1 : 1;
  const size = Math.max(1, Math.round(base / zoom));
  return {
    x: Math.round((video.videoWidth - size) / 2),
    y: Math.round((video.videoHeight - size) / 2),
    width: size,
    height: size,
    downScaledWidth: 400,
    downScaledHeight: 400,
  };
}

async function handleQrResult(result) {
  if (!result) return;
  const qrText = typeof result === "string" ? result : result.data || "";
  const now = Date.now();

  if (qrText && qrText === state.lastQrText && now - state.lastQrAt < 1000) {
    return;
  }
  state.lastQrText = qrText;
  state.lastQrAt = now;
  els.qrText.textContent = qrText || "—";

  const zHex = extractZFromQRText(qrText);
  if (zHex) {
    if (state.processing) return;
    state.processing = true;
    try {
      const derivedSerial = await serialFromZHex(zHex);
      if (derivedSerial) {
        handleSerial(derivedSerial, "qr");
      } else {
        logLine("QR detected, but failed to derive serial from Z field.", "warn");
      }
    } catch (err) {
      logLine(`SHA-256 error: ${err.message}`, "error");
    } finally {
      state.processing = false;
    }
    return;
  }

  const serialFromQr = extractSerialFromQRText(qrText);
  if (serialFromQr) {
    handleSerial(serialFromQr, "qr");
  } else if (qrText) {
    logLine("QR detected, but no Z field or serial found.", "warn");
  }
}

async function startScan() {
  if (state.scanning) return;
  state.scanning = true;
  state.autoCamera = true;
  setStatus(els.cameraStatus, "Starting camera…", "busy");

  try {
    if (!QrScanner) {
      throw new Error("QR scanner library failed to load.");
    }

    state.qrScanner = new QrScanner(
      els.video,
      (result) => handleQrResult(result),
      {
        preferredCamera: "environment",
        calculateScanRegion: getScanRegion,
        returnDetailedScanResult: true,
        onDecodeError: () => {},
      }
    );

    await state.qrScanner.start();
    await refreshCameraControls();
    setStatus(els.cameraStatus, "Scanning", "ok");
  } catch (err) {
    setStatus(els.cameraStatus, "Camera blocked", "error");
    logLine(`Camera error: ${err.message}`, "error");
    state.scanning = false;
  }
}

function stopScan() {
  if (!state.scanning) return;
  state.scanning = false;
  state.autoCamera = false;
  if (state.qrScanner) {
    state.qrScanner.stop();
    state.qrScanner.destroy();
    state.qrScanner = null;
  }

  const stream = els.video.srcObject;
  if (stream && stream.getTracks) {
    stream.getTracks().forEach((track) => track.stop());
  }
  els.video.srcObject = null;
  setStatus(els.cameraStatus, "Idle", "idle");
  setCameraControlsEnabled(false);
  applyVirtualZoom(1);
}

async function handleManualSend() {
  const serial = normalizeSerial(els.manualSerial.value.trim());
  if (!serial) {
    logLine("Enter a 6-character serial (hex).", "warn");
    return;
  }
  await ensureAudioContext();
  handleSerial(serial, "manual");
}

async function ensureAudioContext() {
  if (!window.AudioContext && !window.webkitAudioContext) {
    return null;
  }
  if (!state.audioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    state.audioCtx = new Ctx();
  }
  if (state.audioCtx.state === "suspended") {
    try {
      await state.audioCtx.resume();
    } catch (err) {
      return state.audioCtx;
    }
  }
  return state.audioCtx;
}

async function beep(volume = 0.4) {
  const now = Date.now();
  if (now - state.lastBeepAt < 1500) return;
  state.lastBeepAt = now;
  const ctx = await ensureAudioContext();
  if (!ctx) return;

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "square";
  osc.frequency.setValueAtTime(880, ctx.currentTime);
  gain.gain.setValueAtTime(0.0001, ctx.currentTime);
  const level = Math.max(0.02, Math.min(0.8, volume));
  gain.gain.exponentialRampToValueAtTime(level, ctx.currentTime + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.12);
  osc.connect(gain).connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + 0.14);
}

function getVideoTrack() {
  const stream = els.video.srcObject;
  if (!stream || !stream.getVideoTracks) return null;
  return stream.getVideoTracks()[0] || null;
}

function setCameraControlsEnabled(enabled) {
  els.cameraSelect.disabled = !enabled;
  els.zoomSlider.disabled = !enabled;
  els.torchBtn.disabled = !enabled;
}

function getCameraLabelScore(label) {
  if (!label) return 0;
  const lower = label.toLowerCase();
  if (lower.includes("back") || lower.includes("rear") || lower.includes("environment")) {
    return 3;
  }
  if (lower.includes("front")) return 1;
  return 2;
}

async function updateCameraList() {
  if (!QrScanner) return;
  const cameras = await QrScanner.listCameras(true);
  els.cameraSelect.innerHTML = "";

  if (!cameras.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No cameras found";
    els.cameraSelect.appendChild(option);
    els.cameraSelect.disabled = true;
    return;
  }

  const track = getVideoTrack();
  const currentId = track?.getSettings?.().deviceId;
  let bestId = cameras[0].id;
  let bestScore = -1;

  cameras.forEach((camera) => {
    const option = document.createElement("option");
    option.value = camera.id;
    option.textContent = camera.label || `Camera ${els.cameraSelect.length + 1}`;
    els.cameraSelect.appendChild(option);
    const score = getCameraLabelScore(camera.label);
    if (score > bestScore) {
      bestScore = score;
      bestId = camera.id;
    }
  });

  const targetId = currentId || bestId;
  els.cameraSelect.value = targetId;

  if (state.qrScanner && currentId && targetId !== currentId) {
    await state.qrScanner.setCamera(targetId);
  }
}

function updateZoomValue(value, virtual = false) {
  const num = Number(value || 1);
  els.zoomValue.textContent = virtual
    ? `${num.toFixed(1)}× (virtual)`
    : `${num.toFixed(1)}×`;
}

function applyVirtualZoom(scale) {
  const value = Number(scale) || 1;
  els.video.style.transform = `scale(${value})`;
  els.video.style.transformOrigin = "center center";
}

async function applyZoom(value) {
  const zoom = Number(value);
  if (state.zoomMode === "virtual") {
    state.virtualZoom = zoom || 1;
    applyVirtualZoom(state.virtualZoom);
    return;
  }
  const track = getVideoTrack();
  if (!track) return;
  try {
    await track.applyConstraints({ advanced: [{ zoom }] });
  } catch (err) {
    try {
      await track.applyConstraints({ zoom });
    } catch (innerErr) {
      logLine(`Zoom failed: ${innerErr.message}`, "warn");
    }
  }
}

async function updateZoomControls() {
  const track = getVideoTrack();
  const caps = track?.getCapabilities?.();
  if (!caps?.zoom) {
    state.zoomMode = "virtual";
    const value = state.virtualZoom || 1;
    els.zoomSlider.min = "1";
    els.zoomSlider.max = "3";
    els.zoomSlider.step = "0.1";
    els.zoomSlider.value = String(value);
    els.zoomSlider.disabled = false;
    updateZoomValue(value, true);
    applyVirtualZoom(value);
    return;
  }

  const settings = track.getSettings?.();
  const min = caps.zoom.min ?? 1;
  const max = caps.zoom.max ?? min;
  const step = caps.zoom.step ?? 0.1;
  const value = settings?.zoom ?? min;
  state.zoomMode = "hardware";
  els.zoomSlider.min = String(min);
  els.zoomSlider.max = String(max);
  els.zoomSlider.step = String(step);
  els.zoomSlider.value = String(value);
  els.zoomSlider.disabled = false;
  updateZoomValue(value, false);
  applyVirtualZoom(1);
}

async function updateTorchControls() {
  if (!state.qrScanner) {
    els.torchBtn.disabled = true;
    els.torchBtn.textContent = "Toggle torch";
    return;
  }
  const hasFlash = await state.qrScanner.hasFlash();
  els.torchBtn.disabled = !hasFlash;
  if (!hasFlash) {
    els.torchBtn.textContent = "Torch unavailable";
    state.torchOn = false;
    return;
  }
  state.torchOn = state.qrScanner.isFlashOn();
  els.torchBtn.textContent = state.torchOn ? "Torch on" : "Torch off";
}

async function refreshCameraControls() {
  setCameraControlsEnabled(true);
  await updateCameraList();
  await updateZoomControls();
  await updateTorchControls();
}

async function handlePhotoScan(file) {
  if (!file) return;
  try {
    logLine(`Scanning photo ${file.name}…`, "info");
    const image = await loadImageFromFile(file);
    const result = await scanImageWithFallbacks(image);
    await handleQrResult(result);
  } catch (err) {
    const message = err?.message || String(err);
    if (/no qr code found/i.test(message)) {
      logLine(`No QR code found in ${file.name}.`, "warn");
    } else {
      logLine(`Photo scan failed (${file.name}): ${message}`, "warn");
    }
  }
}

async function handlePhotoFiles(files) {
  const list = Array.from(files || []).filter((file) =>
    file.type?.startsWith("image/")
  );
  if (!list.length) {
    logLine("No image files found.", "warn");
    return;
  }
  for (const file of list) {
    await handlePhotoScan(file);
  }
}

async function scanImageWithFallbacks(image) {
  const attempts = [
    { maxDim: 1600 },
    { maxDim: 2400 },
    { maxDim: 2400, grid: 2, overlap: 0.15 },
    { maxDim: 2400, grid: 3, overlap: 0.2 },
  ];

  for (const attempt of attempts) {
    if (!attempt.grid) {
      const canvas = drawImageToCanvas(image, null, attempt.maxDim);
      const result = await scanCanvas(canvas);
      if (result) return result;
      continue;
    }

    const result = await scanImageTiles(
      image,
      attempt.grid,
      attempt.overlap,
      attempt.maxDim
    );
    if (result) return result;
  }

  throw new Error("No QR code found.");
}

function drawImageToCanvas(image, crop, maxDim) {
  const width = image.width || image.naturalWidth;
  const height = image.height || image.naturalHeight;
  const cropBox = crop || { x: 0, y: 0, width, height };
  const scale = Math.min(1, maxDim / Math.max(cropBox.width, cropBox.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(cropBox.width * scale));
  canvas.height = Math.max(1, Math.round(cropBox.height * scale));
  const ctx = canvas.getContext("2d");
  ctx.drawImage(
    image,
    cropBox.x,
    cropBox.y,
    cropBox.width,
    cropBox.height,
    0,
    0,
    canvas.width,
    canvas.height
  );
  return canvas;
}

async function scanCanvas(canvas) {
  try {
    return await QrScanner.scanImage(canvas, {
      returnDetailedScanResult: true,
      alsoTryWithoutScanRegion: true,
    });
  } catch (err) {
    const message = err?.message || String(err);
    if (/no qr code found/i.test(message)) {
      return null;
    }
    throw err;
  }
}

async function scanImageTiles(image, grid, overlap, maxDim) {
  const width = image.width || image.naturalWidth;
  const height = image.height || image.naturalHeight;
  const stepX = width / grid;
  const stepY = height / grid;
  const padX = stepX * overlap;
  const padY = stepY * overlap;

  for (let row = 0; row < grid; row++) {
    for (let col = 0; col < grid; col++) {
      const x = Math.max(0, Math.floor(col * stepX - padX));
      const y = Math.max(0, Math.floor(row * stepY - padY));
      const x2 = Math.min(width, Math.ceil((col + 1) * stepX + padX));
      const y2 = Math.min(height, Math.ceil((row + 1) * stepY + padY));
      const crop = { x, y, width: x2 - x, height: y2 - y };
      const canvas = drawImageToCanvas(image, crop, maxDim);
      const result = await scanCanvas(canvas);
      if (result) return result;
    }
  }
  return null;
}

function openPhotoPicker() {
  logLine("Opening photo picker…", "info");

  if (window.isSecureContext && window.showOpenFilePicker) {
    window
      .showOpenFilePicker({
        multiple: true,
        types: [
          {
            description: "Images",
            accept: { "image/*": [".png", ".jpg", ".jpeg", ".webp", ".heic"] },
          },
        ],
      })
      .then(async (handles) => {
        for (const handle of handles) {
          const file = await handle.getFile();
          await handlePhotoScan(file);
        }
      })
      .catch((err) => {
        logLine(`Photo picker blocked: ${err.message}`, "warn");
      });
    return;
  }

  if (typeof els.photoInput.showPicker === "function") {
    try {
      els.photoInput.showPicker();
      return;
    } catch (err) {
      logLine(`Photo picker blocked: ${err.message}`, "warn");
    }
  }

  try {
    els.photoInput.click();
  } catch (err) {
    logLine(`Photo picker failed: ${err.message}`, "error");
  }
}

async function loadImageFromFile(file) {
  if (window.createImageBitmap) {
    try {
      return await createImageBitmap(file);
    } catch (err) {
      // fall through to Image() for unsupported formats
    }
  }

  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    if (image.decode) {
      await image.decode();
    } else {
      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = reject;
      });
    }
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function init() {
  loadSettings();

  if (!window.isSecureContext && location.hostname !== "localhost") {
    logLine("Camera access requires HTTPS (or localhost).", "warn");
  }

  els.mqttForm.addEventListener("submit", (event) => {
    event.preventDefault();
    connectMqtt();
  });

  els.connectBtn.addEventListener("click", () => {
    connectMqtt();
  });
  els.disconnectBtn.addEventListener("click", () => {
    disconnectMqtt();
  });
  els.startScanBtn.addEventListener("click", async () => {
    await ensureAudioContext();
    void beep(0.03);
    startScan();
  });
  els.stopScanBtn.addEventListener("click", () => stopScan());
  els.cameraSelect.addEventListener("change", async () => {
    if (!state.qrScanner) return;
    await state.qrScanner.setCamera(els.cameraSelect.value);
    await updateZoomControls();
    await updateTorchControls();
  });
  els.zoomSlider.addEventListener("input", async () => {
    updateZoomValue(els.zoomSlider.value, state.zoomMode === "virtual");
    await applyZoom(els.zoomSlider.value);
  });
  els.torchBtn.addEventListener("click", async () => {
    if (!state.qrScanner) return;
    try {
      await state.qrScanner.toggleFlash();
      state.torchOn = state.qrScanner.isFlashOn();
      els.torchBtn.textContent = state.torchOn ? "Torch on" : "Torch off";
    } catch (err) {
      logLine(`Torch error: ${err.message}`, "warn");
    }
  });
  els.photoBtn.addEventListener("click", () => {
    void openPhotoPicker();
  });
  els.photoInput.addEventListener("change", async (event) => {
    await handlePhotoFiles(event.target.files);
    event.target.value = "";
  });
  els.dropZone.addEventListener("dragover", (event) => {
    event.preventDefault();
  });
  els.dropZone.addEventListener("dragenter", (event) => {
    event.preventDefault();
    els.dropZone.classList.add("drag-over");
  });
  els.dropZone.addEventListener("dragleave", () => {
    els.dropZone.classList.remove("drag-over");
  });
  els.dropZone.addEventListener("drop", async (event) => {
    event.preventDefault();
    els.dropZone.classList.remove("drag-over");
    await handlePhotoFiles(event.dataTransfer?.files);
  });
  window.addEventListener("paste", async (event) => {
    const items = event.clipboardData?.items || [];
    const files = [];
    for (const item of items) {
      if (item.kind === "file") {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }
    if (files.length) {
      event.preventDefault();
      await handlePhotoFiles(files);
    }
  });
  els.sendManualBtn.addEventListener("click", () => handleManualSend());

  [
    els.mqttUrl,
    els.mqttUser,
    els.mqttPass,
    els.baseTopic,
    els.subscribeResponses,
    els.autoConnect,
    els.clientId,
    els.extendedPanId,
  ].forEach((input) => {
    input.addEventListener("input", () => saveSettings());
  });

  setStatus(els.cameraStatus, "Idle", "idle");
  setCameraControlsEnabled(false);
  setConnectState("idle");

  if (els.autoConnect.checked) {
    connectMqtt();
  }
}

init();
