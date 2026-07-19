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
    pendingRegisterNfcToken: null
};

// --- INITIALIZE REAL-TIME CLOUD STORAGE STREAM LISTENERS ---
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

// --- APP VIEW ROUTER ENGINE ---
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
};

// --- ADAPTIVE SUB-MENU PANEL WORKSPACE CONTROLLER SWITCH ---
window.switchAdminSubWorkspace = function(paneId) {
    document.querySelectorAll('.admin-subpane').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.sidebar-tab-btn').forEach(b => b.classList.remove('active'));
    
    const targetPane = document.getElementById(paneId);
    const targetTab = document.getElementById(`tab-${paneId}`);
    
    if (targetPane) targetPane.classList.add('active');
    if (targetTab) targetTab.classList.add('active');
};

// --- AUTOMATED BACKGROUND PASSIVE NFC PORTAL LISTENER LOOP ---
async function startNfcLoginPassiveListener() {
    if (!('NDEFReader' in window)) {
        console.warn("⚠️ Web NFC hardware standards are unavailable or disabled on this device workspace.");
        const radar = document.getElementById('nfc-login-radar-box');
        if (radar) {
            radar.style.background = "#fef2f2";
            radar.style.borderColor = "#ef4444";
            radar.innerHTML = `<strong style="color: #991b1b;">NFC Standard Offline</strong><br><small style="color: #b91c1c;">Please write parameters manually or run from an Android Chrome browser setup.</small>`;
        }
        return;
    }

    try {
        const ndef = new NDEFReader();
        await ndef.scan();
        console.log("📡 Passive NFC authentication gateway scanner operational.");

        ndef.addEventListener("reading", ({ message }) => {
            if (!document.getElementById('view-login').classList.contains('active')) return;

            for (const record of message.records) {
                if (record.recordType === "text") {
                    const textDecoder = new TextDecoder();
                    const rawPayload = textDecoder.decode(record.data);
                    
                    if (rawPayload.startsWith("machane-auth:")) {
                        const extractedId = rawPayload.replace("machane-auth:", "").trim();
                        executeAutomaticNfcLogin(extractedId);
                        break;
                    }
                }
            }
        });
    } catch (error) {
        console.error("❌ Failed to bind active proximity reader framework session context:", error);
    }
}

function executeAutomaticNfcLogin(camperId) {
    const targetProfile = stateMemory.campers.find(c => String(c.id).trim().toLowerCase() === String(camperId).trim().toLowerCase());
    
    if (targetProfile) {
        stateMemory.activeCamperId = targetProfile.id;
        document.getElementById('nav-counselor').classList.remove('hidden');
        if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
        router('addlines');
    } else {
        alert("NFC Access Token Rejected: Decoded target reference address does not match entries inside the active registry directory.");
    }
}

// --- SANITIZED MANUAL BACKUP PASSWORD AUTHENTICATION GATEWAY ---
window.authenticateUserSession = function() {
    const user = document.getElementById('input-username').value.trim().toLowerCase();
    const pass = document.getElementById('input-password').value.trim();

    if (user === 'admin' && pass === '11213') {
        document.getElementById('nav-admin').classList.remove('hidden');
        document.getElementById('nav-spread').classList.remove('hidden');
        router('admin');
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
        alert("Security Verification Failed: The provided user identity and account password combination is invalid.");
    }
};

// --- REAL-TIME TRANSACTION QUANTITY FORM INPUT HANDLERS ---
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
        alert("Server write successfully synchronized.");
    } catch (error) {
        console.error(error);
        alert("Database execution failed.");
    } finally {
        trigger.disabled = false;
        overlay.classList.add('hidden');
    }
};

// --- HIGH-PERFORMANCE PUBLIC VIEW DISPLAY REGENERATION ENGINE ---
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
        tr.innerHTML = `<td>${c.name || 'Unknown'}</td><td>${c.bunk || 'Unassigned'}</td><td>${c.duch || 0}</td><td>${c.tanya || 0}</td><td>${c.mishnayos || 0}</td>`;
        tbody.appendChild(tr);
    });

    if (showColorWarData) {
        title.innerText = "🏆 Live Color War Team Standings Matrix";
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
            div.innerHTML = `<h3>Team ${t.name}</h3><p style="font-size:24px; margin:5px 0;"><strong>${score.toFixed(1)} Pts</strong></p><small>Tanya: ${cwTanya} | Mishnayos: ${cwMish}</small>`;
            container.appendChild(div);
        });
    } else {
        title.innerText = "Bunk Progress Tracker";
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
                <strong>${b.name} Structural Aggregates</strong>
                <div class="progress-channel-bg"><div class="progress-fill fill-duch" style="width: ${(b.duch/maxVal)*100}%"></div></div>
                <div class="progress-channel-bg"><div class="progress-fill fill-tanya" style="width: ${(b.tanya/maxVal)*100}%"></div></div>
                <div class="progress-channel-bg"><div class="progress-fill fill-mishnayos" style="width: ${(b.mishnayos/maxVal)*100}%"></div></div>
            `;
            container.appendChild(div);
        });
    }
}

function generateCounselorDashboard() {
    const activeCamper = stateMemory.campers.find(c => c.id === stateMemory.activeCamperId);
    if (!activeCamper) return;

    document.getElementById('focused-camper-label').innerText = `Camper Identity focus: ${activeCamper.name}`;
    document.getElementById('focused-bunk-label').innerText = `Bunk Context Assignment: ${activeCamper.bunk}`;

    const strip = document.getElementById('colorwar-context-strip');
    if (stateMemory.settings.colorWarState === 'active' && activeCamper.teamId && !stateMemory.settings.hideColorWarCounselor) {
        const team = stateMemory.teams.find(t => t.id === activeCamper.teamId);
        if (team) {
            strip.style.background = `var(--${team.color})`;
            strip.innerText = `Active Operational Channel: Team ${team.name}`;
            strip.classList.remove('hidden');
        }
    } else {
        strip.classList.add('hidden');
    }

    const peers = stateMemory.campers.filter(c => c.bunk === activeCamper.bunk);
    document.getElementById('bunk-aggregates-box').innerHTML = `
        <p>Tanya Cumulative Lines: <strong>${peers.reduce((s,c)=>s+(c.tanya || 0), 0)}</strong></p><br>
        <p>Mishnayos Cumulative Lines: <strong>${peers.reduce((s,c)=>s+(c.mishnayos || 0), 0)}</strong></p><br>
        <p>Duch Unified Points: <strong>${peers.reduce((s,c)=>s+(c.duch || 0), 0)}</strong></p>
    `;
}

// --- HARDWARE PAIRING INTEGRATION WRITERS FLOW ---
window.bindNFCTagToRegistrationFlow = async function() {
    if (!('NDEFReader' in window)) {
        alert("Web NFC standard protocols are not supported or exposed on this browser window context.");
        return;
    }

    const btn = document.getElementById('btn-register-nfc');
    const inputDisplay = document.getElementById('new-camper-nfc-token');
    
    btn.disabled = true;
    btn.innerText = "⏳ Awaiting Device Tap Proximity...";
    inputDisplay.value = "Status: Probing Hardware Track...";

    try {
        const ndef = new NDEFReader();
        await ndef.scan();
        
        const generatedTrackingCode = "m_" + Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
        alert("Device Proximity Sensor Hot: Hold unassigned tag against card loop to flash internal storage sectors.");
        
        await ndef.write({
            records: [{ recordType: "text", data: `machane-auth:${generatedTrackingCode}` }]
        });

        stateMemory.pendingRegisterNfcToken = generatedTrackingCode;
        inputDisplay.value = generatedTrackingCode;
        btn.innerText = "✅ Pairing Bound Successfully";
        btn.className = "action-btn success-btn";
        if (navigator.vibrate) navigator.vibrate(200);
    } catch (err) {
        console.error(err);
        btn.disabled = false;
        btn.innerText = "📟 Assign Card Scan Link";
        inputDisplay.value = "Error: Writing execution failed.";
    }
};

// --- INTERACTIVE CAMPER REGISTRATION & DIRECT LOOKUP MANIPULATION ---
window.createNewCamperAccount = async function(e) {
    e.preventDefault();
    const inputId = document.getElementById('new-camper-id').value.trim();
    const name = document.getElementById('new-camper-name').value.trim();
    const bunk = document.getElementById('new-camper-bunk').value.trim();
    const pin = document.getElementById('new-camper-pass').value.trim();

    const chosenIdentifierKey = stateMemory.pendingRegisterNfcToken || inputId;

    if (!chosenIdentifierKey) {
        alert("Please specify a manual text login ID string name OR tap an active card transponder to register properties.");
        return;
    }

    try {
        await setDoc(doc(db, "campers", chosenIdentifierKey.toLowerCase()), {
            name: name,
            bunk: bunk,
            password: pin || "12345",
            duch: 0,
            tanya: 0,
            mishnayos: 0,
            teamId: null,
            cwBaseTanya: 0,
            cwBaseMish: 0
        });
        alert(`Account configured successfully for lookup identifier reference string: ${chosenIdentifierKey.toLowerCase()}`);
        
        // Reset registration element containers to baseline defaults
        document.getElementById('new-camper-id').value = '';
        document.getElementById('new-camper-name').value = '';
        document.getElementById('new-camper-bunk').value = '';
        document.getElementById('new-camper-pass').value = '';
        stateMemory.pendingRegisterNfcToken = null;
        
        const displayEl = document.getElementById('new-camper-nfc-token');
        if (displayEl) displayEl.value = "NFC Status: No Tag Registered";
        
        const nfcBtn = document.getElementById('btn-register-nfc');
        if (nfcBtn) {
            nfcBtn.disabled = false;
            nfcBtn.innerText = "📟 Assign Card Scan Link";
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
    document.getElementById('edit-c-pass').value = camper.password || '12345';

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
            mishnayos: parseInt(document.getElementById('edit-c-mishnayos').value) || 0,
            password: document.getElementById('edit-c-pass').value.trim()
        });
        alert("Profile modifications committed successfully.");
    } catch(err) { console.error(err); }
};

window.wipeAndRewriteActiveCamperCard = async function() {
    const selectedCamperId = document.getElementById('admin-camper-selector').value;
    if (!selectedCamperId) {
        alert("Please choose a target profile matrix item drop node array reference first.");
        return;
    }

    if (!('NDEFReader' in window)) {
        alert("NFC features are offline on this connection interface client window layout rules engine.");
        return;
    }

    if (!confirm("Completely discard any historical chip keys and overwrite this card's validation tokens?")) return;

    try {
        const ndef = new NDEFReader();
        await ndef.scan();
        
        const reorderedSecureCode = "m_" + Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
        alert("Ready to transmit configuration bytes. Touch physical smartcard node tracking strip against device loop.");
        
        await ndef.write({
            records: [{ recordType: "text", data: `machane-auth:${reorderedSecureCode}` }]
        });

        // Use a secure atomized operation transaction to shift the baseline document ID mapping layout
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
        alert("Chip flashed successfully. Old ID parameters dropped and profile database paths rebuilt.");
        if (navigator.vibrate) navigator.vibrate([150, 100, 150]);
    } catch (err) {
        console.error(err);
        alert("Flash Error: The connection sequence dropped before properties written could finish streaming.");
    }
};

window.deleteCamperProfile = async function() {
    const id = document.getElementById('admin-camper-selector').value;
    if (id && confirm("Permanently drop this camper account record link document?")) {
        await deleteDoc(doc(db, "campers", id));
        document.getElementById('profile-editor-form').classList.add('hidden');
        alert("Account purged from database reference layers.");
    }
};

function populateCamperDropdowns() {
    const adminSel = document.getElementById('admin-camper-selector');
    if (!adminSel) return;

    const lastAdminSel = adminSel.value;
    adminSel.innerHTML = '<option value="">-- Choose a Profile Document to Edit --</option>';

    stateMemory.campers.forEach(c => {
        const str = `<option value="${c.id}">${c.name || 'Unknown'} [Login ID: ${c.id}] (${c.bunk || 'Unassigned'})</option>`;
        adminSel.insertAdjacentHTML('beforeend', str);
    });

    adminSel.value = lastAdminSel;
}

// --- MASTER SPREADSHEET LEDGER MATRIX GRID ENGINE ---
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
            sepRow.innerHTML = `<td colspan="7">${col === 'bunk' ? (currentCategoryNode || 'No Bunk Assigned') : 'Team Assignment Identifier Node Map: ' + (currentCategoryNode || 'Unallocated Profiles')}</td>`;
            tbody.appendChild(sepRow);
        }

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td style="background: #f1f5f9; font-family: monospace; font-weight: bold; color: #475569;">${c.id}</td>
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

// --- COLOR WAR STEP RUNTIME CALCULATIONS WIZARD ---
window.launchColorWarOrchestratorView = function() { router('setteams'); };

window.advanceCWPhase = async function(phase) {
    if (phase === 'pre') {
        if (confirm("Freeze data fields and enter Pre-Color War state mapping tracks?")) {
            await setDoc(doc(db, "system", "settings"), {
                colorWarState: "pre",
                hideColorWarScoreboard: false,
                hideColorWarCounselor: false
            }, { merge: true });
        }
    } else if (phase === 'allocation') {
        syncCWWorkflowUI();
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

    document.getElementById('step-cw-init').classList.add('hidden');
    document.getElementById('step-cw-teams').classList.remove('hidden');

    const manifest = document.getElementById('cw-manifest-display-box');
    if (manifest) manifest.innerText = "Configured Rosters: " + (stateMemory.teams.map(t => t.name).join(', ') || 'None');

    if (stateMemory.teams.length > 0 && document.getElementById('view-setteams').classList.contains('active')) {
        document.getElementById('step-cw-teams').classList.add('hidden');
        document.getElementById('step-cw-alloc').classList.remove('hidden');
        renderDragAndDropMatrix();
    }
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
    if (confirm("Confirm system operational activation deployment?")) {
        const batch = writeBatch(db);
        stateMemory.campers.forEach(c => {
            const ref = doc(db, "campers", c.id);
            batch.update(ref, { cwBaseTanya: c.tanya || 0, cwBaseMish: c.mishnayos || 0 });
        });
        batch.update(doc(db, "system", "settings"), { colorWarState: "active" });
        try {
            await batch.commit();
            router('scoreboard');
            alert("Color War Calculations Systems Online.");
        } catch (e) { console.error(e); }
    }
};

window.emergencyEndColorWar = async function() {
    if (confirm("Force emergency override shutdown command sequence?")) {
        try {
            await updateDoc(doc(db, "system", "settings"), { colorWarState: "inactive" });
            router('admin');
        } catch(e) { console.error(e); }
    }
};

// --- AUTO MARQUEE SCREEN SCROLL OVERLAYS CONTROLLERS ---
function startClock() {
    setInterval(() => {
        const target = document.getElementById('live-clock');
        if (target) target.innerText = `Time: ${new Date().toLocaleTimeString()}`;
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
    if (ind) ind.innerText = stateMemory.activeScroller ? "[Auto Scroll Engine: ACTIVE]" : "[Ctrl+J or Right-Click anywhere to toggle infinite layout scrolling]";
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

startClock();
setupInteractionTriggers();
initRealtimeSync();
setTimeout(startNfcLoginPassiveListener, 1000);