/**
 * DNA Persona — Stage-1 iPhone HTTPS demo (MOCK provider)
 * Independent temporary voice (speechSynthesis / beep). Not ChatGPT Voice.
 * REAL_IPHONE_TEST status is NOT set by this client.
 */
(function () {
  const TEST_BUILD_VERSION = "stage1_https_v1.0.0";
  const PROVIDER_MODE = "MOCK";
  const DEFAULT_PERSONA_VERSION = "P001_SHAHAR_HASON_BEHAVIORAL_DNA_REFINEMENT_001";
  const DEFAULT_ARTIFACT_ID = "PARENT_FIXTURE_p001_persona.json";
  const BASE_VOICE = "MALE_BASE_VOICE_01";
  const PROFILE = "P001_VOICE_CANDIDATE_v0";

  function newSessionId() {
    if (crypto && crypto.randomUUID) return "S1-" + crypto.randomUUID();
    return "S1-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
  }

  const state = {
    SESSION_ID: newSessionId(),
    TEST_BUILD_VERSION,
    PERSONA_ID: "P001",
    PERSONA_VERSION: DEFAULT_PERSONA_VERSION,
    P001_ARTIFACT_ID: DEFAULT_ARTIFACT_ID,
    PROVIDER_MODE,
    MIC_PERMISSION_STATUS: "UNKNOWN",
    MIC_INPUT_STATUS: "IDLE",
    RESPONSE_STATUS: "IDLE",
    AUDIO_STATUS: "IDLE",
    ERROR_CODE: "",
    LATENCY_MS: null,
    sessionStatus: "INIT",
    loadStatus: "LOAD",
    locale: "he-IL",
    debug: false,
    recognizing: false,
    speaking: false,
    personaData: null,
    lastStepFailed: "",
    lastExpected: "",
    lastActual: "",
    mediaStream: null,
    analyser: null,
    raf: null,
    audioCtx: null,
  };

  let recognition = null;
  let currentUtterance = null;
  let toneCtx = null;
  const $ = (id) => document.getElementById(id);

  function nowIso() {
    return new Date().toISOString();
  }

  function setError(code, step, expected, actual) {
    state.ERROR_CODE = code || "";
    state.lastStepFailed = step || "";
    state.lastExpected = expected || "";
    state.lastActual = actual || "";
    $("errorStatus").textContent = state.ERROR_CODE || "none";
    renderDebug();
  }

  function setSession(s) {
    state.sessionStatus = s;
    $("sessionStatus").textContent = s;
    renderDebug();
  }

  function setMicInput(s) {
    state.MIC_INPUT_STATUS = s;
    $("micInputStatus").textContent = s;
    renderDebug();
  }

  function setResponse(s) {
    state.RESPONSE_STATUS = s;
    $("responseStatus").textContent = s;
    renderDebug();
  }

  function setAudio(s) {
    state.AUDIO_STATUS = s;
    $("audioStatus").textContent = s;
    renderDebug();
  }

  function addMsg(role, text) {
    const log = $("transcript");
    const div = document.createElement("div");
    div.className = "msg " + role;
    div.textContent = text;
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
  }

  function diagnostics() {
    return {
      SESSION_ID: state.SESSION_ID,
      TEST_BUILD_VERSION: state.TEST_BUILD_VERSION,
      PERSONA_ID: state.PERSONA_ID,
      PERSONA_VERSION: state.PERSONA_VERSION,
      P001_ARTIFACT_ID: state.P001_ARTIFACT_ID,
      PROVIDER_MODE: state.PROVIDER_MODE,
      MIC_PERMISSION_STATUS: state.MIC_PERMISSION_STATUS,
      MIC_INPUT_STATUS: state.MIC_INPUT_STATUS,
      RESPONSE_STATUS: state.RESPONSE_STATUS,
      AUDIO_STATUS: state.AUDIO_STATUS,
      ERROR_CODE: state.ERROR_CODE || null,
      LATENCY_MS: state.LATENCY_MS,
      SESSION_STATUS: state.sessionStatus,
      LOAD_STATUS: state.loadStatus,
      LOCALE: state.locale,
      BASE_VOICE: BASE_VOICE,
      VOICE_PROFILE: PROFILE,
      INDEPENDENT_VOICE_STATUS: "TEMPORARY_TTS",
      TEMPORARY_VOICE_USED: true,
      SECURE_CONTEXT: window.isSecureContext === true,
      TIMESTAMP: nowIso(),
      USER_AGENT: navigator.userAgent,
    };
  }

  function failurePayload() {
    return {
      BUILD: state.TEST_BUILD_VERSION,
      SESSION: state.SESSION_ID,
      STEP_FAILED: state.lastStepFailed || state.sessionStatus,
      EXPECTED: state.lastExpected || "success",
      ACTUAL: state.lastActual || state.ERROR_CODE || state.sessionStatus,
      ERROR: state.ERROR_CODE || null,
      TIMESTAMP: nowIso(),
      DIAGNOSTICS: diagnostics(),
    };
  }

  function renderDebug() {
    const el = $("debugStrip");
    const actions = $("debugActions");
    if (!el) return;
    const show = !!state.debug;
    el.hidden = !show;
    if (actions) actions.hidden = !show;
    if (!show) return;
    el.textContent = JSON.stringify(diagnostics(), null, 2);
  }

  function updateIdentityUI() {
    $("sessionId").textContent = state.SESSION_ID;
    $("buildVer").textContent = state.TEST_BUILD_VERSION;
    $("personaIdLabel").textContent = "PERSONA: " + state.PERSONA_ID + " · " +
      ((state.personaData && state.personaData.display_name) || "שחר חסון");
    $("personaVerLabel").textContent = "ver: " + state.PERSONA_VERSION;
    $("providerModeLabel").textContent = "PROVIDER: " + state.PROVIDER_MODE;
    $("loadStatus").textContent = state.loadStatus;
    $("loadStatus").className = "pill " + (state.loadStatus === "READY" ? "ok" : "warn");
  }

  async function loadPersona() {
    try {
      const t0 = performance.now();
      const res = await fetch("./fixtures/p001_persona.json", { cache: "no-cache" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      state.personaData = await res.json();
      state.PERSONA_ID = state.personaData.persona_id || "P001";
      state.PERSONA_VERSION = state.personaData.version || DEFAULT_PERSONA_VERSION;
      state.P001_ARTIFACT_ID = state.personaData.artifact_id || DEFAULT_ARTIFACT_ID;
      state.locale = state.personaData.locale || "he-IL";
      state.LATENCY_MS = Math.round(performance.now() - t0);
      state.loadStatus = "READY";
      setSession("READY");
      addMsg("system", "נטען P001 — " + (state.personaData.display_name || "שחר חסון") +
        " · " + state.PERSONA_VERSION);
      setError("", "", "", "");
    } catch (e) {
      state.personaData = {
        persona_id: "P001",
        display_name: "שחר חסון",
        display_name_latin: "Shahar Hason",
        version: DEFAULT_PERSONA_VERSION,
        system_style_he: "סגנון קומיקאי ישראלי חד וישיר.",
      };
      state.loadStatus = "READY";
      setSession("READY_EMBEDDED_FALLBACK");
      setError("FIXTURE_FETCH_FAILED", "loadPersona", "fixture JSON 200", String(e.message || e));
      addMsg("system", "P001 embedded fallback (fixture fetch failed)");
    }
    updateIdentityUI();
    renderDebug();
  }

  function compileReply(userText) {
    const name = (state.personaData && state.personaData.display_name) || "שחר חסון";
    const style = (state.personaData && state.personaData.system_style_he) || "";
    return [
      `(${name} / MOCK) קיבלתי: «${userText}».`,
      style ? "" : "",
      "בקצב סטנדאפ קצר: זה הרגע שבו החיים שולחים אותך לתור בלי מספר, עם דעה על כולם.",
      `[${PROFILE} · ${BASE_VOICE} PENDING · לא שיבוט קול אמיתי · PROVIDER_MODE=MOCK]`,
    ].filter(Boolean).join(" ");
  }

  function stopLevelMeter() {
    if (state.raf) cancelAnimationFrame(state.raf);
    state.raf = null;
    $("micLevel").style.setProperty("--lvl", "0%");
  }

  function startLevelMeter(stream) {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      state.audioCtx = state.audioCtx || new Ctx();
      const src = state.audioCtx.createMediaStreamSource(stream);
      const analyser = state.audioCtx.createAnalyser();
      analyser.fftSize = 256;
      src.connect(analyser);
      state.analyser = analyser;
      const data = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        analyser.getByteFrequencyData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i];
        const avg = sum / data.length;
        const pct = Math.min(100, Math.round((avg / 80) * 100));
        $("micLevel").style.setProperty("--lvl", pct + "%");
        state.raf = requestAnimationFrame(tick);
      };
      tick();
    } catch (_) {}
  }

  async function requestMicPermission() {
    setSession("MIC_PERMISSION");
    if (!window.isSecureContext) {
      state.MIC_PERMISSION_STATUS = "BLOCKED_INSECURE_CONTEXT";
      $("micPermStatus").textContent = state.MIC_PERMISSION_STATUS;
      setError("INSECURE_CONTEXT", "requestMicPermission", "HTTPS secure context", location.protocol);
      addMsg("system", "מיקרופון דורש HTTPS (secure context).");
      return false;
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      state.MIC_PERMISSION_STATUS = "API_UNAVAILABLE";
      $("micPermStatus").textContent = state.MIC_PERMISSION_STATUS;
      setError("MIC_API_UNAVAILABLE", "requestMicPermission", "getUserMedia", "missing");
      return false;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      state.mediaStream = stream;
      state.MIC_PERMISSION_STATUS = "GRANTED";
      $("micPermStatus").textContent = "GRANTED";
      $("btnPTT").disabled = false;
      startLevelMeter(stream);
      setMicInput("LIVE_IDLE");
      setSession("READY");
      setError("", "", "", "");
      addMsg("system", "הרשאת מיקרופון אושרה");
      // Keep tracks live for level meter; stop if user prefers later
      return true;
    } catch (e) {
      const name = (e && e.name) || "Error";
      state.MIC_PERMISSION_STATUS = name === "NotAllowedError" ? "DENIED" : "ERROR:" + name;
      $("micPermStatus").textContent = state.MIC_PERMISSION_STATUS;
      setError("MIC_PERMISSION_" + name, "requestMicPermission", "GRANTED", state.MIC_PERMISSION_STATUS);
      $("btnPTT").disabled = false; // still allow STT attempt / typed
      addMsg("system", "מיקרופון: " + state.MIC_PERMISSION_STATUS + " — אפשר להקליד");
      return false;
    }
  }

  function stopSpeech() {
    try { if (window.speechSynthesis) window.speechSynthesis.cancel(); } catch (_) {}
    currentUtterance = null;
    if (toneCtx) {
      try { toneCtx.close(); } catch (_) {}
      toneCtx = null;
    }
    state.speaking = false;
    if (state.AUDIO_STATUS === "PLAYING") setAudio("INTERRUPTED");
  }

  function mockBeepFallback() {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) {
        setAudio("NO_AUDIO_CONTEXT");
        setError("NO_AUDIO_CONTEXT", "speak", "AudioContext", "missing");
        setSession("ERROR");
        return;
      }
      toneCtx = new Ctx();
      const o = toneCtx.createOscillator();
      const g = toneCtx.createGain();
      o.frequency.value = 440;
      g.gain.value = 0.05;
      o.connect(g);
      g.connect(toneCtx.destination);
      o.start();
      setAudio("PLAYING_BEEP");
      setTimeout(() => {
        try { o.stop(); } catch (_) {}
        try { toneCtx.close(); } catch (_) {}
        toneCtx = null;
        state.speaking = false;
        setAudio("IDLE");
        setResponse("COMPLETE");
        setSession("READY");
      }, 350);
    } catch (e) {
      setError("BEEP_FAILED", "mockBeepFallback", "beep", String(e.message || e));
      setSession("ERROR");
    }
  }

  function speak(text) {
    stopSpeech();
    state.speaking = true;
    setAudio("STARTING");
    setSession("SPEAKING");

    const canSpeak = window.speechSynthesis && typeof SpeechSynthesisUtterance !== "undefined";
    if (canSpeak) {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "he-IL";
      u.rate = 1.05;
      currentUtterance = u;
      u.onstart = () => setAudio("PLAYING_TTS");
      u.onend = () => {
        state.speaking = false;
        setAudio("IDLE");
        setResponse("COMPLETE");
        setSession("READY");
      };
      u.onerror = (ev) => {
        setError("TTS_" + (ev.error || "error"), "speak", "speechSynthesis ok", ev.error || "error");
        mockBeepFallback();
      };
      window.speechSynthesis.speak(u);
      return;
    }
    mockBeepFallback();
  }

  function handleUserText(text, source) {
    const t = (text || "").trim();
    if (!t) return;
    const t0 = performance.now();
    addMsg("user", t);
    setResponse("PROCESSING");
    setSession("THINKING");
    setMicInput(source === "mic" ? "CAPTURED" : "TYPED");
    // MOCK provider — local persona reply only
    setTimeout(() => {
      const reply = compileReply(t);
      state.LATENCY_MS = Math.round(performance.now() - t0);
      $("responseArea").textContent = reply;
      addMsg("assistant", reply);
      setResponse("READY_TO_SPEAK");
      speak(reply);
      renderDebug();
    }, 80);
  }

  function ensureRecognition() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return null;
    if (recognition) return recognition;
    recognition = new SR();
    recognition.lang = "he-IL";
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.onresult = (ev) => {
      let finalText = "";
      let interim = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i];
        if (r.isFinal) finalText += r[0].transcript;
        else interim += r[0].transcript;
      }
      if (interim) setMicInput("HEARING:" + interim.slice(0, 40));
      if (finalText) handleUserText(finalText, "mic");
    };
    recognition.onerror = (ev) => {
      setError("STT_" + (ev.error || "error"), "SpeechRecognition", "transcript", ev.error || "error");
      setSession("ERROR");
      setMicInput("ERROR");
    };
    recognition.onend = () => {
      state.recognizing = false;
      if (state.MIC_INPUT_STATUS === "LISTENING") setMicInput("IDLE");
      $("btnPTT").textContent = "החזק לדיבור";
    };
    return recognition;
  }

  function startPTT() {
    stopSpeech();
    const r = ensureRecognition();
    if (!r) {
      setError("SPEECH_RECOGNITION_UNAVAILABLE", "startPTT", "webkitSpeechRecognition", "missing");
      addMsg("system", "זיהוי דיבור לא זמין — השתמש בשדה הטקסט.");
      $("typed").focus();
      return;
    }
    try {
      state.recognizing = true;
      setMicInput("LISTENING");
      setSession("LISTENING");
      $("btnPTT").textContent = "מקשיב… שחרר לסיום";
      r.start();
    } catch (e) {
      setError("STT_START_FAILED", "startPTT", "start()", String(e.message || e));
      setSession("ERROR");
    }
  }

  function stopPTT() {
    if (recognition && state.recognizing) {
      try { recognition.stop(); } catch (_) {}
    }
  }

  async function copyText(obj) {
    const text = typeof obj === "string" ? obj : JSON.stringify(obj, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      addMsg("system", "הועתק ללוח");
    } catch (_) {
      addMsg("system", text);
    }
  }

  function wire() {
    const q = new URLSearchParams(location.search);
    state.debug = q.get("debug") === "1" || q.get("debug") === "true";
    $("chkDebug").checked = state.debug;
    renderDebug();

    $("chkDebug").addEventListener("change", (e) => {
      state.debug = !!e.target.checked;
      const url = new URL(location.href);
      if (state.debug) url.searchParams.set("debug", "1");
      else url.searchParams.delete("debug");
      history.replaceState({}, "", url);
      renderDebug();
    });

    $("btnMicPerm").addEventListener("click", () => requestMicPermission());

    const ptt = $("btnPTT");
    ptt.addEventListener("mousedown", startPTT);
    ptt.addEventListener("mouseup", stopPTT);
    ptt.addEventListener("mouseleave", stopPTT);
    ptt.addEventListener("touchstart", (e) => { e.preventDefault(); startPTT(); }, { passive: false });
    ptt.addEventListener("touchend", (e) => { e.preventDefault(); stopPTT(); });

    $("btnStop").addEventListener("click", () => {
      stopSpeech();
      stopPTT();
      addMsg("system", "interrupt");
      setSession("INTERRUPTED");
      setResponse("INTERRUPTED");
    });

    $("btnSend").addEventListener("click", () => {
      handleUserText($("typed").value, "typed");
      $("typed").value = "";
    });
    $("typed").addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        handleUserText($("typed").value, "typed");
        $("typed").value = "";
      }
    });

    $("btnCopyDiag").addEventListener("click", () => copyText(diagnostics()));
    $("btnCopyFail").addEventListener("click", () => copyText(failurePayload()));
    $("btnDump").addEventListener("click", () => {
      addMsg("system", "CAPSULE: " + JSON.stringify({
        schema: "portable_session_capsule_stage1",
        ...diagnostics(),
      }));
    });

    // Enable PTT even before mic perm (STT may prompt separately); typed always works
    $("btnPTT").disabled = false;
  }

  window.addEventListener("DOMContentLoaded", async () => {
    updateIdentityUI();
    if ("serviceWorker" in navigator) {
      try { await navigator.serviceWorker.register("./sw.js"); } catch (_) {}
    }
    wire();
    if (!window.isSecureContext) {
      setError("INSECURE_CONTEXT", "boot", "HTTPS", location.protocol);
      addMsg("system", "אזהרה: לא secure context — מיקרופון עלול להיחסם");
    } else {
      addMsg("system", "Secure context OK · Stage-1 MOCK · independent temporary TTS");
    }
    // Probe permission state if available
    try {
      if (navigator.permissions && navigator.permissions.query) {
        const p = await navigator.permissions.query({ name: "microphone" });
        state.MIC_PERMISSION_STATUS = String(p.state).toUpperCase();
        $("micPermStatus").textContent = state.MIC_PERMISSION_STATUS;
        p.onchange = () => {
          state.MIC_PERMISSION_STATUS = String(p.state).toUpperCase();
          $("micPermStatus").textContent = state.MIC_PERMISSION_STATUS;
          renderDebug();
        };
      }
    } catch (_) {}
    await loadPersona();
  });
})();
