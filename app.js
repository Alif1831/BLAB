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
let tasks = [];
let orders = [];

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
  if (!messaging) {
    alert("Notifications are not available in this browser.");
    return;
  }

  if (!currentUser) {
    alert("Enter BLAB first, then enable reminders.");
    return;
  }

  if (PUBLIC_VAPID_KEY.includes("PASTE_")) {
    alert("Add your Firebase Web Push certificate key to PUBLIC_VAPID_KEY in app.js first.");
    return;
  }

  const permission = await Notification.requestPermission();

  if (permission !== "granted") {
    alert("Notifications were not enabled.");
    return;
  }

  try {
    const registration = await navigator.serviceWorker.register("/firebase-messaging-sw.js");

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
    alert("Could not enable reminders. Check console for details.");
  }
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

function renderAll() {
  if (!currentProfile) return;

  renderDashboard();
  renderBookings();
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

  $("busyNowCount").textContent = active.length;
  $("upcomingTodayCount").textContent = upcomingToday.length;
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
  markTaskDone,
  reopenTask,
  deleteTask,
  updateOrderStatus,
  deleteOrder
};
