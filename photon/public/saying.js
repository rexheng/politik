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
  const facebookPostsEl = document.getElementById("facebook-posts");
  const blueskyPostsEl = document.getElementById("bluesky-posts");
  const facebookNoteEl = document.getElementById("facebook-note");
  const facebookFetchedEl = document.getElementById("facebook-fetched");
  const blueskyFetchedEl = document.getElementById("bluesky-fetched");
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

  function formatWhen(iso) {
    if (!iso) return "";
    const when = new Date(iso);
    if (Number.isNaN(when.getTime())) return "";
    return when.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }

  function showFetched(el, iso) {
    if (!el) return;
    const label = formatWhen(iso);
    if (!label) {
      el.hidden = true;
      el.textContent = "";
      return;
    }
    el.hidden = false;
    el.textContent = "Fetched " + label;
  }

  function chipLabels(item) {
    const labels = [];
    if (item.category) labels.push(item.category);
    (item.tags || []).forEach(function (tag) {
      if (tag && tag.text && labels.indexOf(tag.text) === -1) labels.push(tag.text);
    });
    if (item.sentiment) labels.push(item.sentiment);
    return labels;
  }

  function showPosts(el, posts) {
    if (!el) return;
    el.textContent = "";
    (posts || []).forEach(function (item) {
      if (!item) return;
      const li = document.createElement("li");
      li.className = "post";

      const line = document.createElement("p");
      line.className = "post-line";
      line.textContent = item.plain || item.title || "";
      li.appendChild(line);

      const meta = document.createElement("p");
      meta.className = "post-meta";
      if (item.author) {
        const who = document.createElement("span");
        who.textContent = item.author;
        meta.appendChild(who);
      }
      const when = formatWhen(item.happenedAt);
      if (when) {
        const time = document.createElement("time");
        if (item.happenedAt) time.setAttribute("datetime", item.happenedAt);
        time.textContent = when;
        meta.appendChild(time);
      }
      if (item.url) {
        const link = document.createElement("a");
        link.href = item.url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = "Post";
        meta.appendChild(link);
      }
      if (meta.childNodes.length) li.appendChild(meta);

      const labels = chipLabels(item);
      if (labels.length) {
        const tags = document.createElement("p");
        tags.className = "post-tags";
        labels.forEach(function (label) {
          const chip = document.createElement("span");
          chip.className = "chip";
          chip.textContent = label;
          tags.appendChild(chip);
        });
        li.appendChild(tags);
      }

      el.appendChild(li);
    });
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
    const facebook = Array.isArray(data.facebook)
      ? data.facebook
      : items.filter(function (item) {
          return item && (item.source === "browserbase" || item.source === "facebook");
        });
    const bluesky = Array.isArray(data.bluesky)
      ? data.bluesky
      : items.filter(function (item) {
          return item && item.source === "bluesky";
        });

    showPosts(facebookPostsEl, facebook);
    showPosts(blueskyPostsEl, bluesky);
    showFetched(blueskyFetchedEl, data.scannedAt);
    showFetched(facebookFetchedEl, data.facebookReadAt);
    if (facebookNoteEl) {
      if (!facebook.length && data.facebookNote) {
        facebookNoteEl.hidden = false;
        facebookNoteEl.textContent = data.facebookNote;
      } else {
        facebookNoteEl.hidden = true;
        facebookNoteEl.textContent = "";
      }
    }

    try {
      sessionStorage.setItem(KB_KEY, JSON.stringify(items));
    } catch (_) {
      /* private mode */
    }

    const tags = collectTags(facebook);
    showTags(tags);
    if (stageEl) stageEl.textContent = "handoff";
    if (askLink) askLink.hidden = false;
  })();
})();
