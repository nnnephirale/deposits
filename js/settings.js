// The Settings sheet.

import { S } from "./state.js";
import { el, sheetRoot } from "./dom.js";
import { MODES, RETIRED_MAX, TOPICS, hexHue, nextFreeHue, saveTaxonomy, tone, topicColours } from "./taxonomy.js";
import { API_KEY_KEY } from "./anthropic.js";
import { keepConnectedRow, photoStatus, pullMissingImages, pushEntriesNow, syncHealthText, syncPull, syncPushEntries } from "./sync-ui.js";
import { THEME_MODES, UNFOLD_STEPS, setThemeMode, setUnfoldLevel, themeMode, unfoldLevel, unfoldNote } from "./prefs.js";
import { render } from "./render.js";
import { ICO_RABBIT } from "./rails.js";
import { fadeTuneOn, fadeTuneSummary, setFadeTuneOn } from "./tuner.js";
import { cloudCheck, cloudConfig, cloudConfigured, cloudDiagnose, imageIdsIn, pendingUploads, setCloudConfig, setupLink, syncHealth } from "./sync.js";
import { storageReport } from "./store.js";

// ---------- settings (long-press the title) ----------
export function openSettings() {
  sheetRoot.innerHTML = "";
  const overlay = el("div", { class: "overlay", onclick: () => sheetRoot.innerHTML = "" });
  const sheet = el("div", { class: "sheet", onclick: e => e.stopPropagation() });
  overlay.appendChild(sheet);

  function build() {
    sheet.innerHTML = "";
    sheet.appendChild(el("div", { class: "grabber" }));
    sheet.appendChild(el("div", { class: "sheet-head" },
      el("span", { class: "title" }, "Settings"), el("span")));

    // ---- tags ----
    // First on the sheet: it's the only section here that is her CONTENT rather than the app's
    // plumbing, and the one she'll come looking for. Rebuilt on its own (renderTags) rather than
    // through build(), so editing a name can't wipe the connection note or the key field below.
    const tagsBox = el("div");
    sheet.appendChild(tagsBox);
    // one debounce for both jobs a rename has to do — write it away, and redraw the list behind
    // the sheet where the old name is still showing on every pill and group header.
    let tagSaveT = null;
    function commitTags() {
      clearTimeout(tagSaveT);
      tagSaveT = setTimeout(() => { saveTaxonomy(); render(); }, 220);
    }
    // A removal is instantly reversible, so it doesn't get a confirmation — it gets a restore row
    // in the rose the app already uses for undo. It goes into the retired list rather than a
    // variable in this sheet, so it is still there after Settings is closed, after a reload, and
    // on her other device: an undo that expires the moment the panel does is not an undo, it's a
    // grace period, and the deposits it would strand are the whole reason removal needs one.
    // Nothing is done to those deposits either way — they keep the tag's id, so a restore puts
    // every one of them back exactly where it was.
    function removeTag(item, list, isTopic) {
      const at = list.indexOf(item);
      if (at < 0) return;
      list.splice(at, 1);
      S.RETIRED = [...S.RETIRED, { ...item, at, isTopic }].slice(-RETIRED_MAX);
      commitTags(); renderTags();
    }
    function restoreTag(rec) {
      const list = rec.isTopic ? TOPICS : MODES;
      const { at, isTopic, ...item } = rec;
      list.splice(Math.min(at == null ? list.length : at, list.length), 0, item);
      S.RETIRED = S.RETIRED.filter(r => r !== rec);
      commitTags(); renderTags();
    }
    // circular distance between two hues, so "far from the others" means the same going either
    // way round the wheel
    const hueGap = (a, b) => { const d = Math.abs(a - b) % 360; return Math.min(d, 360 - d); };
    // Tapping a dot walks the wheel FORWARD to the next hue that is at least 24° clear of every
    // other topic. Forward means repeated taps keep moving rather than flipping between two
    // colours; the 24° floor means every stop is a colour she can actually tell apart from the
    // ones already on the list.
    function cycleHue(cur, others) {
      for (let step = 6; step <= 360; step += 6) {
        const h = (cur + step) % 360;
        if (others.every(o => hueGap(h, o) > 24)) return h;
      }
      return (cur + 30) % 360;
    }
    function taxRow(item, list, isTopic, usage) {
      const row = el("div", { class: "tax-row" });
      if (isTopic) {
        const dot = el("button", {
          class: "tax-dot", "aria-label": "Change colour",
          style: { background: tone(item).dot },
          onclick: () => {
            const others = list.filter(x => x !== item).map(x => x.hue != null ? x.hue : hexHue(x.dot));
            Object.assign(item, topicColours(cycleHue(item.hue != null ? item.hue : hexHue(item.dot), others)));
            commitTags(); renderTags();
          }
        });
        row.appendChild(dot);
      }
      // a ghost input: it reads as the name until she puts a caret in it, and only then as a
      // field. Same grammar as the composer — nothing looks editable until it is being edited.
      const name = el("input", {
        class: "tax-name", type: "text", value: item.label,
        "aria-label": "Tag name", autocomplete: "off", spellcheck: "false"
      });
      // renderTags is deliberately NOT called from here: rebuilding the row under a live caret
      // is how a rename loses the caret on every keystroke.
      name.addEventListener("input", () => { item.label = name.value; commitTags(); });
      name.addEventListener("blur", () => {
        if (item.label.trim()) return;
        item.label = isTopic ? "untitled topic" : "untitled mode";
        name.value = item.label; commitTags();
      });
      row.appendChild(name);
      const n = usage[item.id] || 0;
      if (n) row.appendChild(el("span", { class: "tax-count" }, String(n)));
      row.appendChild(el("button", {
        class: "tax-del", "aria-label": "Remove " + item.label,
        onclick: () => removeTag(item, list, isTopic)
      }, "×"));
      return row;
    }
    function addTag(list, isTopic) {
      const item = isTopic
        ? { id: "t" + Date.now().toString(36), label: "new topic", ...topicColours(nextFreeHue()) }
        : { id: "m" + Date.now().toString(36), label: "new mode" };
      list.push(item);
      commitTags(); renderTags();
      // straight into naming it, with the placeholder name selected so typing replaces it —
      // adding a tag and naming it are one action, not two
      const rows = tagsBox.querySelectorAll(".tax-row .tax-name");
      const field = rows[isTopic ? TOPICS.length - 1 : TOPICS.length + MODES.length - 1];
      if (field) { field.focus(); field.select(); }
    }
    function renderTags() {
      tagsBox.innerHTML = "";
      // counted off every deposit, not the current period: this is "what am I about to drop",
      // and a topic with nothing filed under it this month may still hold a year of entries.
      const usage = {};
      for (const e of S.entries) for (const t of (e.tags || [])) usage[t] = (usage[t] || 0) + 1;

      tagsBox.appendChild(el("p", { class: "field-label", style: { marginTop: "0" } }, "topics"));
      TOPICS.forEach(t => tagsBox.appendChild(taxRow(t, TOPICS, true, usage)));
      tagsBox.appendChild(el("button", { class: "tax-add", onclick: () => addTag(TOPICS, true) }, "+ topic"));

      tagsBox.appendChild(el("p", { class: "field-label", style: { marginTop: "20px" } }, "modes"));
      MODES.forEach(m => tagsBox.appendChild(taxRow(m, MODES, false, usage)));
      tagsBox.appendChild(el("button", { class: "tax-add", onclick: () => addTag(MODES, false) }, "+ mode"));

      // the retired ones, newest first — the mistake she is most likely to be undoing is the
      // one she just made
      [...S.RETIRED].reverse().forEach(rec => {
        const n = usage[rec.id] || 0;
        tagsBox.appendChild(el("button", { class: "tax-undo", onclick: () => restoreTag(rec) },
          "restore " + (rec.label || "that tag")
          + (n ? " · " + n + " deposit" + (n === 1 ? "" : "s") : "")));
      });

      tagsBox.appendChild(el("p", { class: "settings-note" },
        "renaming keeps every deposit already filed under a tag — they're stored by tag, not by name. "
        + "removing one leaves those deposits untagged rather than deleting them, and tapping a dot "
        + "gives that topic the next colour the palette has room for."));
    }
    renderTags();

    // ---- cloud sync ----
    // A Worker URL and a secret, typed in once per device. No accounts and no sign-in
    // round-trip: the previous backend's session token lived in localStorage alongside the
    // photos, so when that filled up the token couldn't be refreshed and both devices were
    // quietly signed out. Two fields that never expire can't do that.
    sheet.appendChild(el("p", { class: "field-label" }, "cloud sync"));
    const cc = cloudConfig();
    if (cc) {
      const note = el("p", { class: "settings-note", style: { margin: "0" } },
        "backing up to " + cc.url.replace(/^https?:\/\//, "") + " — entries and photos sync across your devices.");
      sheet.appendChild(note);
      // The claim the dot is making, spelled out. A green dot with "last synced 9 days ago"
      // under it is still bad news, but it is bad news you can see.
      const healthNote = el("p", { class: "settings-note", style: { margin: "2px 0 0" } });
      const paintHealthNote = (text, bad) => {
        healthNote.textContent = text === undefined ? syncHealthText() : text;
        healthNote.className = "settings-note" + ((bad === undefined ? syncHealth().failing : bad) ? " warn" : "");
      };
      paintHealthNote();
      sheet.appendChild(healthNote);
      const syncBtn = el("button", { class: "lock-btn", onclick: async () => {
        syncBtn.disabled = true; syncBtn.textContent = "syncing…";
        await syncPull(); await pushEntriesNow();
        syncBtn.disabled = false; syncBtn.textContent = "sync now";
        paintHealthNote();   // whatever just happened, say so rather than leaving the old line
        render();
      } }, "sync now");
      sheet.appendChild(syncBtn);
      // The result goes in the health line, not over the address: overwriting the address was
      // how the panel ended up showing a failure with no mention of what it had failed to reach.
      const testBtn = el("button", { class: "lock-btn", onclick: async () => {
        testBtn.disabled = true; testBtn.textContent = "checking…";
        paintHealthNote("checking…", false);
        const r = await cloudDiagnose();
        testBtn.disabled = false; testBtn.textContent = "test connection";
        paintHealthNote(r.ok
          ? "connected — " + r.entries + " entries in the cloud" +
            (r.deleted ? " (plus " + r.deleted + " deleted)." : ".")
          : r.reason, !r.ok);
      } }, "test connection");
      sheet.appendChild(testBtn);
      // Setting a device up by retyping a 48-character key is how keys end up mistyped.
      // This copies a link that carries it — open it on the other device and it is done.
      const linkBtn = el("button", { class: "lock-btn", onclick: async () => {
        const url = setupLink();
        if (!url) return;
        try { await navigator.clipboard.writeText(url); linkBtn.textContent = "copied — open it on the other device"; }
        catch (e) { note.textContent = url; linkBtn.textContent = "copy failed — the link is above"; }
        setTimeout(() => { linkBtn.textContent = "copy setup link"; }, 4000);
      } }, "copy setup link");
      sheet.appendChild(linkBtn);
      sheet.appendChild(el("p", { class: "settings-note", style: { margin: "2px 0 0" } },
        "the link contains your key — treat it like a password, and it only needs to travel once."));
      // Same link, aimed at this device rather than another one — see keepConnectedRow in sync-ui.js.
      sheet.appendChild(keepConnectedRow());
      sheet.appendChild(el("button", { class: "lock-btn", style: { marginTop: "10px" }, onclick: () => {
        setCloudConfig(null); build();   // local entries are untouched; only the link goes
      } }, "disconnect"));
    } else {
      // A real <form> with a named password field, submitted rather than click-handled, so
      // Safari offers to put the secret in the keychain — which is iCloud, which is every
      // other device she owns, and which nothing on this phone can evict. `autocomplete:
      // "off"` used to actively prevent that, leaving 48 characters to retype by hand.
      const urlIn = el("input", { class: "key-input", type: "url", name: "url",
        placeholder: "https://deposits.<you>.workers.dev", autocomplete: "url" });
      const userIn = el("input", { type: "text", name: "username", value: "deposits",
        autocomplete: "username", readonly: "readonly", "aria-hidden": "true", tabindex: "-1",
        style: { position: "absolute", left: "-9999px", width: "1px", height: "1px" } });
      const secretIn = el("input", { class: "key-input", type: "password", name: "password",
        placeholder: "worker secret", autocomplete: "current-password" });
      const status = el("p", { class: "settings-note" },
        "paste the Worker's address and its secret. entries back up as one small file; " +
        "photos go up once each and are only ever downloaded once per device.");
      const connect = el("button", { class: "lock-btn", type: "submit" }, "connect");
      const form = el("form", { style: { display: "contents" }, onsubmit: async ev => {
        ev.preventDefault();
        const url = urlIn.value.trim(), secret = secretIn.value.trim();
        if (!url || !secret) return;
        connect.disabled = true; connect.textContent = "connecting…";
        setCloudConfig({ url, secret });
        const r = await cloudCheck();
        connect.disabled = false; connect.textContent = "connect";
        if (!r.ok) { setCloudConfig(null); status.textContent = "couldn't connect: " + r.reason; return; }
        await syncPull(); render(); syncPushEntries();
        build();
      } }, urlIn, userIn, secretIn, connect, status);
      sheet.appendChild(form);
    }

    // ---- storage ----
    // Real numbers, on the device that has the problem. Diagnosing the last outage meant
    // plugging a phone into a Mac to reach a console; it shouldn't have.
    sheet.appendChild(el("p", { class: "field-label", style: { marginTop: "26px" } }, "storage"));
    const storageNote = el("p", { class: "settings-note", style: { margin: "0" } }, "checking…");
    sheet.appendChild(storageNote);

    // photos move in the background; show where they are rather than leaving the panel silent
    const photoNote = el("p", { class: "settings-note", style: { margin: "4px 0 0" } });
    photoNote.style.display = photoStatus ? "" : "none";
    if (photoStatus) photoNote.textContent = "photos " + photoStatus.done + " of " + photoStatus.total + "…";
    sheet.appendChild(photoNote);
    S.onPhotoProgress = (st, done, total) => {
      if (!photoNote.isConnected) { S.onPhotoProgress = null; return; }
      photoNote.style.display = "";
      photoNote.textContent = st ? "photos " + done + " of " + total + "…" : "photos up to date";
    };

    if (cloudConfig()) {
      const fixBtn = el("button", { class: "lock-btn", onclick: async () => {
        fixBtn.disabled = true; fixBtn.textContent = "re-downloading…";
        const r = await pullMissingImages(true);
        fixBtn.disabled = false; fixBtn.textContent = "re-download photos";
        photoNote.style.display = "";
        photoNote.textContent = r.got + " photo(s) restored" + (r.failed ? ", " + r.failed + " failed" : "");
        render();
      } }, "re-download photos");
      sheet.appendChild(fixBtn);
    }

    // The dashboard is the thing you want open when something has gone wrong, which is
    // exactly when you will not remember it exists. Same origin, so it inherits this
    // device's credential and needs nothing set up.
    sheet.appendChild(el("button", { class: "lock-btn", onclick: () => {
      window.open("dashboard.html", "_blank", "noopener");
    } }, "open the dashboard"));

    storageReport().then(r => {
      const mb = n => (n / 1048576).toFixed(1) + "MB";
      const pct = r.quota ? Math.round((r.usage / r.quota) * 100) : null;
      storageNote.textContent =
        r.entries + " entries · " + r.images + " photos (" + mb(r.imageBytes) + ")" +
        (r.quota ? " · using " + mb(r.usage) + " of " + mb(r.quota) + " available (" + pct + "%)" : "") +
        (r.legacyBytes > 100000 ? " · " + mb(r.legacyBytes) + " still in the old store" : "") +
        // How many photos this device would still ask the bucket about. It used to be all of
        // them, on every save.
        (cloudConfigured() ? (() => {
          const pending = pendingUploads(imageIdsIn(S.entries));
          return pending ? " · " + pending + " photo" + (pending === 1 ? "" : "s") + " not backed up yet"
                         : " · every photo is backed up";
        })() : "");
    }).catch(() => { storageNote.textContent = "couldn't read storage stats"; });

    // ---- appearance ----
    // the same segmented cells as the speed scale below, so the sheet keeps one control shape
    sheet.appendChild(el("p", { class: "field-label", style: { marginTop: "26px" } }, "appearance"));
    const themeSeg = el("div", { class: "speed-seg", role: "group", "aria-label": "Appearance" });
    for (const m of THEME_MODES) {
      themeSeg.appendChild(el("button", {
        class: "speed-cell" + (m === themeMode ? " on" : ""),
        "aria-pressed": m === themeMode ? "true" : "false",
        onclick: () => { setThemeMode(m); build(); }
      }, m));
    }
    sheet.appendChild(themeSeg);

    // ---- composer speed ----
    // One sheet serves both viewports: the desktop rail's Settings glyph and the mobile ⋮
    // menu's Settings row both land here, so this control only has to be built once.
    sheet.appendChild(el("p", { class: "field-label", style: { marginTop: "26px" } }, "composer speed"));
    const seg = el("div", { class: "speed-seg", role: "group", "aria-label": "Composer speed" });
    for (let i = 0; i < UNFOLD_STEPS.length; i++) {
      const off = UNFOLD_STEPS[i] === 0;
      const cell = el("button", {
        class: "speed-cell" + (i === unfoldLevel ? " on" : ""),
        "aria-pressed": i === unfoldLevel ? "true" : "false",
        "aria-label": off ? "no animation" : "speed " + (i + 1) + " of " + UNFOLD_STEPS.length,
        onclick: () => { setUnfoldLevel(i); build(); }
      });
      if (off) cell.innerHTML = ICO_RABBIT;
      else cell.textContent = String(i + 1);
      seg.appendChild(cell);
    }
    sheet.appendChild(seg);
    sheet.appendChild(el("p", { class: "settings-note" }, unfoldNote()));

    // ---- gradient tuner (TEMPORARY) ----
    // Comes out with the rest of the tuner once the fade's numbers are settled — see FADE_SPECS.
    sheet.appendChild(el("p", { class: "field-label", style: { marginTop: "26px" } }, "gradient tuner"));
    const ftBtn = el("button", { class: "lock-btn", style: { marginTop: "0" }, onclick: () => {
      setFadeTuneOn(!fadeTuneOn);
      ftBtn.textContent = fadeTuneOn ? "hide the tuner" : "show the tuner";
      ftNote.textContent = fadeTuneNote();
    } }, fadeTuneOn ? "hide the tuner" : "show the tuner");
    const fadeTuneNote = () => (fadeTuneOn
      ? "open a long entry and scroll — the panel floats over the composer. now: " + fadeTuneSummary()
      : "five live dials for the fade under the composer's pinned head. now: " + fadeTuneSummary());
    const ftNote = el("p", { class: "settings-note" }, fadeTuneNote());
    sheet.appendChild(ftBtn);
    sheet.appendChild(ftNote);

    sheet.appendChild(el("p", { class: "field-label", style: { marginTop: "26px" } }, "anthropic api key"));
    const input = el("input", { class: "key-input", type: "password", placeholder: "sk-ant-…", autocomplete: "off" });
    input.value = S.apiKey || "";
    input.addEventListener("input", () => {
      const had = !!S.apiKey;
      S.apiKey = input.value.trim() || null;
      try {
        if (S.apiKey) localStorage.setItem(API_KEY_KEY, S.apiKey);
        else localStorage.removeItem(API_KEY_KEY);
      } catch (e) {}
      // The key decides whether the AI routes exist at all — the chevron, the summary block's
      // offer, the segmentation invite. None of them re-read it on their own, so pasting a key
      // used to leave every one of them showing the state from before it was there until some
      // unrelated thing happened to trigger a render. Only on the transition, not per keystroke.
      if (had !== !!S.apiKey) render();
    });
    sheet.appendChild(input);
    sheet.appendChild(el("p", { class: "settings-note" },
      "stored only on this device. used for the weekly summary (via haiku, fractions of a cent) — once a week has entries on 3 or more days, a wand appears to create it — and for the monthly reading (via sonnet, a few cents): in month view, the wand reads the whole month back as observation cards, one at a time."));
  }

  build();
  sheetRoot.appendChild(overlay);
}

// settings used to hang off a long-press on the "deposits" title; the period tabs now
// occupy that same top-left spot, so the gesture moves there and the muscle memory holds.
// the flag stops the release from also registering as a period tap.
const periodNav = document.querySelector(".period-nav");
let titleHoldTimer = null;
periodNav.addEventListener("pointerdown", () => {
  S.titleLongFired = false;
  clearTimeout(titleHoldTimer);
  titleHoldTimer = setTimeout(() => { S.titleLongFired = true; openSettings(); }, 500);
});
["pointerup", "pointerleave", "pointercancel"].forEach(evt =>
  periodNav.addEventListener(evt, () => clearTimeout(titleHoldTimer)));
periodNav.addEventListener("contextmenu", e => e.preventDefault());
