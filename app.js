"use strict";

const KEY = "kotonoha-shelf.v1";
const LABEL = ["シリーズ", "章", "話"];
const ICON = ["▤", "▱", "≡"];
const number = new Intl.NumberFormat("ja-JP");
const byId = id => document.getElementById(id);
const tree = byId("tree");
const search = byId("search");
const content = byId("content");
const dialog = byId("dialog");
const dialogBody = byId("dialog-body");
const expanded = new Set();

let savedRaw = null;
let dirty = false;
let storageError = false;
let selection = null;
let toastTimer;
let shelf = { version: 1, series: [] };

function parseShelf(raw) {
  const data = JSON.parse(raw);
  if (data?.version !== 1 || !Array.isArray(data.series)) throw new Error("形式が異なります");
  const ids = new Set();
  function validate(nodes, depth) {
    return nodes.map(node => {
      if (!node || typeof node.id !== "string" || !node.id || ids.has(node.id) ||
          typeof node.title !== "string" || !node.title.trim()) throw new Error("項目の形式が異なります");
      ids.add(node.id);
      if (depth === 2) {
        if (typeof node.body !== "string") throw new Error("本文の形式が異なります");
        return { id: node.id, title: node.title, body: node.body };
      }
      if (!Array.isArray(node.children)) throw new Error("階層の形式が異なります");
      return { id: node.id, title: node.title, children: validate(node.children, depth + 1) };
    });
  }
  return { version: 1, series: validate(data.series, 0) };
}

try {
  savedRaw = localStorage.getItem(KEY);
  if (savedRaw !== null) shelf = parseShelf(savedRaw);
} catch {
  storageError = true;
}

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function button(text, action, className) {
  const node = element("button", text, className);
  node.type = "button";
  node.addEventListener("click", action);
  return node;
}

function toast(message) {
  const region = byId("toast");
  clearTimeout(toastTimer);
  region.textContent = message;
  toastTimer = setTimeout(() => { region.textContent = ""; }, 3800);
}

function updateSaveStatus() {
  const status = byId("save-status");
  if (!status) return;
  status.textContent = storageError ? "保存できませんでした。バックアップから書き出せます。" :
    dirty ? "未保存" : "自動保存済み";
}

function save() {
  dirty = true;
  try {
    if (localStorage.getItem(KEY) !== savedRaw) throw new Error("別のタブで更新されました");
    const raw = JSON.stringify(shelf);
    localStorage.setItem(KEY, raw);
    savedRaw = raw;
    dirty = false;
    storageError = false;
  } catch {
    if (!storageError) toast("自動保存できませんでした。バックアップから書き出せます。");
    storageError = true;
  }
  updateSaveStatus();
}

window.addEventListener("storage", event => {
  if (event.key !== KEY && event.key !== null) return;
  if (dirty) {
    storageError = true;
    updateSaveStatus();
    toast("別のタブで更新されました。編集中の内容はバックアップから書き出せます。");
    return;
  }
  try {
    const raw = localStorage.getItem(KEY);
    shelf = raw === null ? { version: 1, series: [] } : parseShelf(raw);
    savedRaw = raw;
    storageError = false;
    dialog.close();
    render();
  } catch {
    storageError = true;
    updateSaveStatus();
  }
});

window.addEventListener("beforeunload", event => {
  if (dirty) {
    event.preventDefault();
    event.returnValue = "";
  }
});

function entries(nodes = shelf.series, parent = [], result = []) {
  for (const node of nodes) {
    const path = [...parent, node];
    result.push({ node, path, depth: parent.length, siblings: nodes });
    if (node.children) entries(node.children, path, result);
  }
  return result;
}

function metrics(node) {
  if (node.body !== undefined) return { chars: count(node.body), chapters: 0, stories: 1 };
  return node.children.reduce((total, child) => {
    const childMetrics = metrics(child);
    total.chars += childMetrics.chars;
    total.chapters += child.body === undefined ? 1 : 0;
    total.stories += childMetrics.stories;
    return total;
  }, { chars: 0, chapters: 0, stories: 0 });
}

function count(text) {
  let length = 0;
  for (const character of text) {
    if (character !== "\n" && character !== "\r") length++;
  }
  return length;
}

function summary(node, depth) {
  const { chars, chapters, stories } = metrics(node);
  const parts = [];
  if (depth === 0) parts.push(number.format(chapters) + "章");
  if (depth < 2) parts.push(number.format(stories) + "話");
  parts.push(number.format(chars) + "字");
  return parts.join(" · ");
}

function openItem(id) {
  selection = id;
  const item = entries().find(entry => entry.node.id === id);
  if (item) item.path.slice(0, -1).forEach(node => expanded.add(node.id));
  render();
  byId("workspace").focus({ preventScroll: true });
  if (window.matchMedia("(max-width: 680px)").matches) {
    byId("workspace").scrollIntoView({ block: "start" });
  }
}

function makeTree(nodes, depth = 0) {
  const list = element("ul", undefined, "tree-list");
  for (const node of nodes) {
    const item = element("li");
    const row = element("div", undefined, "tree-row");
    const isOpen = expanded.has(node.id);
    if (node.children?.length) {
      const toggle = button(isOpen ? "▾" : "▸", () => {
        if (isOpen) expanded.delete(node.id);
        else expanded.add(node.id);
        renderShelf();
        tree.querySelectorAll(".twisty").forEach(control => {
          if (control.dataset.id === node.id) control.focus();
        });
      }, "twisty");
      toggle.dataset.id = node.id;
      toggle.setAttribute("aria-expanded", String(isOpen));
      toggle.setAttribute("aria-label", node.title + (isOpen ? "を閉じる" : "を展開"));
      row.append(toggle);
    } else row.append(element("span", undefined, "leaf-space"));
    const control = button(undefined, () => {
      if (node.children) expanded.add(node.id);
      openItem(node.id);
    }, "node");
    const icon = element("span", ICON[depth], "node-icon");
    icon.setAttribute("aria-hidden", "true");
    control.append(icon, document.createTextNode(node.title));
    if (node.id === selection) control.setAttribute("aria-current", "page");
    row.append(control);
    item.append(row);
    if (node.children?.length && isOpen) item.append(makeTree(node.children, depth + 1));
    list.append(item);
  }
  return list;
}

function normalized(value) {
  return value.normalize("NFKC").toLocaleLowerCase("ja");
}

function renderShelf() {
  const all = entries();
  const stories = all.filter(item => item.depth === 2).length;
  byId("random").disabled = stories === 0;
  tree.replaceChildren();
  const query = normalized(search.value.trim());
  if (!query) {
    byId("shelf-count").textContent = number.format(shelf.series.length) + "シリーズ · " + number.format(stories) + "話";
    if (shelf.series.length) tree.append(makeTree(shelf.series));
    return;
  }
  const matches = all.filter(({ node }) => normalized(node.title).includes(query) ||
    (node.body !== undefined && normalized(node.body).includes(query)));
  byId("shelf-count").textContent = "検索結果 " + number.format(matches.length) + "件";
  if (!matches.length) tree.append(element("p", "一致する項目がありません。", "empty"));
  for (const { node, path, depth } of matches) {
    const result = button(undefined, () => openItem(node.id), "search-result");
    result.append(element("span", LABEL[depth] + (depth ? " · " + path.slice(0, -1).map(part => part.title).join(" › ") : ""), "result-path"));
    result.append(element("span", node.title));
    const position = node.body === undefined ? -1 : normalized(node.body).indexOf(query);
    if (position >= 0) {
      const start = Math.max(0, position - 16);
      const snippet = node.body.slice(start, position + query.length + 35).replace(/\s+/gu, " ");
      result.append(element("span", (start ? "…" : "") + snippet + "…", "result-snippet"));
    }
    tree.append(result);
  }
}

function renderHome() {
  const hero = element("div", undefined, "hero");
  const intro = element("div");
  intro.append(element("h2", "自分だけの書架"),
    element("p", "シリーズ、章、話に分けて、文章をまとめておけます。"),
    button("＋ シリーズを作る", () => titleDialog(), "primary"));
  const art = element("div", undefined, "book-art");
  art.setAttribute("aria-hidden", "true");
  art.append(element("i"), element("i"), element("i"));
  hero.append(intro, art);
  content.append(hero);
  if (!shelf.series.length) return;
  const overview = element("section", undefined, "overview");
  overview.append(element("h3", "シリーズ一覧"), cards(shelf.series, 0));
  content.append(overview);
}

function cards(nodes, depth) {
  const group = element("div", undefined, "cards");
  for (const node of nodes) {
    const card = button(node.title, () => openItem(node.id), "card");
    card.append(element("span", summary(node, depth)));
    group.append(card);
  }
  return group;
}

function renderItem(item) {
  const { node, path, depth, siblings } = item;
  const breadcrumbs = element("nav", undefined, "breadcrumbs");
  breadcrumbs.setAttribute("aria-label", "現在の場所");
  breadcrumbs.append(button("本棚", () => openItem(null)));
  for (const parent of path.slice(0, -1)) {
    breadcrumbs.append(element("span", "›"), button(parent.title, () => openItem(parent.id)));
  }
  const header = element("header", undefined, "page-header");
  header.append(element("span", LABEL[depth], "eyebrow"), element("h2", node.title));
  const meta = element("p", summary(node, depth), "meta");
  header.append(meta);
  const actions = element("div", undefined, "actions");
  if (depth < 2) actions.append(button("＋ " + LABEL[depth + 1], () => titleDialog(item), "primary"));
  const copy = button(depth === 2 ? "本文をコピー" : LABEL[depth] + "をコピー", () => copyText(item));
  if (depth === 2) copy.disabled = !node.body.length;
  else copy.disabled = metrics(node).stories === 0;
  actions.append(copy);
  const random = button("ここからランダム", () => openRandom(node.id));
  if (depth < 2 && metrics(node).stories) actions.append(random);
  actions.append(button("整理", () => organize(item, siblings.indexOf(node))));
  header.append(actions);
  content.append(breadcrumbs, header);

  if (depth < 2) {
    if (node.children.length) content.append(cards(node.children, depth + 1));
    else content.append(element("p", "まだ" + LABEL[depth + 1] + "がありません。", "empty"));
    return;
  }
  const label = element("label", "本文", "editor-label");
  label.htmlFor = "body-input";
  const input = element("textarea");
  input.id = "body-input";
  input.placeholder = "ここに文章を貼り付けるか、直接入力できます。";
  input.value = node.body;
  const footer = element("div", undefined, "editor-footer");
  const status = element("span");
  status.id = "save-status";
  footer.append(status, element("span", "文字数は空白を含み、改行を除きます。"));
  content.append(label, input, footer);
  updateSaveStatus();
  input.addEventListener("input", () => {
    node.body = input.value;
    meta.textContent = summary(node, depth);
    copy.disabled = !node.body.length;
    save();
    if (search.value.trim()) renderShelf();
  });
}

function render() {
  renderShelf();
  content.replaceChildren();
  const item = entries().find(entry => entry.node.id === selection);
  if (item) renderItem(item);
  else renderHome();
}

function showDialog(title, ...children) {
  byId("dialog-title").textContent = title;
  dialogBody.replaceChildren(...children);
  if (!dialog.open) dialog.showModal();
}

function titleDialog(parent, editing) {
  const depth = editing ? editing.depth : parent ? parent.depth + 1 : 0;
  const form = element("form");
  const label = element("label", "タイトル");
  label.htmlFor = "item-title";
  const input = element("input");
  input.id = "item-title";
  input.required = true;
  input.value = editing?.node.title ?? "";
  input.addEventListener("input", () => input.setCustomValidity(""));
  const submit = element("button", editing ? "保存" : "作成", "primary");
  submit.type = "submit";
  const actions = element("div", undefined, "dialog-actions");
  actions.append(button("キャンセル", () => dialog.close()), submit);
  form.append(label, input, actions);
  form.addEventListener("submit", event => {
    event.preventDefault();
    const title = input.value.trim();
    if (!title) {
      input.setCustomValidity("タイトルを入力してください。");
      input.reportValidity();
      return;
    }
    let node = editing?.node;
    if (node) node.title = title;
    else {
      node = { id: crypto.randomUUID(), title };
      if (depth === 2) node.body = "";
      else node.children = [];
      (parent ? parent.node.children : shelf.series).push(node);
    }
    search.value = "";
    save();
    dialog.close();
    openItem(node.id);
  });
  showDialog(LABEL[depth] + (editing ? "の名前を変更" : "を作成"), form);
  input.focus();
  if (editing) input.select();
}

function organize(item, index) {
  const { node, depth, path, siblings } = item;
  function move(delta) {
    siblings.splice(index, 1);
    siblings.splice(index + delta, 0, node);
    save();
    dialog.close();
    openItem(node.id);
  }
  const up = button("前へ移動", () => move(-1));
  const down = button("後ろへ移動", () => move(1));
  up.disabled = index === 0;
  down.disabled = index === siblings.length - 1;
  const actions = element("div", undefined, "actions");
  actions.append(button("名前を変更", () => titleDialog(null, item)), up, down,
    button("削除…", () => {
      const descendants = metrics(node).stories;
      const details = depth < 2 && descendants ? "（中の" + number.format(descendants) + "話を含む）" : "";
      confirmAction("削除しますか？", "「" + node.title + "」" + details + "を削除します。", "削除", () => {
        siblings.splice(index, 1);
        save();
        openItem(path.at(-2)?.id ?? null);
      });
    }));
  showDialog(LABEL[depth] + "を整理", actions);
}

function confirmAction(title, description, actionLabel, action) {
  const actions = element("div", undefined, "dialog-actions");
  const cancel = button("キャンセル", () => dialog.close());
  actions.append(cancel, button(actionLabel, () => { dialog.close(); action(); }, "danger"));
  showDialog(title, element("p", description), actions);
  cancel.focus();
}

function clipboardContent(node, depth) {
  if (depth === 2) return node.body;
  function outline(part, level) {
    const heading = "#".repeat(level + 1) + " " + part.title;
    if (part.body !== undefined) return part.body ? heading + "\n\n" + part.body : heading;
    return [heading, ...part.children.map(child => outline(child, level + 1))].join("\n\n");
  }
  return outline(node, 0);
}

async function copyText({ node, depth }) {
  const value = clipboardContent(node, depth);
  try {
    await navigator.clipboard.writeText(value);
    toast(LABEL[depth] + "をコピーしました。");
  } catch {
    const field = element("textarea");
    field.rows = 10;
    field.readOnly = true;
    field.value = value;
    field.setAttribute("aria-label", "コピーする文章");
    showDialog("コピーする文章", element("p", "下の文章を選択してコピーできます。"), field);
    field.focus();
    field.select();
  }
}

function openRandom(scope) {
  const candidates = entries().filter(item => item.depth === 2 &&
    (!scope || item.path.some(node => node.id === scope)));
  if (!candidates.length) return;
  const alternatives = candidates.length > 1 ? candidates.filter(item => item.node.id !== selection) : candidates;
  openItem(alternatives[Math.floor(Math.random() * alternatives.length)].node.id);
}

function exportBackup() {
  const file = new Blob([JSON.stringify(shelf, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(file);
  const link = element("a");
  const today = new Date();
  const date = [today.getFullYear(), today.getMonth() + 1, today.getDate()].map(value => String(value).padStart(2, "0")).join("-");
  link.href = url;
  link.download = "kotonoha-backup-" + date + ".json";
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  dialog.close();
}

byId("backup").addEventListener("click", () => {
  const controls = element("div", undefined, "actions");
  controls.append(button("書き出す", exportBackup, "primary"), button("読み込む…", () => byId("import-file").click()));
  showDialog("バックアップ", element("p", "本棚のデータはこのブラウザに保存されます。別の端末やブラウザに移すときは、JSONを書き出して読み込んでください。"), controls);
});

byId("import-file").addEventListener("change", async event => {
  const file = event.target.files[0];
  event.target.value = "";
  if (!file) return;
  let restored;
  try {
    restored = parseShelf(await file.text());
  } catch {
    toast("本棚のバックアップとして読み込めませんでした。");
    return;
  }
  confirmAction("バックアップを読み込みますか？", "現在の本棚を、選んだファイルの内容に置き換えます。", "置き換える", () => {
    shelf = restored;
    expanded.clear();
    selection = null;
    search.value = "";
    save();
    render();
    if (!storageError) toast("バックアップを読み込みました。");
  });
});

byId("add-series").addEventListener("click", () => titleDialog());
byId("random").addEventListener("click", () => openRandom());
search.addEventListener("input", renderShelf);
render();
if (storageError) toast("保存済みの本棚を読み込めませんでした。");
