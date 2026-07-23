/* ZZSocial — Phase 1
 * Mobile-first chat helper. You paste what THEY said; the AI ghostwrites YOUR reply.
 * The AI writes only your side. Data lives in localStorage. Backend: OpenRouter.
 */

(function () {
  "use strict";

  // ---- Config (kept in localStorage; all DATA lives on the server) ----
  const LS_API = "zz.apiBase"; // e.g. http://YOUR-EC2-IP:3001
  const LS_TOKEN = "zz.appToken"; // X-App-Token secret

  // Typing styles for the user's drafted messages.
  // key -> { label, desc (shown in settings), prompt (appended to system) }
  const STYLES = {
    natural: {
      label: "Natural",
      desc: "Balanced, normal texting.",
      prompt: "Write in a natural, balanced texting style.",
    },
    casual: {
      label: "Casual",
      desc: "Some punctuation, some abbreviations (lol, tbh, u).",
      prompt:
        "Write casually with a relaxed tone: use some common abbreviations " +
        "(lol, tbh, u, rn, imo, ya) and light, informal punctuation. Readable " +
        "but not formal.",
    },
    gamer: {
      label: "Gamer",
      desc: "all lowercase, no punctuation, heavy abbreviations (ofc, ngl, gg).",
      prompt:
        "Write in gamer/chat style: all lowercase, little to no punctuation, " +
        "and lots of abbreviations and slang (ofc, ngl, gg, brb, wyd, fr, lmao, " +
        "idk, tbh, u, ur). Keep it short and snappy.",
    },
    proper: {
      label: "Proper",
      desc: "Full sentences, correct grammar, no abbreviations.",
      prompt:
        "Write with proper grammar, full punctuation, and complete sentences. " +
        "Avoid abbreviations and slang.",
    },
    flirty: {
      label: "Flirty",
      desc: "Playful and teasing, warm.",
      prompt:
        "Write in a playful, flirty, lightly teasing tone while staying " +
        "respectful. Keep it warm and fun.",
    },
    minimal: {
      label: "Minimal",
      desc: "Very short, few words, low-key.",
      prompt:
        "Write very short, minimal replies — just a few words, low-key and dry.",
    },
  };
  const DEFAULT_STYLE = "natural";

  const DEFAULT_MODEL = "openai/gpt-oss-20b:free";

  // MBTI code -> [nickname, one-line description]
  const MBTI_INFO = {
    INTJ: ["Architect", "Strategic, independent, analytical planners."],
    INTP: ["Logician", "Curious, inventive, logical thinkers."],
    ENTJ: ["Commander", "Bold, decisive, natural leaders."],
    ENTP: ["Debater", "Quick-witted, curious, love a good debate."],
    INFJ: ["Advocate", "Insightful, idealistic, quietly principled."],
    INFP: ["Mediator", "Empathetic, imaginative, guided by values."],
    ENFJ: ["Protagonist", "Warm, charismatic, inspiring."],
    ENFP: ["Campaigner", "Enthusiastic, creative, sociable free spirits."],
    ISTJ: ["Logistician", "Practical, dependable, detail-oriented."],
    ISFJ: ["Defender", "Caring, loyal, quietly supportive."],
    ESTJ: ["Executive", "Organized, direct, take-charge."],
    ESFJ: ["Consul", "Sociable, caring, eager to help."],
    ISTP: ["Virtuoso", "Practical, hands-on, spontaneous."],
    ISFP: ["Adventurer", "Gentle, artistic, lives in the moment."],
    ESTP: ["Entrepreneur", "Energetic, bold, thrives on action."],
    ESFP: ["Entertainer", "Playful, spontaneous, loves the spotlight."],
  };
  const MBTI = Object.keys(MBTI_INFO);

  // Shared field schema for both profiles.
  const PROFILE_FIELDS = [
    { key: "name", label: "Name", type: "text", placeholder: "Optional" },
    { key: "age", label: "Age", type: "number", placeholder: "e.g. 29" },
    { key: "sex", label: "Sex", type: "select",
      options: ["", "Female", "Male", "Non-binary", "Other"] },
    { key: "ethnicity", label: "Ethnicity", type: "select",
      options: ["", "White", "Black / African", "Hispanic / Latino",
        "East Asian", "South Asian", "Southeast Asian",
        "Middle Eastern / North African", "Native American / Indigenous",
        "Pacific Islander", "Mixed / Multiracial", "Other"] },
    { key: "country", label: "Country", type: "text", placeholder: "Optional" },
    { key: "mbti", label: "Personality (MBTI)", type: "select",
      options: ["", ...MBTI] },
    { key: "personalityNotes", label: "Personality notes", type: "textarea",
      placeholder: "e.g. sarcastic, loves climbing, hates small talk" },
    { key: "mood", label: "Mood", type: "text", placeholder: "e.g. playful, guarded" },
    { key: "goal", label: "Goal / relationship context", type: "textarea",
      placeholder: "Your goal / relationship with this person" },
  ];

  const FIELD_LABELS = PROFILE_FIELDS.reduce((acc, f) => {
    acc[f.key] = f.label;
    return acc;
  }, {});

  function emptyProfile() {
    return PROFILE_FIELDS.reduce((acc, f) => {
      acc[f.key] = "";
      return acc;
    }, {});
  }

  // ---- State ----
  let apiBase = load(LS_API, ""); // server URL
  let appToken = load(LS_TOKEN, ""); // server secret
  let model = DEFAULT_MODEL;
  let ownProfile = emptyProfile(); // shared "You"
  let emojis = false;
  let style = DEFAULT_STYLE;
  let busy = false;

  // Persons — each: { id, name, profile, messages, summary }. Hydrated from server.
  let persons = [];
  let activeId = null;

  // messages / friendProfile / summary always mirror the active person.
  let messages = []; // [{ id, role: "them"|"me", text, ts }]
  let friendProfile = emptyProfile();
  let summary = "";

  // Compaction thresholds: once a chat reaches COMPACT_WHEN messages, fold all
  // but the last KEEP_RECENT into the running summary.
  const COMPACT_WHEN = 24;
  const KEEP_RECENT = 12;
  let compacting = false;

  // Draft copies edited inside the Profiles modal until "Save".
  let draftProfiles = { own: emptyProfile(), friend: emptyProfile() };
  let activeTab = "own";
  // Field keys just updated by inference, per tab, for visual highlight.
  let inferredKeys = { own: new Set(), friend: new Set() };

  // ---- Elements ----
  const el = {
    chat: document.getElementById("chat"),
    emptyState: document.getElementById("empty-state"),
    btnStart: document.getElementById("btn-start"),
    theirInput: document.getElementById("their-input"),
    btnSend: document.getElementById("btn-send"),
    btnStyle: document.getElementById("btn-style"),
    styleMenu: document.getElementById("style-menu"),
    cmpStyle: document.getElementById("cmp-style"),
    cmpStyleDesc: document.getElementById("cmp-style-desc"),
    cmpEmojis: document.getElementById("cmp-emojis"),
    btnSettings: document.getElementById("btn-settings"),
    settingsModal: document.getElementById("settings-modal"),
    btnCloseSettings: document.getElementById("btn-close-settings"),
    btnSaveSettings: document.getElementById("btn-save-settings"),
    btnClearChat: document.getElementById("btn-clear-chat"),
    setApi: document.getElementById("set-api"),
    setToken: document.getElementById("set-token"),
    setModel: document.getElementById("set-model"),
    btnSummary: document.getElementById("btn-summary"),
    summaryModal: document.getElementById("summary-modal"),
    btnCloseSummary: document.getElementById("btn-close-summary"),
    rangeRow: document.getElementById("range-row"),
    rangeBtns: document.querySelectorAll(".range-btn"),
    summaryResult: document.getElementById("summary-result"),
    btnCopySummary: document.getElementById("btn-copy-summary"),
    toast: document.getElementById("toast"),
    btnProfiles: document.getElementById("btn-profiles"),
    profilesModal: document.getElementById("profiles-modal"),
    btnCloseProfiles: document.getElementById("btn-close-profiles"),
    btnSaveProfiles: document.getElementById("btn-save-profiles"),
    btnClearProfile: document.getElementById("btn-clear-profile"),
    profileForm: document.getElementById("profile-form"),
    profileHint: document.getElementById("profile-hint"),
    tabs: document.querySelectorAll(".tab"),
    btnPeople: document.getElementById("btn-people"),
    activeName: document.getElementById("active-name"),
    peopleModal: document.getElementById("people-modal"),
    btnClosePeople: document.getElementById("btn-close-people"),
    peopleList: document.getElementById("people-list"),
    btnAddPerson: document.getElementById("btn-add-person"),
  };

  // ---- Utilities ----
  function load(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch (_) {
      return fallback;
    }
  }
  function save(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (_) {}
  }
  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }
  let toastTimer = null;
  function toast(msg) {
    el.toast.textContent = msg;
    el.toast.classList.remove("hidden");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.toast.classList.add("hidden"), 1800);
  }
  function scrollToBottom() {
    el.chat.scrollTop = el.chat.scrollHeight;
  }
  function formatTime(ts) {
    const d = new Date(ts);
    const now = new Date();
    const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    if (d.toDateString() === now.toDateString()) return time; // today: time only
    const date = d.toLocaleDateString([], { month: "short", day: "numeric" });
    return date + " " + time;
  }

  // ---- API layer (all data lives on the server) ----
  function apiConfigured() {
    return !!apiBase;
  }
  async function apiFetch(path, opts) {
    if (!apiBase) throw new Error("No server configured");
    const o = opts || {};
    const headers = Object.assign({ "X-App-Token": appToken }, o.headers || {});
    if (o.body) headers["Content-Type"] = "application/json";
    let res;
    try {
      res = await fetch(apiBase.replace(/\/$/, "") + path, {
        method: o.method || "GET",
        headers,
        body: o.body ? JSON.stringify(o.body) : undefined,
      });
    } catch (_) {
      throw new Error("Cannot reach server");
    }
    if (res.status === 401) throw new Error("Unauthorized (check token)");
    if (!res.ok) {
      let d = "";
      try {
        const j = await res.json();
        const e = j && j.error;
        d = typeof e === "string" ? e : (e && e.message) || "";
      } catch (_) {}
      throw new Error("Server " + res.status + (d ? ": " + d : ""));
    }
    return res.status === 204 ? null : res.json();
  }

  function personPayload(p) {
    const idx = persons.indexOf(p);
    return {
      name: p.name,
      profile: p.profile,
      messages: p.messages,
      summary: p.summary || "",
      position: idx < 0 ? 0 : idx,
    };
  }
  async function savePerson(p) {
    try {
      await apiFetch("/api/persons/" + encodeURIComponent(p.id), {
        method: "PUT",
        body: personPayload(p),
      });
    } catch (e) {
      toast("Save failed: " + e.message);
    }
  }
  async function saveSettingsState() {
    try {
      await apiFetch("/api/settings", {
        method: "PUT",
        body: { ownProfile, style, emojis, model, activeId },
      });
    } catch (e) {
      toast("Save failed: " + e.message);
    }
  }
  async function deletePersonApi(id) {
    try {
      await apiFetch("/api/persons/" + encodeURIComponent(id), {
        method: "DELETE",
      });
    } catch (e) {
      toast("Delete failed: " + e.message);
    }
  }

  // ---- Persons ----
  function getActive() {
    return persons.find((p) => p.id === activeId) || persons[0];
  }
  function persistMessages() {
    getActive().messages = messages;
    savePerson(getActive());
  }
  function persistFriend() {
    getActive().profile = friendProfile;
    savePerson(getActive());
  }
  function loadActiveIntoState() {
    const p = getActive();
    activeId = p.id;
    messages = p.messages;
    friendProfile = p.profile;
    summary = p.summary || "";
  }
  function updateActiveName() {
    el.activeName.textContent = getActive() ? getActive().name : "Person";
  }

  function newPerson(name) {
    return {
      id: uid(),
      name: name || "Person 1",
      profile: Object.assign(emptyProfile(), name ? { name } : {}),
      messages: [],
      summary: "",
    };
  }

  function openPeople() {
    renderPeopleList();
    el.peopleModal.classList.remove("hidden");
  }
  function closePeople() {
    el.peopleModal.classList.add("hidden");
  }
  function switchPerson(id) {
    if (id !== activeId) {
      activeId = id;
      loadActiveIntoState();
      saveSettingsState();
      updateActiveName();
      render();
    }
    closePeople();
  }
  function addPerson() {
    const name = (prompt("Name this person:", "") || "").trim();
    if (!name) return;
    const p = newPerson(name);
    persons.push(p);
    activeId = p.id;
    loadActiveIntoState();
    savePerson(p);
    saveSettingsState();
    updateActiveName();
    render();
    renderPeopleList();
    toast("Added " + name);
  }
  function renamePerson(id) {
    const p = persons.find((x) => x.id === id);
    if (!p) return;
    const name = (prompt("Rename person:", p.name) || "").trim();
    if (!name) return;
    p.name = name;
    savePerson(p);
    updateActiveName();
    renderPeopleList();
  }
  function deletePerson(id) {
    const p = persons.find((x) => x.id === id);
    if (!p) return;
    if (!confirm('Delete "' + p.name + '" and their conversation?')) return;
    persons = persons.filter((x) => x.id !== id);
    deletePersonApi(id);
    if (!persons.length) {
      const def = newPerson("Person 1");
      persons.push(def);
      savePerson(def);
    }
    if (id === activeId) {
      activeId = persons[0].id;
      loadActiveIntoState();
      saveSettingsState();
      updateActiveName();
      render();
    }
    renderPeopleList();
  }
  function rowAction(label, title, fn) {
    const b = document.createElement("button");
    b.className = "row-action";
    b.textContent = label;
    b.title = title;
    b.addEventListener("click", fn);
    return b;
  }
  function renderPeopleList() {
    el.peopleList.innerHTML = "";
    persons.forEach((p) => {
      const row = document.createElement("div");
      row.className = "person-row" + (p.id === activeId ? " active" : "");

      const nameBtn = document.createElement("button");
      nameBtn.className = "person-name-btn";
      nameBtn.textContent = p.name;
      nameBtn.addEventListener("click", () => switchPerson(p.id));
      row.appendChild(nameBtn);

      const count = document.createElement("span");
      count.className = "msg-count";
      count.textContent = (p.messages ? p.messages.length : 0) + " msgs";
      row.appendChild(count);

      row.appendChild(rowAction("✎", "Rename", () => renamePerson(p.id)));
      row.appendChild(rowAction("🗑", "Delete", () => deletePerson(p.id)));
      el.peopleList.appendChild(row);
    });
  }

  // ---- Rendering ----
  function render() {
    // Remove all rendered messages + banner (keep empty-state node)
    [...el.chat.querySelectorAll(".msg, .loading-row, .compact-banner")].forEach(
      (n) => n.remove()
    );

    // Banner for compacted older history.
    if (summary && summary.trim()) {
      el.chat.appendChild(renderCompactBanner());
    }

    if (messages.length === 0) {
      el.emptyState.style.display = "";
    } else {
      el.emptyState.style.display = "none";
      messages.forEach((m) => el.chat.appendChild(renderMessage(m)));
    }
    scrollToBottom();
  }

  function renderCompactBanner() {
    const wrap = document.createElement("div");
    wrap.className = "compact-banner";

    const head = document.createElement("button");
    head.className = "compact-head";
    head.textContent = "☰ Earlier messages summarized — tap to view";

    const body = document.createElement("div");
    body.className = "compact-body hidden";
    body.textContent = summary;

    head.addEventListener("click", () => body.classList.toggle("hidden"));
    wrap.appendChild(head);
    wrap.appendChild(body);
    return wrap;
  }

  function renderMessage(m) {
    const row = document.createElement("div");
    row.className = "msg " + (m.role === "me" ? "me" : "them");
    row.dataset.id = m.id;

    // Header above the bubble: sender name + time sent.
    const header = document.createElement("div");
    header.className = "msg-header";
    const nm = m.role === "me" ? ownProfile.name || "You" : getActive().name;
    const time = m.ts ? formatTime(m.ts) : "";
    header.textContent = time ? nm + " · " + time : nm;
    row.appendChild(header);

    const bubble = document.createElement("div");
    bubble.className = "bubble";
    bubble.textContent = m.text;
    row.appendChild(bubble);

    const meta = document.createElement("div");
    meta.className = "msg-meta";

    if (m.role === "me") {
      meta.appendChild(actionBtn("Copy", () => copyText(m.text)));
      meta.appendChild(actionBtn("Regenerate", () => regenerate(m.id)));
    }
    meta.appendChild(actionBtn("Delete", () => deleteMessage(m.id)));
    row.appendChild(meta);

    return row;
  }

  function actionBtn(label, onClick) {
    const b = document.createElement("button");
    b.className = "msg-action";
    b.textContent = label;
    b.addEventListener("click", onClick);
    return b;
  }

  function showLoading() {
    hideLoading();
    const row = document.createElement("div");
    row.className = "msg me loading-row";
    const bubble = document.createElement("div");
    bubble.className = "bubble loading";
    bubble.innerHTML = 'Drafting your reply<span class="dots"></span>';
    row.appendChild(bubble);
    el.chat.appendChild(row);
    scrollToBottom();
  }
  function hideLoading() {
    const n = el.chat.querySelector(".loading-row");
    if (n) n.remove();
  }

  // ---- Actions ----
  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        () => toast("Copied"),
        () => fallbackCopy(text)
      );
    } else {
      fallbackCopy(text);
    }
  }
  function fallbackCopy(text) {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
      toast("Copied");
    } catch (_) {
      toast("Copy failed");
    }
    document.body.removeChild(ta);
  }

  function addMessage(role, text) {
    const m = { id: uid(), role, text, ts: Date.now() };
    messages.push(m);
    persistMessages();
    render();
    return m;
  }

  function deleteMessage(id) {
    messages = messages.filter((m) => m.id !== id);
    persistMessages();
    render();
  }

  // Add their message and draft my reply.
  async function sendTheirMessage() {
    const text = el.theirInput.value.trim();
    if (!text || busy) return;
    addMessage("them", text);
    el.theirInput.value = "";
    autoGrow();
    autoEvaluateFriend(); // background: learn about them from this message
    await draftReply();
  }

  // Draft an opener (first message, no history).
  async function startChat() {
    if (busy) return;
    await draftReply();
  }

  // Regenerate: drop the given "me" message and everything after it, then re-draft.
  async function regenerate(id) {
    if (busy) return;
    const idx = messages.findIndex((m) => m.id === id);
    if (idx === -1) return;
    messages = messages.slice(0, idx);
    persistMessages();
    render();
    await draftReply();
  }

  // Core: call OpenRouter to draft MY next message from current history.
  async function draftReply() {
    if (!apiConfigured()) {
      toast("Set your server URL in settings");
      openSettings();
      return;
    }
    busy = true;
    setBusy(true);
    showLoading();

    try {
      const reply = await callOpenRouter(buildPayload());
      hideLoading();
      if (reply) addMessage("me", reply);
      else toast("Empty response");
    } catch (err) {
      hideLoading();
      toast(err.message || "Request failed");
    } finally {
      busy = false;
      setBusy(false);
    }
    compactIfNeeded(); // background: fold old messages once the chat gets long
  }

  function profileBlock(profile, heading, excludeKeys) {
    const skip = excludeKeys || [];
    const parts = [];
    PROFILE_FIELDS.forEach((f) => {
      if (skip.indexOf(f.key) !== -1) return;
      const v = (profile[f.key] || "").toString().trim();
      if (v) parts.push("- " + FIELD_LABELS[f.key] + ": " + v);
    });
    if (!parts.length) return "";
    return heading + "\n" + parts.join("\n");
  }

  function buildPayload() {
    let system =
      "You are helping the user chat with a person they have a romantic or " +
      "friendship interest in. You write ONLY the user's next message to that " +
      "person. Do NOT write as the other person, and do NOT add commentary, " +
      "labels, quotes, or explanations — output only the message text the user " +
      "will send. Keep it natural, warm, and in a casual texting style that fits " +
      "the flow of the conversation. If there is no prior message, write a good " +
      "opener. Do NOT produce sexually explicit content unless the user " +
      "explicitly asks for it. " +
      (STYLES[style] || STYLES[DEFAULT_STYLE]).prompt +
      " " +
      (emojis
        ? "You may use emojis naturally where they fit."
        : "Do NOT use any emojis.");

    const own = profileBlock(ownProfile, "The user you are writing as (YOU):", [
      "goal",
    ]);
    const friend = profileBlock(
      friendProfile,
      "The person they are messaging (THEM):"
    );
    if (own || friend) {
      system +=
        "\n\nUse these profiles to match tone, interests, and framing. " +
        "Write messages that fit the user's persona and land well with the other person.";
      if (own) system += "\n\n" + own;
      if (friend) system += "\n\n" + friend;
    }

    // Compacted older history (kept so long conversations still "remember").
    if (summary && summary.trim()) {
      system +=
        "\n\nSummary of earlier conversation (older messages, compacted):\n" +
        summary.trim();
    }

    // Map roles for the LLM: the person we're chatting with = "user",
    // the user's own (drafted) side = "assistant".
    const chat = messages.map((m) => ({
      role: m.role === "me" ? "assistant" : "user",
      content: m.text,
    }));

    // If the last message is already "assistant" (mine), nudge for a fresh draft.
    // For an opener (no messages), seed a minimal user turn so the model responds.
    if (chat.length === 0) {
      chat.push({
        role: "user",
        content:
          "(No conversation yet. Write my opening message to start the chat.)",
      });
    }

    return {
      model: model || DEFAULT_MODEL,
      messages: [{ role: "system", content: system }, ...chat],
      // Generous cap: reasoning models (e.g. gpt-oss) spend tokens "thinking"
      // before the actual message, so a small cap can return empty content.
      max_tokens: 1500,
    };
  }

  // Sends the OpenRouter payload to our backend proxy, which adds the key.
  async function callOpenRouter(payload) {
    const data = await apiFetch("/api/ai/complete", {
      method: "POST",
      body: payload,
    });
    const content =
      data && data.choices && data.choices[0] && data.choices[0].message
        ? data.choices[0].message.content
        : "";
    return (content || "").trim();
  }

  function setBusy(on) {
    el.btnSend.disabled = on;
    el.btnStart.disabled = on;
  }

  // ---- Settings modal ----
  function openSettings() {
    el.setApi.value = apiBase;
    el.setToken.value = appToken;
    el.setModel.value = model;
    el.settingsModal.classList.remove("hidden");
  }
  function closeSettings() {
    el.settingsModal.classList.add("hidden");
  }
  function saveSettings() {
    const prevBase = apiBase;
    apiBase = el.setApi.value.trim().replace(/\/$/, "");
    appToken = el.setToken.value.trim();
    model = el.setModel.value.trim() || DEFAULT_MODEL;
    save(LS_API, apiBase);
    save(LS_TOKEN, appToken);
    closeSettings();
    toast("Saved");
    // First-time config or changed server → (re)load data from it.
    if (apiBase && apiBase !== prevBase) hydrate();
    else if (apiBase) saveSettingsState(); // persist model change
  }
  function clearChat() {
    if (!confirm("Clear this person's conversation?")) return;
    messages = [];
    summary = "";
    getActive().summary = "";
    persistMessages();
    render();
    closeSettings();
  }

  // ---- Profiles modal ----
  function openProfiles() {
    draftProfiles.own = Object.assign(emptyProfile(), ownProfile);
    draftProfiles.friend = Object.assign(emptyProfile(), friendProfile);
    inferredKeys = { own: new Set(), friend: new Set() };
    activeTab = "own";
    syncTabButtons();
    buildProfileForm();
    el.profilesModal.classList.remove("hidden");
  }
  function closeProfiles() {
    el.profilesModal.classList.add("hidden");
  }
  function switchTab(tab) {
    // Draft is already updated live via inputs; just re-render for the new tab.
    activeTab = tab;
    syncTabButtons();
    buildProfileForm();
  }
  function syncTabButtons() {
    el.tabs.forEach((t) => {
      t.classList.toggle("active", t.dataset.tab === activeTab);
    });
  }
  function buildProfileForm() {
    const profile = draftProfiles[activeTab];
    el.profileHint.textContent =
      activeTab === "own"
        ? "About you — the AI writes messages as you."
        : "About them — the AI auto-updates this from the chat as you go. You can edit anything.";
    el.profileForm.innerHTML = "";

    PROFILE_FIELDS.forEach((f) => {
      // Goal is the user's goal/relationship WITH the other person — Them only.
      if (activeTab === "own" && f.key === "goal") return;
      const label = document.createElement("label");
      label.className =
        "field" + (inferredKeys[activeTab].has(f.key) ? " inferred" : "");
      const span = document.createElement("span");
      span.textContent = f.label;
      label.appendChild(span);

      let input;
      if (f.type === "select") {
        input = document.createElement("select");
        const opts = f.options.slice();
        // Keep any current value that isn't a preset option (e.g. an
        // AI-inferred nationality like "Brazilian") so it still shows.
        const cur = (profile[f.key] || "").toString();
        if (cur && opts.indexOf(cur) === -1) opts.push(cur);
        opts.forEach((opt) => {
          const o = document.createElement("option");
          o.value = opt;
          if (opt === "") o.textContent = "—";
          else if (f.key === "mbti" && MBTI_INFO[opt])
            o.textContent =
              opt + " — " + MBTI_INFO[opt][0] + ": " + MBTI_INFO[opt][1];
          else o.textContent = opt;
          input.appendChild(o);
        });
      } else if (f.type === "textarea") {
        input = document.createElement("textarea");
        input.rows = 2;
        if (f.placeholder) input.placeholder = f.placeholder;
      } else {
        input = document.createElement("input");
        input.type = f.type;
        if (f.placeholder) input.placeholder = f.placeholder;
      }
      input.value = profile[f.key] || "";
      input.addEventListener("input", () => {
        draftProfiles[activeTab][f.key] = input.value;
      });
      label.appendChild(input);
      el.profileForm.appendChild(label);
    });

  }
  function saveProfiles() {
    ownProfile = Object.assign(emptyProfile(), draftProfiles.own);
    friendProfile = Object.assign(emptyProfile(), draftProfiles.friend);
    saveSettingsState(); // shared "You" profile
    persistFriend(); // active person's Them profile
    closeProfiles();
    toast("Profiles saved");
  }
  function clearActiveProfile() {
    draftProfiles[activeTab] = emptyProfile();
    inferredKeys[activeTab] = new Set();
    buildProfileForm();
  }

  // Automatically observe the conversation and update the Them profile.
  // Runs in the background after each of their messages; saves silently.
  let evaluating = false;
  async function autoEvaluateFriend() {
    if (evaluating) return;
    if (!apiConfigured()) return; // silently skip until server is set

    // Capture the person so a mid-flight person switch can't cross-contaminate.
    const person = getActive();
    if (!person.messages.length) return;

    evaluating = true;
    try {
      const target =
        "the person the user is chatting with (whose messages are labeled 'Them')";
      const inferred = await callInference(
        target,
        person.profile,
        person.messages,
        person.summary
      );
      const changed = [];
      PROFILE_FIELDS.forEach((f) => {
        let val = (inferred[f.key] || "").toString().trim();
        if (!val) return; // never blank out an existing value
        if (f.key === "mbti") {
          val = val.toUpperCase();
          if (!MBTI_INFO[val]) return;
        }
        if (val !== (person.profile[f.key] || "").toString().trim()) {
          person.profile[f.key] = val;
          changed.push(FIELD_LABELS[f.key]);
        }
      });

      // Your own mood tracks the conversation automatically (You profile).
      const userMood = (inferred.userMood || "").toString().trim();
      let ownMoodChanged = false;
      if (userMood && userMood !== (ownProfile.mood || "").toString().trim()) {
        ownProfile.mood = userMood;
        ownMoodChanged = true;
      }

      if (changed.length || ownMoodChanged) {
        if (changed.length) savePerson(person);
        if (ownMoodChanged) saveSettingsState();
        // Only touch the UI if this person is still the active one.
        if (person.id === activeId) {
          friendProfile = person.profile;
          if (!el.profilesModal.classList.contains("hidden")) {
            draftProfiles.friend = Object.assign(emptyProfile(), friendProfile);
            inferredKeys.friend = new Set(
              PROFILE_FIELDS.filter((f) =>
                changed.includes(FIELD_LABELS[f.key])
              ).map((f) => f.key)
            );
            if (ownMoodChanged) {
              draftProfiles.own.mood = ownProfile.mood;
              inferredKeys.own = new Set(["mood"]);
            }
            if (activeTab === "friend" || (ownMoodChanged && activeTab === "own"))
              buildProfileForm();
          }
          const bits = [];
          if (changed.length)
            bits.push(person.name + ": " + changed.join(", "));
          if (ownMoodChanged) bits.push("your mood → " + userMood);
          toast("Learned " + bits.join(" · "));
        }
      }
    } catch (_) {
      // Silent: background evaluation should never interrupt the chat.
    } finally {
      evaluating = false;
    }
  }

  function transcript(msgs) {
    return (msgs || messages)
      .map((m) => (m.role === "me" ? "You: " : "Them: ") + m.text)
      .join("\n");
  }

  // ---- Compaction ----
  // Fold older messages into a running summary so long chats stay within a small
  // context window while still "remembering" what happened.
  async function compactIfNeeded(force) {
    if (compacting || !apiConfigured()) return;
    const person = getActive();
    const min = force ? KEEP_RECENT + 1 : COMPACT_WHEN;
    if (person.messages.length < min) {
      if (force) toast("Not enough messages to compact yet");
      return;
    }

    compacting = true;
    const foldCount = person.messages.length - KEEP_RECENT;
    const fold = person.messages.slice(0, foldCount);
    const keep = person.messages.slice(foldCount);
    if (force) toast("Compacting…");
    try {
      const newSummary = await callCompaction(person.summary, fold);
      if (!newSummary) throw new Error("empty summary");
      person.summary = newSummary;
      person.messages = keep;
      savePerson(person);
      if (person.id === activeId) {
        summary = person.summary;
        messages = person.messages;
        render();
        toast("Compacted " + foldCount + " earlier messages");
      }
    } catch (_) {
      if (force) toast("Compaction failed");
    } finally {
      compacting = false;
    }
  }

  async function callCompaction(existingSummary, foldMsgs) {
    const system =
      "You maintain a running summary of an ongoing chat between 'You' (the " +
      "user) and 'Them' (the person the user is chatting with). Merge the " +
      "existing summary with the new older messages into ONE updated, concise " +
      "summary. Preserve everything needed to continue the relationship " +
      "naturally: names, ages, locations, plans and dates, promises, feelings, " +
      "shared interests, inside jokes, and unresolved threads. Use compact notes. " +
      "Output ONLY the summary text — no preamble.";

    const user =
      "Existing summary:\n" +
      (existingSummary && existingSummary.trim()
        ? existingSummary.trim()
        : "(none yet)") +
      "\n\nOlder messages to fold in:\n" +
      transcript(foldMsgs);

    const payload = {
      model: model || DEFAULT_MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      max_tokens: 1500,
    };
    return (await callOpenRouter(payload)).trim();
  }

  // ---- On-demand recap (user-facing summary over a time range) ----
  const RANGE_LABELS = {
    today: "today",
    week: "the last week",
    month: "the last month",
    all: "the whole conversation",
  };

  function rangeCutoff(range) {
    if (range === "all") return 0;
    if (range === "today") {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      return d.getTime();
    }
    const day = 86400000;
    if (range === "week") return Date.now() - 7 * day;
    if (range === "month") return Date.now() - 30 * day;
    return 0;
  }

  function messagesInRange(range) {
    const cutoff = rangeCutoff(range);
    // Missing ts (legacy messages) count as very old: only included in "all".
    return messages.filter((m) => (m.ts || 0) >= cutoff);
  }

  let summaryBusy = false;
  function openSummary() {
    setSummaryResult("Pick a range to generate a summary.", true);
    el.rangeBtns.forEach((b) => b.classList.remove("active"));
    el.summaryModal.classList.remove("hidden");
  }
  function closeSummary() {
    el.summaryModal.classList.add("hidden");
  }
  function setSummaryResult(text, dim) {
    el.summaryResult.textContent = text;
    el.summaryResult.classList.toggle("dim", !!dim);
  }

  async function generateSummary(range) {
    if (summaryBusy) return;
    if (!apiConfigured()) {
      toast("Set your server URL in settings");
      closeSummary();
      openSettings();
      return;
    }
    el.rangeBtns.forEach((b) =>
      b.classList.toggle("active", b.dataset.range === range)
    );

    const inRange = messagesInRange(range);
    const includeSummary = range === "all" && summary && summary.trim();
    if (!inRange.length && !includeSummary) {
      setSummaryResult("No messages in " + RANGE_LABELS[range] + ".", true);
      return;
    }

    summaryBusy = true;
    setSummaryResult("Generating…", true);
    try {
      const text = await callRecap(range, inRange, includeSummary ? summary : "");
      setSummaryResult(text || "Empty summary.", !text);
    } catch (err) {
      setSummaryResult(err.message || "Failed to generate summary.", true);
    } finally {
      summaryBusy = false;
    }
  }

  async function callRecap(range, msgs, priorSummary) {
    const who = getActive().name;
    const system =
      "You write a clear, friendly recap for the user of their chat with " +
      who +
      " covering " +
      RANGE_LABELS[range] +
      ". Summarize what was discussed, key facts, feelings, plans/dates, and " +
      "anything notable or unresolved. Address the user as 'you'. Use short " +
      "bullet points or brief paragraphs. Output only the recap.";

    const user =
      (priorSummary && priorSummary.trim()
        ? "Summary of earlier (already-compacted) conversation:\n" +
          priorSummary.trim() +
          "\n\n"
        : "") +
      (msgs.length
        ? "Conversation" +
          (range === "all" ? "" : " from " + RANGE_LABELS[range]) +
          ":\n" +
          transcript(msgs)
        : "(No newer messages; base the recap on the summary above.)");

    const payload = {
      model: model || DEFAULT_MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      max_tokens: 1500,
    };
    return (await callOpenRouter(payload)).trim();
  }

  async function callInference(target, current, msgs, priorSummary) {
    const system =
      "You analyze a chat conversation and infer a factual profile for " +
      target +
      ". Respond with ONLY a JSON object (no markdown, no prose) using exactly " +
      'these keys: "name", "age", "sex", "ethnicity", "country", "mbti", ' +
      '"personalityNotes", "mood", "userMood". Rules: ' +
      "Fill a field only when the conversation gives real evidence for it. " +
      "If a current value is clearly contradicted by the conversation, correct it. " +
      "If there is no evidence for a field, return its current value unchanged. " +
      "Never invent facts. Keep values concise. " +
      'age = number as a string; sex = one of "Female","Male","Non-binary","Other"; ' +
      "mbti = one of the 16 type codes (e.g. ENFP) or empty; " +
      "mood = their apparent mood in the chat; " +
      "personalityNotes = short observed traits/interests; " +
      "userMood = a short mood/emotional tone the USER (labeled 'You') should " +
      "adopt in their next message so they respond well to the OTHER person's " +
      "current mood — empathetic and natural (e.g. " +
      "'reassuring and warm', 'playful and flirty', 'calm and supportive'). " +
      "Adapt userMood to the other person's mood. Always provide userMood.";

    const user =
      "Current profile of the other person (may be empty or partly wrong):\n" +
      JSON.stringify(current) +
      "\n\nAbout the user (context for choosing userMood) — goal with this person: " +
      ((current.goal || "").trim() || "unspecified") +
      "; current mood: " +
      ((ownProfile.mood || "").trim() || "unspecified") +
      "." +
      (priorSummary && priorSummary.trim()
        ? "\n\nSummary of earlier conversation:\n" + priorSummary.trim()
        : "") +
      "\n\nConversation:\n" +
      transcript(msgs);

    const payload = {
      model: model || DEFAULT_MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      max_tokens: 1200,
    };

    const raw = await callOpenRouter(payload);
    return parseJsonObject(raw);
  }

  function parseJsonObject(text) {
    try {
      return JSON.parse(text);
    } catch (_) {}
    // Fallback: grab the first {...} block.
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch (_) {}
    }
    throw new Error("Could not read inference result");
  }

  // ---- Composer style popover (applies instantly) ----
  function buildStyleMenu() {
    if (el.cmpStyle.options.length) return; // build options once
    Object.keys(STYLES).forEach((key) => {
      const o = document.createElement("option");
      o.value = key;
      o.textContent = STYLES[key].label;
      el.cmpStyle.appendChild(o);
    });
    el.cmpStyle.addEventListener("change", () => {
      style = STYLES[el.cmpStyle.value] ? el.cmpStyle.value : DEFAULT_STYLE;
      saveSettingsState();
      updateCmpDesc();
      toast("Style: " + STYLES[style].label);
    });
    el.cmpEmojis.addEventListener("change", () => {
      emojis = el.cmpEmojis.checked;
      saveSettingsState();
    });
  }
  function updateCmpDesc() {
    const s = STYLES[el.cmpStyle.value];
    el.cmpStyleDesc.textContent = s ? s.desc : "";
  }
  function toggleStyleMenu() {
    buildStyleMenu();
    const opening = el.styleMenu.classList.contains("hidden");
    if (opening) {
      el.cmpStyle.value = STYLES[style] ? style : DEFAULT_STYLE;
      el.cmpEmojis.checked = emojis;
      updateCmpDesc();
    }
    el.styleMenu.classList.toggle("hidden");
  }
  function closeStyleMenu() {
    el.styleMenu.classList.add("hidden");
  }

  // ---- Composer auto-grow ----
  function autoGrow() {
    el.theirInput.style.height = "auto";
    el.theirInput.style.height = Math.min(el.theirInput.scrollHeight, 140) + "px";
  }

  // ---- Wire up ----
  el.btnSend.addEventListener("click", sendTheirMessage);
  el.btnStart.addEventListener("click", startChat);
  el.theirInput.addEventListener("input", autoGrow);
  el.theirInput.addEventListener("keydown", (e) => {
    // Enter to send, Shift+Enter for newline (desktop convenience).
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendTheirMessage();
    }
  });

  el.btnSettings.addEventListener("click", openSettings);
  el.btnCloseSettings.addEventListener("click", closeSettings);
  el.btnSaveSettings.addEventListener("click", saveSettings);
  el.btnClearChat.addEventListener("click", clearChat);
  el.settingsModal.addEventListener("click", (e) => {
    if (e.target === el.settingsModal) closeSettings();
  });

  el.btnProfiles.addEventListener("click", openProfiles);
  el.btnCloseProfiles.addEventListener("click", closeProfiles);
  el.btnSaveProfiles.addEventListener("click", saveProfiles);
  el.btnClearProfile.addEventListener("click", clearActiveProfile);
  el.tabs.forEach((t) =>
    t.addEventListener("click", () => switchTab(t.dataset.tab))
  );
  el.profilesModal.addEventListener("click", (e) => {
    if (e.target === el.profilesModal) closeProfiles();
  });

  el.btnStyle.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleStyleMenu();
  });
  document.addEventListener("click", (e) => {
    if (el.styleMenu.classList.contains("hidden")) return;
    if (!el.styleMenu.contains(e.target) && e.target !== el.btnStyle)
      closeStyleMenu();
  });

  el.btnSummary.addEventListener("click", openSummary);
  el.btnCloseSummary.addEventListener("click", closeSummary);
  el.rangeBtns.forEach((b) =>
    b.addEventListener("click", () => generateSummary(b.dataset.range))
  );
  el.btnCopySummary.addEventListener("click", () => {
    const t = el.summaryResult.textContent || "";
    if (t && !el.summaryResult.classList.contains("dim")) copyText(t);
  });
  el.summaryModal.addEventListener("click", (e) => {
    if (e.target === el.summaryModal) closeSummary();
  });

  el.btnPeople.addEventListener("click", openPeople);
  el.btnClosePeople.addEventListener("click", closePeople);
  el.btnAddPerson.addEventListener("click", addPerson);
  el.peopleModal.addEventListener("click", (e) => {
    if (e.target === el.peopleModal) closePeople();
  });

  // ---- Hydration ----
  async function hydrate() {
    if (!apiConfigured()) {
      // No server yet: show empty state and nudge to Settings.
      persons = [newPerson("Person 1")];
      activeId = persons[0].id;
      loadActiveIntoState();
      updateActiveName();
      render();
      toast("Set your server URL in Settings");
      openSettings();
      return;
    }
    try {
      const state = await apiFetch("/api/state");
      const s = state.settings || {};
      ownProfile = Object.assign(emptyProfile(), s.ownProfile || {});
      style = STYLES[s.style] ? s.style : DEFAULT_STYLE;
      emojis = !!s.emojis;
      model = s.model || DEFAULT_MODEL;

      persons = (state.persons || []).map((p) => ({
        id: p.id || uid(),
        name: p.name || "Person",
        profile: Object.assign(emptyProfile(), p.profile || {}),
        messages: Array.isArray(p.messages) ? p.messages : [],
        summary: typeof p.summary === "string" ? p.summary : "",
      }));

      if (!persons.length) {
        // First run against a fresh DB: seed a default person.
        const def = newPerson("Person 1");
        persons.push(def);
        activeId = def.id;
        await savePerson(def);
        await saveSettingsState();
      } else {
        activeId = persons.find((p) => p.id === s.activeId)
          ? s.activeId
          : persons[0].id;
      }
      loadActiveIntoState();
      updateActiveName();
      render();
    } catch (e) {
      toast("Load failed: " + e.message);
      // Keep a usable (unsaved) local shell so the UI isn't broken.
      if (!persons.length) {
        persons = [newPerson("Person 1")];
        activeId = persons[0].id;
        loadActiveIntoState();
      }
      updateActiveName();
      render();
      openSettings();
    }
  }

  // ---- Init ----
  hydrate();
})();
