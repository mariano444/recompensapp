(function () {
  const cfg = window.RUNTIME_CONFIG || {};

  function setValue(id, value) {
    const el = document.getElementById(id);
    if (!el || !value) return;
    el.value = value;
  }

  function init() {
    setValue("sb_url", cfg.NEXT_PUBLIC_SUPABASE_URL);
    setValue("sb_anon", cfg.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY);
    setValue("app_url", cfg.NEXT_PUBLIC_APP_URL);

    if (typeof window.autoSave === "function") {
      window.autoSave();
    }

    const note = document.createElement("div");
    note.className = "alert alert-jade";
    note.innerHTML =
      "<span>✓</span><div>Esta copia ya se genera con la URL y la publishable key públicas de Supabase cargadas desde <code>.env.local</code>.</div>";

    const header = document.querySelector(".pg-header");
    if (header) {
      header.parentNode.insertBefore(note, header.nextSibling);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
