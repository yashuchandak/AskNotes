const state = {
  cards: [],
  deletedCards: [],
  trashSupported: false,
  user: null,
  view: "all",
  query: "",
  oldestFirst: false,
  loading: false,
  editingNoteId: null,
};

const elements = {
  authScreen: document.querySelector("#auth-screen"),
  appShell: document.querySelector("#app-shell"),
  authMessage: document.querySelector("#auth-message"),
  accountName: document.querySelector("#account-name"),
  form: document.querySelector("#ask-form"),
  question: document.querySelector("#question-input"),
  noteTitle: document.querySelector("#note-title-input"),
  saveNoteButton: document.querySelector("#save-note-button"),
  createAiButton: document.querySelector("#create-ai-button"),
  characterCount: document.querySelector("#character-count"),
  grid: document.querySelector("#board-grid"),
  empty: document.querySelector("#empty-state"),
  emptyTitle: document.querySelector("#empty-title"),
  emptyCopy: document.querySelector("#empty-copy"),
  boardTitle: document.querySelector("#board-title"),
  boardTitleCount: document.querySelector("#board-title-count"),
  allCount: document.querySelector("#all-count"),
  notesCount: document.querySelector("#notes-count"),
  answersCount: document.querySelector("#answers-count"),
  starCount: document.querySelector("#star-count"),
  savedCount: document.querySelector("#saved-label-count"),
  search: document.querySelector("#search-input"),
  toast: document.querySelector("#toast"),
  themeToggle: document.querySelector("#theme-toggle"),
  themeMenu: document.querySelector("#theme-menu"),
  sortLabel: document.querySelector("#sort-label"),
  noteEditor: document.querySelector("#note-editor"),
  noteEditorTitle: document.querySelector("#note-editor-title"),
  noteEditorForm: document.querySelector("#note-editor-form"),
  editNoteTitle: document.querySelector("#edit-note-title"),
  editNoteQuestion: document.querySelector("#edit-note-question"),
  editQuestionField: document.querySelector("#edit-question-field"),
  editNoteBodyLabel: document.querySelector("#edit-note-body-label"),
  editNoteBody: document.querySelector("#edit-note-body"),
  deletedCount: document.querySelector("#deleted-count"),
  reader: document.querySelector("#card-reader"),
  readerTitle: document.querySelector("#card-reader-title"),
  readerActions: document.querySelector("#reader-actions"),
  readerContent: document.querySelector("#card-reader-content"),
};

const icon = {
  star: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="m10 2.5 2.2 4.4 4.9.7-3.5 3.5.8 4.9-4.4-2.3-4.4 2.3.8-4.9L2.9 7.6l4.9-.7L10 2.5Z"/></svg>',
  trash: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3.5 5.5h13m-8.5 0V3.8h4v1.7m-6.5 0 .7 10.8h6.6l.7-10.8M8 8.2v5.3m4-5.3v5.3"/></svg>',
  edit: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="m12.8 3.2 4 4M4 16l3.3-.7L16 6.6a1.8 1.8 0 0 0-2.6-2.6L4.7 12.7 4 16Z"/><path d="M10.5 16.5h5"/></svg>',
  restore: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4.2 8.2A6.3 6.3 0 1 1 4 11M4.2 4.5v3.9h3.9"/><path d="M10 6.5v4l2.7 1.6"/></svg>',
};

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function tell(message, isError = false) {
  elements.toast.textContent = message;
  elements.toast.classList.toggle("error", isError);
  elements.toast.classList.add("visible");
  clearTimeout(tell.timeout);
  tell.timeout = setTimeout(() => elements.toast.classList.remove("visible"), 3400);
}

function showSignIn(message = "") {
  elements.authScreen.hidden = false;
  elements.appShell.hidden = true;
  elements.authMessage.textContent = message;
  const googleConfig = document.querySelector("#g_id_onload");
  const button = document.querySelector(".google-button-wrap");
  if (!googleConfig?.getAttribute("data-client_id")?.trim()) {
    button.hidden = true;
    elements.authMessage.textContent = "Add GOOGLE_CLIENT_ID to your .env file, then restart AskNotes.";
  } else {
    button.hidden = false;
  }
}

function showBoard(user) {
  state.user = user;
  elements.authScreen.hidden = true;
  elements.appShell.hidden = false;
  elements.accountName.textContent = user.email || user.name || "Google account";
  elements.accountName.title = user.email && user.name ? `${user.name} (${user.email})` : elements.accountName.textContent;
}

async function request(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "That didn’t work. Please try again.");
  return result;
}

function toneFor(card, index) {
  const tones = ["#8a68f0", "#239f86", "#e59b2d", "#3982d1", "#df5d7e"];
  const seed = `${card.id || ""}${card.title || ""}`;
  let total = index;
  for (let i = 0; i < seed.length; i += 1) total += seed.charCodeAt(i);
  return tones[total % tones.length];
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "JUST NOW";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
    .format(date).replace(",", " ·").toUpperCase();
}

function renderCard(card, index) {
  const tone = toneFor(card, index);
  const isNote = card.type === "note";
  const isDeleted = Boolean(card.deletedAt);
  const readingText = isNote ? card.body : `${card.question || ""} ${card.answer || ""}`;
  const readingMinutes = Math.max(1, Math.ceil((String(readingText || "").split(/\s+/).filter(Boolean).length || 1) / 150));
  const title = isNote ? card.title || "Quick note" : card.question || card.title || "AI note";
  const content = isNote
    ? `<p class="note-body">${escapeHtml(card.body || "")}</p>`
    : `<p class="answer-copy">${escapeHtml(card.answer || "")}</p>`;
  return `<article class="question-card" data-id="${escapeHtml(card.id)}" tabindex="0" role="group" aria-label="${escapeHtml(title)}. Press Enter or Space to open note." style="--tone:${tone}">
    <span class="card-accent"></span>
    <div class="card-meta"><span class="card-meta-left"><span class="card-meta-dot"></span>${isDeleted ? "DELETED" : isNote ? "MY NOTE" : "AI NOTE"} · ${escapeHtml(formatDate(isDeleted ? card.deletedAt : card.updatedAt || card.createdAt))}</span>
      <span class="card-tools">
        ${isDeleted
          ? `<button type="button" class="icon-button" data-action="restore" aria-label="Restore this item" title="Restore item">${icon.restore}</button><button type="button" class="icon-button danger" data-action="permanent-delete" aria-label="Permanently delete this item" title="Delete permanently">${icon.trash}</button>`
          : `<button type="button" class="icon-button" data-action="edit" aria-label="Edit ${isNote ? "note" : "AI note"}" title="Edit ${isNote ? "note" : "AI note"}">${icon.edit}</button><button type="button" class="icon-button favorite ${card.favorite ? "is-favorite" : ""}" data-action="favorite" aria-label="${card.favorite ? "Remove from starred" : "Add to starred"}" title="${card.favorite ? "Remove from starred" : "Star this card"}">${icon.star}</button><button type="button" class="icon-button" data-action="delete" aria-label="Move this item to Deleted" title="${state.trashSupported ? "Move to Deleted" : "Restart AskNotes to enable Deleted"}" ${state.trashSupported ? "" : "disabled"}>${icon.trash}</button>`}
      </span>
    </div>
    <h3>${escapeHtml(title)}</h3>
    ${content}
    <div class="card-footer"><span class="card-reading-time">${readingMinutes} min read</span></div>
  </article>`;
}

function renderReaderActions(card) {
  if (card.deletedAt) {
    elements.readerActions.innerHTML = `<button type="button" class="icon-button" data-action="restore" aria-label="Restore this item" title="Restore item">${icon.restore}</button><button type="button" class="icon-button danger" data-action="permanent-delete" aria-label="Permanently delete this item" title="Delete permanently">${icon.trash}</button>`;
    return;
  }
  elements.readerActions.innerHTML = `<button type="button" class="icon-button" data-action="edit" aria-label="Edit ${card.type === "note" ? "note" : "AI note"}" title="Edit ${card.type === "note" ? "note" : "AI note"}">${icon.edit}</button><button type="button" class="icon-button favorite ${card.favorite ? "is-favorite" : ""}" data-action="favorite" aria-label="${card.favorite ? "Remove from starred" : "Add to starred"}" title="${card.favorite ? "Remove from starred" : "Star this note"}">${icon.star}</button><button type="button" class="icon-button danger" data-action="delete" aria-label="Move this item to Deleted" title="${state.trashSupported ? "Move to Deleted" : "Restart AskNotes to enable Deleted"}" ${state.trashSupported ? "" : "disabled"}>${icon.trash}</button>`;
}

function openReader(card) {
  const isNote = card.type === "note";
  elements.readerTitle.textContent = isNote ? card.title || "Quick note" : card.question || card.title || "AI note";
  elements.readerContent.innerHTML = isNote
    ? `<p class="reader-text">${escapeHtml(card.body || "")}</p>`
    : `<p class="reader-text">${escapeHtml(card.answer || "")}</p>`;
  elements.reader.dataset.cardId = card.id;
  renderReaderActions(card);
  elements.reader.showModal();
}

function renderLoadingCard() {
  return `<article class="question-card skeleton" aria-label="Preparing your AI note" style="--tone:#b8a8e9">
    <span class="card-accent"></span><div class="card-meta"><span class="loading-label">PREPARING YOUR AI NOTE</span><span aria-hidden="true">✦</span></div>
    <div class="skeleton-line medium"></div><div class="skeleton-line short"></div><div class="skeleton-answer"></div>
  </article>`;
}

function visibleCards() {
  let cards = [...(state.view === "deleted" ? state.deletedCards : state.cards)];
  if (state.view === "notes") cards = cards.filter((card) => card.type === "note");
  if (state.view === "answers") cards = cards.filter((card) => card.type !== "note");
  if (state.view === "starred") cards = cards.filter((card) => card.favorite);
  if (state.query) {
    const query = state.query.toLowerCase();
    cards = cards.filter((card) => `${card.question || ""} ${card.title || ""} ${card.answer || ""} ${card.body || ""}`.toLowerCase().includes(query));
  }
  cards.sort((a, b) => {
    const direction = state.oldestFirst ? 1 : -1;
    const dateA = state.view === "deleted" ? a.deletedAt || a.createdAt : a.createdAt;
    const dateB = state.view === "deleted" ? b.deletedAt || b.createdAt : b.createdAt;
    return direction * (new Date(dateA || 0) - new Date(dateB || 0));
  });
  return cards;
}

function updateCounts() {
  const starred = state.cards.filter((card) => card.favorite).length;
  const notes = state.cards.filter((card) => card.type === "note").length;
  const answers = state.cards.length - notes;
  elements.allCount.textContent = state.cards.length;
  elements.notesCount.textContent = notes;
  elements.answersCount.textContent = answers;
  elements.starCount.textContent = starred;
  elements.deletedCount.textContent = state.deletedCards.length;
  elements.savedCount.textContent = `${state.cards.length} ${state.cards.length === 1 ? "item" : "items"} saved`;
}

function render() {
  updateCounts();
  const cards = visibleCards();
  const heading = ({ all: "All items", notes: "My notes", answers: "AI notes", starred: "Starred", deleted: "Deleted" })[state.view] || "All items";
  elements.boardTitle.firstChild.textContent = `${heading} `;
  elements.boardTitleCount.textContent = String(cards.length);
  const fragments = [];
  if (state.loading) fragments.push(renderLoadingCard());
  fragments.push(...cards.map(renderCard));
  elements.grid.innerHTML = fragments.length ? fragments.join("") : "";
  elements.grid.setAttribute("aria-busy", String(state.loading));
  elements.empty.hidden = fragments.length > 0;
  if (cards.length === 0 && !state.loading) {
    if (state.query) {
      elements.emptyTitle.textContent = "No matches just yet.";
      elements.emptyCopy.textContent = "Try another word or a shorter search to find the note you’re looking for.";
      document.querySelector("#empty-ask").hidden = true;
    } else if (state.view === "deleted") {
      elements.emptyTitle.textContent = "Nothing in Deleted.";
      elements.emptyCopy.textContent = "Items you move here will stay available until you delete them permanently.";
      document.querySelector("#empty-ask").hidden = true;
    } else if (state.view === "starred") {
      elements.emptyTitle.textContent = "Keep your favorites close.";
      elements.emptyCopy.textContent = "Star any note or AI note and it’ll be waiting here.";
      document.querySelector("#empty-ask").hidden = true;
    } else if (state.view === "notes") {
      elements.emptyTitle.textContent = "A place for your own thoughts.";
      elements.emptyCopy.textContent = "Write a quick note and keep it close to the AI notes you collect.";
      const emptyButton = document.querySelector("#empty-ask");
      emptyButton.hidden = false;
      emptyButton.dataset.compose = "note";
      emptyButton.innerHTML = 'Write your first note <span aria-hidden="true">↑</span>';
    } else if (state.view === "answers") {
      elements.emptyTitle.textContent = "Curiosity starts with an idea.";
      elements.emptyCopy.textContent = "Enter a topic or question and save the AI note here.";
      const emptyButton = document.querySelector("#empty-ask");
      emptyButton.hidden = false;
      emptyButton.dataset.compose = "ask";
      emptyButton.innerHTML = 'Create your first AI note <span aria-hidden="true">↑</span>';
    } else {
      elements.emptyTitle.textContent = "A fresh page, full of possibility.";
      elements.emptyCopy.textContent = "Write a note or use AI to explore a topic. Your first card will be waiting here when you come back.";
      const emptyButton = document.querySelector("#empty-ask");
      emptyButton.hidden = false;
      emptyButton.dataset.compose = "note";
      emptyButton.innerHTML = 'Write your first note <span aria-hidden="true">↑</span>';
    }
  }
}

function setView(view) {
  state.view = view;
  document.querySelectorAll(".nav-link[data-view]").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
  render();
}

function setCreateControlsDisabled(disabled) {
  document.querySelectorAll("#save-note-button, #create-ai-button, .suggestion-chip").forEach((button) => {
    button.disabled = disabled;
  });
}

function focusComposer() {
  document.querySelector("#composer").scrollIntoView({ behavior: "smooth", block: "center" });
  elements.noteTitle.focus();
}

async function loadCards() {
  try {
    const [cards, deletedCards, capabilities] = await Promise.all([
      request("/api/cards"),
      request("/api/cards?view=deleted"),
      request("/api/capabilities").catch(() => ({})),
    ]);
    state.cards = Array.isArray(cards) ? cards : [];
    const deletedList = Array.isArray(deletedCards) ? deletedCards : [];
    state.deletedCards = deletedList.filter((card) => Boolean(card.deletedAt));
    state.trashSupported = capabilities.trash === true && deletedList.every((card) => Boolean(card.deletedAt));
    if (!state.trashSupported) tell("Restart AskNotes to enable Deleted. Your current server is still running the older version.", true);
  } catch (error) {
    tell(error.message, true);
  }
  render();
}

async function initializeApp() {
  const params = new URLSearchParams(window.location.search);
  const loginError = params.get("login_error");
  if (loginError) window.history.replaceState({}, "", window.location.pathname);

  try {
    const session = await request("/api/auth/me");
    if (session.user) {
      showBoard(session.user);
      await loadCards();
      return;
    }
    const messages = {
      "not-configured": "Google sign-in is not configured yet. Add GOOGLE_CLIENT_ID to .env and restart AskNotes.",
      "request-rejected": "Google sign-in was rejected. Please try again.",
      "verification-failed": "Google could not verify that sign-in. Please try again.",
    };
    showSignIn(messages[loginError] || "");
  } catch {
    showSignIn("AskNotes could not reach its server. Start it with npm start, then reload this page.");
  }
}

async function askQuestion(question) {
  if (state.loading) return;
  state.view = "all";
  document.querySelectorAll(".nav-link[data-view]").forEach((button) => button.classList.toggle("active", button.dataset.view === "all"));
  state.loading = true;
  setCreateControlsDisabled(true);
  elements.createAiButton.disabled = true;
  elements.createAiButton.textContent = "Thinking…";
  elements.grid.scrollIntoView({ behavior: "smooth", block: "nearest" });
  render();
  try {
    const card = await request("/api/ask", { method: "POST", body: JSON.stringify({ question }) });
    state.cards.unshift(card);
    state.view = "all";
    document.querySelectorAll(".nav-link[data-view]").forEach((button) => button.classList.toggle("active", button.dataset.view === "all"));
    state.query = "";
    elements.search.value = "";
    elements.noteTitle.value = "";
    elements.question.value = "";
    elements.characterCount.textContent = "0 / 5,000";
    tell("Your AI note is saved to your library.");
  } catch (error) {
    tell(error.message, true);
  } finally {
    state.loading = false;
    setCreateControlsDisabled(false);
    elements.createAiButton.disabled = false;
    elements.createAiButton.textContent = "Create AI Note";
    render();
  }
}

async function saveNote(title, body) {
  if (state.loading) return;
  state.loading = true;
  setCreateControlsDisabled(true);
  elements.saveNoteButton.disabled = true;
  elements.saveNoteButton.textContent = "Saving…";
  try {
    const card = await request("/api/notes", { method: "POST", body: JSON.stringify({ title, body }) });
    state.cards.unshift(card);
    state.view = "all";
    document.querySelectorAll(".nav-link[data-view]").forEach((button) => button.classList.toggle("active", button.dataset.view === "all"));
    state.query = "";
    elements.search.value = "";
    elements.noteTitle.value = "";
    elements.question.value = "";
    elements.characterCount.textContent = "0 / 5,000";
    tell("Your note is saved to your library.");
  } catch (error) {
    tell(error.message, true);
  } finally {
    state.loading = false;
    setCreateControlsDisabled(false);
    elements.saveNoteButton.disabled = false;
    elements.saveNoteButton.textContent = "Save Note";
    render();
  }
}

elements.form.addEventListener("submit", (event) => {
  event.preventDefault();
  const action = event.submitter?.value;
  const title = elements.noteTitle.value.trim();
  const body = elements.question.value.trim();
  if (action === "ai") {
    if (!title) {
      elements.noteTitle.focus();
      return tell("Add a title or topic for your AI note.", true);
    }
    if (title.length > 500) return tell("Keep your prompt under 500 characters.", true);
    askQuestion(title);
    return;
  }
  if (!title) {
    elements.noteTitle.focus();
    return tell("Add a title for your note.", true);
  }
  if (title.length > 120) return tell("Keep the title under 120 characters.", true);
  if (!body) {
    elements.question.focus();
    return tell("Add some note text before saving.", true);
  }
  if (body.length > 5000) return tell("Keep your note under 5,000 characters.", true);
  saveNote(title, body);
});

elements.question.addEventListener("input", () => {
  elements.characterCount.textContent = `${elements.question.value.length} / 5,000`;
});

document.querySelectorAll(".nav-link[data-view]").forEach((button) => {
  button.addEventListener("click", () => setView(button.dataset.view));
});

document.querySelectorAll(".suggestion-chip").forEach((button) => {
  button.addEventListener("click", () => {
    elements.noteTitle.value = button.dataset.question;
    elements.noteTitle.focus();
  });
});

document.querySelector("#empty-ask").addEventListener("click", (event) => {
  event.preventDefault();
  focusComposer();
});

document.querySelector("#close-note-editor").addEventListener("click", () => elements.noteEditor.close());
document.querySelector("#cancel-note-edit").addEventListener("click", () => elements.noteEditor.close());
elements.noteEditor.addEventListener("click", (event) => {
  if (event.target === elements.noteEditor) elements.noteEditor.close();
});

document.querySelector("#close-card-reader").addEventListener("click", () => elements.reader.close());
elements.reader.addEventListener("click", (event) => {
  if (event.target === elements.reader) elements.reader.close();
});

elements.noteEditorForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const card = state.cards.find((item) => item.id === state.editingNoteId);
  if (!card) return elements.noteEditor.close();
  const saveButton = elements.noteEditorForm.querySelector("button[type=submit]");
  saveButton.disabled = true;
  const isNote = card.type === "note";
  const changes = isNote
    ? { title: elements.editNoteTitle.value, body: elements.editNoteBody.value }
    : { question: elements.editNoteQuestion.value, answer: elements.editNoteBody.value };
  try {
    const updated = await request(`/api/cards/${encodeURIComponent(card.id)}`, {
      method: "PATCH",
      body: JSON.stringify(changes),
    });
    Object.assign(card, updated);
    elements.noteEditor.close();
    render();
    tell(isNote ? "Note updated." : "AI note updated.");
  } catch (error) {
    tell(error.message, true);
  } finally {
    saveButton.disabled = false;
  }
});

elements.search.addEventListener("input", () => {
  state.query = elements.search.value.trim();
  render();
});

document.querySelector("#sort-button").addEventListener("click", () => {
  state.oldestFirst = !state.oldestFirst;
  elements.sortLabel.textContent = state.oldestFirst ? "Oldest first" : "Newest first";
  render();
});

document.querySelector("#sign-out").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  try {
    await request("/api/auth/logout", { method: "POST" });
    state.cards = [];
    state.deletedCards = [];
    state.user = null;
    showSignIn("You’ve signed out.");
  } catch (error) {
    tell(error.message, true);
  } finally {
    button.disabled = false;
  }
});

async function handleCardAction(button, card, fromReader = false) {
  const action = button.dataset.action;
  if (action === "read") {
    openReader(card);
    return;
  }
  if (action === "edit" && !card.deletedAt) {
    if (fromReader) elements.reader.close();
    state.editingNoteId = card.id;
    elements.editNoteTitle.value = card.title || "";
    const isNote = card.type === "note";
    elements.editNoteTitle.hidden = !isNote;
    elements.noteEditorTitle.textContent = isNote ? "Edit note" : "Edit AI note";
    elements.editQuestionField.hidden = isNote;
    elements.editNoteQuestion.required = !isNote;
    elements.editNoteQuestion.value = card.question || "";
    elements.editNoteBodyLabel.textContent = isNote ? "Note text" : "AI note text";
    elements.editNoteBody.placeholder = isNote ? "Write your note…" : "Write the AI note…";
    elements.editNoteBody.value = isNote ? card.body || "" : card.answer || "";
    elements.noteEditor.showModal();
    (isNote ? elements.editNoteTitle : elements.editNoteBody).focus();
    return;
  }
  if (action === "favorite" && !card.deletedAt) {
    const previous = card.favorite;
    card.favorite = !previous;
    render();
    if (fromReader) renderReaderActions(card);
    try {
      await request(`/api/cards/${encodeURIComponent(card.id)}`, { method: "PATCH", body: JSON.stringify({ favorite: card.favorite }) });
    } catch (error) {
      card.favorite = previous;
      render();
      if (fromReader) renderReaderActions(card);
      tell(error.message, true);
    }
    return;
  }
  if (action === "delete" && !card.deletedAt) {
    if (!state.trashSupported) {
      tell("Restart AskNotes to enable Deleted before removing items.", true);
      return;
    }
    if (!window.confirm(`Move this ${card.type === "note" ? "note" : "AI note"} to Deleted? You can restore it later.`)) return;
    button.disabled = true;
    try {
      const deleted = await request(`/api/cards/${encodeURIComponent(card.id)}`, { method: "DELETE" });
      state.cards = state.cards.filter((item) => item.id !== card.id);
      state.deletedCards.unshift(deleted);
      if (fromReader) elements.reader.close();
      render();
      tell("Moved to Deleted. You can restore it anytime.");
    } catch (error) {
      button.disabled = false;
      tell(error.message, true);
    }
    return;
  }
  if (action === "restore" && card.deletedAt) {
    button.disabled = true;
    try {
      const restored = await request(`/api/cards/${encodeURIComponent(card.id)}/restore`, { method: "POST" });
      state.deletedCards = state.deletedCards.filter((item) => item.id !== card.id);
      state.cards.unshift(restored);
      if (fromReader) elements.reader.close();
      render();
      tell("Item restored to your library.");
    } catch (error) {
      button.disabled = false;
      tell(error.message, true);
    }
    return;
  }
  if (action === "permanent-delete" && card.deletedAt) {
    if (!window.confirm(`Permanently delete this ${card.type === "note" ? "note" : "AI note"}? This can’t be undone.`)) return;
    button.disabled = true;
    try {
      await request(`/api/cards/${encodeURIComponent(card.id)}/permanent`, { method: "DELETE" });
      state.deletedCards = state.deletedCards.filter((item) => item.id !== card.id);
      if (fromReader) elements.reader.close();
      render();
      tell("Item permanently deleted.");
    } catch (error) {
      button.disabled = false;
      tell(error.message, true);
    }
  }
}

elements.grid.addEventListener("click", async (event) => {
  const cardElement = event.target.closest(".question-card[data-id]");
  if (!cardElement) return;
  const cards = state.view === "deleted" ? state.deletedCards : state.cards;
  const card = cards.find((item) => item.id === cardElement.dataset.id);
  if (!card) return;
  const button = event.target.closest("button[data-action]");
  if (button) {
    await handleCardAction(button, card);
    return;
  }
  openReader(card);
});

elements.grid.addEventListener("keydown", (event) => {
  if (!["Enter", " "].includes(event.key) || event.target.closest("button")) return;
  const cardElement = event.target.closest(".question-card[data-id]");
  if (!cardElement) return;
  const cards = state.view === "deleted" ? state.deletedCards : state.cards;
  const card = cards.find((item) => item.id === cardElement.dataset.id);
  if (!card) return;
  event.preventDefault();
  openReader(card);
});

elements.readerActions.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const cardId = elements.reader.dataset.cardId;
  const card = [...state.cards, ...state.deletedCards].find((item) => item.id === cardId);
  if (card) await handleCardAction(button, card, true);
});

document.addEventListener("keydown", (event) => {
  if (event.key === "/" && !["INPUT", "TEXTAREA"].includes(document.activeElement.tagName)) {
    event.preventDefault();
    elements.search.focus();
  }
});

function applyTheme(theme) {
  const allowedThemes = ["lavender", "ocean", "forest", "sky", "sand", "graphite", "deep-ocean", "night-garden"];
  const selected = allowedThemes.includes(theme) ? theme : "lavender";
  document.documentElement.dataset.theme = selected;
  if (theme !== selected) {
    try { localStorage.setItem("qnotes-theme", selected); } catch {}
  }
  document.querySelectorAll("[data-theme-choice]").forEach((option) => {
    const active = option.dataset.themeChoice === selected;
    option.classList.toggle("selected", active);
    option.setAttribute("aria-pressed", String(active));
  });
}

let savedTheme = "lavender";
try {
  savedTheme = localStorage.getItem("qnotes-theme") || "lavender";
} catch {}
applyTheme(savedTheme);
elements.themeToggle.addEventListener("click", () => {
  const open = elements.themeMenu.hidden;
  elements.themeMenu.hidden = !open;
  elements.themeToggle.setAttribute("aria-expanded", String(open));
});
elements.themeMenu.addEventListener("click", (event) => {
  const option = event.target.closest("[data-theme-choice]");
  if (!option) return;
  const selected = option.dataset.themeChoice;
  try { localStorage.setItem("qnotes-theme", selected); } catch {}
  applyTheme(selected);
  elements.themeMenu.hidden = true;
  elements.themeToggle.setAttribute("aria-expanded", "false");
});
document.addEventListener("click", (event) => {
  if (!event.target.closest(".theme-picker-wrap")) {
    elements.themeMenu.hidden = true;
    elements.themeToggle.setAttribute("aria-expanded", "false");
  }
});

initializeApp();
