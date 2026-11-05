const $ = (s) => document.querySelector(s),
  esc = (s) =>
    String(s ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
const CATS = [
  "Wardrobes",
  "Modular Kitchens",
  "Beds",
  "Sofas & Seating",
  "Dining Sets",
  "TV Units & Panels",
  "Office Furniture",
  "Shop Fit-outs",
  "Temple & Doors",
  "Ceilings & Partitions",
];
$("#cl").innerHTML = CATS.map((c) => `<option value="${esc(c)}">`).join("");

// Resize photos in the browser so each upload stays small (Vercel request limit)
const shrink = (f) =>
  new Promise((res) => {
    if (!/^image\/(jpeg|png|webp)$/.test(f.type)) return res(f);
    const im = new Image();
    im.onload = () => {
      const k = Math.min(1, 1600 / Math.max(im.width, im.height)),
        c = document.createElement("canvas");
      c.width = im.width * k;
      c.height = im.height * k;
      c.getContext("2d").drawImage(im, 0, 0, c.width, c.height);
      c.toBlob(
        (b) =>
          res(
            b
              ? new File([b], f.name.replace(/\.\w+$/, "") + ".jpg", {
                  type: "image/jpeg",
                })
              : f,
          ),
        "image/jpeg",
        0.85,
      );
    };
    im.onerror = () => res(f);
    im.src = URL.createObjectURL(f);
  });

let T = sessionStorage.getItem("t"),
  items = [];

const msg = (e, o) => {
  $("#err").textContent = e || "";
  $("#ok").textContent = o || "";
};
async function api(u, o = {}) {
  o.headers = { ...o.headers, Authorization: "Bearer " + T };
  const r = await fetch(u, o);
  let j = {};
  try {
    j = await r.json();
  } catch {}
  if (r.status === 401 && T) out();
  if (!r.ok)
    throw Error(
      typeof j.detail === "string"
        ? j.detail
        : "Please check the details and try again",
    );
  return j;
}
function out() {
  sessionStorage.removeItem("t");
  T = null;
  show();
}
function show() {
  $("#login").classList.toggle("hide", !!T);
  $("#app").classList.toggle("hide", !T);
  if (T) load();
}
async function load() {
  try {
    items = await api("/api/admin/items");
    $("#items").innerHTML =
      items
        .map(
          (
            i,
          ) => `<div class="row"><span><b>${esc(i.title)}</b> (${i.kind}${i.category ? ", " + esc(i.category) : ""}) ${i.published ? "" : "<i>hidden</i>"}
 <div class="th">${i.images.map((m) => `<div><img src="${esc(m.url)}" alt=""><button data-dm="${m.id}" title="Remove photo">×</button></div>`).join("")}</div></span>
 <span style="flex:none"><button class="l" data-e="${i.id}">Edit</button> <button class="d" data-d="${i.id}">Delete</button></span></div>`,
        )
        .join("") || "Nothing added yet.";
    const ds = await (await fetch("/api/documents")).json();
    $("#dl").innerHTML =
      ds
        .map(
          (d) =>
            `<div class="row"><span><a href="${esc(d.url)}" target="_blank">${esc(d.title)}</a></span><button class="d" data-dm="${d.id}">Delete</button></div>`,
        )
        .join("") || "No documents yet.";
    const en = await api("/api/admin/enquiries");
    $("#enq").innerHTML =
      en
        .map(
          (
            e,
          ) => `<div class="row"><span><b>${esc(e.name)}</b> <a href="tel:${esc(e.phone)}">${esc(e.phone)}</a><br>${esc(e.message)}<br><small>${new Date(e.created_at).toLocaleString()}</small></span>
 <select data-s="${e.id}" style="width:auto">${["new", "contacted", "closed"].map((s) => `<option ${s === e.status ? "selected" : ""}>${s}</option>`).join("")}</select></div>`,
        )
        .join("") || "No enquiries yet.";
    const s = await (await fetch("/api/settings")).json();
    for (const k in s) if ($("#t-set")[k]) $("#t-set")[k].value = s[k];
  } catch (e) {
    msg(e.message);
  }
}
$("#login").onsubmit = async (e) => {
  e.preventDefault();
  msg();
  const r = await fetch("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: $("#u").value,
        password: $("#p").value,
      }),
    }),
    j = await r.json();
  if (!r.ok) return msg(j.detail);
  T = j.token;
  sessionStorage.setItem("t", T);
  $("#p").value = "";
  show();
};
$("#tabs").onclick = (e) => {
  const t = e.target.dataset.t;
  if (!t) return;
  [...$("#tabs").children].forEach((b) =>
    b.classList.toggle("on", b === e.target),
  );
  ["items", "docs", "enq", "set"].forEach((x) =>
    $("#t-" + x).classList.toggle("hide", x !== t),
  );
  msg();
};
$("#out").onclick = out;
function resetForm() {
  $("#add").reset();
  $("#add").id.value = "";
  $("#fh").textContent = "Add new";
  $("#pubL").classList.add("hide");
  $("#cancel").classList.add("hide");
}
$("#cancel").onclick = resetForm;
$("#add").onsubmit = async (e) => {
  e.preventDefault();
  msg();
  const f = e.target,
    id = f.id.value,
    fd = new FormData(f);
  fd.delete("id");
  fd.delete("files");
  for (const x of f.files.files) fd.append("files", await shrink(x));
  if (id) fd.set("published", f.published.checked);
  else fd.delete("published");
  try {
    await api(id ? "/api/admin/items/" + id : "/api/admin/items", {
      method: id ? "PUT" : "POST",
      body: fd,
    });
    resetForm();
    msg("", "Saved. It is now on the website.");
    load();
  } catch (x) {
    msg(x.message);
  }
};
$("#docf").onsubmit = async (e) => {
  e.preventDefault();
  msg();
  try {
    await api("/api/admin/documents", {
      method: "POST",
      body: new FormData(e.target),
    });
    e.target.reset();
    msg("", "Document uploaded.");
    load();
  } catch (x) {
    msg(x.message);
  }
};
$("#t-set").onsubmit = async (e) => {
  e.preventDefault();
  const d = Object.fromEntries(new FormData(e.target));
  try {
    await api("/api/admin/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(d),
    });
    msg("", "Website details saved.");
  } catch (x) {
    msg(x.message);
  }
};
document.addEventListener("click", async (e) => {
  const d = e.target.dataset;
  if (!T) return;
  try {
    if (d.d && confirm("Delete this item and its photos?")) {
      await api("/api/admin/items/" + d.d, { method: "DELETE" });
      load();
    }
    if (d.dm && confirm("Remove this file?")) {
      await api("/api/admin/media/" + d.dm, { method: "DELETE" });
      load();
    }
    if (d.e) {
      const i = items.find((x) => x.id == d.e),
        f = $("#add");
      for (const k of [
        "kind",
        "category",
        "title",
        "description",
        "location",
        "details",
      ])
        f[k].value = i[k] || "";
      f.id.value = i.id;
      f.published.checked = i.published;
      $("#fh").textContent = "Edit: " + i.title;
      $("#pubL").classList.remove("hide");
      $("#cancel").classList.remove("hide");
      f.scrollIntoView();
    }
  } catch (x) {
    msg(x.message);
  }
});
document.addEventListener("change", async (e) => {
  if (e.target.dataset.s)
    try {
      await api(
        `/api/admin/enquiries/${e.target.dataset.s}?status=${e.target.value}`,
        { method: "PATCH" },
      );
    } catch (x) {
      msg(x.message);
    }
});
show();