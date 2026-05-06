import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";

import {
  getAuth,
  signInAnonymously,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";

import {
  getFirestore,
  collection,
  doc,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  getDocs,
  onSnapshot,
  query,
  where,
  serverTimestamp,
  Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

import {
  getMessaging,
  getToken,
  onMessage
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-messaging.js";

/*
  STEP 1:
  Replace this firebaseConfig object with your own Firebase web app config.

  Firebase Console:
  Project settings → General → Your apps → Web app → SDK setup and configuration
*/
const firebaseConfig = {
  apiKey: "AIzaSyAJE2xBl6UnRVhoPdcVAG1yfEiTvy3KPUU",
  authDomain: "blab-fe07e.firebaseapp.com",
  projectId: "blab-fe07e",
  storageBucket: "blab-fe07e.firebasestorage.app",
  messagingSenderId: "1025826311559",
  appId: "1:1025826311559:web:cd10334e5bc941d4139722",
  measurementId: "G-1JJHW4KS9K"
};

/*
  STEP 2:
  Change these before sharing BLAB with your lab.
  This is a convenience gate, not high-security authentication.
*/
const LAB_ACCESS_CODE = "blab2026";
const ADMIN_CODE = "adminblab";

/*
  STEP 3:
  For push reminders, paste your Firebase Web Push certificate key here.
  Firebase Console → Project settings → Cloud Messaging → Web Push certificates.
*/
const PUBLIC_VAPID_KEY = "PASTE_YOUR_PUBLIC_VAPID_KEY_HERE";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

let messaging = null;
try {
  messaging = getMessaging(app);
} catch (error) {
  console.warn("Messaging not available in this browser.", error);
}

let currentUser = null;
let currentProfile = null;
let isAdminUnlocked = localStorage.getItem("blabAdminUnlocked") === "true";

let bookings = [];
let projects = [];
let projectNotes = [];
let currentEditingNoteId = null;
let tasks = [];
let orders = [];
let reminderTimer = null;

const LOCAL_REMINDERS_KEY = "blabLocalRemindersEnabled";
const SHOWN_REMINDERS_KEY = "blabShownInAppRemindersV1";

const instrumentGroups = {
  Hotplate: [
    { id: "hotplate-1", name: "Hotplate 1" },
    { id: "hotplate-2", name: "Hotplate 2" },
    { id: "hotplate-3", name: "Hotplate 3" }
  ],
  Furnace: [
    { id: "furnace-1", name: "Furnace 1" },
    { id: "tube-furnace", name: "Tube Furnace" },
    { id: "muffle-furnace", name: "Muffle Furnace" }
  ],
  Centrifuge: [
    { id: "centrifuge-1", name: "Centrifuge 1" },
    { id: "centrifuge-2", name: "Centrifuge 2" },
    { id: "mini-centrifuge", name: "Mini Centrifuge" }
  ]
};

const $ = id => document.getElementById(id);

document.querySelectorAll(".nav-btn").forEach(button => {
  button.addEventListener("click", () => {
    showPage(button.dataset.page, button);
  });
});

$("enterAppBtn").addEventListener("click", enterApp);
$("enableNotificationsBtn").addEventListener("click", enablePushNotifications);
$("instrumentCategory").addEventListener("change", updateInstrumentOptions);
$("bookInstrumentBtn").addEventListener("click", addBooking);
$("addProjectBtn").addEventListener("click", addProject);
$("projectStatusFilter").addEventListener("change", renderProjects);
$("noteProjectSelect").addEventListener("change", () => { clearProjectNoteEditor(false); renderProjectNotes(); });
$("saveProjectNoteBtn").addEventListener("click", saveProjectNote);
$("clearNoteEditorBtn").addEventListener("click", () => clearProjectNoteEditor(true));
$("exportSelectedNotePdfBtn").addEventListener("click", exportEditingNotePdf);
$("exportSelectedNotePngBtn").addEventListener("click", exportEditingNotePng);
$("exportProjectPdfBtn").addEventListener("click", exportSelectedProjectNotesPdf);
$("exportProjectPngBtn").addEventListener("click", exportSelectedProjectNotesPng);
$("addTaskBtn").addEventListener("click", addTask);
$("addOrderBtn").addEventListener("click", addOrder);
$("unlockAdminBtn").addEventListener("click", unlockAdmin);
$("lockAdminBtn").addEventListener("click", lockAdmin);

updateInstrumentOptions();
boot();

async function boot() {
  onAuthStateChanged(auth, async user => {
    currentUser = user;

    if (!user) {
      await signInAnonymously(auth);
      return;
    }

    const savedName = localStorage.getItem("blabName");
    const savedCodeOk = localStorage.getItem("blabCodeOk") === "true";

    if (savedName && savedCodeOk) {
      currentProfile = {
        uid: user.uid,
        name: savedName
      };

      await saveUserProfile();
      openApp();
      subscribeToData();
    }
  });
}

async function enterApp() {
  const name = $("setupName").value.trim();
  const code = $("setupCode").value.trim();

  if (!name) {
    alert("Please enter your name.");
    return;
  }

  if (code !== LAB_ACCESS_CODE) {
    alert("Incorrect lab access code.");
    return;
  }

  if (!currentUser) {
    await signInAnonymously(auth);
  }

  localStorage.setItem("blabName", name);
  localStorage.setItem("blabCodeOk", "true");

  currentProfile = {
    uid: auth.currentUser.uid,
    name
  };

  await saveUserProfile();
  openApp();
  subscribeToData();
}

async function saveUserProfile() {
  if (!currentUser || !currentProfile) return;

  await setDoc(
    doc(db, "users", currentUser.uid),
    {
      name: currentProfile.name,
      updatedAt: serverTimestamp()
    },
    { merge: true }
  );
}

function openApp() {
  $("setupCard").classList.add("hidden");
  $("appShell").classList.remove("hidden");
  $("currentUserText").textContent = currentProfile.name;
  renderAll();
  startInAppReminderChecker();
}

function showPage(pageId, button) {
  document.querySelectorAll(".page").forEach(page => page.classList.remove("active"));
  $(pageId).classList.add("active");

  document.querySelectorAll(".nav-btn").forEach(btn => btn.classList.remove("active"));
  button.classList.add("active");
}

function subscribeToData() {
  onSnapshot(collection(db, "bookings"), snapshot => {
    bookings = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    renderAll();
  });

  onSnapshot(collection(db, "projects"), snapshot => {
    projects = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    renderAll();
  });

  onSnapshot(collection(db, "projectNotes"), snapshot => {
    projectNotes = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    renderAll();
  });

  onSnapshot(collection(db, "tasks"), snapshot => {
    tasks = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    renderAll();
  });

  onSnapshot(collection(db, "orders"), snapshot => {
    orders = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    renderAll();
  });
}

function updateInstrumentOptions() {
  const category = $("instrumentCategory").value;
  const instruments = instrumentGroups[category] || [];

  $("instrumentSelect").innerHTML = instruments.map(instrument => {
    return `<option value="${instrument.id}">${escapeHTML(instrument.name)}</option>`;
  }).join("");
}

async function addBooking() {
  const category = $("instrumentCategory").value;
  const instrumentId = $("instrumentSelect").value;
  const instrumentName = $("instrumentSelect").selectedOptions[0].textContent;
  const startValue = $("startTime").value;
  const endValue = $("endTime").value;
  const reminderMinutes = Number($("reminderMinutes").value);

  if (!startValue || !endValue) {
    alert("Please select From and To times.");
    return;
  }

  const start = new Date(startValue);
  const end = new Date(endValue);

  if (end <= start) {
    alert("To time must be after From time.");
    return;
  }

  const conflict = await hasBookingConflict(instrumentId, start, end);

  if (conflict) {
    $("bookingMessage").innerHTML = `
      <div class="item">
        <span class="badge danger">Conflict</span>
        <p>This instrument is already booked during that time.</p>
      </div>
    `;
    return;
  }

  await addDoc(collection(db, "bookings"), {
    category,
    instrumentId,
    instrumentName,
    userId: currentUser.uid,
    userName: currentProfile.name,
    startTime: Timestamp.fromDate(start),
    endTime: Timestamp.fromDate(end),
    reminderMinutes,
    reminderSent: false,
    overdueReminderSent: false,
    status: "active",
    createdAt: serverTimestamp()
  });

  $("startTime").value = "";
  $("endTime").value = "";
  $("reminderMinutes").value = "60";

  $("bookingMessage").innerHTML = `
    <div class="item">
      <span class="badge success">Saved</span>
      <p>Booking added.</p>
    </div>
  `;
}

async function hasBookingConflict(instrumentId, newStart, newEnd) {
  const q = query(
    collection(db, "bookings"),
    where("instrumentId", "==", instrumentId),
    where("status", "==", "active")
  );

  const snapshot = await getDocs(q);

  let conflict = false;

  snapshot.forEach(docSnap => {
    const booking = docSnap.data();

    const existingStart = booking.startTime.toDate();
    const existingEnd = booking.endTime.toDate();

    if (newStart < existingEnd && newEnd > existingStart) {
      conflict = true;
    }
  });

  return conflict;
}

async function markBookingFinished(id) {
  await updateDoc(doc(db, "bookings", id), {
    status: "finished",
    finishedAt: serverTimestamp()
  });
}

async function deleteBooking(id) {
  if (!isAdmin()) {
    alert("Admin only.");
    return;
  }

  if (!confirm("Delete this booking?")) return;

  await deleteDoc(doc(db, "bookings", id));
}

async function addProject() {
  const title = $("projectTitle").value.trim();
  const ownerName = $("projectOwner").value.trim() || currentProfile.name;
  const status = $("projectStatus").value;
  const goal = $("projectGoal").value.trim();
  const progress = $("projectProgress").value.trim();
  const nextStep = $("projectNextStep").value.trim();
  const targetDate = $("projectTargetDate").value;

  if (!title) {
    alert("Please enter a project title.");
    return;
  }

  await addDoc(collection(db, "projects"), {
    title,
    ownerId: currentUser.uid,
    ownerName,
    status,
    goal,
    progress,
    nextStep,
    targetDate,
    createdBy: currentUser.uid,
    createdByName: currentProfile.name,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });

  $("projectTitle").value = "";
  $("projectOwner").value = "";
  $("projectStatus").value = "Active";
  $("projectGoal").value = "";
  $("projectProgress").value = "";
  $("projectNextStep").value = "";
  $("projectTargetDate").value = "";
}

async function updateProjectProgress(id) {
  const project = projects.find(item => item.id === id);
  if (!project) return;

  const progress = prompt("Update project progress:", project.progress || "");
  if (progress === null) return;

  const nextStep = prompt("Update next step:", project.nextStep || "");
  if (nextStep === null) return;

  await updateDoc(doc(db, "projects", id), {
    progress: progress.trim(),
    nextStep: nextStep.trim(),
    updatedAt: serverTimestamp(),
    lastUpdatedBy: currentProfile.name
  });
}

async function updateProjectStatus(id, status) {
  await updateDoc(doc(db, "projects", id), {
    status,
    updatedAt: serverTimestamp(),
    lastUpdatedBy: currentProfile.name
  });
}

async function deleteProject(id) {
  const project = projects.find(item => item.id === id);

  if (!project) return;

  const isOwner = project.createdBy === currentUser.uid || project.ownerId === currentUser.uid;

  if (!isAdmin() && !isOwner) {
    alert("Only the project owner or admin can delete this project.");
    return;
  }

  if (!confirm("Delete this project?")) return;

  await deleteDoc(doc(db, "projects", id));
}


async function saveProjectNote() {
  const projectId = $("noteProjectSelect").value;
  const title = $("projectNoteTitle").value.trim();
  const text = $("projectNoteText").value.trim();

  if (!projectId) {
    alert("Please select a project first.");
    return;
  }

  if (!title) {
    alert("Please enter a note/file title, for example Week 1.");
    return;
  }

  if (!text) {
    alert("Please write something in the note before saving.");
    return;
  }

  const project = projects.find(item => item.id === projectId);

  if (currentEditingNoteId) {
    await updateDoc(doc(db, "projectNotes", currentEditingNoteId), {
      title,
      text,
      updatedAt: serverTimestamp(),
      lastEditedById: currentUser.uid,
      lastEditedByName: currentProfile.name
    });
  } else {
    const newDoc = await addDoc(collection(db, "projectNotes"), {
      projectId,
      projectTitle: project?.title || "Untitled project",
      title,
      text,
      authorId: currentUser.uid,
      authorName: currentProfile.name,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      lastEditedById: currentUser.uid,
      lastEditedByName: currentProfile.name
    });

    currentEditingNoteId = newDoc.id;
  }

  await updateDoc(doc(db, "projects", projectId), {
    progress: text.slice(0, 500),
    updatedAt: serverTimestamp(),
    lastUpdatedBy: currentProfile.name
  });

  setEditingStatus();
  renderProjectNotes();
  alert("Note saved. You can keep editing it later.");
}

function clearProjectNoteEditor(focusTitle = true) {
  currentEditingNoteId = null;
  if ($("projectNoteTitle")) $("projectNoteTitle").value = "";
  if ($("projectNoteText")) $("projectNoteText").value = "";
  setEditingStatus();
  if (focusTitle && $("projectNoteTitle")) $("projectNoteTitle").focus();
  renderProjectNotes();
}

function setEditingStatus() {
  const status = $("editingNoteStatus");
  if (!status) return;

  if (!currentEditingNoteId) {
    status.textContent = "Creating a new editable note/file.";
    return;
  }

  const note = projectNotes.find(item => item.id === currentEditingNoteId);
  status.textContent = note
    ? `Editing: ${note.title || "Untitled note"}`
    : "Editing saved note/file.";
}

function editProjectNote(id) {
  const note = projectNotes.find(item => item.id === id);
  if (!note) return;

  const projectSelect = $("noteProjectSelect");
  if (projectSelect && note.projectId) {
    projectSelect.value = note.projectId;
  }

  currentEditingNoteId = id;
  $("projectNoteTitle").value = note.title || "Untitled note";
  $("projectNoteText").value = note.text || "";
  setEditingStatus();
  renderProjectNotes();

  $("projectNoteTitle").scrollIntoView({ behavior: "smooth", block: "center" });
}

async function deleteProjectNote(id) {
  const note = projectNotes.find(item => item.id === id);
  if (!note) return;

  const canDelete = isAdmin() || note.authorId === currentUser.uid || note.lastEditedById === currentUser.uid;

  if (!canDelete) {
    alert("Only the note author/editor or admin can delete this note.");
    return;
  }

  if (!confirm(`Delete note/file: ${note.title || "Untitled note"}?`)) return;

  await deleteDoc(doc(db, "projectNotes", id));

  if (currentEditingNoteId === id) {
    clearProjectNoteEditor(false);
  }
}

function openProjectNotebook(projectId) {
  const select = $("noteProjectSelect");
  if (select) {
    select.value = projectId;
  }
  clearProjectNoteEditor(false);
  renderProjectNotes();
  const card = document.querySelector(".notebook-card");
  if (card) card.scrollIntoView({ behavior: "smooth", block: "start" });
}

function getSelectedProject() {
  const projectId = $("noteProjectSelect")?.value;
  return projects.find(item => item.id === projectId) || null;
}

function getNotesForProject(projectId) {
  return projectNotes
    .filter(note => note.projectId === projectId)
    .sort((a, b) => {
      const aTime = getNoteSortTime(a);
      const bTime = getNoteSortTime(b);
      return bTime - aTime;
    });
}

function getNoteSortTime(note) {
  const updated = note.updatedAt?.toDate ? note.updatedAt.toDate().getTime() : 0;
  const created = note.createdAt?.toDate ? note.createdAt.toDate().getTime() : 0;
  return updated || created || 0;
}

function getEditingNote() {
  if (!currentEditingNoteId) return null;
  return projectNotes.find(item => item.id === currentEditingNoteId) || null;
}

function exportEditingNotePdf() {
  const note = getEditingNote();
  const project = getSelectedProject();

  if (!note || !project) {
    alert("Select a saved note/file first, then export it.");
    return;
  }

  exportSingleNotePdf(note.id);
}

function exportEditingNotePng() {
  const note = getEditingNote();
  const project = getSelectedProject();

  if (!note || !project) {
    alert("Select a saved note/file first, then export it.");
    return;
  }

  exportSingleNotePng(note.id);
}

function exportSingleNotePdf(noteId) {
  const note = projectNotes.find(item => item.id === noteId);
  if (!note) return;

  const project = projects.find(item => item.id === note.projectId) || getSelectedProject();
  const printable = buildSingleNoteHtml(project, note);
  const win = window.open("", "_blank");

  if (!win) {
    alert("Popup blocked. Allow popups for BLAB, then try again.");
    return;
  }

  win.document.write(printable);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 300);
}

function exportSingleNotePng(noteId) {
  const note = projectNotes.find(item => item.id === noteId);
  if (!note) return;

  const project = projects.find(item => item.id === note.projectId) || getSelectedProject();
  const lines = buildSingleNoteLines(project, note);
  exportLinesAsPng(lines, `${project?.title || "project"}-${note.title || "note"}.png`, "BLAB Project Note");
}

function exportSelectedProjectNotesPdf() {
  const project = getSelectedProject();

  if (!project) {
    alert("Please select a project first.");
    return;
  }

  const notes = getNotesForProject(project.id);
  const printable = buildProjectNotesHtml(project, notes);
  const win = window.open("", "_blank");

  if (!win) {
    alert("Popup blocked. Allow popups for BLAB, then try again.");
    return;
  }

  win.document.write(printable);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 300);
}

function exportSelectedProjectNotesPng() {
  const project = getSelectedProject();

  if (!project) {
    alert("Please select a project first.");
    return;
  }

  const notes = getNotesForProject(project.id);
  const lines = buildProjectNotesLines(project, notes);
  exportLinesAsPng(lines, `${project.title || "project"}-all-notes.png`, "BLAB Project Notes");
}

function exportLinesAsPng(lines, fileName, heading) {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  const width = 1200;
  const padding = 60;
  const lineHeight = 30;
  const wrapped = [];

  ctx.font = "22px Arial";
  lines.forEach(line => {
    wrapped.push(...wrapCanvasText(ctx, line, width - padding * 2));
  });

  canvas.width = width;
  canvas.height = Math.max(900, padding * 2 + wrapped.length * lineHeight + 40);

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "#155e75";
  ctx.font = "bold 42px Arial";
  ctx.fillText(heading, padding, padding);

  ctx.fillStyle = "#172033";
  ctx.font = "22px Arial";

  let y = padding + 60;
  wrapped.forEach(line => {
    ctx.fillText(line, padding, y);
    y += lineHeight;
  });

  const link = document.createElement("a");
  link.download = makeSafeFileName(fileName);
  link.href = canvas.toDataURL("image/png");
  link.click();
}

function buildSingleNoteLines(project, note) {
  const created = note.createdAt?.toDate ? formatDateTime(note.createdAt.toDate()) : "Date not available";
  const updated = note.updatedAt?.toDate ? formatDateTime(note.updatedAt.toDate()) : created;

  const lines = [];
  lines.push(`Project: ${project?.title || note.projectTitle || "Untitled project"}`);
  lines.push(`Note/File: ${note.title || "Untitled note"}`);
  lines.push(`Author: ${note.authorName || "Unknown"}`);
  lines.push(`Created: ${created}`);
  lines.push(`Updated: ${updated}`);
  lines.push("");
  String(note.text || "").split("\n").forEach(noteLine => lines.push(noteLine));
  return lines;
}

function buildProjectNotesLines(project, notes) {
  const lines = [];
  lines.push(`Project: ${project.title || "Untitled"}`);
  lines.push(`Lead: ${project.ownerName || "Not set"}`);
  lines.push(`Status: ${project.status || "Active"}`);
  lines.push(`Target: ${project.targetDate || "Not set"}`);
  lines.push("");
  lines.push(`Goal: ${project.goal || "Not added"}`);
  lines.push(`Current progress: ${project.progress || "No progress added"}`);
  lines.push(`Next step: ${project.nextStep || "Not set"}`);
  lines.push("");
  lines.push("Project files / notes:");

  if (notes.length === 0) {
    lines.push("No notes yet.");
  } else {
    notes.forEach(note => {
      const date = note.updatedAt?.toDate
        ? formatDateTime(note.updatedAt.toDate())
        : (note.createdAt?.toDate ? formatDateTime(note.createdAt.toDate()) : "Date not available");
      lines.push("");
      lines.push(`${note.title || "Untitled note"} — ${date} — ${note.lastEditedByName || note.authorName || "Unknown"}`);
      String(note.text || "").split("\n").forEach(noteLine => lines.push(noteLine));
    });
  }

  return lines;
}

function buildSingleNoteHtml(project, note) {
  const created = note.createdAt?.toDate ? formatDateTime(note.createdAt.toDate()) : "Date not available";
  const updated = note.updatedAt?.toDate ? formatDateTime(note.updatedAt.toDate()) : created;

  return `
    <!doctype html>
    <html>
      <head>
        <title>${escapeHTML(note.title || "Project Note")}</title>
        <style>
          body { font-family: Arial, sans-serif; color: #172033; padding: 36px; line-height: 1.45; }
          h1 { color: #155e75; margin-bottom: 4px; }
          .meta { color: #64748b; margin-bottom: 24px; }
          .box { border: 1px solid #d8e0ea; border-radius: 14px; padding: 16px; margin: 14px 0; }
          @media print { button { display: none; } body { padding: 0; } }
        </style>
      </head>
      <body>
        <button onclick="window.print()">Save / Print PDF</button>
        <h1>${escapeHTML(note.title || "Untitled note")}</h1>
        <div class="meta">Project: ${escapeHTML(project?.title || note.projectTitle || "Untitled project")} · Exported ${escapeHTML(formatDateTime(new Date()))}</div>
        <div class="box">
          <p><b>Author:</b> ${escapeHTML(note.authorName || "Unknown")}</p>
          <p><b>Created:</b> ${escapeHTML(created)}</p>
          <p><b>Last edited:</b> ${escapeHTML(updated)}${note.lastEditedByName ? ` by ${escapeHTML(note.lastEditedByName)}` : ""}</p>
        </div>
        <div class="box">
          ${escapeHTML(note.text || "").replaceAll("\n", "<br>")}
        </div>
      </body>
    </html>
  `;
}

function buildProjectNotesHtml(project, notes) {
  const noteHtml = notes.length === 0
    ? `<p>No notes yet.</p>`
    : notes.map(note => {
        const date = note.updatedAt?.toDate
          ? formatDateTime(note.updatedAt.toDate())
          : (note.createdAt?.toDate ? formatDateTime(note.createdAt.toDate()) : "Date not available");
        return `
          <section class="note">
            <h3>${escapeHTML(note.title || "Untitled note")}</h3>
            <div class="meta">${escapeHTML(date)} — ${escapeHTML(note.lastEditedByName || note.authorName || "Unknown")}</div>
            <p>${escapeHTML(note.text || "").replaceAll("\n", "<br>")}</p>
          </section>
        `;
      }).join("");

  return `
    <!doctype html>
    <html>
      <head>
        <title>${escapeHTML(project.title || "Project Notes")}</title>
        <style>
          body { font-family: Arial, sans-serif; color: #172033; padding: 36px; line-height: 1.45; }
          h1 { color: #155e75; margin-bottom: 4px; }
          h2 { color: #155e75; border-bottom: 1px solid #d8e0ea; padding-bottom: 8px; }
          .meta { color: #64748b; margin-bottom: 14px; }
          .box { border: 1px solid #d8e0ea; border-radius: 14px; padding: 16px; margin: 14px 0; }
          .note { border-top: 1px solid #d8e0ea; padding-top: 12px; margin-top: 16px; }
          .note h3 { font-size: 18px; color: #334155; margin-bottom: 4px; }
          @media print { button { display: none; } body { padding: 0; } }
        </style>
      </head>
      <body>
        <button onclick="window.print()">Save / Print PDF</button>
        <h1>BLAB Project Workspace</h1>
        <div class="meta">Exported ${escapeHTML(formatDateTime(new Date()))}</div>
        <div class="box">
          <h2>${escapeHTML(project.title || "Untitled project")}</h2>
          <p><b>Lead:</b> ${escapeHTML(project.ownerName || "Not set")}</p>
          <p><b>Status:</b> ${escapeHTML(project.status || "Active")}</p>
          <p><b>Target:</b> ${escapeHTML(project.targetDate || "Not set")}</p>
          <p><b>Goal:</b><br>${escapeHTML(project.goal || "Not added").replaceAll("\n", "<br>")}</p>
          <p><b>Current progress:</b><br>${escapeHTML(project.progress || "No progress added").replaceAll("\n", "<br>")}</p>
          <p><b>Next step:</b><br>${escapeHTML(project.nextStep || "Not set").replaceAll("\n", "<br>")}</p>
        </div>
        <h2>Project Files / Notes</h2>
        ${noteHtml}
      </body>
    </html>
  `;
}

function wrapCanvasText(ctx, text, maxWidth) {
  if (text === "") return [""];
  const words = String(text).split(" ");
  const lines = [];
  let line = "";

  words.forEach(word => {
    const testLine = line ? `${line} ${word}` : word;
    if (ctx.measureText(testLine).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = testLine;
    }
  });

  lines.push(line);
  return lines;
}

function makeSafeFileName(name) {
  return String(name).replace(/[^a-z0-9._-]+/gi, "-").replace(/-+/g, "-").toLowerCase();
}

async function addTask() {
  const title = $("taskTitle").value.trim();
  const dueDate = $("taskDue").value;

  if (!title) {
    alert("Please enter a task.");
    return;
  }

  await addDoc(collection(db, "tasks"), {
    title,
    dueDate,
    ownerId: currentUser.uid,
    ownerName: currentProfile.name,
    done: false,
    createdAt: serverTimestamp()
  });

  $("taskTitle").value = "";
  $("taskDue").value = "";
}

async function markTaskDone(id) {
  await updateDoc(doc(db, "tasks", id), {
    done: true,
    completedAt: serverTimestamp()
  });
}

async function reopenTask(id) {
  await updateDoc(doc(db, "tasks", id), {
    done: false
  });
}

async function deleteTask(id) {
  if (!isAdmin()) {
    alert("Admin only.");
    return;
  }

  if (!confirm("Delete this completed task?")) return;

  await deleteDoc(doc(db, "tasks", id));
}

async function addOrder() {
  const item = $("orderItem").value.trim();
  const quantity = $("orderQuantity").value.trim();
  const reason = $("orderReason").value.trim();

  if (!item) {
    alert("Please enter an item.");
    return;
  }

  await addDoc(collection(db, "orders"), {
    item,
    quantity,
    reason,
    requesterId: currentUser.uid,
    requesterName: currentProfile.name,
    status: "Needed",
    createdAt: serverTimestamp()
  });

  $("orderItem").value = "";
  $("orderQuantity").value = "";
  $("orderReason").value = "";
}

async function updateOrderStatus(id, status) {
  await updateDoc(doc(db, "orders", id), {
    status
  });
}

async function deleteOrder(id) {
  if (!isAdmin()) {
    alert("Admin only.");
    return;
  }

  if (!confirm("Delete this received order?")) return;

  await deleteDoc(doc(db, "orders", id));
}

async function enablePushNotifications() {
  if (!currentUser) {
    alert("Enter BLAB first, then enable reminders.");
    return;
  }

  localStorage.setItem(LOCAL_REMINDERS_KEY, "true");

  if (!("Notification" in window)) {
    alert("In-app reminder banners are enabled. Browser notifications are not available on this device/browser.");
    startInAppReminderChecker();
    return;
  }

  const permission = await Notification.requestPermission();

  if (permission !== "granted") {
    alert("In-app reminder banners are enabled. Phone/browser notification permission was not granted.");
    startInAppReminderChecker();
    return;
  }

  if (!messaging || PUBLIC_VAPID_KEY.includes("PASTE_")) {
    alert("In-app reminders are enabled. Background push reminders are not configured yet, so reminders work while BLAB is open.");
    startInAppReminderChecker();
    return;
  }

  try {
    const registration = await navigator.serviceWorker.register("./firebase-messaging-sw.js");

    const token = await getToken(messaging, {
      vapidKey: PUBLIC_VAPID_KEY,
      serviceWorkerRegistration: registration
    });

    await setDoc(
      doc(db, "users", currentUser.uid, "fcmTokens", token),
      {
        token,
        userName: currentProfile.name,
        createdAt: serverTimestamp()
      }
    );

    alert("Reminders enabled for this device.");
  } catch (error) {
    console.error(error);
    alert("In-app reminders are enabled, but background push could not be enabled. Check console for details.");
  }

  startInAppReminderChecker();
}

if (messaging) {
  onMessage(messaging, payload => {
    alert(payload.notification?.title + "\n" + payload.notification?.body);
  });
}

function unlockAdmin() {
  const code = $("adminCodeInput").value.trim();

  if (code !== ADMIN_CODE) {
    alert("Incorrect admin code.");
    return;
  }

  isAdminUnlocked = true;
  localStorage.setItem("blabAdminUnlocked", "true");
  $("adminCodeInput").value = "";
  renderAll();
}

function lockAdmin() {
  isAdminUnlocked = false;
  localStorage.removeItem("blabAdminUnlocked");
  renderAll();
}

function isAdmin() {
  return isAdminUnlocked;
}


function startInAppReminderChecker() {
  if (reminderTimer) return;

  checkInAppReminders();
  reminderTimer = setInterval(checkInAppReminders, 30000);
}

function getShownReminderMap() {
  try {
    return JSON.parse(localStorage.getItem(SHOWN_REMINDERS_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveShownReminderMap(map) {
  localStorage.setItem(SHOWN_REMINDERS_KEY, JSON.stringify(map));
}

function checkInAppReminders() {
  if (!currentUser || !currentProfile || bookings.length === 0) return;

  const now = new Date();
  const shown = getShownReminderMap();
  let changed = false;

  bookings.forEach(booking => {
    if (booking.status !== "active") return;
    if (booking.userId !== currentUser.uid) return;

    const reminderMinutes = Number(booking.reminderMinutes || 0);
    if (reminderMinutes <= 0) return;

    const end = booking.endTime?.toDate ? booking.endTime.toDate() : null;
    if (!end) return;

    const reminderTime = new Date(end.getTime() - reminderMinutes * 60 * 1000);
    const reminderKey = `${booking.id}:ending:${reminderMinutes}`;
    const overdueKey = `${booking.id}:overdue`;

    if (now >= reminderTime && now < end && !shown[reminderKey]) {
      const message = `${booking.instrumentName} ends at ${formatDateTime(end)}.`;
      showInAppReminder(`BLAB reminder: ${formatReminder(reminderMinutes)}`, message);
      shown[reminderKey] = new Date().toISOString();
      changed = true;
    }

    if (now >= end && !shown[overdueKey]) {
      const message = `${booking.instrumentName} booking has ended. Mark it finished when done.`;
      showInAppReminder("BLAB overdue reminder", message);
      shown[overdueKey] = new Date().toISOString();
      changed = true;
    }
  });

  if (changed) saveShownReminderMap(shown);
}

function showInAppReminder(title, message) {
  const fullMessage = `${title}\n${message}`;

  showReminderToast(title, message);

  if (localStorage.getItem(LOCAL_REMINDERS_KEY) === "true" && "Notification" in window && Notification.permission === "granted") {
    try {
      new Notification(title, {
        body: message,
        tag: `blab-${Date.now()}`
      });
    } catch (error) {
      console.warn("Notification failed", error);
    }
  }

  console.log(fullMessage);
}

function showReminderToast(title, message) {
  let toast = document.getElementById("blabReminderToast");

  if (!toast) {
    toast = document.createElement("div");
    toast.id = "blabReminderToast";
    toast.className = "reminder-toast";
    document.body.appendChild(toast);
  }

  toast.innerHTML = `
    <button class="toast-close" aria-label="Close reminder" onclick="this.parentElement.classList.remove('show')">×</button>
    <strong>${escapeHTML(title)}</strong>
    <div>${escapeHTML(message)}</div>
  `;

  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 12000);
}

function renderAll() {
  if (!currentProfile) return;

  renderDashboard();
  renderBookings();
  renderProjects();
  renderProjectNoteSelectors();
  renderProjectNotes();
  checkInAppReminders();
  renderTasks();
  renderOrders();
  renderAdmin();
}

function renderDashboard() {
  const now = new Date();
  const today = now.toDateString();

  const active = bookings.filter(booking => {
    if (booking.status !== "active") return false;

    const start = booking.startTime.toDate();
    const end = booking.endTime.toDate();

    return now >= start && now <= end;
  });

  const upcomingToday = bookings.filter(booking => {
    if (booking.status !== "active") return false;

    const start = booking.startTime.toDate();

    return start > now && start.toDateString() === today;
  });

  const activeProjects = projects.filter(project => project.status !== "Completed");

  $("busyNowCount").textContent = active.length;
  $("upcomingTodayCount").textContent = upcomingToday.length;
  $("activeProjectsCount").textContent = activeProjects.length;
  $("currentUserText").textContent = currentProfile.name;

  const allInstruments = Object.values(instrumentGroups).flat();

  $("instrumentStatus").innerHTML = allInstruments.map(instrument => {
    const activeBooking = active.find(booking => booking.instrumentId === instrument.id);

    if (!activeBooking) {
      return `
        <div class="item">
          <div class="item-head">
            <div>
              <div class="title">${escapeHTML(instrument.name)}</div>
              <div class="muted">Available now</div>
            </div>
            <span class="badge success">Available</span>
          </div>
        </div>
      `;
    }

    return `
      <div class="item">
        <div class="item-head">
          <div>
            <div class="title">${escapeHTML(instrument.name)}</div>
            <div class="muted">Using now: ${escapeHTML(activeBooking.userName)}</div>
            <div class="muted">Ends: ${formatDateTime(activeBooking.endTime.toDate())}</div>
          </div>
          <span class="badge warning">Busy</span>
        </div>
      </div>
    `;
  }).join("");
}

function renderBookings() {
  renderBookingGroup("Hotplate", "hotplateBookings");
  renderBookingGroup("Furnace", "furnaceBookings");
  renderBookingGroup("Centrifuge", "centrifugeBookings");
}

function renderBookingGroup(category, elementId) {
  const box = $(elementId);

  const group = bookings
    .filter(booking => booking.category === category)
    .sort((a, b) => a.startTime.toDate() - b.startTime.toDate());

  if (group.length === 0) {
    box.innerHTML = `<div class="empty">No ${category.toLowerCase()} bookings yet.</div>`;
    return;
  }

  box.innerHTML = group.map(booking => {
    const status = getBookingStatus(booking);

    return `
      <div class="item">
        <div class="item-head">
          <div>
            <div class="title">${escapeHTML(booking.instrumentName)}</div>
            <div class="muted">User: ${escapeHTML(booking.userName)}</div>
          </div>
          <span class="badge ${status.className}">${status.label}</span>
        </div>

        <p>
          <b>From:</b> ${formatDateTime(booking.startTime.toDate())}
          <br>
          <b>To:</b> ${formatDateTime(booking.endTime.toDate())}
        </p>

        <p class="muted">Reminder: ${formatReminder(booking.reminderMinutes)}</p>

        <div class="actions">
          ${
            booking.status === "active" && booking.userId === currentUser.uid
              ? `<button class="btn small success" onclick="window.blab.markBookingFinished('${booking.id}')">Mark Finished</button>`
              : ""
          }

          ${
            isAdmin()
              ? `<button class="btn small danger" onclick="window.blab.deleteBooking('${booking.id}')">Delete</button>`
              : ""
          }
        </div>
      </div>
    `;
  }).join("");
}

function getBookingStatus(booking) {
  if (booking.status === "finished") {
    return {
      label: "Finished",
      className: "success"
    };
  }

  const now = new Date();
  const start = booking.startTime.toDate();
  const end = booking.endTime.toDate();

  if (now < start) {
    return {
      label: "Upcoming",
      className: ""
    };
  }

  if (now >= start && now <= end) {
    return {
      label: "Busy",
      className: "warning"
    };
  }

  return {
    label: "Overdue",
    className: "danger"
  };
}

function renderProjects() {
  const box = $("projectsList");
  const filter = $("projectStatusFilter")?.value || "All";

  let visibleProjects = projects.slice();

  if (filter !== "All") {
    visibleProjects = visibleProjects.filter(project => project.status === filter);
  }

  visibleProjects.sort((a, b) => {
    const aTime = a.updatedAt?.toDate ? a.updatedAt.toDate().getTime() : 0;
    const bTime = b.updatedAt?.toDate ? b.updatedAt.toDate().getTime() : 0;
    return bTime - aTime;
  });

  if (visibleProjects.length === 0) {
    box.innerHTML = `<div class="empty">No projects found.</div>`;
    return;
  }

  box.innerHTML = visibleProjects.map(project => {
    const badgeClass = getProjectBadgeClass(project.status);
    const updated = project.updatedAt?.toDate
      ? formatDateTime(project.updatedAt.toDate())
      : "Not available";

    return `
      <div class="item project-item">
        <div class="item-head">
          <div>
            <div class="title">${escapeHTML(project.title)}</div>
            <div class="muted">Lead: ${escapeHTML(project.ownerName || "Not set")}</div>
            <div class="muted">Target: ${escapeHTML(project.targetDate || "Not set")}</div>
          </div>
          <span class="badge ${badgeClass}">${escapeHTML(project.status || "Active")}</span>
        </div>

        <p><b>Goal:</b> ${escapeHTML(project.goal || "Not added yet")}</p>
        <p><b>Progress:</b> ${escapeHTML(project.progress || "No update yet")}</p>
        <p><b>Next step:</b> ${escapeHTML(project.nextStep || "Not set")}</p>
        <p class="muted">Last updated: ${updated}${project.lastUpdatedBy ? ` by ${escapeHTML(project.lastUpdatedBy)}` : ""}</p>

        <div class="actions">
          <button class="btn small secondary" onclick="window.blab.openProjectNotebook('${project.id}')">Open Notebook</button>
          <button class="btn small secondary" onclick="window.blab.updateProjectProgress('${project.id}')">Update Progress</button>
          <button class="btn small" onclick="window.blab.updateProjectStatus('${project.id}', 'Active')">Active</button>
          <button class="btn small warning" onclick="window.blab.updateProjectStatus('${project.id}', 'Paused')">Paused</button>
          <button class="btn small success" onclick="window.blab.updateProjectStatus('${project.id}', 'Completed')">Completed</button>
          ${
            isAdmin() || project.createdBy === currentUser.uid || project.ownerId === currentUser.uid
              ? `<button class="btn small danger" onclick="window.blab.deleteProject('${project.id}')">Delete</button>`
              : ""
          }
        </div>
      </div>
    `;
  }).join("");
}


function renderProjectNoteSelectors() {
  const select = $("noteProjectSelect");
  if (!select) return;

  const previous = select.value;
  const sortedProjects = projects.slice().sort((a, b) => (a.title || "").localeCompare(b.title || ""));

  select.innerHTML = sortedProjects.length === 0
    ? `<option value="">No projects yet</option>`
    : sortedProjects.map(project => `<option value="${project.id}">${escapeHTML(project.title)}</option>`).join("");

  if (previous && sortedProjects.some(project => project.id === previous)) {
    select.value = previous;
  }
}

function renderProjectNotes() {
  const box = $("projectNotesList");
  const title = $("notebookTitle");
  const project = getSelectedProject();

  if (!box || !title) return;

  if (!project) {
    title.textContent = "Project Workspace";
    box.innerHTML = `<div class="empty">Select or create a project first.</div>`;
    setEditingStatus();
    return;
  }

  title.textContent = project.title;
  const notes = getNotesForProject(project.id);

  if (currentEditingNoteId && !notes.some(note => note.id === currentEditingNoteId)) {
    currentEditingNoteId = null;
  }

  setEditingStatus();

  if (notes.length === 0) {
    box.innerHTML = `<div class="empty">No note files yet. Create Week 1, Experiment 1, Literature Notes, etc.</div>`;
    return;
  }

  box.innerHTML = notes.map(note => {
    const updated = note.updatedAt?.toDate
      ? formatDateTime(note.updatedAt.toDate())
      : (note.createdAt?.toDate ? formatDateTime(note.createdAt.toDate()) : "Date not available");
    const excerpt = String(note.text || "").slice(0, 120);
    const activeClass = note.id === currentEditingNoteId ? "active-note" : "";
    const canDelete = isAdmin() || note.authorId === currentUser.uid || note.lastEditedById === currentUser.uid;

    return `
      <div class="item note-file ${activeClass}">
        <div class="item-head">
          <div>
            <div class="title">${escapeHTML(note.title || "Untitled note")}</div>
            <div class="muted">Updated: ${escapeHTML(updated)}</div>
            <div class="muted">By: ${escapeHTML(note.lastEditedByName || note.authorName || "Unknown")}</div>
          </div>
        </div>
        <p>${escapeHTML(excerpt)}${String(note.text || "").length > 120 ? "..." : ""}</p>
        <div class="actions">
          <button class="btn small" onclick="window.blab.editProjectNote('${note.id}')">Edit</button>
          <button class="btn small secondary" onclick="window.blab.exportSingleNotePdf('${note.id}')">PDF</button>
          <button class="btn small secondary" onclick="window.blab.exportSingleNotePng('${note.id}')">PNG</button>
          ${canDelete ? `<button class="btn small danger" onclick="window.blab.deleteProjectNote('${note.id}')">Delete</button>` : ""}
        </div>
      </div>
    `;
  }).join("");
}

function getProjectBadgeClass(status) {
  if (status === "Completed") return "success";
  if (status === "Paused") return "warning";
  if (status === "Planning") return "";
  return "success";
}

function renderTasks() {
  const box = $("tasksList");

  if (tasks.length === 0) {
    box.innerHTML = `<div class="empty">No tasks yet.</div>`;
    return;
  }

  box.innerHTML = tasks.map(task => {
    return `
      <div class="item">
        <div class="item-head">
          <div>
            <div class="title">${escapeHTML(task.title)}</div>
            <div class="muted">Owner: ${escapeHTML(task.ownerName)}</div>
            <div class="muted">Due: ${escapeHTML(task.dueDate || "Not set")}</div>
          </div>
          <span class="badge ${task.done ? "success" : "warning"}">
            ${task.done ? "Done" : "Open"}
          </span>
        </div>

        <div class="actions">
          ${
            task.done
              ? `<button class="btn small secondary" onclick="window.blab.reopenTask('${task.id}')">Reopen</button>`
              : `<button class="btn small success" onclick="window.blab.markTaskDone('${task.id}')">Mark Done</button>`
          }

          ${
            isAdmin() && task.done
              ? `<button class="btn small danger" onclick="window.blab.deleteTask('${task.id}')">Delete</button>`
              : ""
          }
        </div>
      </div>
    `;
  }).join("");
}

function renderOrders() {
  const box = $("ordersList");

  if (orders.length === 0) {
    box.innerHTML = `<div class="empty">No orders yet.</div>`;
    return;
  }

  box.innerHTML = orders.map(order => {
    let badgeClass = "";
    if (order.status === "Ordered") badgeClass = "warning";
    if (order.status === "Received") badgeClass = "success";

    return `
      <div class="item">
        <div class="item-head">
          <div>
            <div class="title">${escapeHTML(order.item)}</div>
            <div class="muted">Requested by: ${escapeHTML(order.requesterName)}</div>
          </div>
          <span class="badge ${badgeClass}">${escapeHTML(order.status)}</span>
        </div>

        <p><b>Quantity:</b> ${escapeHTML(order.quantity || "Not specified")}</p>
        <p><b>Reason:</b> ${escapeHTML(order.reason || "Not specified")}</p>

        <div class="actions">
          <button class="btn small secondary" onclick="window.blab.updateOrderStatus('${order.id}', 'Needed')">Needed</button>
          <button class="btn small warning" onclick="window.blab.updateOrderStatus('${order.id}', 'Ordered')">Ordered</button>
          <button class="btn small success" onclick="window.blab.updateOrderStatus('${order.id}', 'Received')">Received</button>

          ${
            isAdmin() && order.status === "Received"
              ? `<button class="btn small danger" onclick="window.blab.deleteOrder('${order.id}')">Delete</button>`
              : ""
          }
        </div>
      </div>
    `;
  }).join("");
}

function renderAdmin() {
  $("adminStatus").innerHTML = isAdmin()
    ? `<span class="badge success">Admin mode is ON</span>`
    : `<span class="badge warning">Admin mode is OFF</span>`;
}

function formatDateTime(date) {
  return date.toLocaleString([], {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function formatReminder(minutes) {
  const value = Number(minutes);

  if (value === 0) return "No reminder";
  if (value === 15) return "15 minutes before end";
  if (value === 30) return "30 minutes before end";
  if (value === 60) return "1 hour before end";
  if (value === 120) return "2 hours before end";
  if (value === 1440) return "1 day before end";

  return `${value} minutes before end`;
}

function escapeHTML(text) {
  return String(text || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

window.blab = {
  markBookingFinished,
  deleteBooking,
  updateProjectProgress,
  updateProjectStatus,
  deleteProject,
  saveProjectNote,
  editProjectNote,
  deleteProjectNote,
  clearProjectNoteEditor,
  openProjectNotebook,
  exportSingleNotePdf,
  exportSingleNotePng,
  exportSelectedProjectNotesPdf,
  exportSelectedProjectNotesPng,
  markTaskDone,
  reopenTask,
  deleteTask,
  updateOrderStatus,
  deleteOrder
};
