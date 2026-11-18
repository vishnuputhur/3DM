'use strict';

// ═══════════════════════════════════════════════════════════
// 1. LOCALSTORAGE SAVED PLATES & LINES REPOSITORY
// ═══════════════════════════════════════════════════════════
const SAVED_PLATES_KEY = 'vt_forming_saved_plates_v1';

function getSavedPlates() {
  try {
    return JSON.parse(localStorage.getItem(SAVED_PLATES_KEY) || '[]');
  } catch (e) {
    return [];
  }
}

function savePlateRecord(record) {
  try {
    const list = getSavedPlates();
    const idx = list.findIndex(p => p.id === record.id);
    if (idx !== -1) list[idx] = record;
    else list.unshift(record);
    localStorage.setItem(SAVED_PLATES_KEY, JSON.stringify(list));
    return true;
  } catch (e) {
    console.warn('Storage full:', e);
    return false;
  }
}

function deleteSavedPlateRecord(id) {
  try {
    const list = getSavedPlates().filter(p => p.id !== id);
    localStorage.setItem(SAVED_PLATES_KEY, JSON.stringify(list));
  } catch (e) {}
}

// ═══════════════════════════════════════════════════════════
// 2. FORMING STUDIO 3D ENGINE & STATE
// ═══════════════════════════════════════════════════════════
let fScene, fCamera, fRenderer, fControls;
let fPlateMesh = null;
let fLinesVisualGroup = new THREE.Group();
let fTempPickGroup = new THREE.Group();
let formingStudioInitialized = false;

let currentPlate = null;
let plateEdgesInfo = [];
let topEdgeMid = null, fwdEdgeMid = null;
let htmlLabels = [];

// Modes: 'view' | 'pick_start' | 'pick_end'
let mode = 'view';
let tempStartPt = null;
let divisionPitch = 200;
let activeLineId = null;

// ═══════════════════════════════════════════════════════════
// 3. EXACT ORIGINAL MODAL DOM BUILDER (WORKS DIRECTLY OVER INDEX)
// ═══════════════════════════════════════════════════════════
function buildFormingModalDOM() {
  if (!document.getElementById('vt-forming-styles')) {
    const style = document.createElement('style');
    style.id = 'vt-forming-styles';
    style.textContent = `
      #forming-studio-modal {
        position: fixed; inset: 0; width: 100%; height: 100%;
        background: #090d16; z-index: 9999; display: none; overflow: hidden;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        color: #f8fafc; touch-action: none; user-select: none; -webkit-user-select: none;
      }
      #forming-canvas-container { position: absolute; inset: 0; width: 100%; height: 100%; z-index: 1; }

      /* Top Header */
      .f-top-bar {
        position: absolute; top: 8px; left: 8px; right: 8px; height: 42px;
        display: flex; justify-content: space-between; align-items: center; gap: 6px;
        background: rgba(15, 23, 42, 0.94); backdrop-filter: blur(10px);
        padding: 0 10px; border-radius: 10px; border: 1px solid #1e293b; z-index: 20;
      }
      .f-top-left { display: flex; align-items: center; gap: 6px; min-width: 0; }
      .f-btn-top {
        background: #1e293b; color: #f8fafc; border: 1px solid #334155;
        padding: 5px 8px; border-radius: 6px; font-size: 11px; font-weight: 700;
        text-decoration: none; cursor: pointer; white-space: nowrap; flex-shrink: 0;
      }
      .f-btn-save-plate { background: #059669; border-color: #10b981; color: #fff; }
      .f-top-bar h1 { font-size: 13px; font-weight: 700; color: #38bdf8; margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .f-top-right { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
      .f-plate-tag {
        font-size: 10px; background: #0369a1; padding: 3px 7px; border-radius: 6px;
        font-weight: 600; max-width: 110px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }

      /* Status Banner */
      .f-sub-hud-row {
        position: absolute; top: 56px; left: 8px; right: 8px;
        display: flex; justify-content: space-between; align-items: flex-start; gap: 8px;
        z-index: 15; pointer-events: none;
      }
      .f-mode-banner {
        background: rgba(15, 23, 42, 0.92); border: 1px solid #334155;
        color: #e2e8f0; padding: 6px 10px; border-radius: 8px;
        font-size: 11px; font-weight: 600; line-height: 1.3;
        backdrop-filter: blur(6px); max-width: 65%; pointer-events: auto;
      }

      /* Collapsible Right Measurement Table Drawer */
      .f-table-wrapper {
        position: absolute; right: 0; top: 56px; bottom: 64px;
        z-index: 18; display: flex; align-items: flex-start;
        transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1);
        pointer-events: none;
      }
      .f-table-wrapper.collapsed { transform: translateX(100%); }
      .f-table-toggle-tab {
        position: absolute; right: 100%; top: 10px;
        background: rgba(15, 23, 42, 0.95); border: 1px solid #0284c7; border-right: none;
        color: #38bdf8; padding: 8px 6px; border-radius: 8px 0 0 8px;
        font-size: 10px; font-weight: 800; cursor: pointer; pointer-events: auto;
        writing-mode: vertical-rl; text-orientation: mixed; letter-spacing: 0.04em;
        box-shadow: -3px 2px 10px rgba(0,0,0,0.45);
      }
      .f-measure-panel {
        width: 245px; max-width: 72vw; max-height: 100%;
        background: rgba(15, 23, 42, 0.95); backdrop-filter: blur(10px);
        border: 1px solid #334155; border-right: none; border-radius: 12px 0 0 12px;
        padding: 10px; overflow-y: auto; pointer-events: auto;
        box-shadow: -4px 4px 18px rgba(0,0,0,0.55);
      }
      .f-m-sec-title { font-size: 10px; font-weight: 800; color: #38bdf8; text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 6px; }
      .f-trace-box {
        background: #090d16; border: 1px solid #1e293b; border-radius: 8px;
        padding: 7px 8px; margin-bottom: 8px; font-size: 10px; line-height: 1.45;
      }
      .f-trace-box b { color: #facc15; }
      .f-trace-box span { color: #94a3b8; }

      .f-m-table { width: 100%; border-collapse: collapse; font-size: 11px; font-family: monospace; }
      .f-m-table th { background: #1e293b; color: #94a3b8; padding: 5px 6px; text-align: left; font-size: 10px; }
      .f-m-table td { padding: 5px 6px; border-bottom: 1px solid #1e293b; color: #f8fafc; }
      .f-m-table td.val-col { color: #facc15; font-weight: 800; text-align: right; }

      /* Clean Background-Free Fixed-Size 3D Text Labels */
      .f-clean-3d-text {
        position: absolute; pointer-events: none; z-index: 10;
        font-family: monospace; font-weight: 800; font-size: 11px;
        transform: translate(-50%, -50%); white-space: nowrap;
        text-shadow: 0 1px 3px #000, 0 0 4px #000;
      }
      .f-txt-top { color: #39ff14; font-size: 11px; letter-spacing: 0.06em; }
      .f-txt-fwd { color: #facc15; font-size: 11px; letter-spacing: 0.06em; }
      .f-txt-pt  { color: #38bdf8; font-size: 10px; transform: translate(6px, -10px); }
      .f-txt-end { color: #f43f5e; font-size: 11px; transform: translate(6px, -12px); }

      /* Bottom Action Dock */
      .f-bottom-dock {
        position: absolute; bottom: 10px; left: 8px; right: 8px;
        display: flex; gap: 5px; justify-content: center; align-items: center; z-index: 20;
      }
      @media (min-width: 768px) {
        .f-bottom-dock {
          left: 50%; right: auto; transform: translateX(-50%);
          background: rgba(15, 23, 42, 0.92); padding: 6px 10px;
          border-radius: 14px; border: 1px solid #334155;
        }
        .f-dock-btn { min-width: 110px !important; padding: 0 12px !important; font-size: 12px !important; }
      }
      .f-dock-btn {
        flex: 1; min-width: 0; height: 38px;
        background: rgba(15, 23, 42, 0.95); color: #f8fafc; border: 1px solid #334155;
        padding: 0 6px; border-radius: 9px; font-size: 11px; font-weight: 700;
        cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 4px;
        backdrop-filter: blur(10px); box-shadow: 0 4px 10px rgba(0,0,0,0.4);
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      .f-dock-btn.active { background: #0284c7; border-color: #38bdf8; color: #fff; }
      .f-dock-btn.pick-armed { background: #059669; border-color: #34d399; color: #fff; animation: pulsePick 1.2s infinite; }
      .f-dock-btn.undo-btn { background: #7f1d1d; border-color: #ef4444; color: #fecaca; flex: 0.65; }
      .f-dock-btn.hidden { display: none; }

      @keyframes pulsePick {
        0%, 100% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.65); }
        50% { box-shadow: 0 0 0 6px rgba(16, 185, 129, 0); }
      }

      /* Magnifier Loupe */
      #f-magnifier {
        position: fixed; width: 110px; height: 110px; border-radius: 50%;
        border: 3px solid #10b981; box-shadow: 0 8px 24px rgba(0,0,0,0.85);
        pointer-events: none; z-index: 45; display: none; overflow: hidden;
        background: #090d16; transform: translate(-50%, -125%);
      }
      #f-magnifier canvas { width: 100%; height: 100%; display: block; }
      #f-magnifier::after {
        content: ''; position: absolute; inset: 0;
        background:
          linear-gradient(to right, transparent 49%, rgba(250,204,21,0.9) 49.5%, rgba(250,204,21,0.9) 50.5%, transparent 51%),
          linear-gradient(to bottom, transparent 49%, rgba(250,204,21,0.9) 49.5%, rgba(250,204,21,0.9) 50.5%, transparent 51%);
      }

      /* Bottom / Side Modals */
      .f-modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.6); z-index: 30; display: none; }
      .f-modal-backdrop.open { display: block; }
      .f-sheet-drawer {
        position: fixed; bottom: 0; left: 0; right: 0; max-height: 76vh;
        background: #0f172a; border-top: 1px solid #334155; border-radius: 18px 18px 0 0;
        padding: 16px; z-index: 35; overflow-y: auto;
        transform: translateY(100%); transition: transform 0.25s ease-out;
      }
      .f-sheet-drawer.open { transform: translateY(0); }
      @media (min-width: 768px) {
        .f-sheet-drawer {
          left: 50%; right: auto; bottom: auto; top: 50%; width: 420px;
          border-radius: 14px; border: 1px solid #334155;
          transform: translate(-50%, -50%) scale(0.95); opacity: 0; pointer-events: none;
        }
        .f-sheet-drawer.open { transform: translate(-50%, -50%) scale(1); opacity: 1; pointer-events: auto; }
      }
      .f-sheet-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; padding-bottom: 8px; border-bottom: 1px solid #1e293b; }
      .f-sheet-header h2 { font-size: 13px; color: #38bdf8; text-transform: uppercase; margin: 0; }
      .f-btn-close-sheet { background: #1e293b; border: 1px solid #334155; color: #fff; padding: 5px 10px; border-radius: 6px; font-size: 12px; font-weight: 700; cursor: pointer; }

      .f-list-card {
        display: flex; justify-content: space-between; align-items: center; gap: 8px;
        background: #090d16; padding: 10px; border-radius: 8px; border: 1px solid #1e293b;
        margin-bottom: 8px; font-size: 12px;
      }
      .f-list-card.selected { border-color: #0284c7; background: rgba(2, 132, 199, 0.14); }
      .f-list-card-info { flex: 1; min-width: 0; cursor: pointer; }
      .f-list-card-title { font-weight: 700; color: #f8fafc; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .f-list-card-sub { font-size: 10px; color: #94a3b8; margin-top: 2px; }
      .f-card-actions { display: flex; gap: 6px; flex-shrink: 0; }
      .f-icon-btn {
        background: #1e293b; border: 1px solid #334155; color: #e2e8f0;
        padding: 6px 9px; border-radius: 6px; font-size: 11px; font-weight: 700; cursor: pointer;
      }
      .f-icon-btn.danger { background: #7f1d1d; border-color: #991b1b; color: #fecaca; }
      .f-icon-btn.primary { background: #0284c7; border-color: #38bdf8; color: #fff; }

      .f-input-group { margin-bottom: 12px; }
      .f-input-group label { display: block; font-size: 11px; margin-bottom: 4px; color: #94a3b8; }
      .f-input-group input { width: 100%; padding: 9px 10px; background: #090d16; border: 1px solid #334155; border-radius: 8px; color: #fff; font-size: 13px; font-family: monospace; }
      .f-btn-full { width: 100%; padding: 10px; border: none; border-radius: 8px; background: #0284c7; color: #fff; font-weight: 700; font-size: 12px; cursor: pointer; }
    `;
    document.head.appendChild(style);
  }

  let modal = document.getElementById('forming-studio-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'forming-studio-modal';
    document.body.appendChild(modal);
  }

  modal.innerHTML = `
    <!-- Top Bar -->
    <div class="f-top-bar">
      <div class="f-top-left">
        <button class="f-btn-top" id="f-btn-close-forming">⬅ Viewer</button>
        <h1>📐 Forming Studio</h1>
      </div>
      <div class="f-top-right">
        <span class="f-plate-tag" id="f-plate-badge">Plate</span>
        <button class="f-btn-top f-btn-save-plate" id="f-btn-open-save-plate">💾 Save</button>
      </div>
    </div>

    <!-- Mode Status Banner -->
    <div class="f-sub-hud-row">
      <div class="f-mode-banner" id="f-mode-banner">🔍 Zoom plate or tap "Create Line"</div>
    </div>

    <!-- Collapsible Right Square-Drop Measurement Table -->
    <div class="f-table-wrapper collapsed" id="f-table-wrapper">
      <button class="f-table-toggle-tab" id="f-btn-toggle-table">📊 MEASUREMENTS</button>
      <div class="f-measure-panel">
        <div class="f-m-sec-title">
          <span id="f-tbl-line-title">No Line Selected</span>
        </div>
        <div class="f-trace-box" id="f-tbl-trace-info">
          Draw a line to see edge tracing distances &amp; 90° square drop heights.
        </div>
        <table class="f-m-table">
          <thead>
            <tr>
              <th>Pt</th>
              <th>Dist</th>
              <th style="text-align:right;">90° Drop</th>
            </tr>
          </thead>
          <tbody id="f-tbl-points-body"></tbody>
        </table>
      </div>
    </div>

    <!-- Clean Background-Free 3D Text Labels -->
    <div id="f-labels-layer"></div>
    <div id="f-magnifier"><canvas id="f-mag-canvas" width="110" height="110"></canvas></div>

    <!-- Bottom Action Dock -->
    <div class="f-bottom-dock">
      <button class="f-dock-btn" id="f-btn-create-line">📏 Create Line</button>
      <button class="f-dock-btn undo-btn hidden" id="f-btn-undo-pt">↩ Undo</button>
      <button class="f-dock-btn" id="f-btn-open-lines">📋 Lines (<span id="f-lbl-line-count">0</span>)</button>
      <button class="f-dock-btn" id="f-btn-open-plates">📂 Saved</button>
      <button class="f-dock-btn" id="f-btn-open-settings">⚙️</button>
    </div>

    <!-- Backdrop -->
    <div class="f-modal-backdrop" id="f-modal-backdrop"></div>

    <!-- 1. Lines Manager Sheet -->
    <div class="f-sheet-drawer" id="f-sheet-lines">
      <div class="f-sheet-header">
        <h2>📋 Saved String Lines</h2>
        <button class="f-btn-close-sheet" onclick="closeAllFormingSheets()">✕ Close</button>
      </div>
      <div id="f-lines-list-container"></div>
    </div>

    <!-- 2. Saved Plates Library Sheet -->
    <div class="f-sheet-drawer" id="f-sheet-plates">
      <div class="f-sheet-header">
        <h2>📂 Saved Shell Plates</h2>
        <button class="f-btn-close-sheet" onclick="closeAllFormingSheets()">✕ Close</button>
      </div>
      <div id="f-plates-list-container"></div>
    </div>

    <!-- 3. Save Plate Name Modal -->
    <div class="f-sheet-drawer" id="f-sheet-save-plate">
      <div class="f-sheet-header">
        <h2>💾 Save Shell Plate</h2>
        <button class="f-btn-close-sheet" onclick="closeAllFormingSheets()">✕ Close</button>
      </div>
      <div class="f-input-group">
        <label>Plate Number / Block</label>
        <input type="text" id="f-inp-plate-no" placeholder="e.g., Hull-102 / P-14" />
      </div>
      <div class="f-input-group">
        <label>Plate Name / Description</label>
        <input type="text" id="f-inp-plate-name" placeholder="e.g., Port Bilge Strake" />
      </div>
      <button class="f-btn-full" id="f-btn-confirm-save-plate">✅ Save Plate &amp; Lines</button>
    </div>

    <!-- 4. Settings Sheet -->
    <div class="f-sheet-drawer" id="f-sheet-settings">
      <div class="f-sheet-header">
        <h2>⚙️ Forming Settings</h2>
        <button class="f-btn-close-sheet" onclick="closeAllFormingSheets()">✕ Close</button>
      </div>
      <div class="f-input-group">
        <label>Line Division Pitch (mm) — Default 200 mm</label>
        <input type="number" id="f-inp-pitch" value="200" step="50" min="50" max="1000" />
      </div>
      <button class="f-btn-full" id="f-btn-apply-settings">⚡ Apply &amp; Recalculate Lines</button>
    </div>

    <div id="forming-canvas-container"></div>
  `;
}

// ═══════════════════════════════════════════════════════════
// 4. INITIALIZE OVERLAY ENGINE (SAME AS WORKING CODE)
// ═══════════════════════════════════════════════════════════
function initFormingOverlay() {
  buildFormingModalDOM();

  const container = document.getElementById('forming-canvas-container');
  fScene = new THREE.Scene();
  fScene.background = new THREE.Color(0x090d16);

  fCamera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 10, 500000);
  fCamera.up.set(0, 0, 1);

  fRenderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  fRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  fRenderer.setSize(window.innerWidth, window.innerHeight);
  container.appendChild(fRenderer.domElement);

  fControls = new THREE.OrbitControls(fCamera, fRenderer.domElement);
  fControls.enableDamping = true;
  fControls.dampingFactor = 0.08;

  fScene.add(new THREE.AmbientLight(0xffffff, 0.75));
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.9);
  dirLight.position.set(5000, -5000, 7000);
  fScene.add(dirLight);
  const backLight = new THREE.DirectionalLight(0xffffff, 0.45);
  backLight.position.set(-5000, 5000, -6000);
  fScene.add(backLight);

  fScene.add(fLinesVisualGroup);
  fScene.add(fTempPickGroup);

  window.addEventListener('resize', () => {
    const modal = document.getElementById('forming-studio-modal');
    if (modal && modal.style.display === 'block' && fRenderer && fCamera) {
      fCamera.aspect = window.innerWidth / window.innerHeight;
      fCamera.updateProjectionMatrix();
      fRenderer.setSize(window.innerWidth, window.innerHeight);
    }
  });

  setupInteractions();
  setupUI();
  formingStudioInitialized = true;

  function animForming() {
    requestAnimationFrame(animForming);
    const modal = document.getElementById('forming-studio-modal');
    if (modal && modal.style.display === 'block') {
      if (fControls && fControls.enabled) fControls.update();
      updateHTMLLabels();
      if (fRenderer && fScene && fCamera) fRenderer.render(fScene, fCamera);
    }
  }
  animForming();
}

// ═══════════════════════════════════════════════════════════
// 5. DIRECT ENTRY BRIDGE FROM INDEX VIEWER (EXACT WORKING FLOW)
// ═══════════════════════════════════════════════════════════
window.openDirectFormingStudio = function(meshObj) {
  if (!meshObj || !meshObj.geometry) {
    alert('ദയവായി ഒരു പ്ലേറ്റ് സെലക്ട് ചെയ്യുക.');
    return;
  }

  if (!formingStudioInitialized) initFormingOverlay();

  const modal = document.getElementById('forming-studio-modal');
  modal.style.display = 'block';
  if (window.controls) window.controls.enabled = false;

  meshObj.updateMatrixWorld(true);
  let g = meshObj.geometry.clone();
  g.applyMatrix4(meshObj.matrixWorld);
  if (g.index) g = g.toNonIndexed();

  const verts = Array.from(g.attributes.position.array);
  const pName = (meshObj.userData && meshObj.userData.name) ? meshObj.userData.name : 'Selected Shell';
  const pNo = (meshObj.userData && meshObj.userData.partNo) ? meshObj.userData.partNo : '';
  const pCol = (meshObj.material && meshObj.material.color) ? meshObj.material.color.getHex() : 0x38bdf8;

  const saved = getSavedPlates();
  const existing = saved.find(p => p.name === pName && p.vertices && p.vertices.length === verts.length);

  if (existing) {
    renderPlateFromRecord(existing);
  } else {
    const newRecord = {
      id: 'plate_' + Date.now(),
      plateNo: pNo || ('P-' + (saved.length + 1)),
      name: pName,
      color: pCol,
      vertices: verts,
      lines: [],
      updatedAt: Date.now()
    };
    savePlateRecord(newRecord);
    renderPlateFromRecord(newRecord);
  }
};

// ═══════════════════════════════════════════════════════════
// 6. BUILD 3D MESH + TOP (NEON GREEN) & FORWARD (YELLOW) EDGES
// ═══════════════════════════════════════════════════════════
function renderPlateFromRecord(record) {
  currentPlate = record;
  tempStartPt = null;
  activeLineId = null;

  if (fPlateMesh) { fScene.remove(fPlateMesh); fPlateMesh = null; }
  while (fLinesVisualGroup.children.length > 0) fLinesVisualGroup.remove(fLinesVisualGroup.children[0]);
  while (fTempPickGroup.children.length > 0) fTempPickGroup.remove(fTempPickGroup.children[0]);

  document.getElementById('f-plate-badge').innerText = record.name || 'Selected Shell';
  document.getElementById('f-inp-plate-no').value = record.plateNo || '';
  document.getElementById('f-inp-plate-name').value = record.name || '';

  const floatArr = (record.vertices instanceof Float32Array) ? record.vertices : new Float32Array(record.vertices);
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(floatArr, 3));
  geom.computeVertexNormals();

  classifyAndColorPlateEdges(geom, (record.color !== undefined) ? record.color : 0x38bdf8);

  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.35,
    metalness: 0.25,
    side: THREE.DoubleSide
  });

  fPlateMesh = new THREE.Mesh(geom, mat);
  fScene.add(fPlateMesh);

  geom.computeBoundingBox();
  const bbox = geom.boundingBox;
  const center = bbox.getCenter(new THREE.Vector3());
  fControls.target.copy(center);

  const size = bbox.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z) || 1000;
  fCamera.position.set(center.x + maxDim * 0.7, center.y - maxDim * 0.7, center.z + maxDim * 0.8);
  fCamera.up.set(0, 0, 1);
  fControls.enabled = true;
  fControls.update();

  fRenderer.setSize(window.innerWidth, window.innerHeight);
  fCamera.aspect = window.innerWidth / window.innerHeight;
  fCamera.updateProjectionMatrix();

  if (currentPlate.lines && currentPlate.lines.length > 0) {
    const lastLine = currentPlate.lines[currentPlate.lines.length - 1];
    lastLine.visible = true;
    activeLineId = lastLine.id;
  }

  rebuildAllSavedLinesVisuals();
  setMode('view');
}

function classifyAndColorPlateEdges(geom, baseHex) {
  const pos = geom.attributes.position.array;
  const norm = geom.attributes.normal.array;
  const triCount = pos.length / 9;

  const baseColor = new THREE.Color(baseHex);
  const neonGreen = new THREE.Color(0x39ff14); // Top Edge (Highest Z)
  const fwdYellow = new THREE.Color(0xfacc15); // Forward Edge (Highest X)

  const colors = new Float32Array(pos.length);

  const tris = [];
  let maxArea = 0;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const ab = new THREE.Vector3(), ac = new THREE.Vector3(), cross = new THREE.Vector3();

  for (let i = 0; i < triCount; i++) {
    const idx = i * 9;
    a.set(pos[idx], pos[idx + 1], pos[idx + 2]);
    b.set(pos[idx + 3], pos[idx + 4], pos[idx + 5]);
    c.set(pos[idx + 6], pos[idx + 7], pos[idx + 8]);

    ab.subVectors(b, a);
    ac.subVectors(c, a);
    const area = cross.crossVectors(ab, ac).length() * 0.5;
    if (area > maxArea) maxArea = area;

    const n = new THREE.Vector3(norm[idx], norm[idx + 1], norm[idx + 2]).normalize();
    const centroid = new THREE.Vector3().add(a).add(b).add(c).multiplyScalar(1 / 3);
    tris.push({ i, area, n, centroid, a: a.clone(), b: b.clone(), c: c.clone() });
  }

  const broadNormal = new THREE.Vector3();
  tris.forEach(t => {
    if (t.area > maxArea * 0.15) {
      const sign = (broadNormal.lengthSq() > 0 && t.n.dot(broadNormal) < 0) ? -1 : 1;
      broadNormal.addScaledVector(t.n, sign * t.area);
    }
  });
  broadNormal.normalize();

  const edgeTris = tris.filter(t => Math.abs(t.n.dot(broadNormal)) < 0.45);

  const clusters = [];
  edgeTris.forEach(t => {
    let bestCluster = null;
    let bestDot = 0.78;
    clusters.forEach(cl => {
      const d = t.n.dot(cl.avgNormal);
      if (d > bestDot) { bestDot = d; bestCluster = cl; }
    });
    if (bestCluster) {
      bestCluster.items.push(t);
      bestCluster.avgNormal.add(t.n).normalize();
    } else {
      clusters.push({ avgNormal: t.n.clone(), items: [t] });
    }
  });

  plateEdgesInfo = clusters.map((cl, idx) => {
    let sumX = 0, sumZ = 0;
    const pts = [];
    cl.items.forEach(t => {
      sumX += t.centroid.x;
      sumZ += t.centroid.z;
      pts.push(t.a, t.b, t.c);
    });
    const avgX = sumX / cl.items.length;
    const avgZ = sumZ / cl.items.length;

    let pStart = pts[0], pEnd = pts[0], maxD2 = -1;
    for (let i = 0; i < pts.length; i += 2) {
      for (let j = i + 1; j < pts.length; j += 2) {
        const d2 = pts[i].distanceToSquared(pts[j]);
        if (d2 > maxD2) { maxD2 = d2; pStart = pts[i]; pEnd = pts[j]; }
      }
    }

    if (Math.abs(pStart.z - pEnd.z) >= Math.abs(pStart.x - pEnd.x)) {
      if (pEnd.z > pStart.z) [pStart, pEnd] = [pEnd, pStart];
    } else {
      if (pEnd.x > pStart.x) [pStart, pEnd] = [pEnd, pStart];
    }

    const mid = new THREE.Vector3().addVectors(pStart, pEnd).multiplyScalar(0.5);
    return { id: idx, items: cl.items, avgX, avgZ, pStart, pEnd, mid, role: 'SIDE' };
  });

  let topCluster = null, fwdCluster = null;
  if (plateEdgesInfo.length > 0) {
    topCluster = [...plateEdgesInfo].sort((a, b) => b.avgZ - a.avgZ)[0];
    topCluster.role = 'TOP';
    topEdgeMid = topCluster.mid.clone();

    const remaining = plateEdgesInfo.filter(c => c !== topCluster);
    if (remaining.length > 0) {
      fwdCluster = remaining.sort((a, b) => b.avgX - a.avgX)[0];
      fwdCluster.role = 'FWD';
      fwdEdgeMid = fwdCluster.mid.clone();
    }
  }

  const topSet = new Set(topCluster ? topCluster.items : []);
  const fwdSet = new Set(fwdCluster ? fwdCluster.items : []);

  tris.forEach(t => {
    let col = baseColor;
    if (topSet.has(t)) col = neonGreen;
    else if (fwdSet.has(t)) col = fwdYellow;

    const baseIdx = t.i * 9;
    for (let v = 0; v < 3; v++) {
      colors[baseIdx + v * 3] = col.r;
      colors[baseIdx + v * 3 + 1] = col.g;
      colors[baseIdx + v * 3 + 2] = col.b;
    }
  });

  geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

// ═══════════════════════════════════════════════════════════
// 7. EDGE TRACING & 90° SQUARE-TO-LINE MEASUREMENT ENGINE
// ═══════════════════════════════════════════════════════════
function computeEdgeTraceForPoint(pt) {
  if (!plateEdgesInfo || plateEdgesInfo.length === 0) {
    return { edgeLabel: 'Plate Surface', endAName: 'End 1', distA: 0, endBName: 'End 2', distB: 0 };
  }

  let bestEdge = plateEdgesInfo[0];
  let bestDist = Infinity;
  const line3 = new THREE.Line3();
  const closePt = new THREE.Vector3();

  plateEdgesInfo.forEach(edge => {
    line3.set(edge.pStart, edge.pEnd);
    line3.closestPointToPoint(pt, true, closePt);
    const d = pt.distanceTo(closePt);
    if (d < bestDist) {
      bestDist = d;
      bestEdge = edge;
    }
  });

  const isVert = Math.abs(bestEdge.pStart.z - bestEdge.pEnd.z) >= Math.abs(bestEdge.pStart.x - bestEdge.pEnd.x);
  const edgeName = bestEdge.role === 'TOP' ? 'TOP Edge (Green)' :
                   bestEdge.role === 'FWD' ? 'FWD Edge (Yellow)' :
                   (isVert ? 'Aft/Side Vertical Edge' : 'Bottom Edge');

  return {
    edgeLabel: edgeName,
    endAName: isVert ? 'Top Corner' : 'Fwd Corner',
    distA: pt.distanceTo(bestEdge.pStart),
    endBName: isVert ? 'Bot Corner' : 'Aft Corner',
    distB: pt.distanceTo(bestEdge.pEnd)
  };
}

function calculateLineSquareMeasurements(startVec, endVec, pitch) {
  const totalLen = startVec.distanceTo(endVec);
  const lineDir = new THREE.Vector3().subVectors(endVec, startVec).normalize();

  const midPt = new THREE.Vector3().addVectors(startVec, endVec).multiplyScalar(0.5);
  const plateNormal = estimatePlateNormalNear(midPt);

  const sqDir = plateNormal.clone().addScaledVector(lineDir, -plateNormal.dot(lineDir));
  if (sqDir.lengthSq() < 0.0001) sqDir.copy(plateNormal);
  sqDir.normalize();

  const raycaster = new THREE.Raycaster();
  const stations = [];
  let idx = 1;

  for (let d = pitch; d < totalLen - 5; d += pitch) {
    const linePt = startVec.clone().addScaledVector(lineDir, d);
    let hitPt = null;
    let minDrop = Infinity;

    [sqDir, sqDir.clone().negate()].forEach(dir => {
      const origin = linePt.clone().addScaledVector(dir, -5);
      raycaster.set(origin, dir);
      const hits = raycaster.intersectObject(fPlateMesh, false);
      if (hits.length > 0) {
        const hPt = hits[0].point;
        const drop = linePt.distanceTo(hPt);
        if (drop < minDrop) {
          minDrop = drop;
          hitPt = hPt.clone();
        }
      }
    });

    if (!hitPt) {
      hitPt = findClosestPlateSurfacePoint(linePt);
      minDrop = linePt.distanceTo(hitPt);
    }

    stations.push({
      label: `P${idx}`,
      distFromStart: d,
      dropHeight: minDrop,
      linePt: { x: linePt.x, y: linePt.y, z: linePt.z },
      platePt: { x: hitPt.x, y: hitPt.y, z: hitPt.z }
    });
    idx++;
  }

  return {
    totalLength: totalLen,
    startTrace: computeEdgeTraceForPoint(startVec),
    endTrace: computeEdgeTraceForPoint(endVec),
    stations
  };
}

function estimatePlateNormalNear(pt) {
  const pos = fPlateMesh.geometry.attributes.position.array;
  const norm = fPlateMesh.geometry.attributes.normal.array;
  let bestD2 = Infinity;
  const bestN = new THREE.Vector3(0, 0, 1);
  const tmp = new THREE.Vector3();

  for (let i = 0; i < pos.length; i += 3) {
    tmp.set(pos[i], pos[i + 1], pos[i + 2]);
    const d2 = tmp.distanceToSquared(pt);
    if (d2 < bestD2) {
      bestD2 = d2;
      bestN.set(norm[i], norm[i + 1], norm[i + 2]).normalize();
    }
  }
  return bestN;
}

function findClosestPlateSurfacePoint(pt) {
  const pos = fPlateMesh.geometry.attributes.position.array;
  let bestD2 = Infinity;
  const bestP = pt.clone(), tmp = new THREE.Vector3();
  for (let i = 0; i < pos.length; i += 3) {
    tmp.set(pos[i], pos[i + 1], pos[i + 2]);
    const d2 = tmp.distanceToSquared(pt);
    if (d2 < bestD2) { bestD2 = d2; bestP.copy(tmp); }
  }
  return bestP;
}

// ═══════════════════════════════════════════════════════════
// 8. RENDER SAVED LINES, 90° DROP BARS & CLEAN 3D TEXT LABELS
// ═══════════════════════════════════════════════════════════
function rebuildAllSavedLinesVisuals() {
  while (fLinesVisualGroup.children.length > 0) fLinesVisualGroup.remove(fLinesVisualGroup.children[0]);
  const layer = document.getElementById('f-labels-layer');
  layer.innerHTML = '';
  htmlLabels = [];

  if (topEdgeMid) addClean3DLabel('TOP', topEdgeMid, 'f-txt-top');
  if (fwdEdgeMid) addClean3DLabel('FWD', fwdEdgeMid, 'f-txt-fwd');

  if (!currentPlate || !currentPlate.lines) return;
  document.getElementById('f-lbl-line-count').innerText = currentPlate.lines.length;

  let selectedLineObj = null;

  currentPlate.lines.forEach(line => {
    if (line.id === activeLineId) selectedLineObj = line;
    if (!line.visible) return;

    const isSelected = (line.id === activeLineId);
    const sVec = new THREE.Vector3(line.start.x, line.start.y, line.start.z);
    const eVec = new THREE.Vector3(line.end.x, line.end.y, line.end.z);

    const lineMat = new THREE.LineBasicMaterial({
      color: isSelected ? 0x38bdf8 : 0x10b981,
      linewidth: isSelected ? 3 : 1.5,
      depthTest: false
    });
    fLinesVisualGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([sVec, eVec]), lineMat));

    [sVec, eVec].forEach(p => {
      const dot = new THREE.Mesh(
        new THREE.SphereGeometry(isSelected ? 6 : 4, 10, 10),
        new THREE.MeshBasicMaterial({ color: 0xf43f5e, depthTest: false })
      );
      dot.position.copy(p);
      fLinesVisualGroup.add(dot);
    });

    if (isSelected) {
      addClean3DLabel(`${line.name} (S)`, sVec, 'f-txt-end');
      addClean3DLabel(`E`, eVec, 'f-txt-end');

      line.stations.forEach(st => {
        const pTop = new THREE.Vector3(st.linePt.x, st.linePt.y, st.linePt.z);
        const pBot = new THREE.Vector3(st.platePt.x, st.platePt.y, st.platePt.z);

        fLinesVisualGroup.add(new THREE.Line(
          new THREE.BufferGeometry().setFromPoints([pTop, pBot]),
          new THREE.LineBasicMaterial({ color: 0xfacc15, linewidth: 2, depthTest: false })
        ));

        const pDot = new THREE.Mesh(
          new THREE.SphereGeometry(3.5, 8, 8),
          new THREE.MeshBasicMaterial({ color: 0x38bdf8, depthTest: false })
        );
        pDot.position.copy(pTop);
        fLinesVisualGroup.add(pDot);

        addClean3DLabel(`${st.label}: ${st.dropHeight.toFixed(1)}`, pTop, 'f-txt-pt');
      });
    }
  });

  updateMeasurementTableUI(selectedLineObj);
}

function addClean3DLabel(text, pos3D, cssClass) {
  const el = document.createElement('div');
  el.className = `f-clean-3d-text ${cssClass}`;
  el.innerText = text;
  document.getElementById('f-labels-layer').appendChild(el);
  htmlLabels.push({ el, pos3D: pos3D.clone() });
}

function updateHTMLLabels() {
  if (!fCamera) return;
  const w = window.innerWidth, h = window.innerHeight;
  htmlLabels.forEach(item => {
    const v = item.pos3D.clone().project(fCamera);
    if (v.z > 1 || v.z < -1) {
      item.el.style.display = 'none';
    } else {
      item.el.style.display = 'block';
      item.el.style.left = ((v.x * 0.5 + 0.5) * w) + 'px';
      item.el.style.top = ((-(v.y * 0.5) + 0.5) * h) + 'px';
    }
  });
}

function updateMeasurementTableUI(line) {
  const titleEl = document.getElementById('f-tbl-line-title');
  const traceEl = document.getElementById('f-tbl-trace-info');
  const tbody = document.getElementById('f-tbl-points-body');
  tbody.innerHTML = '';

  if (!line) {
    titleEl.innerText = 'No Line Selected';
    traceEl.innerHTML = 'Tap <b>Create Line</b> or select a saved line from <b>Lines</b>.';
    return;
  }

  titleEl.innerText = `${line.name} (Len: ${line.totalLength.toFixed(0)} mm)`;
  const st = line.startTrace;
  const en = line.endTrace;
  traceEl.innerHTML = `
    <div><b>Start (S):</b> ${st.edgeLabel}</div>
    <div><span>↳ ${st.endAName}:</span> <b>${st.distA.toFixed(0)}mm</b> | <span>${st.endBName}:</span> <b>${st.distB.toFixed(0)}mm</b></div>
    <div style="margin-top:4px;"><b>End (E):</b> ${en.edgeLabel}</div>
    <div><span>↳ ${en.endAName}:</span> <b>${en.distA.toFixed(0)}mm</b> | <span>${en.endBName}:</span> <b>${en.distB.toFixed(0)}mm</b></div>
  `;

  if (line.stations.length === 0) {
    tbody.innerHTML = `<tr><td colspan="3" style="color:#94a3b8; text-align:center;">Line shorter than ${divisionPitch}mm pitch</td></tr>`;
    return;
  }

  line.stations.forEach(s => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td><b>${s.label}</b></td><td>${s.distFromStart} mm</td><td class="val-col">${s.dropHeight.toFixed(1)} mm</td>`;
    tbody.appendChild(tr);
  });
}

// ═══════════════════════════════════════════════════════════
// 9. ZOOM-SAFE POINT PICKER + MAGNIFIER LOUPE
// ═══════════════════════════════════════════════════════════
function findPlatePointAtScreen(cx, cy) {
  if (!fPlateMesh || !fCamera || !fRenderer) return null;
  const rect = fRenderer.domElement.getBoundingClientRect();
  const nx = ((cx - rect.left) / rect.width) * 2 - 1;
  const ny = -((cy - rect.top) / rect.height) * 2 + 1;

  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(new THREE.Vector2(nx, ny), fCamera);
  const hits = raycaster.intersectObject(fPlateMesh, false);
  if (hits.length > 0) return hits[0].point.clone();

  const pos = fPlateMesh.geometry.attributes.position.array;
  const tmp = new THREE.Vector3(), proj = new THREE.Vector3();
  let bestPx = 32, bestPt = null;
  for (let i = 0; i < pos.length; i += 3) {
    tmp.set(pos[i], pos[i + 1], pos[i + 2]);
    proj.copy(tmp).project(fCamera);
    if (proj.z > 1 || proj.z < -1) continue;
    const sx = (proj.x * 0.5 + 0.5) * rect.width + rect.left;
    const sy = (-proj.y * 0.5 + 0.5) * rect.height + rect.top;
    const d = Math.hypot(sx - cx, sy - cy);
    if (d < bestPx) { bestPx = d; bestPt = tmp.clone(); }
  }
  return bestPt;
}

function updateMagnifier(cx, cy) {
  const magEl = document.getElementById('f-magnifier');
  const magCanvas = document.getElementById('f-mag-canvas');
  magEl.style.display = 'block';
  magEl.style.left = cx + 'px';
  magEl.style.top = cy + 'px';

  fRenderer.render(fScene, fCamera);
  const ctx = magCanvas.getContext('2d');
  const src = fRenderer.domElement;
  const dpr = fRenderer.getPixelRatio();
  const rect = src.getBoundingClientRect();
  const sx = (cx - rect.left) * dpr;
  const sy = (cy - rect.top) * dpr;
  const sample = 44 * dpr;

  ctx.clearRect(0, 0, magCanvas.width, magCanvas.height);
  ctx.drawImage(src, sx - sample / 2, sy - sample / 2, sample, sample, 0, 0, magCanvas.width, magCanvas.height);
}

function setupInteractions() {
  const dom = fRenderer.domElement;
  let isPickingDrag = false;
  let lastX = 0, lastY = 0;
  let pendingPt = null;

  function handleReleasePick() {
    if (!isPickingDrag) return;
    isPickingDrag = false;
    document.getElementById('f-magnifier').style.display = 'none';

    const pt = pendingPt || findPlatePointAtScreen(lastX, lastY);
    pendingPt = null;

    if (!pt) {
      setMode('view', '⚠️ Missed plate. Zoom & tap "Create Line" again');
      return;
    }

    if (mode === 'pick_start') {
      tempStartPt = pt.clone();
      while (fTempPickGroup.children.length > 0) fTempPickGroup.remove(fTempPickGroup.children[0]);
      const dot = new THREE.Mesh(
        new THREE.SphereGeometry(6, 10, 10),
        new THREE.MeshBasicMaterial({ color: 0xf43f5e, depthTest: false })
      );
      dot.position.copy(tempStartPt);
      fTempPickGroup.add(dot);

      setMode('view', '✅ Start (S) Locked! Zoom to End Point, then tap "Pick End (2/2)"');
    } else if (mode === 'pick_end' && tempStartPt) {
      while (fTempPickGroup.children.length > 0) fTempPickGroup.remove(fTempPickGroup.children[0]);

      const calc = calculateLineSquareMeasurements(tempStartPt, pt, divisionPitch);
      const lineNum = (currentPlate.lines ? currentPlate.lines.length : 0) + 1;
      const newLine = {
        id: 'line_' + Date.now(),
        name: `Line ${lineNum}`,
        visible: true,
        start: { x: tempStartPt.x, y: tempStartPt.y, z: tempStartPt.z },
        end: { x: pt.x, y: pt.y, z: pt.z },
        totalLength: calc.totalLength,
        startTrace: calc.startTrace,
        endTrace: calc.endTrace,
        stations: calc.stations
      };

      currentPlate.lines.forEach(l => l.visible = false);
      currentPlate.lines.push(newLine);
      currentPlate.updatedAt = Date.now();
      activeLineId = newLine.id;
      tempStartPt = null;

      savePlateRecord(currentPlate);
      rebuildAllSavedLinesVisuals();

      document.getElementById('f-table-wrapper').classList.remove('collapsed');
      setMode('view', `✅ ${newLine.name} Created & Saved!`);
    }
  }

  dom.addEventListener('pointerdown', (e) => {
    lastX = e.clientX; lastY = e.clientY;
    if (mode === 'pick_start' || mode === 'pick_end') {
      e.stopImmediatePropagation();
      isPickingDrag = true;
      fControls.enabled = false;
      pendingPt = findPlatePointAtScreen(e.clientX, e.clientY);
      updateMagnifier(e.clientX, e.clientY);
    }
  }, true);

  window.addEventListener('pointermove', (e) => {
    if (isPickingDrag) {
      lastX = e.clientX; lastY = e.clientY;
      const pt = findPlatePointAtScreen(e.clientX, e.clientY);
      if (pt) pendingPt = pt;
      updateMagnifier(e.clientX, e.clientY);
    }
  }, true);

  window.addEventListener('pointerup', (e) => {
    if (isPickingDrag) {
      if (e.clientX || e.clientY) { lastX = e.clientX; lastY = e.clientY; }
      handleReleasePick();
    }
  }, true);

  window.addEventListener('pointercancel', () => {
    if (isPickingDrag) handleReleasePick();
  }, true);
}

// ═══════════════════════════════════════════════════════════
// 10. UI MODES, SAVED PLATES & MULTI-LINE MANAGER
// ═══════════════════════════════════════════════════════════
function setMode(newMode, customMsg) {
  mode = newMode;
  document.getElementById('f-magnifier').style.display = 'none';

  const btnCreate = document.getElementById('f-btn-create-line');
  const btnUndo = document.getElementById('f-btn-undo-pt');
  const banner = document.getElementById('f-mode-banner');

  btnCreate.classList.remove('pick-armed', 'active');
  btnUndo.classList.toggle('hidden', !tempStartPt);

  if (newMode === 'pick_start') {
    fControls.enabled = false;
    btnCreate.classList.add('pick-armed');
    btnCreate.innerText = '🎯 Touch Start (1/2)';
    banner.innerText = customMsg || '🎯 Touch & release on Start Point (Magnifier Active)';
    banner.style.borderColor = '#10b981'; banner.style.color = '#6ee7b7';
  } else if (newMode === 'pick_end') {
    fControls.enabled = false;
    btnCreate.classList.add('pick-armed');
    btnCreate.innerText = '🎯 Touch End (2/2)';
    banner.innerText = customMsg || '🎯 Touch & release on End Point';
    banner.style.borderColor = '#10b981'; banner.style.color = '#6ee7b7';
  } else {
    fControls.enabled = true;
    if (tempStartPt) {
      btnCreate.classList.add('active');
      btnCreate.innerText = '🎯 Pick End (2/2)';
      banner.innerText = customMsg || '🔍 Zoom to End Point, then tap "Pick End (2/2)"';
    } else {
      btnCreate.innerText = '📏 Create Line';
      banner.innerText = customMsg || '🔍 Zoom freely. Tap "Create Line" to measure';
    }
    banner.style.borderColor = '#334155'; banner.style.color = '#e2e8f0';
  }
}

function openSheet(id) {
  closeAllFormingSheets();
  document.getElementById('f-modal-backdrop').classList.add('open');
  document.getElementById(id).classList.add('open');
}

window.closeAllFormingSheets = function() {
  document.getElementById('f-modal-backdrop').classList.remove('open');
  document.querySelectorAll('.f-sheet-drawer').forEach(el => el.classList.remove('open'));
};

function renderLinesManager() {
  const container = document.getElementById('f-lines-list-container');
  container.innerHTML = '';

  if (!currentPlate || !currentPlate.lines || currentPlate.lines.length === 0) {
    container.innerHTML = '<p style="font-size:12px; color:#94a3b8; text-align:center; padding:14px;">No lines drawn on this plate yet.</p>';
    return;
  }

  currentPlate.lines.forEach((line) => {
    const isSel = (line.id === activeLineId);
    const card = document.createElement('div');
    card.className = 'f-list-card' + (isSel ? ' selected' : '');
    card.innerHTML = `
      <div class="f-list-card-info" onclick="selectSavedFormingLine('${line.id}')">
        <div class="f-list-card-title">${line.name} (${line.totalLength.toFixed(0)} mm)</div>
        <div class="f-list-card-sub">${line.stations.length} pts • ${line.startTrace.edgeLabel}</div>
      </div>
      <div class="f-card-actions">
        <button class="f-icon-btn ${line.visible ? 'primary' : ''}" onclick="toggleFormingLineVisibility('${line.id}')">${line.visible ? '👁️ On' : '🙈 Off'}</button>
        <button class="f-icon-btn danger" onclick="deleteSavedFormingLine('${line.id}')">🗑️</button>
      </div>
    `;
    container.appendChild(card);
  });
}

window.selectSavedFormingLine = function(lineId) {
  if (!currentPlate) return;
  activeLineId = lineId;
  const line = currentPlate.lines.find(l => l.id === lineId);
  if (line) line.visible = true;
  savePlateRecord(currentPlate);
  rebuildAllSavedLinesVisuals();
  document.getElementById('f-table-wrapper').classList.remove('collapsed');
  closeAllFormingSheets();
};

window.toggleFormingLineVisibility = function(lineId) {
  if (!currentPlate) return;
  const line = currentPlate.lines.find(l => l.id === lineId);
  if (line) {
    line.visible = !line.visible;
    if (line.visible) activeLineId = line.id;
    savePlateRecord(currentPlate);
    rebuildAllSavedLinesVisuals();
    renderLinesManager();
  }
};

window.deleteSavedFormingLine = function(lineId) {
  if (!currentPlate) return;
  currentPlate.lines = currentPlate.lines.filter(l => l.id !== lineId);
  if (activeLineId === lineId) {
    activeLineId = currentPlate.lines.length > 0 ? currentPlate.lines[currentPlate.lines.length - 1].id : null;
  }
  savePlateRecord(currentPlate);
  rebuildAllSavedLinesVisuals();
  renderLinesManager();
};

function renderSavedPlatesList() {
  const container = document.getElementById('f-plates-list-container');
  const plates = getSavedPlates();
  plates.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

  container.innerHTML = '';
  if (plates.length === 0) {
    container.innerHTML = '<p style="font-size:12px; color:#94a3b8; text-align:center; padding:14px;">No saved plates found.</p>';
    return;
  }

  plates.forEach(p => {
    const isCurrent = (currentPlate && currentPlate.id === p.id);
    const card = document.createElement('div');
    card.className = 'f-list-card' + (isCurrent ? ' selected' : '');
    card.innerHTML = `
      <div class="f-list-card-info" onclick="openSavedFormingPlateById('${p.id}')">
        <div class="f-list-card-title">${p.plateNo || 'Plate'} — ${p.name}</div>
        <div class="f-list-card-sub">${(p.lines || []).length} saved lines • ${new Date(p.updatedAt).toLocaleDateString()}</div>
      </div>
      <div class="f-card-actions">
        <button class="f-icon-btn primary" onclick="openSavedFormingPlateById('${p.id}')">Open</button>
        <button class="f-icon-btn danger" onclick="removeSavedFormingPlate('${p.id}')">🗑️</button>
      </div>
    `;
    container.appendChild(card);
  });
}

window.openSavedFormingPlateById = function(id) {
  const target = getSavedPlates().find(p => p.id === id);
  if (target) {
    renderPlateFromRecord(target);
    closeAllFormingSheets();
  }
};

window.removeSavedFormingPlate = function(id) {
  deleteSavedPlateRecord(id);
  renderSavedPlatesList();
};

function setupUI() {
  document.getElementById('f-btn-close-forming').addEventListener('click', () => {
    document.getElementById('forming-studio-modal').style.display = 'none';
    if (window.updateControlsLockState) window.updateControlsLockState();
    else if (window.controls) window.controls.enabled = true;
  });

  document.getElementById('f-btn-create-line').addEventListener('click', () => {
    if (!currentPlate) return;
    if (mode === 'pick_start' || mode === 'pick_end') {
      setMode('view');
      return;
    }
    if (!tempStartPt) setMode('pick_start');
    else setMode('pick_end');
  });

  document.getElementById('f-btn-undo-pt').addEventListener('click', () => {
    tempStartPt = null;
    while (fTempPickGroup.children.length > 0) fTempPickGroup.remove(fTempPickGroup.children[0]);
    setMode('view', '↩ Start point cancelled.');
  });

  document.getElementById('f-btn-toggle-table').addEventListener('click', () => {
    document.getElementById('f-table-wrapper').classList.toggle('collapsed');
  });

  document.getElementById('f-btn-open-lines').addEventListener('click', () => {
    renderLinesManager();
    openSheet('f-sheet-lines');
  });

  document.getElementById('f-btn-open-plates').addEventListener('click', () => {
    renderSavedPlatesList();
    openSheet('f-sheet-plates');
  });

  document.getElementById('f-btn-open-save-plate').addEventListener('click', () => {
    if (!currentPlate) return;
    openSheet('f-sheet-save-plate');
  });

  document.getElementById('f-btn-confirm-save-plate').addEventListener('click', () => {
    if (!currentPlate) return;
    currentPlate.plateNo = document.getElementById('f-inp-plate-no').value.trim() || 'Plate';
    currentPlate.name = document.getElementById('f-inp-plate-name').value.trim() || 'Shell Plate';
    currentPlate.updatedAt = Date.now();
    savePlateRecord(currentPlate);
    document.getElementById('f-plate-badge').innerText = `${currentPlate.plateNo}: ${currentPlate.name}`;
    closeAllFormingSheets();
    setMode('view', `💾 Saved as ${currentPlate.plateNo}: ${currentPlate.name}`);
  });

  document.getElementById('f-btn-open-settings').addEventListener('click', () => openSheet('f-sheet-settings'));
  document.getElementById('f-btn-apply-settings').addEventListener('click', () => {
    const val = parseFloat(document.getElementById('f-inp-pitch').value);
    if (val >= 50) {
      divisionPitch = val;
      if (currentPlate && currentPlate.lines) {
        currentPlate.lines.forEach(line => {
          const sVec = new THREE.Vector3(line.start.x, line.start.y, line.start.z);
          const eVec = new THREE.Vector3(line.end.x, line.end.y, line.end.z);
          const calc = calculateLineSquareMeasurements(sVec, eVec, divisionPitch);
          line.stations = calc.stations;
        });
        savePlateRecord(currentPlate);
        rebuildAllSavedLinesVisuals();
      }
    }
    closeAllFormingSheets();
  });

  document.getElementById('f-modal-backdrop').addEventListener('click', closeAllFormingSheets);
}
