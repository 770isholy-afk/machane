import { initializeApp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";
import { 
    getFirestore, collection, doc, onSnapshot, updateDoc, 
    increment, setDoc, deleteDoc, runTransaction, writeBatch 
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyDFby7GMORMxa5rQbZr5OuH1neU1x_3wOQ",
    authDomain: "machanemoshiachth.firebaseapp.com",
    projectId: "machanemoshiachth",
    storageBucket: "machanemoshiachth.firebasestorage.app",
    messagingSenderId: "878646637008",
    appId: "1:878646637008:web:396688287b8b0dffbdc9d5",
    measurementId: "G-YB1GF9H4J2"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

window.stateMemory = {
    campers: [],
    teams: [],
    settings: { colorWarState: "inactive", hideColorWarScoreboard: false, hideColorWarCounselor: false },
    sorting: { column: 'name', ascending: true },
    activeScroller: false,
    scrollerLoops: [],
    activeCamperId: null,
    pendingRegisterNfcToken: null,
    awaitingAdminCard: false
};

const ADMIN_CARD_SECRET = "machane-master-admin-2024";
const DEVICE_AUTH_KEY = "machaneDeviceAuthorized";

function isDeviceAuthorized() {
    try { return localStorage.getItem(DEVICE_AUTH_KEY) === "true"; }
    catch (e) { return false; }
}

function markDeviceAuthorized() {
    try { localStorage.setItem(DEVICE_AUTH_KEY, "true"); }
    catch (e) { console.warn("localStorage unavailable", e); }
}

function isAdminLoggedIn() {
    const navAdmin = document.getElementById('nav-admin');
    return navAdmin && !navAdmin.classList.contains('hidden');
}

// --- REAL-TIME SYNC ---
function initRealtimeSync() {
    onSnapshot(doc(db, "system", "settings"), (docSnap) => {
        if (docSnap.exists()) {
            stateMemory.settings = docSnap.data();
            const btnEnd = document.getElementById('btn-quick-end-cw');
            if (btnEnd) btnEnd.style.display = stateMemory.settings.colorWarState === 'active' ? 'block' : 'none';
            const chkSb = document.getElementById('chk-hide-sb');
            const chkCc = document.getElementById('chk-hide-counselor');
            if (chkSb) chkSb.checked = !!stateMemory.settings.hideColorWarScoreboard;
            if (chkCc) chkCc.checked = !!stateMemory.settings.hideColorWarCounselor;
        }
        refreshActiveViewData();
    });

    onSnapshot(collection(db, "campers"), (querySnapshot) => {
        const temp = [];
        querySnapshot.forEach((doc) => { temp.push({ id: doc.id, ...doc.data() }); });
        stateMemory.campers = temp;
        populateCamperDropdowns();
        refreshActiveViewData();
    });

    onSnapshot(collection(db, "teams"), (querySnapshot) => {
        const temp = [];
        querySnapshot.forEach((doc) => { temp.push({ id: doc.id, ...doc.data() }); });
        stateMemory.teams = temp;
        refreshActiveViewData();
    });
}

function refreshActiveViewData() {
    const activeSection = document.querySelector('.view.active');
    if (!activeSection) return;
    const viewId = activeSection.id.replace('view-', '');
    
    if (viewId === 'scoreboard') generateLiveScoreboard();
    if (viewId === 'spread') generateSpreadsheetLedger();
    if (viewId === 'addlines') generateCounselorDashboard();
    if (viewId === 'setteams') syncCWWorkflowUI();
}

// --- ROUTER ---
window.router = function(viewId) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    const target = document.getElementById(`view-${viewId}`);
    if (target) target.classList.add('active');
    
    document.querySelectorAll('#app-nav button').forEach(b => b.classList.remove('active'));
    const btnNav = document.getElementById(`btn-nav-${viewId}`) || document.getElementById(`nav-${viewId}`);
    if (btnNav) btnNav.classList.add('active');

    if (viewId !== 'scoreboard') killScrollIntervals();

    if (viewId === 'scoreboard') generateLiveScoreboard();
    if (viewId === 'spread') generateSpreadsheetLedger();
    if (viewId === 'addlines') generateCounselorDashboard();
    if (viewId === 'setteams') syncCWWorkflowUI();
    if (viewId === 'admin') refreshDeviceAuthStatus();
};

// --- ADMIN TAB SWITCH ---
window.switchAdminSubWorkspace = function(paneId) {
    document.querySelectorAll('.admin-subpane').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.sidebar-tab-btn').forEach(b => b.classList.remove('active'));

    const targetPane = document.getElementById(paneId);
    const targetTab = document.getElementById(`tab-${paneId}`);

    if (targetPane) targetPane.classList.add('active');
    if (targetTab) targetTab.classList.add('active');

    if (paneId === 'pane-welcome') refreshDeviceAuthStatus();
};

// --- NFC CARD LISTENER (works on every page) ---
async function startNfcLoginPassiveListener() {
    const statusPill = document.getElementById('nfc-global-status');
    const statusText = document.getElementById('nfc-global-status-text');

    if (!('NDEFReader' in window)) {
        console.warn("Web NFC is not available on this device.");
        if (statusPill) { statusPill.className = 'off'; if (statusText) statusText.innerText = 'NFC off'; }
        const radar = document.getElementById('nfc-login-radar-box');
        if (radar) {
            radar.style.background = "#fef2f2";
            radar.style.borderColor = "#ef4444";
            radar.innerHTML = `<strong style="color: #991b1b;">NFC not available</strong><br><small style="color: #b91c1c;">Use an Android Chrome browser, or sign in with username and password.</small>`;
        }
        return;
    }

    try {
        const ndef = new NDEFReader();
        await ndef.scan();
        console.log("NFC scanner is running.");
        if (statusPill) { statusPill.className = ''; if (statusText) statusText.innerText = 'Scanning'; }

        ndef.addEventListener("reading", ({ message }) => {
            for (const record of message.records) {
                if (record.recordType === "text") {
                    const textDecoder = new TextDecoder();
                    const rawPayload = textDecoder.decode(record.data).trim();

                    if (rawPayload.startsWith("machane-admin:")) {
                        const key = rawPayload.replace("machane-admin:", "").trim();
                        handleAdminCardScan(key);
                        break;
                    }

                    if (rawPayload.startsWith("machane-auth:")) {
                        const extractedId = rawPayload.replace("machane-auth:", "").trim();
                        handleCamperCardScan(extractedId);
                        break;
                    }
                }
            }
        });
    } catch (error) {
        console.error("NFC scanner failed to start:", error);
        if (statusPill) { statusPill.className = 'off'; if (statusText) statusText.innerText = 'NFC off'; }
    }
}

function handleAdminCardScan(key) {
    if (key !== ADMIN_CARD_SECRET) {
        console.warn("Admin card key did not match.");
        return;
    }

    markDeviceAuthorized();
    stateMemory.awaitingAdminCard = false;
    if (navigator.vibrate) navigator.vibrate([150, 80, 150]);
    refreshDeviceAuthStatus();
    const btn = document.getElementById('btn-authorize-device');
    if (btn) { btn.disabled = false; btn.innerText = "📡 Authorize This Device"; }
    alert("This device is now authorized! Camper cards can be used here.");
}

function handleCamperCardScan(camperId) {
    if (!isDeviceAuthorized()) {
        if (navigator.vibrate) navigator.vibrate([60, 60, 60]);
        alert("This device isn't authorized yet. An admin needs to scan their Admin Card here first.");
        return;
    }

    const targetProfile = stateMemory.campers.find(c => String(c.id).trim().toLowerCase() === String(camperId).trim().toLowerCase());

    if (targetProfile) {
        stateMemory.activeCamperId = targetProfile.id;
        document.getElementById('nav-counselor').classList.remove('hidden');
        if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
        router('addlines');
    } else {
        alert("This card isn't linked to a camper. Ask an admin to register it.");
    }
}

// --- PASSWORD LOGIN ---
window.authenticateUserSession = function() {
    const user = document.getElementById('input-username').value.trim().toLowerCase();
    const pass = document.getElementById('input-password').value.trim();

    if (user === 'admin' && pass === '11213') {
        document.getElementById('nav-admin').classList.remove('hidden');
        document.getElementById('nav-spread').classList.remove('hidden');
        router('admin');
        refreshDeviceAuthStatus();
        return;
    }

    const matchedProfile = stateMemory.campers.find(c => {
        const dbId = String(c.id).trim().toLowerCase();
        const dbPassword = String(c.password || "12345").trim();
        return dbId === user && dbPassword === pass;
    });

    if (matchedProfile) {
        stateMemory.activeCamperId = matchedProfile.id;
        document.getElementById('nav-counselor').classList.remove('hidden');
        router('addlines');
    } else {
        alert("Wrong username or password.");
    }
};

// --- DEVICE AUTHORIZATION (ADMIN CARD) ---
window.authorizeDeviceWithAdminCard = async function() {
    if (!('NDEFReader' in window)) {
        alert("NFC is not available on this device.");
        return;
    }

    if (isDeviceAuthorized()) {
        alert("This device is already authorized.");
        return;
    }

    const btn = document.getElementById('btn-authorize-device');
    if (btn) { btn.disabled = true; btn.innerText = "⏳ Tap your Admin Card..."; }

    stateMemory.awaitingAdminCard = true;

    try {
        const ndef = new NDEFReader();
        await ndef.scan();
        alert("Hold your Admin Card against the device to authorize it.");
    } catch (err) {
        console.error(err);
        stateMemory.awaitingAdminCard = false;
        if (btn) { btn.disabled = false; btn.innerText = "📡 Authorize This Device"; }
        alert("Couldn't start the NFC scanner. Try again.");
    }
};

window.programAdminCard = async function() {
    if (!('NDEFReader' in window)) {
        alert("NFC is not available on this device.");
        return;
    }

    const btn = document.getElementById('btn-program-admin-card');
    if (btn) { btn.disabled = true; btn.innerText = "⏳ Hold blank card..."; }

    try {
        const ndef = new NDEFReader();
        await ndef.scan();
        alert("Hold a blank card against the device to write the Admin Card.");
        await ndef.write({
            records: [{ recordType: "text", data: `machane-admin:${ADMIN_CARD_SECRET}` }]
        });
        if (navigator.vibrate) navigator.vibrate(200);
        alert("Admin Card programmed! Keep this card safe.");
    } catch (err) {
        console.error(err);
        alert("Couldn't write the card. Try again.");
    } finally {
        if (btn) { btn.disabled = false; btn.innerText = "📟 Program Admin Card"; }
    }
};

function refreshDeviceAuthStatus() {
    const box = document.getElementById('device-auth-status');
    if (!box) return;

    if (isDeviceAuthorized()) {
        box.className = 'auth-yes';
        box.innerText = "✅ This device is authorized. Camper cards work here.";
    } else {
        box.className = 'auth-no';
        box.innerText = "⛔ Not authorized yet. Tap \"Authorize This Device\" and scan your Admin Card.";
    }
}

// --- ADD LINES FORM ---
window.commitLineTransaction = async function(e) {
    e.preventDefault();
    const trigger = document.getElementById('form-submit-trigger');
    const overlay = document.getElementById('submit-blocker-overlay');

    trigger.disabled = true;
    overlay.classList.remove('hidden');

    const type = document.getElementById('select-metric-type').value;
    const value = parseInt(document.getElementById('input-metric-qty').value) || 0;
    const camperRef = doc(db, "campers", stateMemory.activeCamperId);

    try {
        await updateDoc(camperRef, { [type]: increment(value) });
        document.getElementById('input-metric-qty').value = '';
        alert("Saved!");
    } catch (error) {
        console.error(error);
        alert("Couldn't save. Try again.");
    } finally {
        trigger.disabled = false;
        overlay.classList.add('hidden');
    }
};

// --- LIVE SCOREBOARD ---
function generateLiveScoreboard() {
    const tbody = document.getElementById('scoreboard-table-rows');
    const container = document.getElementById('dynamic-progress-render-box');
    const title = document.getElementById('dynamic-progress-title');

    if (!tbody || !container) return;
    tbody.innerHTML = '';
    container.innerHTML = '';

    const showColorWarData = stateMemory.settings.colorWarState === 'active' && !stateMemory.settings.hideColorWarScoreboard;

    stateMemory.campers.forEach(c => {
        const tr = document.createElement('tr');
        if (showColorWarData && c.teamId) {
            const team = stateMemory.teams.find(t => t.id === c.teamId);
            if (team) tr.style.borderLeft = `8px solid var(--${team.color})`;
        }
        tr.innerHTML = `<td>${c.name || 'לא ידוע'}</td><td>${c.bunk || 'ללא בית'}</td><td>${c.duch || 0}</td><td>${c.tanya || 0}</td><td>${c.mishnayos || 0}</td>`;
        tbody.appendChild(tr);
    });

    if (showColorWarData) {
        title.innerText = "🏆 ניקוד מערכה";
        stateMemory.teams.forEach(t => {
            let cwTanya = 0, cwMish = 0;
            stateMemory.campers.filter(c => c.teamId === t.id).forEach(c => {
                cwTanya += ((c.tanya || 0) - (c.cwBaseTanya || 0));
                cwMish += ((c.mishnayos || 0) - (c.cwBaseMish || 0));
            });
            const score = (cwTanya * 1.5) + cwMish;

            const div = document.createElement('div');
            div.className = 'card';
            div.style.borderTop = `6px solid var(--${t.color})`;
            div.innerHTML = `<h3>קבוצה ${t.name}</h3><p style="font-size:24px; margin:5px 0;"><strong>${score.toFixed(1)} נקודות</strong></p><small>תניא: ${cwTanya} | משניות: ${cwMish}</small>`;
            container.appendChild(div);
        });
    } else {
        title.innerText = "התקדמות בתים";
        const uniqueBunks = [...new Set(stateMemory.campers.map(c => c.bunk))].filter(Boolean);
        let maxVal = 1;

        const rollups = uniqueBunks.map(b => {
            const match = stateMemory.campers.filter(c => c.bunk === b);
            const data = {
                name: b,
                duch: match.reduce((s, c) => s + (c.duch || 0), 0),
                tanya: match.reduce((s, c) => s + (c.tanya || 0), 0),
                mishnayos: match.reduce((s, c) => s + (c.mishnayos || 0), 0)
            };
            const sum = data.duch + data.tanya + data.mishnayos;
            if (sum > maxVal) maxVal = sum;
            return data;
        });

        rollups.forEach(b => {
            const div = document.createElement('div');
            div.className = 'metric-container';
            div.innerHTML = `
                <strong>${b.name}</strong>
                <div class="metric-bars-row">
                    <div class="metric-bar-col">
                        <span class="metric-bar-label">דו"ח</span>
                        <div class="progress-channel-bg"><div class="progress-fill fill-duch" style="width: ${(b.duch/maxVal)*100}%"></div></div>
                        <span class="metric-bar-value">${b.duch}</span>
                    </div>
                    <div class="metric-bar-col">
                        <span class="metric-bar-label">תניא</span>
                        <div class="progress-channel-bg"><div class="progress-fill fill-tanya" style="width: ${(b.tanya/maxVal)*100}%"></div></div>
                        <span class="metric-bar-value">${b.tanya}</span>
                    </div>
                    <div class="metric-bar-col">
                        <span class="metric-bar-label">משניות</span>
                        <div class="progress-channel-bg"><div class="progress-fill fill-mishnayos" style="width: ${(b.mishnayos/maxVal)*100}%"></div></div>
                        <span class="metric-bar-value">${b.mishnayos}</span>
                    </div>
                </div>
            `;
            container.appendChild(div);
        });
    }
}

function generateCounselorDashboard() {
    const activeCamper = stateMemory.campers.find(c => c.id === stateMemory.activeCamperId);
    if (!activeCamper) return;

    document.getElementById('focused-camper-label').innerText = `Camper: ${activeCamper.name}`;
    document.getElementById('focused-bunk-label').innerText = `Bunk: ${activeCamper.bunk}`;

    const strip = document.getElementById('colorwar-context-strip');
    if (stateMemory.settings.colorWarState === 'active' && activeCamper.teamId && !stateMemory.settings.hideColorWarCounselor) {
        const team = stateMemory.teams.find(t => t.id === activeCamper.teamId);
        if (team) {
            strip.style.background = `var(--${team.color})`;
            strip.innerText = `Team ${team.name}`;
            strip.classList.remove('hidden');
        }
    } else {
        strip.classList.add('hidden');
    }

    const camperBox = document.getElementById('camper-totals-box');
    if (camperBox) {
        camperBox.innerHTML = `
            <p>Tanya: <strong>${activeCamper.tanya || 0}</strong></p><br>
            <p>Mishnayos: <strong>${activeCamper.mishnayos || 0}</strong></p><br>
            <p>Duch: <strong>${activeCamper.duch || 0}</strong></p>
        `;
    }

    const peers = stateMemory.campers.filter(c => c.bunk === activeCamper.bunk);
    document.getElementById('bunk-aggregates-box').innerHTML = `
        <p>Tanya: <strong>${peers.reduce((s,c)=>s+(c.tanya || 0), 0)}</strong></p><br>
        <p>Mishnayos: <strong>${peers.reduce((s,c)=>s+(c.mishnayos || 0), 0)}</strong></p><br>
        <p>Duch: <strong>${peers.reduce((s,c)=>s+(c.duch || 0), 0)}</strong></p>
    `;
}

// --- NFC CARD WRITING (registration) ---
window.bindNFCTagToRegistrationFlow = async function() {
    if (!('NDEFReader' in window)) {
        alert("NFC is not available on this device.");
        return;
    }

    const btn = document.getElementById('btn-register-nfc');
    const inputDisplay = document.getElementById('new-camper-nfc-token');

    btn.disabled = true;
    btn.innerText = "⏳ Hold card to write...";
    inputDisplay.value = "Scanning...";

    try {
        const ndef = new NDEFReader();
        await ndef.scan();

        const generatedTrackingCode = "m_" + Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
        alert("Hold the card against the device to write it.");

        await ndef.write({
            records: [{ recordType: "text", data: `machane-auth:${generatedTrackingCode}` }]
        });

        stateMemory.pendingRegisterNfcToken = generatedTrackingCode;
        inputDisplay.value = generatedTrackingCode;
        btn.innerText = "✅ Card linked";
        btn.className = "action-btn success-btn";
        if (navigator.vibrate) navigator.vibrate(200);
    } catch (err) {
        console.error(err);
        btn.disabled = false;
        btn.innerText = "📟 Scan Card";
        inputDisplay.value = "Couldn't write the card.";
    }
};

// --- ADD NEW CAMPER ---
window.createNewCamperAccount = async function(e) {
    e.preventDefault();
    const name = document.getElementById('new-camper-name').value.trim();
    const bunk = document.getElementById('new-camper-bunk').value.trim();

    let chosenIdentifierKey = stateMemory.pendingRegisterNfcToken;
    if (!chosenIdentifierKey) {
        const baseId = name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
        chosenIdentifierKey = baseId;
        let suffix = 0;
        while (stateMemory.campers.some(c => c.id === chosenIdentifierKey)) {
            suffix++;
            chosenIdentifierKey = baseId + '_' + suffix;
        }
    }

    if (!chosenIdentifierKey) {
        alert("Enter a camper name or scan a card first.");
        return;
    }

    try {
        await setDoc(doc(db, "campers", chosenIdentifierKey.toLowerCase()), {
            name: name,
            bunk: bunk,
            password: "12345",
            duch: 0,
            tanya: 0,
            mishnayos: 0,
            teamId: null,
            cwBaseTanya: 0,
            cwBaseMish: 0
        });
        alert(`Camper added! Login username: ${chosenIdentifierKey.toLowerCase()}`);

        document.getElementById('new-camper-name').value = '';
        document.getElementById('new-camper-bunk').value = '';
        stateMemory.pendingRegisterNfcToken = null;

        const displayEl = document.getElementById('new-camper-nfc-token');
        if (displayEl) displayEl.value = "No card scanned yet";

        const nfcBtn = document.getElementById('btn-register-nfc');
        if (nfcBtn) {
            nfcBtn.disabled = false;
            nfcBtn.innerText = "📟 Scan Card";
            nfcBtn.className = "action-btn secondary-btn";
        }
    } catch(err) { console.error(err); }
};

window.loadCamperIntoProfileEditor = function(camperId) {
    const area = document.getElementById('profile-editor-form');
    if (!camperId) { area.classList.add('hidden'); return; }

    const camper = stateMemory.campers.find(c => c.id === camperId);
    if (!camper) return;

    document.getElementById('edit-c-name').value = camper.name || '';
    document.getElementById('edit-c-bunk').value = camper.bunk || '';
    document.getElementById('edit-c-duch').value = camper.duch || 0;
    document.getElementById('edit-c-tanya').value = camper.tanya || 0;
    document.getElementById('edit-c-mishnayos').value = camper.mishnayos || 0;

    area.classList.remove('hidden');
};

window.saveCamperProfileEdits = async function() {
    const id = document.getElementById('admin-camper-selector').value;
    if (!id) return;

    try {
        await updateDoc(doc(db, "campers", id), {
            name: document.getElementById('edit-c-name').value.trim(),
            bunk: document.getElementById('edit-c-bunk').value.trim(),
            duch: parseInt(document.getElementById('edit-c-duch').value) || 0,
            tanya: parseInt(document.getElementById('edit-c-tanya').value) || 0,
            mishnayos: parseInt(document.getElementById('edit-c-mishnayos').value) || 0
        });
        alert("Saved!");
    } catch(err) { console.error(err); }
};

window.wipeAndRewriteActiveCamperCard = async function() {
    const selectedCamperId = document.getElementById('admin-camper-selector').value;
    if (!selectedCamperId) {
        alert("Please choose a camper first.");
        return;
    }

    if (!('NDEFReader' in window)) {
        alert("NFC is not available on this device.");
        return;
    }

    if (!confirm("Write a new card for this camper? The old card will stop working.")) return;

    try {
        const ndef = new NDEFReader();
        await ndef.scan();

        const reorderedSecureCode = "m_" + Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
        alert("Hold the new card against the device to write it.");

        await ndef.write({
            records: [{ recordType: "text", data: `machane-auth:${reorderedSecureCode}` }]
        });

        await runTransaction(db, async (transaction) => {
            const oldRef = doc(db, "campers", selectedCamperId);
            const newRef = doc(db, "campers", reorderedSecureCode);
            const oldSnap = await transaction.get(oldRef);

            if (oldSnap.exists()) {
                transaction.set(newRef, oldSnap.data());
                transaction.delete(oldRef);
            }
        });

        document.getElementById('profile-editor-form').classList.add('hidden');
        document.getElementById('admin-camper-selector').value = "";
        alert("New card written! The old card no longer works.");
        if (navigator.vibrate) navigator.vibrate([150, 100, 150]);
    } catch (err) {
        console.error(err);
        alert("Couldn't write the card. Try again.");
    }
};

window.deleteCamperProfile = async function() {
    const id = document.getElementById('admin-camper-selector').value;
    if (id && confirm("Delete this camper for good?")) {
        await deleteDoc(doc(db, "campers", id));
        document.getElementById('profile-editor-form').classList.add('hidden');
        alert("Camper deleted.");
    }
};

function populateCamperDropdowns() {
    const adminSel = document.getElementById('admin-camper-selector');
    if (!adminSel) return;

    const lastAdminSel = adminSel.value;
    adminSel.innerHTML = '<option value="">-- Choose a camper to edit --</option>';

    stateMemory.campers.forEach(c => {
        const str = `<option value="${c.id}">${c.name || 'Unknown'} (${c.bunk || 'No bunk'})</option>`;
        adminSel.insertAdjacentHTML('beforeend', str);
    });

    adminSel.value = lastAdminSel;
}

// --- SPREADSHEET ---
window.toggleDataSorting = function(col) {
    if (stateMemory.sorting.column === col) {
        stateMemory.sorting.ascending = !stateMemory.sorting.ascending;
    } else {
        stateMemory.sorting.column = col;
        stateMemory.sorting.ascending = true;
    }
    generateSpreadsheetLedger();
};

function generateSpreadsheetLedger() {
    const tbody = document.getElementById('spreadsheet-matrix-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    let pool = [...stateMemory.campers];
    const col = stateMemory.sorting.column;
    const dir = stateMemory.sorting.ascending ? 1 : -1;

    pool.sort((a, b) => {
        if ((a[col] || '') < (b[col] || '')) return -1 * dir;
        if ((a[col] || '') > (b[col] || '')) return 1 * dir;
        return 0;
    });

    const verifyBreak = (col === 'bunk' || col === 'teamId');
    let currentCategoryNode = null;

    pool.forEach(c => {
        if (verifyBreak && c[col] !== currentCategoryNode) {
            currentCategoryNode = c[col];
            const sepRow = document.createElement('tr');
            sepRow.className = 'category-split-header';
            sepRow.innerHTML = `<td colspan="6">${col === 'bunk' ? (currentCategoryNode || 'No Bunk') : 'Team: ' + (currentCategoryNode || 'No Team')}</td>`;
            tbody.appendChild(sepRow);
        }

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><input type="text" value="${c.name || ''}" onchange="mutateStorageCell('${c.id}', 'name', this.value)"></td>
            <td><input type="text" value="${c.bunk || ''}" onchange="mutateStorageCell('${c.id}', 'bunk', this.value)"></td>
            <td><input type="number" value="${c.duch || 0}" onchange="mutateStorageCell('${c.id}', 'duch', this.value)"></td>
            <td><input type="number" value="${c.tanya || 0}" onchange="mutateStorageCell('${c.id}', 'tanya', this.value)"></td>
            <td><input type="number" value="${c.mishnayos || 0}" onchange="mutateStorageCell('${c.id}', 'mishnayos', this.value)"></td>
            <td><input type="text" value="${c.teamId || ''}" placeholder="None" onchange="mutateStorageCell('${c.id}', 'teamId', this.value)"></td>
        `;
        tbody.appendChild(tr);
    });
}

window.mutateStorageCell = async function(id, key, val) {
    const ref = doc(db, "campers", id);
    const parsed = ['duch','tanya','mishnayos'].includes(key) ? (parseInt(val) || 0) : val;
    try { await updateDoc(ref, { [key]: parsed }); } catch (e) { console.error(e); }
};

window.propagateGlobalSettings = async function() {
    const ref = doc(db, "system", "settings");
    try {
        await updateDoc(ref, {
            hideColorWarScoreboard: document.getElementById('chk-hide-sb').checked,
            hideColorWarCounselor: document.getElementById('chk-hide-counselor').checked
        });
    } catch (e) { console.error(e); }
};

// --- COLOR WAR ---
window.launchColorWarOrchestratorView = function() { router('setteams'); };

window.advanceCWPhase = async function(phase) {
    if (phase === 'pre') {
        if (confirm("Save current points and start Color War setup?")) {
            await setDoc(doc(db, "system", "settings"), {
                colorWarState: "pre",
                hideColorWarScoreboard: false,
                hideColorWarCounselor: false
            }, { merge: true });
        }
    } else if (phase === 'allocation') {
        if (stateMemory.teams.length === 0) {
            alert("Add at least one team first.");
            return;
        }
        document.getElementById('step-cw-teams').classList.add('hidden');
        document.getElementById('step-cw-alloc').classList.remove('hidden');
        renderDragAndDropMatrix();
    }
};

window.commitTeamToRoster = async function() {
    const nameEl = document.getElementById('txt-cw-team-name');
    const colorEl = document.getElementById('sel-cw-team-color');
    const label = nameEl.value.trim();
    if (!label) return;

    const id = 'team-' + Date.now();
    await setDoc(doc(db, "teams", id), { name: label, color: colorEl.value });
    nameEl.value = '';
};

function syncCWWorkflowUI() {
    const activePhase = stateMemory.settings.colorWarState;
    if (activePhase === 'inactive') return;

    const manifest = document.getElementById('cw-manifest-display-box');
    if (manifest) manifest.innerText = "Teams: " + (stateMemory.teams.map(t => t.name).join(', ') || 'None');

    const allocStep = document.getElementById('step-cw-alloc');
    if (allocStep && !allocStep.classList.contains('hidden')) {
        renderDragAndDropMatrix();
        return;
    }

    const teamsStep = document.getElementById('step-cw-teams');
    if (teamsStep && !teamsStep.classList.contains('hidden')) {
        return;
    }

    document.getElementById('step-cw-init').classList.add('hidden');
    document.getElementById('step-cw-teams').classList.remove('hidden');
}

function renderDragAndDropMatrix() {
    const pool = document.getElementById('pool-unassigned');
    const zones = document.getElementById('row-team-dropzones');
    if(!pool || !zones) return;
    
    pool.innerHTML = '';
    zones.innerHTML = '';

    stateMemory.campers.filter(c => !c.teamId).forEach(c => {
        const div = document.createElement('div');
        div.className = 'camper-draggable-token';
        div.innerText = c.name;
        div.draggable = true;
        div.id = `drag-${c.id}`;
        div.addEventListener('dragstart', (e) => e.dataTransfer.setData('text/plain', c.id));
        pool.appendChild(div);
    });

    stateMemory.teams.forEach(t => {
        const zone = document.createElement('div');
        zone.className = 'target-node-zone';
        zone.style.borderColor = `var(--${t.color})`;
        zone.innerHTML = `<h4 style="background:var(--${t.color})">${t.name}</h4><div class="nested-token-box" id="node-box-${t.id}"></div>`;
        
        zone.addEventListener('dragover', (e) => e.preventDefault());
        zone.addEventListener('drop', (e) => handleDropAssignment(e, t.id));
        zones.appendChild(zone);

        const targetBox = zone.querySelector('.nested-token-box');
        stateMemory.campers.filter(c => c.teamId === t.id).forEach(c => {
            const token = document.createElement('div');
            token.className = 'camper-draggable-token';
            token.innerText = c.name;
            token.draggable = true;
            token.id = `drag-${c.id}`;
            token.addEventListener('dragstart', (e) => e.dataTransfer.setData('text/plain', c.id));
            targetBox.appendChild(token);
        });
    });
}

window.handleDropAssignment = async function(e, targetTeamId) {
    e.preventDefault();
    const camperId = e.dataTransfer.getData('text/plain');
    const ref = doc(db, "campers", camperId);
    const assignValue = (targetTeamId === 'unassigned') ? null : targetTeamId;
    try { await updateDoc(ref, { teamId: assignValue }); } catch(err) { console.error(err); }
};

window.finalizeAndLaunchColorWar = async function() {
    if (confirm("Start Color War now?")) {
        const batch = writeBatch(db);
        stateMemory.campers.forEach(c => {
            const ref = doc(db, "campers", c.id);
            batch.update(ref, { cwBaseTanya: c.tanya || 0, cwBaseMish: c.mishnayos || 0 });
        });
        batch.update(doc(db, "system", "settings"), { colorWarState: "active" });
        try {
            await batch.commit();
            router('scoreboard');
            alert("Color War is on!");
        } catch (e) { console.error(e); }
    }
};

window.emergencyEndColorWar = async function() {
    if (confirm("End Color War now?")) {
        try {
            await updateDoc(doc(db, "system", "settings"), { colorWarState: "inactive" });
            router('admin');
        } catch(e) { console.error(e); }
    }
};

// --- AUTO SCROLL ---
function startClock() {
    setInterval(() => {
        const target = document.getElementById('live-clock');
        if (target) target.innerText = `זמן: ${new Date().toLocaleTimeString()}`;
    }, 1000);
}

function setupInteractionTriggers() {
    window.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'j') { e.preventDefault(); toggleScrollLoop(); }
    });
    window.addEventListener('contextmenu', (e) => {
        if (document.getElementById('view-scoreboard').classList.contains('active')) { e.preventDefault(); toggleScrollLoop(); }
    });
}

function toggleScrollLoop() {
    stateMemory.activeScroller = !stateMemory.activeScroller;
    killScrollIntervals();
    const ind = document.getElementById('scroll-status-msg');
    if (ind) ind.innerText = stateMemory.activeScroller ? "Auto-scroll: ON" : "Ctrl+J or Right-Click to toggle auto-scroll";
    if (stateMemory.activeScroller) {
        stateMemory.scrollerLoops.push(runScrollCycle(document.getElementById('panel-campers')));
        stateMemory.scrollerLoops.push(runScrollCycle(document.getElementById('panel-progress')));
    }
}

function runScrollCycle(el) {
    if (!el) return null;
    return setInterval(() => {
        el.scrollTop += 1;
        if (el.scrollTop >= (el.scrollHeight - el.clientHeight - 1)) el.scrollTop = 0;
    }, 25);
}

function killScrollIntervals() {
    stateMemory.scrollerLoops.forEach(clearInterval);
    stateMemory.scrollerLoops = [];
}

// --- NAV AUTO-FADE ON COMPUTERS (cursor idle 20s) ---
function setupNavAutoFade() {
    const isComputer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    if (!isComputer) return;

    const nav = document.getElementById('app-nav');
    if (!nav) return;

    let idleTimer = null;
    const FADE_DELAY = 20000;

    function showNav() {
        nav.classList.remove('nav-faded');
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(() => nav.classList.add('nav-faded'), FADE_DELAY);
    }

    document.addEventListener('mousemove', showNav);
    document.addEventListener('mousedown', showNav);
    document.addEventListener('keydown', showNav);
    document.addEventListener('touchstart', showNav);

    nav.addEventListener('mouseenter', () => {
        if (idleTimer) clearTimeout(idleTimer);
    });
    nav.addEventListener('mouseleave', showNav);

    showNav();
}

startClock();
setupInteractionTriggers();
setupNavAutoFade();
initRealtimeSync();
refreshDeviceAuthStatus();
setTimeout(startNfcLoginPassiveListener, 1000);