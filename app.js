(() => {
"use strict";
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const store = {
  get(k){ try { return localStorage.getItem(k); } catch { return null; } },
  set(k,v){ try { localStorage.setItem(k,v); } catch {} },
};
const norm = c => (c || "").toUpperCase().replace(/[^A-Z0-9ÄÖÜ]/g, "");
const b64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

// ---------- Hash: #CODE  or  #CODE&id=xyz ----------
function parseHash(){
  const out = {};
  decodeURIComponent(location.hash.slice(1)).split("&").forEach(p => {
    if (!p) return;
    const [k, v] = p.split("=");
    if (v === undefined) out.code = k; else out[k] = v;
  });
  return out;
}

let KEY = null;
async function deriveKey(code, p){
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(norm(code)), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({name:"PBKDF2", salt:b64(p.salt), iterations:p.iter, hash:"SHA-256"}, base, {name:"AES-GCM", length:256}, false, ["decrypt"]);
}
async function open_(key, iv, ct){
  return new TextDecoder().decode(await crypto.subtle.decrypt({name:"AES-GCM", iv:b64(iv)}, key, b64(ct)));
}
async function decrypt(code){
  const p = JSON.parse($("#payload").textContent);
  const key = await deriveKey(code, p);
  const raw = await crypto.subtle.decrypt({name:"AES-GCM", iv:b64(p.iv)}, key, b64(p.ct));
  const text = p.z ? await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream("deflate"))).text() : new TextDecoder().decode(raw);
  const data = JSON.parse(text);
  KEY = key;
  return data;
}
// Fotos liegen verschlüsselt in media.json (selber Schlüssel), damit index.html klein bleibt.
async function loadMedia(){
  try {
    const m = await (await fetch("media.json", {cache: "no-cache"})).json();
    const media = JSON.parse(await open_(KEY, m.iv, m.ct));
    $$("img[data-media]").forEach(img => { if (media[img.dataset.media]) img.src = media[img.dataset.media]; });
  } catch (e) { console.warn("media", e); }
}

let CODE = "", CFG = null;

async function tryOpen(code, silent){
  if (!code) return false;
  try {
    const data = await decrypt(code);
    CODE = norm(code); CFG = data.cfg;
    store.set("jw_code", CODE);
    $("#lock").hidden = true;
    const app = $("#app"); app.innerHTML = data.html; app.hidden = false;
    document.title = data.cfg.title;
    init();
    loadMedia();
    return true;
  } catch (e) {
    if (!silent) {
      $("#lock-err").textContent = "Hmm, der Code passt nicht. Schaut nochmal auf eure Karte.";
      const c = $(".lock-card"); c.classList.remove("shake"); void c.offsetWidth; c.classList.add("shake");
    }
    return false;
  }
}

const H = parseHash();
if (H.id) store.set("jw_id", H.id);
(async () => {
  const ok = await tryOpen(H.code, false) || await tryOpen(store.get("jw_code"), true);
  if (H.code || H.id) history.replaceState(null, "", location.pathname + location.search);
  if (!ok) $("#lock-code").focus();
})();
$("#lock-form").addEventListener("submit", e => { e.preventDefault(); tryOpen($("#lock-code").value, false); });

// ---------- App ----------
function init(){
  const start = new Date(`${CFG.dateISO}T${CFG.start}:00+02:00`);
  const end = new Date(`${CFG.dateISO}T${CFG.calEnd}:00+02:00`);
  const deadline = new Date(`${CFG.rsvpDeadline}T23:59:59+02:00`);
  const now = () => new Date();

  // Countdown
  const cd = k => $(`[data-cd="${k}"]`);
  const tick = () => {
    let s = Math.max(0, Math.floor((start - now()) / 1000));
    if (s === 0) { $("#countdown").innerHTML = '<div style="min-width:auto;padding:12px 18px"><b style="font-size:22px">Heute wird gefeiert!</b></div>'; return; }
    const d = Math.floor(s / 86400); s %= 86400;
    cd("d").textContent = d; cd("h").textContent = Math.floor(s / 3600);
    cd("m").textContent = Math.floor(s % 3600 / 60); cd("s").textContent = s % 60;
    setTimeout(tick, 1000);
  };
  tick();

  // Calendar
  const z = d => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const where = `${CFG.venueName}, ${CFG.street}, ${CFG.city}`;
  const title = `Jugendweihe-Party ${CFG.name}`;
  const ics = ["BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//jugendweihe//DE","BEGIN:VEVENT",
    `UID:jugendweihe-${CFG.dateISO}@${location.hostname || "local"}`,`DTSTAMP:${z(now())}`,`DTSTART:${z(start)}`,`DTEND:${z(end)}`,
    `SUMMARY:${title}`,`LOCATION:${where.replace(/,/g, "\\,")}`,`DESCRIPTION:${CFG.venueHint}`,
    "BEGIN:VALARM","TRIGGER:-P1D","ACTION:DISPLAY","DESCRIPTION:Morgen ist die Party!","END:VALARM",
    "END:VEVENT","END:VCALENDAR"].join("\r\n");
  $$("[data-ics]").forEach(b => b.addEventListener("click", () => {
    const a = document.createElement("a");
    a.href = "data:text/calendar;charset=utf-8," + encodeURIComponent(ics);
    a.download = `jugendweihe-${CFG.name.toLowerCase()}.ics`;
    document.body.appendChild(a); a.click(); a.remove();
  }));
  const g = new URLSearchParams({action:"TEMPLATE", text:title, dates:`${z(start)}/${z(end)}`, location:where, details:CFG.venueHint});
  $$("[data-gcal]").forEach(a => a.href = "https://calendar.google.com/calendar/render?" + g);

  // Zusage-/Absage-Buttons oben
  $$("[data-rsvp]").forEach(a => a.addEventListener("click", e => {
    e.preventDefault();
    const form = $("#rsvp-form");
    if (!form.hidden && !closed) {
      $$('input[name="kommt"]', form).forEach(x => x.checked = x.value === a.dataset.rsvp);
      form.elements.kommt[0].dispatchEvent(new Event("change"));
    }
    $("#rsvp").scrollIntoView({behavior:"smooth", block:"start"});
    if (!form.hidden && !closed) setTimeout(() => form.elements.name.focus({preventScroll:true}), 500);
  }));

  // Texte aus dem Google Sheet (Tab "Texte") – Martin kann sie dort selbst ändern
  const applyTexts = t => {
    $$("[data-text]").forEach(el => { const v = t[el.dataset.text]; if (v && v.trim()) el.textContent = v.trim(); });
    $$("[data-href]").forEach(a => { const v = (t[a.dataset.href] || "").trim();
      if (/^https?:\/\//.test(v)) { a.href = v; a.classList.remove("btn-pending"); if (a.dataset.label) a.textContent = a.dataset.label; } });
  };
  $$("[data-link]").forEach(a => a.dataset.label = a.textContent);
  try { const c = JSON.parse(store.get("jw_texts") || "null"); if (c) applyTexts(c); } catch {}
  if (CFG.apiUrl) fetch(`${CFG.apiUrl}?action=texts&k=${encodeURIComponent(CODE)}`).then(r => r.json())
    .then(r => { if (r.ok && r.texts) { store.set("jw_texts", JSON.stringify(r.texts)); applyTexts(r.texts); } }).catch(() => {});

  // Links, die noch Platzhalter sind
  $$("[data-link]").forEach(a => { if (/TODO/.test(a.getAttribute("href"))) {
    a.removeAttribute("href"); a.classList.add("btn-pending"); a.textContent = "Link folgt bald"; } });

  // Lageplan vergrößern
  $$("[data-zoom]").forEach(btn => btn.addEventListener("click", () => {
    const o = document.createElement("div"); o.className = "zoomed"; o.setAttribute("role", "dialog");
    o.appendChild(btn.querySelector("img").cloneNode());
    const close = () => { o.remove(); document.removeEventListener("keydown", esc); };
    const esc = e => e.key === "Escape" && close();
    o.addEventListener("click", close); document.addEventListener("keydown", esc);
    document.body.appendChild(o);
  }));

  // Photos
  if (now() > start) { $("#photos-before").hidden = true; $("#photos-after").hidden = false; }
  initUpload();

  // RSVP
  const form = $("#rsvp-form"); const F = form.elements;
  const closed = now() > deadline;
  if (closed) { $("#rsvp-closed").hidden = false; }

  const steppers = {};
  $$("[data-stepper]", form).forEach(el => {
    const out = $("output", el), min = +el.dataset.min;
    const st = { el, get v(){ return +out.value; }, max: +el.dataset.max,
      set(v){ v = Math.max(min, Math.min(this.max, v)); out.value = v; out.textContent = v;
        $("[data-dec]", el).disabled = v <= min; $("[data-inc]", el).disabled = v >= this.max; onChange(); } };
    $("[data-dec]", el).onclick = () => st.set(st.v - 1);
    $("[data-inc]", el).onclick = () => st.set(st.v + 1);
    steppers[el.dataset.stepper] = st;
  });
  function onChange(){
    if (!steppers.vegan) return;
    const p = steppers.personen.v;
    ["vegetarisch","vegan"].forEach(k => { const s = steppers[k]; if (s.max !== p){ s.max = p; if (s.v > p) s.set(p); else s.set(s.v); } });
  }
  const kommt = () => F.kommt.value;
  const toggle = () => $$("[data-only]", form.parentElement).forEach(el => el.hidden = el.dataset.only !== kommt());
  $$('input[name="kommt"]', form).forEach(r => r.addEventListener("change", toggle));
  Object.values(steppers).forEach(s => s.set(s.v));
  toggle();

  const fields = ["name","hinweise","s1t","s1a","s2t","s2a","nachricht"];
  function collect(){
    const d = { k: CODE, id: store.get("jw_id") || "", kommt: kommt() };
    fields.forEach(f => d[f] = F[f].value.trim());
    d.personen = d.kommt === "ja" ? steppers.personen.v : 0;
    d.vegetarisch = d.kommt === "ja" ? steppers.vegetarisch.v : 0;
    d.vegan = d.kommt === "ja" ? steppers.vegan.v : 0;
    return d;
  }
  function fill(r){
    fields.forEach(f => { if (r[f] != null) F[f].value = r[f]; });
    $$('input[name="kommt"]', form).forEach(x => x.checked = x.value === (r.kommt || "ja"));
    if (r.personen) steppers.personen.set(+r.personen);
    steppers.vegetarisch.set(+r.vegetarisch || 0); steppers.vegan.set(+r.vegan || 0);
    toggle();
  }
  function validate(d){
    $$(".invalid", form).forEach(x => x.classList.remove("invalid"));
    const bad = [];
    if (!d.name) bad.push("name");
    if (d.kommt === "ja") ["s1t","s1a","s2t","s2a"].forEach(f => { if (!d[f]) bad.push(f); });
    bad.forEach(f => F[f].classList.add("invalid"));
    if (bad.length) {
      showErr(bad.includes("name") ? "Bitte sagt uns, wer antwortet." : "Bitte nennt zwei Songs mit Titel und Interpret – die kommen auf die Party-Playlist!");
      F[bad[0]].focus();
    }
    return !bad.length;
  }
  const showErr = m => { const e = $("#form-error"); e.textContent = m; e.hidden = !m; };
  form.addEventListener("input", e => e.target.classList.remove("invalid"));

  function initUpload(){
    const input = $("#photo-input"), status = $("#upload-status"), thumbs = $("#thumbs"), nameEl = $("#upload-name");
    nameEl.value = store.get("jw_name") || "";
    const say = (t, err) => { status.hidden = false; status.textContent = t; status.classList.toggle("err", !!err); };
    const toB64 = blob => new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(",")[1]); r.onerror = no; r.readAsDataURL(blob); });
    async function shrink(file){
      try {
        // Beamer-tauglich: max. 4096 px (4K+) an der langen Seite, hohe JPEG-Qualität.
        const bmp = await createImageBitmap(file, {imageOrientation: "from-image"});
        const MAX = 4096;
        if (/jpe?g/i.test(file.type) && file.size <= 12 * 1024 * 1024 && Math.max(bmp.width, bmp.height) <= MAX)
          return {blob: file, mime: "image/jpeg", name: file.name};   // Original unverändert
        const f = Math.min(1, MAX / Math.max(bmp.width, bmp.height));
        const cv = document.createElement("canvas"); cv.width = Math.round(bmp.width * f); cv.height = Math.round(bmp.height * f);
        cv.getContext("2d").drawImage(bmp, 0, 0, cv.width, cv.height);
        const blob = await new Promise(r => cv.toBlob(r, "image/jpeg", .92));
        if (blob) return {blob, mime: "image/jpeg", name: file.name.replace(/\.\w+$/, "") + ".jpg"};
      } catch {}
      return {blob: file, mime: file.type || "image/jpeg", name: file.name};
    }
    input.addEventListener("change", async () => {
      const files = [...input.files].filter(f => /^image\//.test(f.type) || /\.(heic|heif)$/i.test(f.name));
      input.value = "";
      if (!files.length) return;
      const von = nameEl.value.trim(); if (von) store.set("jw_name", von);
      let done = 0, failed = 0;
      const tiles = files.map(f => { const d = document.createElement("div"); d.className = "busy"; d.style.backgroundImage = `url(${URL.createObjectURL(f)})`; thumbs.appendChild(d); return d; });
      for (let i = 0; i < files.length; i++) {
        say(`Lade Foto ${i + 1} von ${files.length} hoch …`);
        try {
          const p = await shrink(files[i]);
          if (p.blob.size > 18 * 1024 * 1024) throw new Error("size");
          const r = await api("POST", {k: CODE, action: "photo", name: von || "Gast", filename: p.name, mime: p.mime, data: await toB64(p.blob)});
          if (!r.ok) throw new Error(r.error);
          tiles[i].className = "ok"; done++;
        } catch (e) { tiles[i].className = "fail"; failed++; }
      }
      say(failed ? `${done} von ${files.length} Fotos hochgeladen – ${failed} hat nicht geklappt. Versucht es mit diesen bitte nochmal.` : `${done} ${done === 1 ? "Foto" : "Fotos"} hochgeladen – danke!`, failed && !done);
    });
  }

  async function api(method, data){
    if (!CFG.apiUrl) { // Demo-Modus ohne Backend
      await new Promise(r => setTimeout(r, 500));
      if (method === "GET") { const r = store.get("jw_demo"); return r ? {ok:true, record:JSON.parse(r)} : {ok:false}; }
      if (data.action === "photo") return {ok:true, demo:true};
      const id = data.id || Math.random().toString(36).slice(2, 10);
      store.set("jw_demo", JSON.stringify({...data, id})); return {ok:true, id, demo:true};
    }
    const res = method === "GET"
      ? await fetch(`${CFG.apiUrl}?action=get&k=${encodeURIComponent(CODE)}&id=${encodeURIComponent(data.id)}`)
      : await fetch(CFG.apiUrl, {method:"POST", body:JSON.stringify(data)});
    return res.json();
  }

  function showDone(d, fresh){
    const url = `${location.origin}${location.pathname}#${CODE}&id=${store.get("jw_id")}`;
    form.hidden = true; $("#rsvp-done").hidden = false;
    const first = d.name;
    $(".done-title").textContent = d.kommt === "ja" ? `Yay, ${first}! Ich freu mich auf ${d.personen > 1 ? "euch" : "dich"}.` : `Schade, ${first} – danke für die Rückmeldung!`;
    $(".done-text").textContent = (fresh ? "Eure Antwort ist angekommen. " : "Ihr habt schon geantwortet. ")
      + (d.kommt === "ja" ? `${d.personen} ${d.personen == 1 ? "Person" : "Personen"} · Songs: „${d.s1t}“ und „${d.s2t}“.` : "")
      + " Speichert euch den Link unten, falls ihr später etwas ändern wollt.";
    $("#edit-url").value = url;
    $("#edit-again").hidden = closed;
  }
  $("#copy-edit").onclick = async () => {
    const i = $("#edit-url"); i.select();
    try { await navigator.clipboard.writeText(i.value); } catch { document.execCommand("copy"); }
    $("#copy-edit").textContent = "Kopiert!"; setTimeout(() => $("#copy-edit").textContent = "Kopieren", 1800);
  };
  $("#edit-again").onclick = () => { $("#rsvp-done").hidden = true; form.hidden = false; $("#submit-btn").textContent = "Antwort aktualisieren"; F.name.focus(); };

  form.addEventListener("submit", async e => {
    e.preventDefault(); showErr("");
    const d = collect();
    if (!validate(d)) return;
    const btn = $("#submit-btn"), label = btn.textContent;
    btn.disabled = true; btn.textContent = "Wird gesendet …";
    try {
      const r = await api("POST", d);
      if (!r.ok) throw new Error(r.error || "Fehler");
      store.set("jw_id", r.id); store.set("jw_name", d.name);
      showDone(d, true);
      $("#rsvp").scrollIntoView({behavior:"smooth", block:"start"});
    } catch (err) {
      showErr(err.message === "closed" ? "Die Rückmeldefrist ist leider vorbei." : "Das hat nicht geklappt. Bitte versucht es gleich nochmal.");
    } finally { btn.disabled = false; btn.textContent = label; }
  });

  if (closed) { form.hidden = !store.get("jw_id"); $$("input,textarea,button", form).forEach(x => x.disabled = true); }

  // Bereits geantwortet? → laden
  const id = store.get("jw_id");
  if (id) api("GET", {id}).then(r => {
    if (r && r.ok && r.record) { fill(r.record); showDone({...r.record, personen:+r.record.personen || 0}, false); $("#submit-btn").textContent = "Antwort aktualisieren"; }
  }).catch(() => {});
}
})();
