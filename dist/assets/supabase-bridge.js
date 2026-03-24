(function () {
  const cfg = window.RUNTIME_CONFIG || {};
  const supabaseUrl = cfg.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = cfg.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY;
  const appUrl = cfg.NEXT_PUBLIC_APP_URL || window.location.origin;
  const storageKey = "recompensapp.supabase.session";

  if (!supabaseUrl || !supabaseKey) {
    return;
  }

  const originalSaveAll = typeof saveAll === "function" ? saveAll : function () {};
  const originalLoadAll = typeof loadAll === "function" ? loadAll : function () {};
  const query = new URLSearchParams(window.location.search);

  let remoteProfile = null;
  let activeProfileId = null;
  let profileSaveTimer = null;
  let isHydrating = false;
  let publicMode = false;
  let session = loadSession();

  function safeToast(message, icon) {
    if (typeof toast === "function") toast(message, icon);
  }

  function loadSession() {
    try {
      const raw = localStorage.getItem(storageKey);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function saveSession(nextSession) {
    session = nextSession || null;
    try {
      if (nextSession) localStorage.setItem(storageKey, JSON.stringify(nextSession));
      else localStorage.removeItem(storageKey);
    } catch {}
  }

  function slugify(value) {
    return (value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-");
  }

  function formatDate(value) {
    if (!value) return "";
    return new Date(value).toLocaleDateString("es-AR", {
      day: "numeric",
      month: "short",
      year: "numeric"
    });
  }

  function parseSuggestions(value) {
    if (!value) return [100, 500, 1000, 2000, 5000];
    return String(value)
      .split(",")
      .map((item) => Number(item.trim()))
      .filter((item) => Number.isFinite(item) && item > 0);
  }

  function getFullName(user) {
    const name = user?.user_metadata?.name || user?.name || "";
    const lastName = user?.user_metadata?.last_name || user?.last || "";
    return [name, lastName].filter(Boolean).join(" ").trim() || user?.email || "Usuario";
  }

  function getAvatarLabel(text) {
    const parts = String(text || "U")
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2);
    return parts.map((part) => part[0]).join("").toUpperCase() || "U";
  }

  function buildHeaders(authenticated, extra) {
    const headers = {
      apikey: supabaseKey,
      "Content-Type": "application/json",
      ...extra
    };
    if (authenticated && session?.access_token) {
      headers.Authorization = `Bearer ${session.access_token}`;
    } else {
      headers.Authorization = `Bearer ${supabaseKey}`;
    }
    return headers;
  }

  async function apiFetch(path, options) {
    const response = await fetch(`${supabaseUrl}${path}`, options);
    const text = await response.text();
    let payload = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = text;
    }
    if (!response.ok) {
      const message =
        payload?.msg_description ||
        payload?.error_description ||
        payload?.message ||
        payload?.error ||
        `Request failed: ${response.status}`;
      throw new Error(message);
    }
    return payload;
  }

  async function authSignInWithPassword(email, password) {
    const data = await apiFetch("/auth/v1/token?grant_type=password", {
      method: "POST",
      headers: buildHeaders(false),
      body: JSON.stringify({ email, password })
    });
    saveSession(data);
    return data;
  }

  async function authSignUp(email, password, userData) {
    const data = await apiFetch("/auth/v1/signup", {
      method: "POST",
      headers: buildHeaders(false),
      body: JSON.stringify({
        email,
        password,
        data: userData,
        email_redirect_to: appUrl
      })
    });
    if (data?.access_token) saveSession(data);
    return data;
  }

  async function authRecover(email) {
    return apiFetch("/auth/v1/recover", {
      method: "POST",
      headers: buildHeaders(false),
      body: JSON.stringify({ email, redirect_to: appUrl })
    });
  }

  async function authGetUser() {
    if (!session?.access_token) return null;
    return apiFetch("/auth/v1/user", {
      method: "GET",
      headers: buildHeaders(true)
    });
  }

  async function authSignOut() {
    try {
      if (session?.access_token) {
        await apiFetch("/auth/v1/logout", {
          method: "POST",
          headers: buildHeaders(true)
        });
      }
    } catch {}
    saveSession(null);
  }

  async function restSelect(table, params, authenticated) {
    const queryString = new URLSearchParams(params).toString();
    return apiFetch(`/rest/v1/${table}?${queryString}`, {
      method: "GET",
      headers: buildHeaders(authenticated)
    });
  }

  async function restInsert(table, payload, authenticated) {
    return apiFetch(`/rest/v1/${table}`, {
      method: "POST",
      headers: buildHeaders(authenticated, {
        Prefer: "return=representation"
      }),
      body: JSON.stringify(payload)
    });
  }

  async function restUpdate(table, filters, payload, authenticated) {
    const queryString = new URLSearchParams(filters).toString();
    return apiFetch(`/rest/v1/${table}?${queryString}`, {
      method: "PATCH",
      headers: buildHeaders(authenticated, {
        Prefer: "return=representation"
      }),
      body: JSON.stringify(payload)
    });
  }

  async function restDelete(table, filters, authenticated) {
    const queryString = new URLSearchParams(filters).toString();
    return apiFetch(`/rest/v1/${table}?${queryString}`, {
      method: "DELETE",
      headers: buildHeaders(authenticated, {
        Prefer: "return=representation"
      })
    });
  }

  function setShareLink(slug) {
    const shareLink = document.getElementById("shareLink");
    if (!shareLink) return;
    shareLink.textContent = `${appUrl.replace(/\/$/, "")}/?profile=${slug}`;
  }

  function mapReviewRow(row) {
    return {
      id: row.id,
      rating: row.rating,
      service: row.service_type,
      msg: row.message,
      name: row.reviewer_name,
      emoji: row.emoji || "✨",
      amount: row.amount || 0,
      date: formatDate(row.created_at),
      reply: row.reply_text
        ? {
            text: row.reply_text,
            owner: row.reply_owner || document.getElementById("pName")?.textContent?.trim() || "Recompensapp",
            date: formatDate(row.reply_date || row.updated_at)
          }
        : null
    };
  }

  function syncProfileToUi(profile) {
    remoteProfile = profile;
    activeProfileId = profile.id;

    const fullName = [profile.display_name, profile.last_name].filter(Boolean).join(" ").trim();
    const profileName = fullName || "Perfil";
    const pName = document.getElementById("pName");
    const pDesc = document.getElementById("pDesc");
    const payLink = document.getElementById("payLink");

    if (pName) pName.textContent = profileName;
    if (pDesc) pDesc.textContent = profile.description || "";
    if (payLink) payLink.value = profile.pay_link || "";

    mpCfg = {
      pk: profile.mp_public_key || cfg.NEXT_PUBLIC_MP_PUBLIC_KEY || "",
      at: profile.mp_access_token || "",
      mode: profile.mp_mode || "sandbox"
    };
    amtCfg = {
      min: profile.amt_min || 100,
      sugg: parseSuggestions(profile.amt_suggestions)
    };
    prefs = {
      showAmt: profile.pref_show_amounts !== false,
      demo: profile.pref_demo_mode !== false
    };

    const pkInput = document.getElementById("mp-pk");
    const atInput = document.getElementById("mp-at");
    const modeInput = document.getElementById("mp-mode");
    const minInput = document.getElementById("cfg-min");
    const suggInput = document.getElementById("cfg-sugg");
    const tAmt = document.getElementById("t-amt");
    const tDemo = document.getElementById("t-demo");

    if (pkInput) pkInput.value = mpCfg.pk;
    if (atInput) atInput.value = mpCfg.at;
    if (modeInput) modeInput.value = mpCfg.mode;
    if (minInput) minInput.value = String(amtCfg.min);
    if (suggInput) suggInput.value = amtCfg.sugg.join(", ");
    if (tAmt) tAmt.checked = prefs.showAmt;
    if (tDemo) tDemo.checked = prefs.demo;

    if (typeof refreshMPSt === "function") refreshMPSt();
    setShareLink(profile.slug || slugify(profileName));
  }

  function refreshUi() {
    if (typeof updateStats === "function") updateStats();
    if (typeof updateLandingStats === "function") updateLandingStats();
    const badge = document.getElementById("feedBadge");
    if (badge) badge.textContent = String(reviews.length);
    const activeView = document.querySelector(".view.on");
    if (activeView?.id === "v-feed" && typeof renderFeed === "function") renderFeed();
    if (activeView?.id === "v-history" && typeof renderHist === "function") renderHist();
    if (activeView?.id === "v-public" && typeof renderPublic === "function") renderPublic();
  }

  async function loadReviews(profileId) {
    const data = await restSelect(
      "reviews",
      {
        select: "*",
        profile_id: `eq.${profileId}`,
        order: "created_at.desc"
      },
      !!session?.access_token
    );
    reviews = (data || []).map(mapReviewRow);
    refreshUi();
  }

  async function loadOwnerState(user) {
    isHydrating = true;
    publicMode = false;
    try {
      const rows = await restSelect(
        "profiles",
        {
          select: "*",
          id: `eq.${user.id}`
        },
        true
      );
      const profile = rows?.[0];
      if (!profile) throw new Error("No se encontró el perfil del usuario.");
      syncProfileToUi(profile);
      await loadReviews(profile.id);
    } catch (error) {
      console.error(error);
      safeToast("No se pudieron cargar los datos del perfil en Supabase", "⚠️");
    } finally {
      isHydrating = false;
    }
  }

  async function fetchPublicProfile(slug) {
    if (slug) {
      const rows = await restSelect(
        "profiles",
        {
          select: "*",
          slug: `eq.${slug}`
        },
        false
      );
      if (rows?.[0]) return rows[0];
    }
    const rows = await restSelect(
      "profiles",
      {
        select: "*",
        slug: "not.is.null",
        limit: "1"
      },
      false
    );
    return rows?.[0] || null;
  }

  async function loadPublicState(slug) {
    try {
      const profile = await fetchPublicProfile(slug);
      if (!profile) return false;
      publicMode = true;
      syncProfileToUi(profile);
      await loadReviews(profile.id);
      if (slug) {
        const authWrap = document.getElementById("authWrap");
        if (authWrap) authWrap.classList.add("gone");
        if (typeof go === "function") go("public");
      }
      return true;
    } catch (error) {
      console.error(error);
      safeToast("No se pudo leer el perfil público desde Supabase", "⚠️");
      return false;
    }
  }

  function buildProfilePayload() {
    const fullName =
      document.getElementById("pName")?.textContent?.trim() ||
      getFullName({ email: currentUser?.email, user_metadata: currentUser || {} });
    const nameParts = fullName.split(/\s+/).filter(Boolean);
    const displayName = nameParts.shift() || fullName;
    const lastName = nameParts.join(" ");
    return {
      id: currentUser.id,
      display_name: displayName,
      last_name: lastName,
      description: document.getElementById("pDesc")?.textContent?.trim() || "",
      pay_link: document.getElementById("payLink")?.value?.trim() || "",
      slug: slugify(fullName),
      mp_public_key: document.getElementById("mp-pk")?.value?.trim() || "",
      mp_access_token: document.getElementById("mp-at")?.value?.trim() || "",
      mp_mode: document.getElementById("mp-mode")?.value || "sandbox",
      amt_min: Number(document.getElementById("cfg-min")?.value || 100),
      amt_suggestions: document.getElementById("cfg-sugg")?.value?.trim() || "100,500,1000,2000,5000",
      pref_show_amounts: document.getElementById("t-amt")?.checked !== false,
      pref_demo_mode: document.getElementById("t-demo")?.checked !== false
    };
  }

  async function persistProfile() {
    if (!currentUser || isHydrating) return;
    try {
      const rows = await restUpdate(
        "profiles",
        { id: `eq.${currentUser.id}` },
        buildProfilePayload(),
        true
      );
      if (rows?.[0]) syncProfileToUi(rows[0]);
    } catch (error) {
      console.error(error);
      safeToast("No se pudieron guardar los cambios del perfil", "⚠️");
    }
  }

  function scheduleProfileSave() {
    if (!currentUser) return;
    clearTimeout(profileSaveTimer);
    profileSaveTimer = setTimeout(() => {
      persistProfile();
    }, 500);
  }

  async function checkConnection() {
    try {
      await restSelect("service_types", { select: "id", limit: "1" }, false);
      return true;
    } catch (error) {
      console.error(error);
      safeToast("Supabase no respondió. Revisá el schema o las políticas RLS.", "⚠️");
      return false;
    }
  }

  window.saveAll = function saveAllOverride() {
    originalSaveAll();
    scheduleProfileSave();
  };

  window.loadAll = function loadAllOverride() {
    originalLoadAll();
  };

  window.applyUser = async function applyUserOverride(save, userLike) {
    const resolvedUser = userLike || (await authGetUser());
    if (!resolvedUser) return;
    currentUser = {
      id: resolvedUser.id,
      email: resolvedUser.email,
      name: resolvedUser.user_metadata?.name || resolvedUser.email?.split("@")[0] || "Usuario",
      last: resolvedUser.user_metadata?.last_name || "",
      av: getAvatarLabel(getFullName(resolvedUser))
    };
    publicMode = false;
    document.getElementById("authWrap")?.classList.add("gone");
    const pill = document.getElementById("uPill");
    if (pill) pill.style.display = "flex";
    const uAv = document.getElementById("uAv");
    const uNm = document.getElementById("uNm");
    const sessInfo = document.getElementById("sessinfo");
    if (uAv) uAv.textContent = currentUser.av;
    if (uNm) uNm.textContent = currentUser.name;
    if (sessInfo) sessInfo.textContent = `${getFullName(resolvedUser)} · ${resolvedUser.email}`;
    await loadOwnerState(resolvedUser);
    if (save) safeToast(`Bienvenido/a, ${currentUser.name}`, "✦");
  };

  window.doLogin = async function doLoginOverride() {
    const email = document.getElementById("le1")?.value?.trim().toLowerCase();
    const password = document.getElementById("lp1")?.value || "";
    if (!email || !password) {
      setAE("le", "lem", "Completá todos los campos.");
      return;
    }
    try {
      const data = await authSignInWithPassword(email, password);
      await window.applyUser(true, data.user);
    } catch (error) {
      setAE("le", "lem", error.message || "No se pudo iniciar sesión.");
    }
  };

  window.doReg = async function doRegOverride() {
    const name = document.getElementById("rn")?.value?.trim();
    const lastName = document.getElementById("rl")?.value?.trim();
    const email = document.getElementById("re1")?.value?.trim().toLowerCase();
    const password = document.getElementById("rp1")?.value || "";
    const repeat = document.getElementById("rp2")?.value || "";
    if (!name || !email || !password) {
      setAE("re", "rem", "Completá los campos obligatorios.");
      return;
    }
    if (password.length < 6) {
      setAE("re", "rem", "Mínimo 6 caracteres.");
      return;
    }
    if (password !== repeat) {
      setAE("re", "rem", "Las contraseñas no coinciden.");
      return;
    }
    try {
      const data = await authSignUp(email, password, { name, last_name: lastName || "" });
      document.getElementById("re")?.classList.remove("on");
      document.getElementById("rok")?.classList.add("on");
      if (data?.user && data?.access_token) {
        await window.applyUser(true, data.user);
      } else {
        safeToast("Cuenta creada. Revisá tu email para confirmarla.", "✉️");
      }
    } catch (error) {
      const msg = String(error.message || "");
      if (msg.toLowerCase().includes("rate limit")) {
        setAE("re", "rem", "Esperá unos minutos antes de pedir otro email.");
      } else {
        setAE("re", "rem", msg || "No se pudo crear la cuenta.");
      }
    }
  };

  window.doForgot = async function doForgotOverride() {
    const email = document.getElementById("fe")?.value?.trim();
    if (!email) return;
    try {
      await authRecover(email);
      const ok = document.getElementById("fo-ok");
      if (ok) ok.style.display = "flex";
      setTimeout(() => {
        if (ok) ok.style.display = "none";
        aTab("login");
      }, 3000);
    } catch (error) {
      safeToast(error.message || "No se pudo enviar el email de recuperación", "⚠️");
    }
  };

  window.socialA = function socialAOverride(provider) {
    safeToast(`El acceso con ${provider} requiere activar ese provider en Supabase Auth.`, "ℹ️");
  };

  window.doLogout = async function doLogoutOverride() {
    if (!confirm("¿Cerrar sesión?")) return;
    await authSignOut();
    currentUser = null;
    remoteProfile = null;
    reviews = [];
    activeProfileId = null;
    publicMode = false;
    document.getElementById("authWrap")?.classList.remove("gone");
    const pill = document.getElementById("uPill");
    if (pill) pill.style.display = "none";
    aTab("login");
    refreshUi();
    safeToast("Sesión cerrada", "👋");
  };

  window.saveReview = async function saveReviewOverride(amount) {
    const profileId = activeProfileId || currentUser?.id;
    if (!profileId || !pendingRv) {
      safeToast("No hay un perfil activo para guardar la reseña.", "⚠️");
      return;
    }
    try {
      const rows = await restInsert(
        "reviews",
        {
          profile_id: profileId,
          reviewer_name: pendingRv.name,
          rating: pendingRv.rating,
          service_type: pendingRv.service,
          message: pendingRv.msg,
          emoji: pendingRv.emoji,
          amount: amount || 0,
          payment_status: amount > 0 ? "approved" : "pending",
          is_visible: true
        },
        !!session?.access_token
      );
      const review = mapReviewRow(rows?.[0]);
      reviews.unshift(review);
      refreshUi();
      const who = review.name || "Alguien anónimo";
      const messagePart = review.msg ? ` con el mensaje "${review.msg.slice(0, 45)}${review.msg.length > 45 ? "…" : ""}"` : "";
      const amountPart = amount > 0 ? ` y envió $${Number(amount).toLocaleString("es-AR")} de recompensa` : "";
      const box = document.getElementById("sboxtxt");
      if (box) box.textContent = `${who} publicó su reseña sobre "${review.service}"${messagePart}${amountPart}. ¡Gracias!`;
    } catch (error) {
      console.error(error);
      safeToast("No se pudo guardar la reseña en Supabase", "⚠️");
    }
  };

  window.submitReply = async function submitReplyOverride(reviewId) {
    if (!currentUser || currentUser.id !== activeProfileId) {
      safeToast("Solo el dueño del perfil puede responder reseñas.", "⚠️");
      return;
    }
    let textArea = null;
    for (const formId of [`rfp-${reviewId}`, `rff-${reviewId}`]) {
      const form = document.getElementById(formId);
      if (form && form.classList.contains("open")) {
        textArea = form.querySelector("textarea");
        break;
      }
    }
    if (!textArea) {
      safeToast("Escribí tu respuesta primero", "⚠️");
      return;
    }
    const text = textArea.value.trim();
    if (!text) {
      safeToast("Escribí tu respuesta primero", "⚠️");
      return;
    }
    try {
      const rows = await restUpdate(
        "reviews",
        { id: `eq.${reviewId}` },
        {
          reply_text: text,
          reply_owner: document.getElementById("pName")?.textContent?.trim() || "El prestador",
          reply_date: new Date().toISOString()
        },
        true
      );
      const nextReview = mapReviewRow(rows?.[0]);
      reviews = reviews.map((review) => (review.id === reviewId ? nextReview : review));
      refreshUi();
      safeToast("Respuesta publicada", "💬");
    } catch (error) {
      console.error(error);
      safeToast("No se pudo guardar la respuesta", "⚠️");
    }
  };

  window.clearAll = async function clearAllOverride() {
    if (!currentUser?.id || currentUser.id !== activeProfileId) {
      safeToast("Solo el dueño del perfil puede borrar reseñas.", "⚠️");
      return;
    }
    if (!confirm("¿Borrar todas las reseñas?")) return;
    try {
      await restDelete("reviews", { profile_id: `eq.${currentUser.id}` }, true);
      reviews = [];
      refreshUi();
      safeToast("Reseñas eliminadas", "🗑");
    } catch (error) {
      console.error(error);
      safeToast("No se pudieron borrar las reseñas", "⚠️");
    }
  };

  window.copyRL = function copyRLOvverride() {
    navigator.clipboard.writeText(document.getElementById("shareLink")?.textContent || "").catch(() => {});
    safeToast("Link copiado", "🔗");
  };

  async function bootstrap() {
    const connected = await checkConnection();
    if (!connected) return;
    const mpInput = document.getElementById("mp-pk");
    if (mpInput && !mpInput.value && cfg.NEXT_PUBLIC_MP_PUBLIC_KEY) {
      mpInput.value = cfg.NEXT_PUBLIC_MP_PUBLIC_KEY;
    }
    const slug = query.get("profile");
    const user = await authGetUser();
    if (user) await window.applyUser(false, user);
    else await loadPublicState(slug);
  }

  bootstrap();
})();
