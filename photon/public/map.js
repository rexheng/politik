(async function () {
  let token = "";
  try {
    const res = await fetch("/api/map-token");
    if (res.ok) token = (await res.text()).trim();
  } catch (err) {
    token = "";
  }
  const trace = document.getElementById("trace");
  if (!token) {
    if (trace) trace.appendChild(stepEl({ label: "Map unavailable" }));
    return;
  }
  mapboxgl.accessToken = token;

  const map = new mapboxgl.Map({
    container: "map",
    style: "mapbox://styles/mapbox/streets-v12",
    projection: "mercator",
    center: [-119.4, 36.8],
    zoom: 5,
    pitch: 0,
    bearing: 0,
    maxPitch: 0,
    dragRotate: false,
    pitchWithRotate: false,
    touchPitch: false,
  });
  map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "bottom-right");

  const westBounds = new mapboxgl.LngLatBounds();
  const singaporeBounds = new mapboxgl.LngLatBounds();
  let placed = 0;

  function stepEl(item) {
    const el = item.url ? document.createElement("a") : document.createElement("span");
    el.className = "step" + (item.id ? " " + item.id : "");
    el.textContent = item.label;
    if (item.url) {
      el.href = item.url;
      el.target = "_blank";
      el.rel = "noopener noreferrer";
    }
    return el;
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function escapeAttr(value) {
    return escapeHtml(value).replace(/"/g, "&quot;");
  }

  function kindOf(point) {
    if (point.kind === "datacentre" || point.kind === "policy") return point.kind;
    return "university";
  }

  function kindLabel(kind) {
    if (kind === "datacentre") return "Datacentre";
    if (kind === "policy") return "Policy Tracker";
    return "University";
  }

  const PIN_COLOR = {
    datacentre: "#c2412d",
    university: "#8a6230",
    policy: "#1f6b4a",
  };

  function pinMarkup(color) {
    return (
      '<svg viewBox="0 0 24 36" width="22" height="32" aria-hidden="true">' +
      '<path fill="' + color + '" d="M12 0C5.37 0 0 5.37 0 12c0 8.4 12 24 12 24s12-15.6 12-24C24 5.37 18.63 0 12 0z"/>' +
      '<circle cx="12" cy="11.5" r="4" fill="#f6f1e7"/>' +
      "</svg>"
    );
  }

  function pin(point) {
    const el = document.createElement("div");
    const kind = kindOf(point);
    el.className = "pin " + kind;
    el.innerHTML = pinMarkup(PIN_COLOR[kind] || PIN_COLOR.university);
    el.title = point.title || "";
    el.setAttribute("aria-label", (point.title || "Place") + ", " + (point.place || ""));
    const link = point.url
      ? '<a href="' + escapeAttr(point.url) + '" target="_blank" rel="noopener noreferrer">source</a>'
      : "";
    const detail = point.detail ? escapeHtml(point.detail) + "<br>" : "";
    const popup = new mapboxgl.Popup({ offset: 36, anchor: "bottom" }).setHTML(
      "<strong>" + escapeHtml(point.title) + "</strong><br>" +
        escapeHtml(point.place) + "<br>" +
        detail +
        escapeHtml(kindLabel(kind)) + " " + link,
    );
    new mapboxgl.Marker({ element: el, anchor: "bottom" })
      .setLngLat([point.lng, point.lat])
      .setPopup(popup)
      .addTo(map);
    const target = point.frame === "singapore" ? singaporeBounds : westBounds;
    target.extend([point.lng, point.lat]);
    placed += 1;
  }

  function showFrame(name) {
    const west = document.getElementById("frame-west");
    const singapore = document.getElementById("frame-sg");
    if (west) west.setAttribute("aria-pressed", name === "west" ? "true" : "false");
    if (singapore) singapore.setAttribute("aria-pressed", name === "singapore" ? "true" : "false");
    const bounds = name === "singapore" ? singaporeBounds : westBounds;
    if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: 72, maxZoom: name === "singapore" ? 11 : 6, duration: 600 });
  }

  const westButton = document.getElementById("frame-west");
  const singaporeButton = document.getElementById("frame-sg");
  if (westButton) westButton.addEventListener("click", () => showFrame("west"));
  if (singaporeButton) singaporeButton.addEventListener("click", () => showFrame("singapore"));

  fetch("/api/map")
    .then((res) => res.json())
    .then((data) => {
      const points = data.points || [];
      (data.trace || []).forEach((item) => trace.appendChild(stepEl(item)));
      points.forEach(pin);
      if (!westBounds.isEmpty()) map.fitBounds(westBounds, { padding: 72, maxZoom: 6, duration: 0 });
      else if (placed > 0) map.fitBounds(singaporeBounds, { padding: 72, maxZoom: 11, duration: 0 });
    })
    .catch(() => {
      trace.appendChild(stepEl({ label: "Map unavailable" }));
    });
})();
