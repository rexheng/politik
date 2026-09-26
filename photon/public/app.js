(function () {
  const CATEGORY_LABELS = {
    "bill-stuck": "A bill is waiting",
    "local-worry": "Near home",
    "lab-money": "Labs and money",
    research: "Research",
    speech: "A speech",
    other: "General",
  };

  const form = document.getElementById("ask-form");
  const input = document.getElementById("message");
  const button = document.getElementById("ask-btn");
  const transcript = document.getElementById("transcript");
  function showTranscript() {
    transcript.hidden = false;
  }

  function appendUser(text) {
    const bubble = document.createElement("div");
    bubble.className = "bubble bubble--user";
    bubble.textContent = text;
    transcript.appendChild(bubble);
  }

  function auditText(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function fetchedText(value) {
    const text = auditText(value);
    if (!text) return "—";
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
    const parsed = new Date(text);
    if (Number.isNaN(parsed.getTime())) return text;
    return parsed.toISOString().slice(0, 16).replace("T", " ") + " UTC";
  }

  function urlNode(value) {
    const text = auditText(value);
    if (!text) return null;
    let href = "";
    try {
      const parsed = new URL(text);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") href = parsed.href;
    } catch (err) {
      href = "";
    }
    if (!href) {
      const span = document.createElement("span");
      span.textContent = text;
      return span;
    }
    const link = document.createElement("a");
    link.href = href;
    link.textContent = href;
    link.rel = "noopener noreferrer";
    link.target = "_blank";
    return link;
  }

  function auditLine(label, value) {
    const line = document.createElement("p");
    line.className = "audit-line";
    const key = document.createElement("span");
    key.className = "audit-k";
    key.textContent = label;
    line.appendChild(key);
    if (value && typeof value === "object") {
      line.appendChild(value);
    } else {
      const text = document.createElement("span");
      text.textContent = value || "—";
      line.appendChild(text);
    }
    return line;
  }

  function auditStrip(item) {
    const strip = document.createElement("div");
    strip.className = "item-audit";
    const link = urlNode(item && item.url);
    strip.appendChild(auditLine("URL", link || "—"));
    strip.appendChild(auditLine("FETCHED", fetchedText(item && (item.fetched || item.happenedAt))));
    strip.appendChild(auditLine("SOURCE", auditText(item && item.source) || "—"));
    strip.appendChild(auditLine("JURISDICTION", auditText(item && item.jurisdiction) || "—"));
    return strip;
  }

  function prefersReducedMotion() {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  function wait(ms) {
    return new Promise(function (resolve) {
      window.setTimeout(resolve, ms);
    });
  }

  function showPending() {
    const pending = document.createElement("div");
    pending.className = "bubble bubble--photon bubble--pending";
    const dots = document.createElement("span");
    dots.className = "pending-dots";
    dots.setAttribute("aria-hidden", "true");
    for (let i = 0; i < 3; i++) dots.appendChild(document.createElement("span"));
    pending.appendChild(dots);
    const note = document.createElement("span");
    note.className = "sr-only";
    note.textContent = "Looking that up";
    pending.appendChild(note);
    transcript.appendChild(pending);
    pending.scrollIntoView({ behavior: "smooth", block: "end" });
    return pending;
  }

  function clearPending(pending) {
    if (pending && pending.parentNode) pending.remove();
  }

  async function revealText(node, text) {
    const paragraphs = text.trim() ? text.trim().split(/\n\n+/) : [];
    const words = paragraphs.flatMap(function (paragraph) {
      return paragraph.trim().split(/\s+/).filter(Boolean);
    });
    if (prefersReducedMotion() || words.length === 0) {
      node.textContent = text;
      return;
    }
    node.setAttribute("aria-hidden", "true");
    node.textContent = "";
    const step = Math.min(28, Math.max(12, Math.round(700 / words.length)));
    const shown = [];
    for (let p = 0; p < paragraphs.length; p++) {
      const part = paragraphs[p].trim().split(/\s+/).filter(Boolean);
      const built = [];
      for (let i = 0; i < part.length; i++) {
        built.push(part[i]);
        node.textContent = shown.concat(built.join(" ")).join("\n\n");
        if (!(p === paragraphs.length - 1 && i === part.length - 1)) await wait(step);
      }
      shown.push(built.join(" "));
    }
    node.textContent = shown.join("\n\n");
    node.removeAttribute("aria-hidden");
  }

  function itemCard(item) {
    const card = document.createElement("article");
    card.className = "item-card";

    if (item && item.placeNote) {
      const note = document.createElement("p");
      note.className = "item-relation";
      note.textContent = item.placeNote;
      card.appendChild(note);
    }

    const title = document.createElement("p");
    title.className = "item-title";
    if (item.url) {
      const link = document.createElement("a");
      link.href = item.url;
      link.textContent = item.title || "";
      link.rel = "noopener noreferrer";
      link.target = "_blank";
      title.appendChild(link);
    } else {
      title.textContent = item.title || "";
    }
    card.appendChild(title);

    if (item.plain) {
      const plain = document.createElement("p");
      plain.className = "item-plain";
      plain.textContent = item.plain;
      card.appendChild(plain);
    }

    card.appendChild(auditStrip(item));
    return card;
  }

  async function appendPhoton(reply, category, items) {
    const block = document.createElement("div");
    block.className = "reply-block";

    const bubble = document.createElement("div");
    bubble.className = "bubble bubble--photon bubble--in";
    block.appendChild(bubble);
    transcript.appendChild(block);

    await revealText(bubble, reply || "");

    const list = Array.isArray(items) ? items.slice(0, 5) : [];
    if (list.length === 0) {
      bubble.scrollIntoView({ behavior: "smooth", block: "end" });
      return;
    }

    const tail = document.createElement("div");
    tail.className = "reply-tail reply-tail--in";

    const label = CATEGORY_LABELS[category];
    if (label && category !== "other") {
      const cat = document.createElement("p");
      cat.className = "category";
      cat.textContent = label;
      tail.appendChild(cat);
    }

    const itemsEl = document.createElement("div");
    itemsEl.className = "items";
    list.forEach(function (item) {
      itemsEl.appendChild(itemCard(item));
    });
    tail.appendChild(itemsEl);
    block.appendChild(tail);
    tail.scrollIntoView({ behavior: "smooth", block: "end" });
  }

  let reachNoted = false;

  function appendError() {
    if (reachNoted) return;
    reachNoted = true;
    const bubble = document.createElement("div");
    bubble.className = "bubble bubble--photon";
    bubble.textContent = "I could not reach Politik. Try again.";
    transcript.appendChild(bubble);
  }


  function readWho() {
    try {
      const parsed = JSON.parse(sessionStorage.getItem("politik-who") || "null");
      if (parsed && typeof parsed.name === "string" && parsed.name.trim()) return parsed;
    } catch (err) {
      return null;
    }
    return null;
  }

  const who = readWho();
  const tagline = document.querySelector(".tagline");
  if (who && tagline) tagline.textContent = who.name;

  const turns = [];

  function rememberTurn(message, data) {
    turns.push({ role: "user", text: message });
    const titles = [];
    const list = data && Array.isArray(data.items) ? data.items : [];
    list.forEach(function (item) {
      if (item && item.title) titles.push(item.title);
    });
    turns.push({ role: "assistant", text: (data && data.reply) || "", titles: titles });
    while (turns.length > 8) turns.shift();
  }

  function askBody(message, knowledge) {
    const payload = { message, history: turns.slice() };
    if (knowledge) payload.knowledge = knowledge;
    if (who) {
      payload.who = {
        name: who.name,
        region: who.region || "",
        role: who.role || "",
        context: who.context || null,
      };
    }
    return payload;
  }

  function readKnowledge() {
    try {
      const raw = sessionStorage.getItem("politik-kb");
      if (!raw) return undefined;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch (err) {
      return undefined;
    }
    return undefined;
  }

  async function postAsk(message) {
    const res = await fetch("/api/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(askBody(message, readKnowledge())),
    });
    if (!res.ok) throw new Error("ask failed");
    return res.json();
  }

  async function renderAsk(message) {
    reachNoted = false;
    showTranscript();
    appendUser(message);
    button.disabled = true;
    const pending = showPending();
    try {
      const data = await postAsk(message);
      clearPending(pending);
      rememberTurn(message, data);
      await appendPhoton(data.reply || "", data.category, data.items);
    } catch (err) {
      clearPending(pending);
      appendError();
    } finally {
      button.disabled = false;
    }
  }

  const GREETING = "What do you want to know?";

  function voicePrompt() {
    const lines = [
      "You are Politik.",
      "Greetings stay to one short sentence.",
      "Do not recite a briefing unless the person asked a real question.",
    ];
    const knowledge = readKnowledge();
    if (knowledge) {
      lines.push("Session notes:");
      lines.push(JSON.stringify(knowledge));
    }
    return lines.join("\n");
  }

  function agentSocketBase() {
    const url = new URL("/api/voice", window.location.href);
    url.protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    url.search = "";
    url.hash = "";
    return url.href.replace(/\/$/, "");
  }

  let voiceTurn = "";
  let voiceFailed = false;

  function mountFallbackTalk(host) {
    host.innerHTML = "";
    const talkBtn = document.createElement("button");
    talkBtn.type = "button";
    talkBtn.className = "talk-btn";
    talkBtn.textContent = "Talk";
    host.appendChild(talkBtn);

    let busy = false;
    let mediaStream = null;
    let audioContext = null;
    let processor = null;
    let source = null;
    let socket = null;
    let silenceTimer = null;
    let heard = "";

    function setLabel(text) {
      talkBtn.textContent = text;
    }

    function cleanupMic() {
      if (silenceTimer) {
        clearTimeout(silenceTimer);
        silenceTimer = null;
      }
      try {
        if (processor) processor.disconnect();
      } catch (err) {}
      try {
        if (source) source.disconnect();
      } catch (err) {}
      try {
        if (audioContext) audioContext.close();
      } catch (err) {}
      if (mediaStream) {
        mediaStream.getTracks().forEach(function (track) {
          track.stop();
        });
      }
      processor = null;
      source = null;
      audioContext = null;
      mediaStream = null;
    }

    function closeSocket() {
      if (!socket) return;
      try {
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "CloseStream" }));
      } catch (err) {}
      try {
        socket.close();
      } catch (err) {}
      socket = null;
    }

    function failOnce() {
      cleanupMic();
      closeSocket();
      busy = false;
      setLabel("Talk");
      talkBtn.disabled = false;
      showTranscript();
      appendError();
    }

    function downsample(buffer, inRate, outRate) {
      if (outRate === inRate) return buffer;
      const ratio = inRate / outRate;
      const length = Math.round(buffer.length / ratio);
      const result = new Float32Array(length);
      for (let i = 0; i < length; i++) {
        result[i] = buffer[Math.min(buffer.length - 1, Math.round(i * ratio))] || 0;
      }
      return result;
    }

    function floatTo16(buffer) {
      const out = new Int16Array(buffer.length);
      for (let i = 0; i < buffer.length; i++) {
        const sample = Math.max(-1, Math.min(1, buffer[i]));
        out[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      }
      return out;
    }

    async function playReply(text) {
      const spoken = (text || "").trim();
      if (!spoken) return;
      const res = await fetch("/api/voice/speak", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: spoken }),
      });
      if (!res.ok) throw new Error("speak");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      await new Promise(function (resolve, reject) {
        const audio = new Audio(url);
        audio.onended = function () {
          URL.revokeObjectURL(url);
          resolve();
        };
        audio.onerror = function () {
          URL.revokeObjectURL(url);
          reject(new Error("play"));
        };
        audio.play().catch(reject);
      });
    }

    async function finishTurn(text) {
      cleanupMic();
      closeSocket();
      const message = (text || heard || "").trim();
      if (!message) {
        busy = false;
        setLabel("Talk");
        talkBtn.disabled = false;
        showTranscript();
        appendError();
        return;
      }
      try {
        setLabel("Thinking");
        const data = await postAsk(message);
        showTranscript();
        appendUser(message);
        rememberTurn(message, data);
        await appendPhoton(data.reply || "", data.category, data.items);
        setLabel("Speaking");
        await playReply(data.reply || GREETING);
      } catch (err) {
        showTranscript();
        appendError();
      } finally {
        busy = false;
        setLabel("Talk");
        talkBtn.disabled = false;
      }
    }

    function armSilence() {
      if (silenceTimer) clearTimeout(silenceTimer);
      silenceTimer = setTimeout(function () {
        finishTurn(heard);
      }, 1400);
    }

    talkBtn.addEventListener("click", async function () {
      if (busy) return;
      reachNoted = false;
      busy = true;
      talkBtn.disabled = true;
      heard = "";
      setLabel("Listening");
      try {
        mediaStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
          },
        });
        const listenUrl = new URL("/api/voice/listen", window.location.href);
        listenUrl.protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        socket = new WebSocket(listenUrl.href);
        socket.binaryType = "arraybuffer";

        await new Promise(function (resolve, reject) {
          const timer = setTimeout(function () {
            reject(new Error("connect"));
          }, 8000);
          socket.onopen = function () {
            clearTimeout(timer);
            resolve();
          };
          socket.onerror = function () {
            clearTimeout(timer);
            reject(new Error("socket"));
          };
        });

        socket.onmessage = function (event) {
          if (typeof event.data !== "string") return;
          let payload;
          try {
            payload = JSON.parse(event.data);
          } catch (err) {
            return;
          }
          if (payload.type === "UtteranceEnd") {
            finishTurn(heard);
            return;
          }
          const alt =
            payload.channel &&
            payload.channel.alternatives &&
            payload.channel.alternatives[0];
          const text = alt && typeof alt.transcript === "string" ? alt.transcript.trim() : "";
          if (!text) return;
          if (payload.is_final || payload.speech_final) {
            heard = (heard + " " + text).trim();
            armSilence();
          }
        };

        socket.onclose = function () {
          if (busy && talkBtn.textContent === "Listening") failOnce();
        };

        audioContext = new AudioContext();
        const inputRate = audioContext.sampleRate;
        source = audioContext.createMediaStreamSource(mediaStream);
        processor = audioContext.createScriptProcessor(4096, 1, 1);
        const silent = audioContext.createGain();
        silent.gain.value = 0;
        processor.onaudioprocess = function (event) {
          if (!socket || socket.readyState !== WebSocket.OPEN) return;
          const input = event.inputBuffer.getChannelData(0);
          const down = downsample(input, inputRate, 16000);
          socket.send(floatTo16(down).buffer);
        };
        source.connect(processor);
        processor.connect(silent);
        silent.connect(audioContext.destination);
        setTimeout(function () {
          if (busy && talkBtn.textContent === "Listening" && !heard) failOnce();
        }, 12000);
      } catch (err) {
        failOnce();
      }
    });
  }

  function mountVoice() {
    const host = document.getElementById("voice");
    const widget = window.DeepgramAgent;
    if (!host) return;

    function useFallback() {
      if (voiceFailed) return;
      voiceFailed = true;
      try {
        host.innerHTML = "";
      } catch (err) {}
      mountFallbackTalk(host);
    }

    if (!widget || typeof widget.init !== "function") {
      useFallback();
      return;
    }

    const prompt = voicePrompt();
    try {
      widget.init({
        tokenFactory: function () {
          return fetch("/api/deepgram-token").then(function (res) {
            if (!res.ok) throw new Error("token");
            return res.text();
          });
        },
        url: agentSocketBase(),
        agent: {
          language: "en",
          greeting: GREETING,
          listen: {
            provider: { type: "deepgram", model: "nova-3" },
          },
          think: {
            provider: { type: "open_ai", model: "gpt-4o-mini" },
            prompt: prompt,
            endpoint: {
              url: new URL("/api/voice/think", window.location.href).href,
            },
          },
          speak: {
            provider: { type: "deepgram", model: "aura-2-thalia-en" },
          },
        },
        overrides: {
          greeting: GREETING,
          systemPrompt: prompt,
        },
        layout: "orb",
        containerId: "voice",
        colorScheme: "light",
        showTranscript: false,
        showTextInput: false,
        showMicToggle: false,
        showSpeakerToggle: false,
        text: {
          name: "Politik",
          startLabel: "Talk",
          stopLabel: "Stop",
          connectingLabel: "Connecting",
          emptyStateHint: "Talk",
        },
        theme: {
          primary: "#1c1915",
          primaryHover: "#2e2a24",
          primaryActive: "#1c1915",
          onPrimary: "#f6f1e7",
          background: "#f6f1e7",
          backgroundRaised: "#fffdf8",
          backgroundInput: "#fffdf8",
          backgroundHover: "#f6f1e7",
          backgroundActive: "#efe6d4",
          text: "#1c1915",
          textMuted: "#5c564c",
          border: "#1c1915",
          userMessageBackground: "#fffdf8",
          userMessageBorder: "#1c1915",
          buttonRadius: "9999px",
          font: '"Source Sans 3", "Segoe UI", sans-serif',
        },
        on: {
          onError: function () {
            useFallback();
          },
          onAgentError: function () {
            useFallback();
          },
          onMessage: function (msg) {
            if (!msg || msg.role !== "user") return;
            const text = typeof msg.content === "string" ? msg.content.trim() : "";
            if (!text || text === voiceTurn) return;
            voiceTurn = text;
            renderAsk(text).finally(function () {
              if (voiceTurn === text) voiceTurn = "";
            });
          },
        },
      });
    } catch (err) {
      useFallback();
    }

    host.addEventListener("click", function (event) {
      const target = event.target;
      if (!(target instanceof Element) || target.closest("button") || !target.closest("canvas")) return;
      const talk = host.querySelector("button");
      if (talk && !talk.disabled) talk.click();
    });
  }

  mountVoice();

  form.addEventListener("submit", async function (event) {
    event.preventDefault();
    const message = input.value.trim();
    if (!message || button.disabled) return;
    input.value = "";
    await renderAsk(message);
    input.focus();
    transcript.lastElementChild?.scrollIntoView({
      behavior: "smooth",
      block: "end",
    });
  });
})();
