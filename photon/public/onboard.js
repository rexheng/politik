const CONTEXT = {
  name: "David Evan Harris",
  handle: "davidevanharris",
};

document.getElementById("signup").addEventListener("submit", (event) => {
  event.preventDefault();
  const name = document.getElementById("name").value.trim();
  if (!name) {
    document.getElementById("name").focus();
    return;
  }
  sessionStorage.setItem(
    "politik-who",
    JSON.stringify({
      name,
      region: document.getElementById("region").value.trim(),
      role: document.getElementById("role").value.trim(),
      context: CONTEXT,
    }),
  );
  location.assign("/");
});
