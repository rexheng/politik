(function () {
  const blocked = document.getElementById("blocked");
  const jurisdictions = document.getElementById("jurisdictions");
  const sources = document.getElementById("sources");
  const latest = document.getElementById("latest");
  const DASH = "\u2014";

  function chip(text) {
    const span = document.createElement("span");
    span.className = "chip";
    span.textContent = text;
    return span;
  }

  function redistributionBadge(ok) {
    if (ok !== true) return null;
    const span = document.createElement("span");
    span.className = "badge";
    span.textContent = "Redistribution OK";
    return span;
  }

  function line(label, value) {
    const p = document.createElement("p");
    p.className = "meta";
    const key = document.createElement("span");
    key.className = "k";
    key.textContent = label;
    p.append(key);
    if (!value) {
      p.append(document.createTextNode(DASH));
      return p;
    }
    if (/^https?:\/\//.test(value)) {
      const a = document.createElement("a");
      a.href = value;
      a.textContent = value;
      p.append(a);
      return p;
    }
    p.append(document.createTextNode(value));
    return p;
  }

  function errorLine(text) {
    const p = document.createElement("p");
    p.className = "meta";
    const key = document.createElement("span");
    key.className = "k";
    key.textContent = "Error";
    p.append(key);
    const match = text.match(/https?:\/\/\S+/);
    if (!match || match.index === undefined) {
      p.append(document.createTextNode(text));
      return p;
    }
    p.append(document.createTextNode(text.slice(0, match.index)));
    const a = document.createElement("a");
    a.href = match[0];
    a.textContent = match[0];
    p.append(a, document.createTextNode(text.slice(match.index + match[0].length)));
    return p;
  }

  function countLine(documents) {
    const count = document.createElement("p");
    count.className = "count";
    count.append(document.createTextNode(String(documents)));
    const unit = document.createElement("span");
    unit.textContent = " documents";
    count.append(unit);
    return count;
  }

  function blockedCard(source) {
    const card = document.createElement("article");
    card.className = "card blocked";
    const name = document.createElement("h3");
    name.className = "name";
    name.textContent = source.id;
    const chips = document.createElement("div");
    chips.className = "chips";
    chips.append(chip(source.jurisdiction));
    card.append(
      name,
      chips,
      line("Live", source.live === true ? "true" : ""),
      line("Ended", source.ended),
      errorLine(source.error || ""),
      line("URL", source.url),
      line("Fetched", source.fetched),
      line("SHA-256", source.sha256),
    );
    if (source.officialText === false) {
      const none = document.createElement("p");
      none.className = "meta";
      none.textContent = "No official text";
      card.append(none);
    }
    card.append(line("Attribution", source.attribution));
    return card;
  }

  function jurisdictionCard(row) {
    const card = document.createElement("article");
    card.className = "card";
    const chips = document.createElement("div");
    chips.className = "chips";
    chips.append(chip(row.label || row.id));
    card.append(chips, countLine(row.documents));
    return card;
  }

  function sourceCard(source) {
    const card = document.createElement("article");
    card.className = "card";
    const name = document.createElement("h3");
    name.className = "name";
    name.textContent = source.id;
    const chips = document.createElement("div");
    chips.className = "chips";
    const badge = redistributionBadge(source.redistributionOk);
    if (badge) chips.append(badge);
    card.append(name, chips, countLine(source.documents));
    card.append(
      line("URL", source.url),
      line("Fetched", source.fetched),
      line("SHA-256", source.sha256),
      line("Attribution", source.attribution),
    );
    return card;
  }

  function docCard(doc) {
    const card = document.createElement("article");
    card.className = "doc";
    const title = document.createElement("h3");
    const a = document.createElement("a");
    a.href = doc.url;
    a.textContent = doc.title;
    title.append(a);
    const chips = document.createElement("div");
    chips.className = "chips";
    chips.append(chip(doc.kind), chip(doc.jurisdiction));
    const badge = redistributionBadge(doc.redistributionOk);
    if (badge) chips.append(badge);
    card.append(
      title,
      chips,
      line("Published", doc.published),
      line("URL", doc.url),
      line("Fetched", doc.fetched),
      line("SHA-256", doc.sha256),
    );
    return card;
  }

  fetch("/api/sources")
    .then(function (res) { return res.json(); })
    .then(function (data) {
      (data.blocked || []).forEach(function (row) {
        blocked.appendChild(blockedCard(row));
      });
      (data.jurisdictions || []).forEach(function (row) {
        jurisdictions.appendChild(jurisdictionCard(row));
      });
      (data.sources || []).forEach(function (row) {
        sources.appendChild(sourceCard(row));
      });
      (data.latest || []).forEach(function (row) {
        latest.appendChild(docCard(row));
      });
    });
})();
