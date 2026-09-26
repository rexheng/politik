(function () {
  mapboxgl.accessToken = "";

  const map = new mapboxgl.Map({
    container: "map",
    style: "mapbox://styles/mapbox/light-v11",
    center: [-119.4, 36.8],
    zoom: 5,
  });
  map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "bottom-right");

  const trace = document.getElementById("trace");
  const bounds = new mapboxgl.LngLatBounds();
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

  function pin(point) {
    const el = document.createElement("div");
    const kind = point.kind === "datacentre" ? "datacentre" : "university";
    el.className = "pin " + kind;
    el.title = point.title || "";
    el.setAttribute("aria-label", (point.title || "Place") + ", " + (point.place || ""));
    const link = point.url
      ? '<a href="' + escapeAttr(point.url) + '" target="_blank" rel="noopener noreferrer">source</a>'
      : "";
    const detail = point.detail ? escapeHtml(point.detail) + "<br>" : "";
    const label = kind === "datacentre" ? "Datacentre" : "University";
    const popup = new mapboxgl.Popup({ offset: 14 }).setHTML(
      "<strong>" + escapeHtml(point.title) + "</strong><br>" +
        escapeHtml(point.place) + "<br>" +
        detail +
        escapeHtml(label) + " · " + escapeHtml(point.source) + " " + link,
    );
    new mapboxgl.Marker({ element: el, anchor: "center" })
      .setLngLat([point.lng, point.lat])
      .setPopup(popup)
      .addTo(map);
    bounds.extend([point.lng, point.lat]);
    placed += 1;
  }

  fetch("/api/map")
    .then((res) => res.json())
    .then((data) => {
      const points = data.points || [];
      (data.trace || []).forEach((item) => trace.appendChild(stepEl(item)));
      points.forEach(pin);
      if (placed > 0) map.fitBounds(bounds, { padding: 64, maxZoom: 6, duration: 0 });
    })
    .catch(() => {
      trace.appendChild(stepEl({ label: "Map unavailable" }));
    });
})();
