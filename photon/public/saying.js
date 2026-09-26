(function () {
  const GROUP =
    "https://www.facebook.com/groups/saynotodatacenters/";
  const BLUESKY = "https://bsky.app/profile/datacenter.bsky.social";
  const STAGES = ["open", "read", "handoff"];
  const BLUESKY_STAGES = ["open", "comments", "sentiment"];
  const BUCKETS = ["for", "against", "unsure"];
  const KB_KEY = "politik-kb";

  const clockEl = document.getElementById("clock");
  const blueskyClockEl = document.getElementById("bluesky-clock");
  const stageEl = document.getElementById("stage");
  const blueskyStageEl = document.getElementById("bluesky-stage");
  const tagsEl = document.getElementById("tags");
  const weightsEl = document.getElementById("weights");
  const askLink = document.getElementById("ask-link");
  const groupEl = document.getElementById("group-url");
  const blueskyEl = document.getElementById("bluesky-url");

  if (groupEl) groupEl.href = GROUP;
  if (blueskyEl) blueskyEl.href = BLUESKY;

  function paintClock(el) {
    if (!el) return;
    const now = new Date();
    el.textContent = now.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    el.setAttribute("datetime", now.toISOString());
  }

  function tickClock() {
    paintClock(clockEl);
    paintClock(blueskyClockEl);
  }

  tickClock();
  setInterval(tickClock, 1000);

  function sleep(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  function collectTags(items) {
    const byText = new Map();
    (items || []).forEach(function (item) {
      (item.tags || []).forEach(function (tag) {
        if (!tag || !tag.text) return;
        const sig = typeof tag.significance === "number" ? tag.significance : 0;
        const prev = byText.get(tag.text);
        if (!prev || sig > prev.significance) {
          byText.set(tag.text, { text: tag.text, significance: sig });
        }
      });
    });
    return Array.from(byText.values()).sort(function (a, b) {
      return b.significance - a.significance;
    });
  }

  function showTags(tags) {
    if (!tagsEl) return;
    tagsEl.textContent = "";
    tags.forEach(function (tag, i) {
      const el = document.createElement("span");
      el.className = "tag";
      if (tag.significance >= 0.55) el.classList.add("tag--hot");
      el.textContent = tag.text;
      const size = 0.85 + tag.significance * 1.55;
      const weight = 500 + Math.round(tag.significance * 200);
      const bright = 0.45 + tag.significance * 0.55;
      el.style.fontSize = size.toFixed(2) + "rem";
      el.style.fontWeight = String(weight);
      el.style.opacity = "0";
      if (tag.significance >= 0.55) {
        el.style.color =
          "rgba(232, 196, 104, " + Math.min(1, bright).toFixed(2) + ")";
      } else {
        el.style.color =
          "rgba(246, 241, 231, " + Math.min(0.95, bright).toFixed(2) + ")";
      }
      tagsEl.appendChild(el);
      setTimeout(function () {
        el.classList.add("is-in");
        el.style.opacity = String(Math.min(1, bright));
      }, 40 + i * 55);
    });
  }

  function countBuckets(comments) {
    const counts = { for: 0, against: 0, unsure: 0 };
    if (!Array.isArray(comments)) return counts;
    comments.forEach(function (comment) {
      if (!comment || typeof comment.text !== "string" || !comment.text.trim()) return;
      if (counts[comment.sentiment] === undefined) return;
      counts[comment.sentiment] += 1;
    });
    return counts;
  }

  function showWeights(comments) {
    if (!weightsEl) return;
    const counts = countBuckets(comments);
    const max = Math.max(counts.for, counts.against, counts.unsure);
    BUCKETS.forEach(function (name) {
      const el = weightsEl.querySelector('.weight[data-bucket="' + name + '"]');
      if (!el) return;
      const countEl = el.querySelector(".count");
      const count = counts[name];
      if (countEl) countEl.textContent = String(count);
      const scale = max > 0 ? count / max : 0;
      el.style.fontSize = (1.15 + scale * 1.85).toFixed(2) + "rem";
      el.classList.toggle("is-heavy", count > 0 && count === max);
    });
  }

  async function runStages(el, stages) {
    if (!el) return;
    for (let i = 0; i < stages.length; i++) {
      el.textContent = stages[i];
      await sleep(i === 0 ? 700 : 900);
    }
  }

  async function loadSaying() {
    const res = await fetch("/api/saying", { method: "GET" });
    if (!res.ok) throw new Error("saying failed");
    return res.json();
  }

  showWeights([]);

  (async function () {
    const stagePromise = Promise.all([
      runStages(stageEl, STAGES),
      runStages(blueskyStageEl, BLUESKY_STAGES),
    ]);
    let data = null;
    let err = null;

    try {
      data = await loadSaying();
    } catch (e) {
      err = e;
    }

    await stagePromise;

    const comments = data && Array.isArray(data.comments) ? data.comments : [];
    showWeights(comments);
    if (blueskyStageEl) blueskyStageEl.textContent = "sentiment";
    if (data && data.blueskyUrl && blueskyEl) blueskyEl.href = data.blueskyUrl;

    if (err || !data) {
      if (stageEl) stageEl.textContent = "handoff";
      return;
    }

    if (data.groupUrl && groupEl) groupEl.href = data.groupUrl;

    const items = Array.isArray(data.items) ? data.items : [];
    try {
      sessionStorage.setItem(KB_KEY, JSON.stringify(items));
    } catch (_) {
      /* private mode */
    }

    const tags = collectTags(items);
    showTags(tags);
    if (stageEl) stageEl.textContent = "handoff";
    if (askLink) askLink.hidden = false;
  })();
})();
