/*
  Firebase Messaging Service Worker for BLAB.

  IMPORTANT:
  Replace the firebaseConfig object below with the same config from public/app.js.
*/

importScripts("https://www.gstatic.com/firebasejs/10.12.4/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.4/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "PASTE_YOUR_API_KEY_HERE",
  authDomain: "PASTE_YOUR_PROJECT.firebaseapp.com",
  projectId: "PASTE_YOUR_PROJECT_ID",
  storageBucket: "PASTE_YOUR_PROJECT.appspot.com",
  messagingSenderId: "PASTE_YOUR_SENDER_ID",
  appId: "PASTE_YOUR_APP_ID"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage(payload => {
  const title = payload.notification?.title || "BLAB Reminder";
  const options = {
    body: payload.notification?.body || "You have a lab reminder.",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png"
  };

  self.registration.showNotification(title, options);
});
