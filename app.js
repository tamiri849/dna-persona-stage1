/**
 * DNA Persona — Stage-1 iPhone HTTPS demo REMEDIATION v1.0.1 (MOCK)
 * Fixes from physical S1-b34bb6c2-cd55-4c25-8f7b-f055c4cd1f10:
 *  - Explicit media state machine; listening UI only while RECORDING
 *  - STT: single instance, continuous while held, combine interim+final, finalize on release
 *  - Safari audio unlock (AudioContext.resume + silent speechSynthesis unlock)
 *  - MOCK echoes exact transcript; RECOGNIZED shown
 *  - Test A (complete cycle) then Test B (interrupt) with interrupt diagnostics
 *  - Never treat AUDIO_STATUS=STARTING or CAPTURED alone as pass
 * Independent temporary voice. NOT ChatGPT Voice. REAL_IPHONE_TEST not set by client.
 */
(function () {
  const TEST_BUILD_VERSION = "stage1_https_v1.0.1";
  const PROVIDER_MODE = "MOCK";
  const DEFAULT_PERSONA_VERSION = "P001_SHAHAR_HASON_BEHAVIORAL_DNA_REFINEMENT_001";
  const DEFAULT_ARTIFACT_ID = "1NZ5E2Tqsk4h7fz2sVJLYKcFk1ZX_hUs3";
  const BASE_VOICE = "MALE_BASE_VOICE_01";
  const PROFILE = "P001_VOICE_CANDIDATE_v0";
  const FINALIZE_WAIT_MS = 1200;
  const STT_HARD_TIMEOUT_MS = 20000;

  const SM = {
    IDLE: "IDLE",
    MIC_INITIALIZING: "MIC_INITIALIZING",
    READY_TO_RECORD: "READY_TO_RECORD",
    RECORDING: "RECORDING",
    USER_RELEASED: "USER_RELEASED",
    FINALIZING_TRANSCRIPT: "FINALIZING_TRANSCRIPT",
    TRANSCRIPT_READY: "TRANSCRIPT_READY",
    PROCESSING: "PROCESSING",
    RESPONSE_READY: "RESPONSE_READY",
    AUDIO_STARTING: "AUDIO_STARTING",
    AUDIO_PLAYING: "AUDIO_PLAYING",
    COMPLETE: "COMPLETE",
    ERROR: "ERROR",
    INTERRUPTED: "INTERRUPTED",
  };

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
    mediaState: SM.IDLE,
    personaData: null,
    lastStepFailed: "",
    lastExpected: "",
    lastActual: "",
    mediaStream: null,
    analyser: null,
    raf: null,
    audioCtx: null,
    AUDIO_CONTEXT_STATE: "none",
    AUDIO_UNLOCKED: false,
    TTS_REQUEST_CREATED: false,
    TTS_START: false,
    TTS_END: false,
    PLAYBACK_STARTED: false,
    PLAYBACK_COMPLETED: false,
    PLAYBACK_ERROR: null,
    AUDIO_PLAYBACK_VERIFIED: false,
    CAPTURE_RELIABILITY: "UNKNOWN",
    lastTranscript: "",
    lastTranscriptSource: "",
    recognizedExact: "",
    interimBuffer: "",
    finalBuffer: "",
    holding: false,
    recognizing: false,
    speaking: false,
    testMode: "A", // A = full cycle, B = interrupt
    testAStatus: "NOT_RUN",
    testBStatus: "NOT_RUN",
    // sticky success flags — interrupt must NOT wipe these
    sticky: {
      MIC_PERMISSION_OK: false,
      CAPTURE_USABLE: false,
      TRANSCRIPT_SHOWN: false,
      MOCK_ECHO_RELATED: false,
      AUDIO_HEARD_OR_PLAYBACK_STARTED: false,
      TEST_A_COMPLETE: false,
    },
    interrupt: {
      INTERRUPT_BUTTON_PRESSED: false,
      INTERRUPT_TS: null,
      PRE_STATE: null,
      POST_STATE: null,
      AUDIO_WAS_PLAYING: false,
      CANCEL: false,
      AUDIO_STOPPED: false,
      STOP_LATENCY_MS: null,
    },
    eventLog: [],
  };

  let recognition = null;
  let currentUtterance = null;
  let toneNodes = null;
  let finalizeTimer = null;
  let sttHardTimer = null;
  let unlockSilentUtterance = null;
  const $ = (id) => document.getElementById(id);

  function nowIso() {
    return new Date().toISOString();
  }

  function logEvent(kind, detail) {
    state.eventLog.push({ t: nowIso(), kind, detail: detail || null });
    if (state.eventLog.length > 80) state.eventLog.shift();
  }

  function setError(code, step, expected, actual) {
    state.ERROR_CODE = code || "";
    state.lastStepFailed = step || "";
    state.lastExpected = expected || "";
    state.lastActual = actual || "";
    if ($("errorStatus")) $("errorStatus").textContent = state.ERROR_CODE || "none";
    renderDebug();
  }

  function setSession(s) {
    state.sessionStatus = s;
    if ($("sessionStatus")) $("sessionStatus").textContent = s;
    renderDebug();
  }

  function setMicInput(s) {
    state.MIC_INPUT_STATUS = s;
    if ($("micInputStatus")) $("micInputStatus").textContent = s;
    renderDebug();
  }

  function setResponse(s) {
    state.RESPONSE_STATUS = s;
    if ($("responseStatus")) $("responseStatus").textContent = s;
    renderDebug();
  }

  function setAudio(s) {
    state.AUDIO_STATUS = s;
    if ($("audioStatus")) $("audioStatus").textContent = s;
    // STARTING alone never verifies playback
    if (s === "PLAYING" || s === "PLAYING_TTS" || s === "PLAYING_BEEP" || s === "COMPLETED") {
      if (s !== "COMPLETED") {
        state.PLAYBACK_STARTED = true;
        state.sticky.AUDIO_HEARD_OR_PLAYBACK_STARTED = true;
      }
      if (s === "COMPLETED") {
        state.PLAYBACK_COMPLETED = true;
        state.AUDIO_PLAYBACK_VERIFIED = true;
      }
    }
    renderDebug();
  }

  function setMediaState(next) {
    const prev = state.mediaState;
    state.mediaState = next;
    if ($("mediaState")) $("mediaState").textContent = next;
    const listenEl = $("listeningBanner");
    if (listenEl) {
      const show = next === SM.RECORDING;
      listenEl.hidden = !show;
      listenEl.setAttribute("aria-hidden", show ? "false" : "true");
      if (show) listenEl.textContent = "🎙️ מקשיב…";
    }
    const ptt = $("btnPTT");
    if (ptt) {
      if (next === SM.RECORDING) ptt.textContent = "מקשיב… שחרר לסיום";
      else if (next === SM.FINALIZING_TRANSCRIPT || next === SM.USER_RELEASED)
        ptt.textContent = "מסיים תמליל…";
      else ptt.textContent = "החזק לדיבור";
      ptt.classList.toggle("recording", next === SM.RECORDING);
    }
    logEvent("MEDIA_STATE", { from: prev, to: next });
    renderDebug();
  }

  function addMsg(role, text) {
    const log = $("transcript");
    if (!log) return;
    const div = document.createElement("div");
    div.className = "msg " + role;
    div.textContent = text;
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
  }

  function showRecognized(exact) {
    state.recognizedExact = exact || "";
    const el = $("recognizedExact");
    if (el) el.textContent = exact ? ("RECOGNIZED: " + exact) : "RECOGNIZED: —";
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
      MEDIA_STATE: state.mediaState,
      LOCALE: state.locale,
      BASE_VOICE: BASE_VOICE,
      VOICE_PROFILE: PROFILE,
      INDEPENDENT_VOICE_STATUS: "TEMPORARY_TTS",
      TEMPORARY_VOICE_USED: true,
      SECURE_CONTEXT: window.isSecureContext === true,
      AUDIO_CONTEXT_STATE: state.AUDIO_CONTEXT_STATE,
      AUDIO_UNLOCKED: state.AUDIO_UNLOCKED,
      TTS_REQUEST_CREATED: state.TTS_REQUEST_CREATED,
      TTS_START: state.TTS_START,
      TTS_END: state.TTS_END,
      PLAYBACK_STARTED: state.PLAYBACK_STARTED,
      PLAYBACK_COMPLETED: state.PLAYBACK_COMPLETED,
      PLAYBACK_ERROR: state.PLAYBACK_ERROR,
      AUDIO_PLAYBACK_VERIFIED: state.AUDIO_PLAYBACK_VERIFIED,
      CAPTURE_RELIABILITY: state.CAPTURE_RELIABILITY,
      LAST_TRANSCRIPT: state.lastTranscript || null,
      RECOGNIZED_EXACT: state.recognizedExact || null,
      TEST_MODE: state.testMode,
      TEST_A_STATUS: state.testAStatus,
      TEST_B_STATUS: state.testBStatus,
      STICKY_SUCCESS: Object.assign({}, state.sticky),
      INTERRUPT: Object.assign({}, state.interrupt),
      TIMESTAMP: nowIso(),
      USER_AGENT: navigator.userAgent,
      EVENT_LOG_TAIL: state.eventLog.slice(-20),
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
    if ($("sessionId")) $("sessionId").textContent = state.SESSION_ID;
    if ($("buildVer")) $("buildVer").textContent = state.TEST_BUILD_VERSION;
    if ($("personaIdLabel"))
      $("personaIdLabel").textContent =
        "PERSONA: " +
        state.PERSONA_ID +
        " · " +
        ((state.personaData && state.personaData.display_name) || "שחר חסון");
    if ($("personaVerLabel")) $("personaVerLabel").textContent = "ver: " + state.PERSONA_VERSION;
    if ($("providerModeLabel")) $("providerModeLabel").textContent = "PROVIDER: " + state.PROVIDER_MODE;
    if ($("loadStatus")) {
      $("loadStatus").textContent = state.loadStatus;
      $("loadStatus").className = "pill " + (state.loadStatus === "READY" ? "ok" : "warn");
    }
    if ($("testAStatus")) $("testAStatus").textContent = state.testAStatus;
    if ($("testBStatus")) $("testBStatus").textContent = state.testBStatus;
  }

  function syncAudioContextState() {
    if (state.audioCtx) state.AUDIO_CONTEXT_STATE = state.audioCtx.state;
    else state.AUDIO_CONTEXT_STATE = "none";
  }

  async function ensureAudioUnlocked(reason) {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) {
        if (!state.audioCtx) state.audioCtx = new Ctx();
        if (state.audioCtx.state === "suspended") {
          await state.audioCtx.resume();
        }
        syncAudioContextState();
      }
      if (window.speechSynthesis) {
        try {
          window.speechSynthesis.cancel();
          unlockSilentUtterance = new SpeechSynthesisUtterance(" ");
          unlockSilentUtterance.volume = 0;
          unlockSilentUtterance.lang = "he-IL";
          window.speechSynthesis.speak(unlockSilentUtterance);
          window.speechSynthesis.cancel();
        } catch (_) {}
      }
      state.AUDIO_UNLOCKED = true;
      logEvent("AUDIO_UNLOCK", reason || "gesture");
      renderDebug();
      return true;
    } catch (e) {
      state.AUDIO_UNLOCKED = false;
      logEvent("AUDIO_UNLOCK_FAIL", String(e && e.message ? e.message : e));
      return false;
    }
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
      setMediaState(SM.IDLE);
      addMsg(
        "system",
        "נטען P001 — " +
          (state.personaData.display_name || "שחר חסון") +
          " · " +
          state.PERSONA_VERSION +
          " · BUILD " +
          TEST_BUILD_VERSION
      );
      setError("", "", "", "");
    } catch (e) {
      state.personaData = {
        persona_id: "P001",
        display_name: "שחר חסון",
        display_name_latin: "Shahar Hason",
        version: DEFAULT_PERSONA_VERSION,
        artifact_id: DEFAULT_ARTIFACT_ID,
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
    // MOCK MUST echo transcript — related reply, not unrelated stock joke alone
    return (
      "קלטתי שאמרת: " +
      userText +
      ". (" +
      name +
      " / MOCK) " +
      "בקצב קצר: קיבלתי אותך. " +
      "[" +
      PROFILE +
      " · " +
      BASE_VOICE +
      " PENDING · TEMPORARY_TTS · PROVIDER_MODE=MOCK]"
    );
  }

  function stopLevelMeter() {
    if (state.raf) cancelAnimationFrame(state.raf);
    state.raf = null;
    if ($("micLevel")) $("micLevel").style.setProperty("--lvl", "0%");
  }

  function startLevelMeter(stream) {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      state.audioCtx = state.audioCtx || new Ctx();
      if (state.audioCtx.state === "suspended") state.audioCtx.resume();
      syncAudioContextState();
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
        if ($("micLevel")) $("micLevel").style.setProperty("--lvl", pct + "%");
        state.raf = requestAnimationFrame(tick);
      };
      tick();
    } catch (_) {}
  }

  async function requestMicPermission() {
    setSession("MIC_PERMISSION");
    setMediaState(SM.MIC_INITIALIZING);
    await ensureAudioUnlocked("mic_perm_button");
    if (!window.isSecureContext) {
      state.MIC_PERMISSION_STATUS = "BLOCKED_INSECURE_CONTEXT";
      if ($("micPermStatus")) $("micPermStatus").textContent = state.MIC_PERMISSION_STATUS;
      setError("INSECURE_CONTEXT", "requestMicPermission", "HTTPS secure context", location.protocol);
      setMediaState(SM.ERROR);
      addMsg("system", "מיקרופון דורש HTTPS (secure context).");
      return false;
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      state.MIC_PERMISSION_STATUS = "API_UNAVAILABLE";
      if ($("micPermStatus")) $("micPermStatus").textContent = state.MIC_PERMISSION_STATUS;
      setError("MIC_API_UNAVAILABLE", "requestMicPermission", "getUserMedia", "missing");
      setMediaState(SM.ERROR);
      return false;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      state.mediaStream = stream;
      state.MIC_PERMISSION_STATUS = "GRANTED";
      state.sticky.MIC_PERMISSION_OK = true;
      if ($("micPermStatus")) $("micPermStatus").textContent = "GRANTED";
      if ($("btnPTT")) $("btnPTT").disabled = false;
      startLevelMeter(stream);
      setMicInput("LIVE_IDLE");
      setSession("READY");
      setMediaState(SM.READY_TO_RECORD);
      setError("", "", "", "");
      addMsg("system", "הרשאת מיקרופון אושרה · audio unlock attempted");
      return true;
    } catch (e) {
      const name = (e && e.name) || "Error";
      state.MIC_PERMISSION_STATUS = name === "NotAllowedError" ? "DENIED" : "ERROR:" + name;
      if ($("micPermStatus")) $("micPermStatus").textContent = state.MIC_PERMISSION_STATUS;
      setError("MIC_PERMISSION_" + name, "requestMicPermission", "GRANTED", state.MIC_PERMISSION_STATUS);
      if ($("btnPTT")) $("btnPTT").disabled = false;
      setMediaState(SM.IDLE);
      addMsg("system", "מיקרופון: " + state.MIC_PERMISSION_STATUS + " — אפשר להקליד");
      return false;
    }
  }

  function clearFinalizeTimers() {
    if (finalizeTimer) {
      clearTimeout(finalizeTimer);
      finalizeTimer = null;
    }
    if (sttHardTimer) {
      clearTimeout(sttHardTimer);
      sttHardTimer = null;
    }
  }

  function combinedTranscript() {
    const f = (state.finalBuffer || "").trim();
    const i = (state.interimBuffer || "").trim();
    if (f && i) {
      // Prefer final; append interim only if it extends beyond final
      if (i.indexOf(f) === 0) return i;
      if (f.indexOf(i) === 0) return f;
      return (f + " " + i).replace(/\s+/g, " ").trim();
    }
    return f || i || "";
  }

  function destroyRecognition() {
    if (!recognition) return;
    try {
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      recognition.onstart = null;
      recognition.onspeechend = null;
      recognition.onnomatch = null;
      recognition.stop();
    } catch (_) {}
    try {
      recognition.abort();
    } catch (_) {}
    recognition = null;
    state.recognizing = false;
  }

  function ensureRecognition() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return null;
    // Always recreate cleanly to avoid stale multi-instance / stuck Safari sessions
    destroyRecognition();
    recognition = new SR();
    recognition.lang = state.locale || "he-IL";
    recognition.interimResults = true;
    // continuous=true while holding — avoids premature onend mid-utterance (iOS truncation)
    recognition.continuous = true;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      state.recognizing = true;
      setMediaState(SM.RECORDING);
      setMicInput("RECORDING");
      setSession("LISTENING");
      logEvent("STT_START", null);
    };

    recognition.onresult = (ev) => {
      let interim = "";
      // Rebuild from full results set for reliability (Safari can reshuffle)
      let finals = "";
      for (let i = 0; i < ev.results.length; i++) {
        const r = ev.results[i];
        const t = (r[0] && r[0].transcript) || "";
        if (r.isFinal) finals += t;
        else interim += t;
      }
      if (finals) state.finalBuffer = finals;
      state.interimBuffer = interim;
      const live = combinedTranscript();
      if (live) {
        setMicInput("HEARING:" + live.slice(0, 48));
        showRecognized(live);
      }
      logEvent("STT_RESULT", { finals: !!finals, interimLen: interim.length });
    };

    recognition.onerror = (ev) => {
      const err = (ev && ev.error) || "error";
      logEvent("STT_ERROR", err);
      // aborted/no-speech during intentional stop are soft
      if (err === "aborted" && !state.holding) return;
      if (err === "no-speech" && state.holding) return;
      if (err === "aborted" || err === "no-speech") {
        setMicInput("STT_" + err.toUpperCase());
        return;
      }
      setError("STT_" + err, "SpeechRecognition", "transcript", err);
      state.CAPTURE_RELIABILITY = "FAILED";
      setMediaState(SM.ERROR);
      setSession("ERROR");
      setMicInput("ERROR");
    };

    recognition.onend = () => {
      state.recognizing = false;
      logEvent("STT_END", { holding: state.holding, media: state.mediaState });
      // If user still holding, restart (Safari sometimes ends early)
      if (state.holding) {
        try {
          recognition.start();
          state.recognizing = true;
          logEvent("STT_RESTART_WHILE_HOLDING", null);
          return;
        } catch (e) {
          logEvent("STT_RESTART_FAIL", String(e && e.message ? e.message : e));
        }
      }
      // If we released and are finalizing, commit transcript
      if (
        state.mediaState === SM.USER_RELEASED ||
        state.mediaState === SM.FINALIZING_TRANSCRIPT ||
        state.mediaState === SM.RECORDING
      ) {
        finishTranscriptCapture("onend");
      }
    };

    return recognition;
  }

  function finishTranscriptCapture(reason) {
    clearFinalizeTimers();
    if (
      state.mediaState === SM.TRANSCRIPT_READY ||
      state.mediaState === SM.PROCESSING ||
      state.mediaState === SM.RESPONSE_READY ||
      state.mediaState === SM.AUDIO_STARTING ||
      state.mediaState === SM.AUDIO_PLAYING ||
      state.mediaState === SM.COMPLETE
    ) {
      return; // already moved on
    }
    setMediaState(SM.FINALIZING_TRANSCRIPT);
    const text = combinedTranscript();
    state.interimBuffer = "";
    destroyRecognition();

    if (!text) {
      state.CAPTURE_RELIABILITY = "FAILED";
      setMicInput("EMPTY_TRANSCRIPT");
      setMediaState(SM.ERROR);
      setSession("ERROR");
      setError("EMPTY_TRANSCRIPT", "finishTranscriptCapture", "non-empty transcript", "empty");
      addMsg("system", "לא נקלט תמליל — נסה שוב (החזק ברציפות בזמן הדיבור)");
      logEvent("CAPTURE_EMPTY", reason);
      return;
    }

    state.lastTranscript = text;
    state.lastTranscriptSource = "mic";
    state.CAPTURE_RELIABILITY = "OK";
    state.sticky.CAPTURE_USABLE = true;
    state.sticky.TRANSCRIPT_SHOWN = true;
    setMicInput("CAPTURED_USABLE");
    setMediaState(SM.TRANSCRIPT_READY);
    showRecognized(text);
    logEvent("CAPTURE_OK", { reason, len: text.length });
    handleUserText(text, "mic");
  }

  function stopSpeech(fromInterrupt) {
    const wasPlaying =
      state.speaking ||
      state.AUDIO_STATUS === "PLAYING" ||
      state.AUDIO_STATUS === "PLAYING_TTS" ||
      state.AUDIO_STATUS === "PLAYING_BEEP" ||
      state.AUDIO_STATUS === "STARTING" ||
      state.mediaState === SM.AUDIO_PLAYING ||
      state.mediaState === SM.AUDIO_STARTING;

    const t0 = performance.now();
    try {
      if (window.speechSynthesis) window.speechSynthesis.cancel();
    } catch (_) {}
    currentUtterance = null;
    if (toneNodes) {
      try {
        if (toneNodes.osc) toneNodes.osc.stop();
      } catch (_) {}
      toneNodes = null;
    }
    state.speaking = false;

    if (fromInterrupt) {
      state.interrupt.CANCEL = true;
      state.interrupt.AUDIO_STOPPED = wasPlaying;
      state.interrupt.STOP_LATENCY_MS = Math.round(performance.now() - t0);
      if (wasPlaying) setAudio("STOPPED_BY_INTERRUPT");
      // Do NOT wipe sticky success / prior TEST_A flags
    } else if (state.AUDIO_STATUS === "PLAYING" || state.AUDIO_STATUS === "PLAYING_TTS") {
      setAudio("INTERRUPTED");
    }
  }

  function mockBeepFallback() {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) {
        setAudio("NO_AUDIO_CONTEXT");
        state.PLAYBACK_ERROR = "NO_AUDIO_CONTEXT";
        setError("NO_AUDIO_CONTEXT", "speak", "AudioContext", "missing");
        setMediaState(SM.ERROR);
        setSession("ERROR");
        return;
      }
      state.audioCtx = state.audioCtx || new Ctx();
      const resumeP =
        state.audioCtx.state === "suspended" ? state.audioCtx.resume() : Promise.resolve();
      resumeP.then(() => {
        syncAudioContextState();
        const o = state.audioCtx.createOscillator();
        const g = state.audioCtx.createGain();
        o.frequency.value = 523.25;
        g.gain.value = 0.08;
        o.connect(g);
        g.connect(state.audioCtx.destination);
        toneNodes = { osc: o, gain: g };
        o.start();
        setAudio("PLAYING_BEEP");
        setMediaState(SM.AUDIO_PLAYING);
        state.PLAYBACK_STARTED = true;
        state.sticky.AUDIO_HEARD_OR_PLAYBACK_STARTED = true;
        setTimeout(() => {
          try {
            o.stop();
          } catch (_) {}
          toneNodes = null;
          state.speaking = false;
          setAudio("COMPLETED");
          state.PLAYBACK_COMPLETED = true;
          state.AUDIO_PLAYBACK_VERIFIED = true;
          setResponse("COMPLETE");
          setMediaState(SM.COMPLETE);
          setSession("READY");
          markTestAIfApplicable();
        }, 400);
      });
    } catch (e) {
      state.PLAYBACK_ERROR = String(e && e.message ? e.message : e);
      setError("BEEP_FAILED", "mockBeepFallback", "beep", state.PLAYBACK_ERROR);
      setMediaState(SM.ERROR);
      setSession("ERROR");
    }
  }

  function speak(text) {
    stopSpeech(false);
    state.speaking = true;
    state.TTS_REQUEST_CREATED = false;
    state.TTS_START = false;
    state.TTS_END = false;
    state.PLAYBACK_STARTED = false;
    state.PLAYBACK_COMPLETED = false;
    state.PLAYBACK_ERROR = null;
    state.AUDIO_PLAYBACK_VERIFIED = false;
    setAudio("STARTING");
    setMediaState(SM.AUDIO_STARTING);
    setSession("SPEAKING");

    const run = async () => {
      await ensureAudioUnlocked("before_tts");
      const canSpeak = window.speechSynthesis && typeof SpeechSynthesisUtterance !== "undefined";
      if (!canSpeak) {
        mockBeepFallback();
        return;
      }
      // Safari: resume + getVoices nudge
      try {
        window.speechSynthesis.getVoices();
      } catch (_) {}

      const u = new SpeechSynthesisUtterance(text);
      u.lang = "he-IL";
      u.rate = 1.0;
      u.volume = 1.0;
      currentUtterance = u;
      state.TTS_REQUEST_CREATED = true;
      logEvent("TTS_REQUEST", { len: text.length });

      let startWatch = setTimeout(() => {
        // If onstart never fires (Safari silent fail), fall back to audible beep
        if (!state.TTS_START && state.speaking) {
          logEvent("TTS_START_TIMEOUT", null);
          try {
            window.speechSynthesis.cancel();
          } catch (_) {}
          mockBeepFallback();
        }
      }, 1500);

      u.onstart = () => {
        clearTimeout(startWatch);
        state.TTS_START = true;
        state.PLAYBACK_STARTED = true;
        state.sticky.AUDIO_HEARD_OR_PLAYBACK_STARTED = true;
        setAudio("PLAYING_TTS");
        setMediaState(SM.AUDIO_PLAYING);
        logEvent("TTS_START", null);
      };
      u.onend = () => {
        clearTimeout(startWatch);
        state.TTS_END = true;
        state.speaking = false;
        setAudio("COMPLETED");
        state.PLAYBACK_COMPLETED = true;
        state.AUDIO_PLAYBACK_VERIFIED = true;
        setResponse("COMPLETE");
        setMediaState(SM.COMPLETE);
        setSession("READY");
        markTestAIfApplicable();
        logEvent("TTS_END", null);
      };
      u.onerror = (ev) => {
        clearTimeout(startWatch);
        const err = (ev && ev.error) || "error";
        state.PLAYBACK_ERROR = err;
        if (err === "interrupted" || err === "canceled") {
          logEvent("TTS_INTERRUPTED", err);
          state.speaking = false;
          return;
        }
        setError("TTS_" + err, "speak", "speechSynthesis ok", err);
        logEvent("TTS_ERROR", err);
        mockBeepFallback();
      };

      try {
        window.speechSynthesis.speak(u);
      } catch (e) {
        clearTimeout(startWatch);
        state.PLAYBACK_ERROR = String(e && e.message ? e.message : e);
        mockBeepFallback();
      }
    };
    run();
  }

  function markTestAIfApplicable() {
    if (state.testMode !== "A") return;
    const ok =
      state.sticky.TRANSCRIPT_SHOWN &&
      state.sticky.MOCK_ECHO_RELATED &&
      (state.PLAYBACK_STARTED || state.AUDIO_PLAYBACK_VERIFIED);
    if (ok) {
      state.testAStatus = "CLIENT_CYCLE_COMPLETE";
      state.sticky.TEST_A_COMPLETE = true;
      // Never set REAL_IPHONE pass here
      updateIdentityUI();
      addMsg("system", "Test A client cycle complete — awaiting physical audible confirm on retest");
    }
  }

  function handleUserText(text, source) {
    const t = (text || "").trim();
    if (!t) return;
    const t0 = performance.now();
    state.lastTranscript = t;
    state.lastTranscriptSource = source;
    showRecognized(t);
    addMsg("user", t);
    state.sticky.TRANSCRIPT_SHOWN = true;
    setResponse("PROCESSING");
    setSession("THINKING");
    setMediaState(SM.PROCESSING);
    if (source === "mic") setMicInput("CAPTURED_USABLE");
    else setMicInput("TYPED");

    setTimeout(() => {
      const reply = compileReply(t);
      state.LATENCY_MS = Math.round(performance.now() - t0);
      state.sticky.MOCK_ECHO_RELATED = reply.indexOf(t) !== -1 || reply.indexOf("קלטתי שאמרת:") !== -1;
      if ($("responseArea")) $("responseArea").textContent = reply;
      addMsg("assistant", reply);
      setResponse("READY_TO_SPEAK");
      setMediaState(SM.RESPONSE_READY);
      speak(reply);
      renderDebug();
    }, 60);
  }

  function startPTT(ev) {
    if (ev && ev.cancelable) {
      try {
        ev.preventDefault();
      } catch (_) {}
    }
    // Ignore duplicate starts
    if (state.holding) return;
    state.holding = true;
    state.finalBuffer = "";
    state.interimBuffer = "";
    clearFinalizeTimers();
    stopSpeech(false);
    ensureAudioUnlocked("ptt_start");

    setMediaState(SM.MIC_INITIALIZING);
    const r = ensureRecognition();
    if (!r) {
      state.holding = false;
      setError("SPEECH_RECOGNITION_UNAVAILABLE", "startPTT", "webkitSpeechRecognition", "missing");
      setMediaState(SM.ERROR);
      addMsg("system", "זיהוי דיבור לא זמין — השתמש בשדה הטקסט.");
      if ($("typed")) $("typed").focus();
      return;
    }
    try {
      setMicInput("STARTING");
      setSession("LISTENING");
      r.start();
      sttHardTimer = setTimeout(() => {
        if (state.holding || state.mediaState === SM.RECORDING) {
          logEvent("STT_HARD_TIMEOUT", null);
          state.holding = false;
          try {
            r.stop();
          } catch (_) {}
          finishTranscriptCapture("hard_timeout");
        }
      }, STT_HARD_TIMEOUT_MS);
    } catch (e) {
      state.holding = false;
      setError("STT_START_FAILED", "startPTT", "start()", String(e.message || e));
      setMediaState(SM.ERROR);
      setSession("ERROR");
      state.CAPTURE_RELIABILITY = "FAILED";
    }
  }

  function stopPTT(ev) {
    if (ev && ev.cancelable) {
      try {
        ev.preventDefault();
      } catch (_) {}
    }
    if (!state.holding && state.mediaState !== SM.RECORDING) return;
    state.holding = false;
    setMediaState(SM.USER_RELEASED);
    setMicInput("USER_RELEASED");
    try {
      if (recognition) recognition.stop();
    } catch (_) {}
    // Wait briefly for late finals before committing
    clearFinalizeTimers();
    finalizeTimer = setTimeout(() => finishTranscriptCapture("release_timeout"), FINALIZE_WAIT_MS);
  }

  function doInterrupt() {
    const pre = {
      mediaState: state.mediaState,
      AUDIO_STATUS: state.AUDIO_STATUS,
      RESPONSE_STATUS: state.RESPONSE_STATUS,
      sessionStatus: state.sessionStatus,
      sticky: Object.assign({}, state.sticky),
    };
    const wasPlaying =
      state.speaking ||
      state.AUDIO_STATUS === "PLAYING_TTS" ||
      state.AUDIO_STATUS === "PLAYING_BEEP" ||
      state.AUDIO_STATUS === "PLAYING" ||
      state.AUDIO_STATUS === "STARTING" ||
      state.mediaState === SM.AUDIO_PLAYING ||
      state.mediaState === SM.AUDIO_STARTING;

    state.interrupt.INTERRUPT_BUTTON_PRESSED = true;
    state.interrupt.INTERRUPT_TS = nowIso();
    state.interrupt.PRE_STATE = pre;
    state.interrupt.AUDIO_WAS_PLAYING = wasPlaying;

    stopSpeech(true);
    state.holding = false;
    clearFinalizeTimers();
    destroyRecognition();

    setMediaState(SM.INTERRUPTED);
    setSession("INTERRUPTED");
    setResponse("INTERRUPTED");
    // Preserve sticky / Test A — only mark interrupt path
    if (state.testMode === "B" || state.sticky.TEST_A_COMPLETE) {
      state.testBStatus = wasPlaying ? "INTERRUPT_WHILE_PLAYING" : "INTERRUPT_NO_AUDIO";
    }
    state.interrupt.POST_STATE = {
      mediaState: state.mediaState,
      AUDIO_STATUS: state.AUDIO_STATUS,
      RESPONSE_STATUS: state.RESPONSE_STATUS,
      sticky: Object.assign({}, state.sticky),
    };
    addMsg(
      "system",
      "interrupt · AUDIO_WAS_PLAYING=" +
        wasPlaying +
        " · sticky preserved · STOP_LATENCY_MS=" +
        state.interrupt.STOP_LATENCY_MS
    );
    updateIdentityUI();
    renderDebug();
    logEvent("INTERRUPT", state.interrupt);
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

  function setTestMode(mode) {
    state.testMode = mode === "B" ? "B" : "A";
    if ($("testModeLabel")) $("testModeLabel").textContent = "TEST " + state.testMode;
    document.querySelectorAll("[data-test-mode]").forEach((btn) => {
      btn.classList.toggle("active", btn.getAttribute("data-test-mode") === state.testMode);
    });
    addMsg(
      "system",
      state.testMode === "A"
        ? "Test A: input → transcript → MOCK echo → audible audio (complete cycle)"
        : "Test B: Interrupt during playback (run after Test A audio starts)"
    );
    updateIdentityUI();
  }

  function wire() {
    const q = new URLSearchParams(location.search);
    state.debug = q.get("debug") === "1" || q.get("debug") === "true";
    if ($("chkDebug")) $("chkDebug").checked = state.debug;
    renderDebug();

    if ($("chkDebug"))
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
    // Pointer Events unify mouse/touch and reduce iOS ghost mouse duplicates
    if (window.PointerEvent) {
      ptt.addEventListener("pointerdown", (e) => {
        if (e.button != null && e.button !== 0) return;
        ptt.setPointerCapture(e.pointerId);
        startPTT(e);
      });
      ptt.addEventListener("pointerup", (e) => {
        try {
          ptt.releasePointerCapture(e.pointerId);
        } catch (_) {}
        stopPTT(e);
      });
      ptt.addEventListener("pointercancel", (e) => stopPTT(e));
      ptt.addEventListener("lostpointercapture", (e) => stopPTT(e));
    } else {
      ptt.addEventListener("mousedown", startPTT);
      ptt.addEventListener("mouseup", stopPTT);
      ptt.addEventListener("mouseleave", stopPTT);
      ptt.addEventListener(
        "touchstart",
        (e) => {
          e.preventDefault();
          startPTT(e);
        },
        { passive: false }
      );
      ptt.addEventListener(
        "touchend",
        (e) => {
          e.preventDefault();
          stopPTT(e);
        },
        { passive: false }
      );
      ptt.addEventListener(
        "touchcancel",
        (e) => {
          e.preventDefault();
          stopPTT(e);
        },
        { passive: false }
      );
    }

    $("btnStop").addEventListener("click", () => {
      ensureAudioUnlocked("interrupt_btn");
      doInterrupt();
    });

    $("btnSend").addEventListener("click", () => {
      ensureAudioUnlocked("typed_send");
      handleUserText($("typed").value, "typed");
      $("typed").value = "";
    });
    $("typed").addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        ensureAudioUnlocked("typed_enter");
        handleUserText($("typed").value, "typed");
        $("typed").value = "";
      }
    });

    document.querySelectorAll("[data-test-mode]").forEach((btn) => {
      btn.addEventListener("click", () => setTestMode(btn.getAttribute("data-test-mode")));
    });

    $("btnCopyDiag").addEventListener("click", () => copyText(diagnostics()));
    $("btnCopyFail").addEventListener("click", () => copyText(failurePayload()));
    $("btnDump").addEventListener("click", () => {
      addMsg(
        "system",
        "CAPSULE: " +
          JSON.stringify({
            schema: "portable_session_capsule_stage1_v101",
            ...diagnostics(),
          })
      );
    });

    $("btnPTT").disabled = false;
    setTestMode("A");
  }

  window.addEventListener("DOMContentLoaded", async () => {
    updateIdentityUI();
    if ("serviceWorker" in navigator) {
      try {
        await navigator.serviceWorker.register("./sw.js");
      } catch (_) {}
    }
    wire();
    if (!window.isSecureContext) {
      setError("INSECURE_CONTEXT", "boot", "HTTPS", location.protocol);
      addMsg("system", "אזהרה: לא secure context — מיקרופון עלול להיחסם");
    } else {
      addMsg(
        "system",
        "Secure context OK · Stage-1 MOCK v1.0.1 · independent temporary TTS · retest build"
      );
    }
    try {
      if (navigator.permissions && navigator.permissions.query) {
        const p = await navigator.permissions.query({ name: "microphone" });
        state.MIC_PERMISSION_STATUS = String(p.state).toUpperCase();
        if ($("micPermStatus")) $("micPermStatus").textContent = state.MIC_PERMISSION_STATUS;
        p.onchange = () => {
          state.MIC_PERMISSION_STATUS = String(p.state).toUpperCase();
          if ($("micPermStatus")) $("micPermStatus").textContent = state.MIC_PERMISSION_STATUS;
          renderDebug();
        };
      }
    } catch (_) {}
    await loadPersona();
  });
})();
