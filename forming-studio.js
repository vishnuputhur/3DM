'use strict';

// ═══════════════════════════════════════════════════════════
// MOBILE-FIRST 4-CORNER EXACT MESH & MAGNIFIER FORMING STUDIO
// ═══════════════════════════════════════════════════════════

let fScene, fCamera, fRenderer, fControls;
let fPlateMesh = null, fDatumPlane = null;
let fTemplateGroup = new THREE.Group();
let fStringGroup = new THREE.Group();
let fProbeGroup = new THREE.Group();
let fSections = [];
let formingStudioInitialized = false;

// Interaction state: 'measure' | 'corners'
let fMode = 'measure';
let fManualCorners = []; // Exact 4 corners picked by user
let fHtmlLabels = [];
let fPlaneOffset = 0;

let cornerData = {
  C1: new THREE.Vector3(),
  C2: new THREE.Vector3(),
  C3: new THREE.Vector3(),
  C4: new THREE.Vector3(),
  center: new THREE.Vector3(),
  uDir: new THREE.Vector3(),
  vDir: new THREE.Vector3(),
  nDir: new THREE.Vector3(),
  length: 0,
  width: 0
};

// ═══════════════════════════════════════════════════════════
// 1. INJECT UI, SIDE OFFSET CONTROL & MAGNIFIER LOUPE
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
        color: #f8fafc; touch-action: none;
      }
      #forming-canvas-container { position: absolute; inset: 0; width: 100%; height: 100%; z-index: 1; }

      .f-top-bar {
        position: absolute; top: 10px; left: 10px; right: 10px;
        display: flex; justify-content: space-between; align-items: center;
        background: rgba(15, 23, 42, 0.92); backdrop-filter: blur(10px);
        padding: 8px 12px; border-radius: 10px; border: 1px solid #1e293b; z-index: 15;
      }
      .f-top-left { display: flex; align-items: center; gap: 8px; }
      .f-btn-close {
        background: #1e293b; color: #f8fafc; border: 1px solid #334155;
        padding: 6px 10px; border-radius: 6px; font-size: 12px; font-weight: 700; cursor: pointer;
      }
      .f-top-bar h1 { font-size: 14px; font-weight: 700; color: #38bdf8; margin: 0; }
      .f-badge {
        font-size: 11px; background: #0369a1; padding: 3px 8px; border-radius: 6px;
        font-weight: 600; max-width: 135px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }

      .f-mode-banner {
        position: absolute; top: 56px; left: 10px;
        background: rgba(2, 132, 199, 0.2); border: 1px solid #0284c7;
        color: #38bdf8; padding: 6px 10px; border-radius: 8px;
        font-size: 11px; font-weight: 600; z-index: 14; max-width: 52%;
        backdrop-filter: blur(6px);
      }

      /* Side Vertical Plane Offset Bar */
      .f-side-offset-panel {
        position: absolute; left: 10px; top: 50%; transform: translateY(-50%);
        background: rgba(15, 23, 42, 0.9); backdrop-filter: blur(8px);
        border: 1px solid #334155; border-radius: 12px; padding: 8px 6px;
        z-index: 15; display: flex; flex-direction: column; align-items: center; gap: 6px;
        box-shadow: 0 4px 16px rgba(0,0,0,0.5);
      }
      .f-side-offset-panel.hidden { display: none; }
      .f-offset-title { font-size: 9px; font-weight: 800; color: #94a3b8; text-transform: uppercase; writing-mode: horizontal-tb; text-align: center; }
      .f-offset-val { font-size: 11px; font-weight: 800; color: #facc15; font-family: monospace; }
      .f-offset-step-btn {
        width: 28px; height: 28px; border-radius: 6px; border: 1px solid #334155;
        background: #1e293b; color: #fff; font-size: 15px; font-weight: 800;
        cursor: pointer; display: flex; align-items: center; justify-content: center;
      }
      .f-offset-step-btn:active { background: #0284c7; }
      .f-vertical-slider-wrap {
        height: 110px; width: 28px; display: flex; align-items: center; justify-content: center;
      }
      #f-side-offset-slider {
        width: 105px; height: 6px; transform: rotate(-90deg);
        accent-color: #0284c7; cursor: pointer;
      }

      /* Compact Probe HUD */
      .f-probe-hud {
        position: absolute; top: 56px; right: 10px;
        background: rgba(15, 23, 42, 0.88); backdrop-filter: blur(8px);
        border: 1px solid #0284c7; border-radius: 10px; padding: 8px 12px;
        z-index: 14; text-align: right; box-shadow: 0 4px 15px rgba(0,0,0,0.45);
        pointer-events: none; transition: opacity 0.2s; min-width: 162px;
      }
      .f-probe-hud.hidden { opacity: 0; }
      .f-probe-label { font-size: 9px; font-weight: 700; letter-spacing: 0.05em; color: #94a3b8; text-transform: uppercase; }
      .f-probe-val { font-size: 22px; font-weight: 800; color: #facc15; font-family: monospace; line-height: 1.1; }
      .f-probe-grid {
        margin-top: 6px; padding-top: 6px; border-top: 1px solid #1e293b;
        display: grid; grid-template-columns: 1fr 1fr; gap: 4px 10px;
        font-size: 11px; font-family: monospace; text-align: left;
      }
      .f-probe-grid span { color: #94a3b8; }
      .f-probe-grid b { color: #38bdf8; float: right; }

      /* Bottom Mobile Action Bar */
      .f-bottom-dock {
        position: absolute; bottom: 14px; left: 10px; right: 10px;
        display: flex; gap: 6px; justify-content: center; flex-wrap: wrap; z-index: 15;
      }
      .f-dock-btn {
        flex: 1; min-width: 75px; max-width: 145px;
        background: rgba(15, 23, 42, 0.94); color: #f8fafc; border: 1px solid #334155;
        padding: 10px 8px; border-radius: 10px; font-size: 12px; font-weight: 700;
        cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 5px;
        backdrop-filter: blur(10px); box-shadow: 0 4px 12px rgba(0,0,0,0.45);
      }
      .f-dock-btn.active { background: #0284c7; border-color: #38bdf8; color: #fff; }
      .f-dock-btn.corner-active { background: #059669; border-color: #34d399; color: #fff; }

      /* Magnifier Loupe */
      #f-magnifier {
        position: fixed; width: 116px; height: 116px; border-radius: 50%;
        border: 3px solid #38bdf8; box-shadow: 0 8px 25px rgba(0,0,0,0.75), inset 0 0 10px rgba(0,0,0,0.5);
        pointer-events: none; z-index: 40; display: none; overflow: hidden;
        background: #090d16; transform: translate(-50%, -125%);
      }
      #f-magnifier canvas { width: 100%; height: 100%; display: block; }
      #f-magnifier::after {
        content: ''; position: absolute; inset: 0;
        background:
          linear-gradient(to right, transparent 49%, rgba(250,204,21,0.85) 49.5%, rgba(250,204,21,0.85) 50.5%, transparent 51%),
          linear-gradient(to bottom, transparent 49%, rgba(250,204,21,0.85) 49.5%, rgba(250,204,21,0.85) 50.5%, transparent 51%);
      }

      /* Offset Arrow Corner Callout Labels */
      .f-corner-callout {
        position: absolute; pointer-events: none; z-index: 12;
        display: flex; align-items: center; transform: translate(6px, -22px);
      }
      .f-callout-arrow {
        width: 14px; height: 1.5px; background: #10b981;
        transform: rotate(-35deg); transform-origin: left center; margin-right: 2px;
      }
      .f-callout-tag {
        background: rgba(5, 150, 105, 0.92); color: #fff; border: 1px solid #a7f3d0;
        padding: 1px 5px; border-radius: 4px; font-size: 10px; font-family: monospace; font-weight: 800;
        box-shadow: 0 2px 6px rgba(0,0,0,0.5);
      }

      .f-edge-label {
        position: absolute; background: rgba(9, 13, 22, 0.85); color: #facc15;
        border: 1px solid #10b981; padding: 1px 5px; border-radius: 4px;
        font-size: 10px; font-family: monospace; font-weight: 700;
        pointer-events: none; transform: translate(-50%, -50%); z-index: 11; white-space: nowrap;
      }

      /* Settings Drawer */
      .f-drawer-backdrop {
        position: fixed; inset: 0; background: rgba(0,0,0,0.55); z-index: 25; display: none;
      }
      .f-drawer-backdrop.open { display: block; }

      .f-settings-drawer {
        position: fixed; bottom: 0; left: 0; right: 0; max-height: 78vh;
        background: #0f172a; border-top: 1px solid #334155; border-radius: 18px 18px 0 0;
        padding: 16px; z-index: 30; overflow-y: auto;
        transform: translateY(100%); transition: transform 0.25s ease-out;
        box-shadow: 0 -10px 30px rgba(0,0,0,0.65);
      }
      .f-settings-drawer.open { transform: translateY(0); }

      @media (min-width: 768px) {
        .f-settings-drawer {
          left: 65px; right: auto; bottom: auto; top: 62px;
          width: 345px; border-radius: 14px; border: 1px solid #334155;
          transform: translateX(-130%);
        }
        .f-settings-drawer.open { transform: translateX(0); }
      }

      .f-drawer-header {
        display: flex; justify-content: space-between; align-items: center;
        margin-bottom: 14px; padding-bottom: 10px; border-bottom: 1px solid #1e293b;
      }
      .f-drawer-header h2 { font-size: 13px; color: #38bdf8; text-transform: uppercase; margin: 0; }
      .f-btn-drawer-close {
        background: #1e293b; border: 1px solid #334155; color: #fff;
        padding: 5px 10px; border-radius: 6px; font-size: 12px; font-weight: 700; cursor: pointer;
      }
      .f-input-group { margin-bottom: 12px; }
      .f-input-group label { display: block; font-size: 11px; margin-bottom: 4px; color: #94a3b8; }
      .f-input-group input[type="number"], .f-input-group select {
        width: 100%; padding: 9px 10px; background: #090d16; border: 1px solid #334155;
        border-radius: 8px; color: #fff; font-size: 13px; outline: none; font-family: monospace;
      }
      .f-btn-row { display: flex; gap: 8px; margin-top: 8px; }
      .f-btn {
        flex: 1; padding: 10px; border: none; border-radius: 8px; font-weight: 700;
        font-size: 12px; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 5px;
      }
      .f-btn-primary { background: linear-gradient(135deg, #0284c7, #0369a1); color: #fff; }
      .f-btn-secondary { background: #1e293b; color: #e2e8f0; border: 1px solid #334155; }
      .f-btn-danger { background: #7f1d1d; color: #fecaca; border: 1px solid #991b1b; }

      .f-tmpl-list { margin-top: 10px; display: flex; flex-direction: column; gap: 8px; }
      .f-tmpl-item {
        display: flex; justify-content: space-between; align-items: center;
        background: #090d16; padding: 10px; border-radius: 8px; border: 1px solid #1e293b; font-size: 12px;
      }
      .f-tmpl-dxf-btn {
        background: #059669; color: #fff; border: none; padding: 6px 10px;
        border-radius: 6px; cursor: pointer; font-size: 11px; font-weight: 700;
      }

      #f-touch-pin {
        position: absolute; width: 12px; height: 12px; border-radius: 50%;
        border: 2px solid #facc15; background: rgba(250, 204, 21, 0.5);
        transform: translate(-50%, -50%); pointer-events: none; display: none; z-index: 13;
      }
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
    <div class="f-top-bar">
      <div class="f-top-left">
        <button class="f-btn-close" id="btn-close-forming">⬅ Viewer</button>
        <h1>📐 Forming Studio</h1>
      </div>
      <span class="f-badge" id="f-plate-badge">Shell Plate</span>
    </div>

    <div class="f-mode-banner" id="f-mode-banner">
      📍 Pick 4 corners to build sight mesh
    </div>

    <!-- Side Plane Offset Control -->
    <div class="f-side-offset-panel" id="f-side-offset-panel">
      <div class="f-offset-title">Offset</div>
      <div class="f-offset-val" id="f-side-offset-val">0mm</div>
      <button class="f-offset-step-btn" id="f-btn-offset-up">+</button>
      <div class="f-vertical-slider-wrap">
        <input type="range" id="f-side-offset-slider" min="0" max="500" value="0" step="5" />
      </div>
      <button class="f-offset-step-btn" id="f-btn-offset-down">−</button>
    </div>

    <!-- Probe HUD -->
    <div class="f-probe-hud" id="f-probe-hud">
      <div class="f-probe-label">Plane Drop Depth</div>
      <div class="f-probe-val" id="f-probe-depth">0.0 mm</div>
      <div class="f-probe-grid">
        <div><span>Left:</span> <b id="f-dist-left">-</b></div>
        <div><span>Right:</span> <b id="f-dist-right">-</b></div>
        <div><span>Top:</span> <b id="f-dist-top">-</b></div>
        <div><span>Bot:</span> <b id="f-dist-bot">-</b></div>
      </div>
    </div>

    <!-- Magnifier Loupe -->
    <div id="f-magnifier"><canvas id="f-mag-canvas" width="116" height="116"></canvas></div>

    <div id="f-labels-layer"></div>
    <div id="f-touch-pin"></div>

    <div class="f-bottom-dock">
      <button class="f-dock-btn" id="f-btn-mode-measure">📏 Measure</button>
      <button class="f-dock-btn corner-active" id="f-btn-mode-corners">📍 Pick 4 Corners</button>
      <button class="f-dock-btn" id="f-btn-toggle-hud">👁️ Hide HUD</button>
      <button class="f-dock-btn" id="f-btn-open-settings">⚙️ Settings / DXF</button>
    </div>

    <div class="f-drawer-backdrop" id="f-drawer-backdrop"></div>
    <div class="f-settings-drawer" id="f-settings-drawer">
      <div class="f-drawer-header">
        <h2>⚙️ Forming & Template Settings</h2>
        <button class="f-btn-drawer-close" id="f-btn-close-settings">✕ Close</button>
      </div>

      <div class="f-input-group">
        <label>Corner Selection Tools</label>
        <div class="f-btn-row">
          <button class="f-btn f-btn-secondary" id="f-btn-undo-corner">↩ Undo Corner</button>
          <button class="f-btn f-btn-danger" id="f-btn-clear-corners">🗑️ Clear All</button>
        </div>
      </div>

      <div class="f-input-group">
        <label>Template Slice Direction</label>
        <select id="f-inp-axis">
          <option value="station">Along Length (C1 → C2)</option>
          <option value="waterline">Along Width (C1 → C4)</option>
        </select>
      </div>

      <div class="f-input-group">
        <label>Station Pitch (mm)</label>
        <input type="number" id="f-inp-interval" value="300" step="50" min="100" max="1500" />
      </div>

      <div class="f-input-group">
        <label>Wood Base Margin for CNC (mm)</label>
        <input type="number" id="f-inp-base-depth" value="120" min="50" max="300" />
      </div>

      <div class="f-btn-row">
        <button class="f-btn f-btn-primary" id="f-btn-slice-plates">⚡ Update Templates</button>
        <button class="f-btn f-btn-secondary" id="f-btn-toggle-datum">🌐 Mesh On/Off</button>
      </div>

      <div style="margin-top:16px; border-top:1px solid #1e293b; padding-top:12px;">
        <h2 style="font-size:12px; color:#94a3b8; margin-bottom:8px;">DOWNLOAD 2D WOOD CNC DXF</h2>
        <div class="f-tmpl-list" id="f-template-export-list"></div>
      </div>
    </div>

    <div id="forming-canvas-container"></div>
  `;
}

// ═══════════════════════════════════════════════════════════
// 2. INITIALIZE THREE.JS SCENE
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
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.95);
  dirLight.position.set(5000, -5000, 8000);
  fScene.add(dirLight);

  fScene.add(fTemplateGroup);
  fScene.add(fStringGroup);
  fScene.add(fProbeGroup);

  window.addEventListener('resize', () => {
    const modal = document.getElementById('forming-studio-modal');
    if (modal && modal.style.display === 'block' && fRenderer && fCamera) {
      fCamera.aspect = window.innerWidth / window.innerHeight;
      fCamera.updateProjectionMatrix();
      fRenderer.setSize(window.innerWidth, window.innerHeight);
    }
  });

  setupFormingCanvasInteractions();
  setupFormingOverlayEvents();
  formingStudioInitialized = true;

  function animForming() {
    requestAnimationFrame(animForming);
    const modal = document.getElementById('forming-studio-modal');
    if (modal && modal.style.display === 'block') {
      if (fControls) fControls.update();
      updateFormingHTMLLabels();
      if (fRenderer && fScene && fCamera) fRenderer.render(fScene, fCamera);
    }
  }
  animForming();
}

// ═══════════════════════════════════════════════════════════
// 3. OPEN FORMING STUDIO (NO RANDOM AUTO-MESH ON START)
// ═══════════════════════════════════════════════════════════
window.openDirectFormingStudio = function(meshObj) {
  if (!formingStudioInitialized) {
    initFormingOverlay();
  }

  const modal = document.getElementById('forming-studio-modal');
  modal.style.display = 'block';
  if (window.controls) window.controls.enabled = false;

  // Clear previous state completely
  if (fPlateMesh) { fScene.remove(fPlateMesh); fPlateMesh = null; }
  if (fDatumPlane) { fScene.remove(fDatumPlane); fDatumPlane = null; }
  while (fTemplateGroup.children.length > 0) fTemplateGroup.remove(fTemplateGroup.children[0]);
  while (fStringGroup.children.length > 0) fStringGroup.remove(fStringGroup.children[0]);
  while (fProbeGroup.children.length > 0) fProbeGroup.remove(fProbeGroup.children[0]);

  fManualCorners = [];
  fPlaneOffset = 0;
  document.getElementById('f-side-offset-slider').value = 0;
  document.getElementById('f-side-offset-val').innerText = '0mm';
  document.getElementById('f-touch-pin').style.display = 'none';

  meshObj.updateMatrixWorld(true);
  let g = meshObj.geometry.clone();
  g.applyMatrix4(meshObj.matrixWorld);
  if (g.index) g = g.toNonIndexed();

  let pCol = (meshObj.material && meshObj.material.color) ? meshObj.material.color.getHex() : 0x38bdf8;
  const mat = new THREE.MeshStandardMaterial({
    color: pCol, roughness: 0.35, metalness: 0.25, side: THREE.DoubleSide
  });

  fPlateMesh = new THREE.Mesh(g, mat);
  fScene.add(fPlateMesh);

  document.getElementById('f-plate-badge').innerText = meshObj.userData.name || 'Ship Shell Plate';

  g.computeBoundingBox();
  const bbox = g.boundingBox;
  const center = bbox.getCenter(new THREE.Vector3());
  const size = bbox.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z) || 1000;

  fControls.target.copy(center);
  fCamera.position.set(center.x + maxDim * 0.7, center.y - maxDim * 0.7, center.z + maxDim * 0.8);
  fCamera.up.set(0, 0, 1);
  fControls.update();

  fRenderer.setSize(window.innerWidth, window.innerHeight);
  fCamera.aspect = window.innerWidth / window.innerHeight;
  fCamera.updateProjectionMatrix();

  // Start directly in Pick 4 Corners mode so user creates exact mesh from 4 corners
  setFormingMode('corners');
};

// ═══════════════════════════════════════════════════════════
// 4. EXACT 4-CORNER BILINEAR MESH & STRING LINES
// ═══════════════════════════════════════════════════════════
function applyFormingCorners(corners) {
  if (fDatumPlane) { fScene.remove(fDatumPlane); fDatumPlane = null; }
  while (fTemplateGroup.children.length > 0) fTemplateGroup.remove(fTemplateGroup.children[0]);

  if (corners.length < 4) {
    drawCornerPinsAndStrings(corners, 0);
    return;
  }

  const [c1, c2, c3, c4] = corners;
  cornerData.C1.copy(c1);
  cornerData.C2.copy(c2);
  cornerData.C3.copy(c3);
  cornerData.C4.copy(c4);

  cornerData.center.copy(c1).add(c2).add(c3).add(c4).multiplyScalar(0.25);

  // Average direction vectors from the 4 picked corners
  const u1 = new THREE.Vector3().subVectors(c2, c1);
  const u2 = new THREE.Vector3().subVectors(c3, c4);
  cornerData.uDir.copy(u1).add(u2).normalize();

  const v1 = new THREE.Vector3().subVectors(c4, c1);
  const v2 = new THREE.Vector3().subVectors(c3, c2);
  cornerData.vDir.copy(v1).add(v2).normalize();

  cornerData.nDir.crossVectors(cornerData.uDir, cornerData.vDir).normalize();
  if (cornerData.nDir.z < 0) cornerData.nDir.negate();
  cornerData.vDir.crossVectors(cornerData.nDir, cornerData.uDir).normalize();

  cornerData.length = (u1.length() + u2.length()) * 0.5;
  cornerData.width = (v1.length() + v2.length()) * 0.5;

  buildExact4CornerMesh();
  generateFormingTemplates();
}

function buildExact4CornerMesh() {
  if (fDatumPlane) { fScene.remove(fDatumPlane); fDatumPlane = null; }
  if (fManualCorners.length < 4) return;

  const offsetVec = cornerData.nDir.clone().multiplyScalar(fPlaneOffset);
  const p1 = cornerData.C1.clone().add(offsetVec);
  const p2 = cornerData.C2.clone().add(offsetVec);
  const p3 = cornerData.C3.clone().add(offsetVec);
  const p4 = cornerData.C4.clone().add(offsetVec);

  // Draw pins, vertical offset posts, and string lines
  drawCornerPinsAndStrings(fManualCorners, fPlaneOffset);

  // Build exact Bilinear Ruled Surface Mesh connecting p1, p2, p3, p4
  const segsU = 10;
  const segsV = 10;
  const vertices = [];
  const indices = [];

  for (let iv = 0; iv <= segsV; iv++) {
    const v = iv / segsV;
    const leftPt = new THREE.Vector3().lerpVectors(p1, p4, v);
    const rightPt = new THREE.Vector3().lerpVectors(p2, p3, v);
    for (let iu = 0; iu <= segsU; iu++) {
      const u = iu / segsU;
      const pt = new THREE.Vector3().lerpVectors(leftPt, rightPt, u);
      vertices.push(pt.x, pt.y, pt.z);
    }
  }

  for (let iv = 0; iv < segsV; iv++) {
    for (let iu = 0; iu < segsU; iu++) {
      const a = iv * (segsU + 1) + iu;
      const b = a + 1;
      const c = (iv + 1) * (segsU + 1) + iu;
      const d = c + 1;
      indices.push(a, b, d, a, d, c);
    }
  }

  const meshGeom = new THREE.BufferGeometry();
  meshGeom.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  meshGeom.setIndex(indices);
  meshGeom.computeVertexNormals();

  const wireMat = new THREE.MeshBasicMaterial({
    color: 0x0284c7,
    wireframe: true,
    transparent: true,
    opacity: 0.45
  });

  fDatumPlane = new THREE.Mesh(meshGeom, wireMat);
  fScene.add(fDatumPlane);
}

function drawCornerPinsAndStrings(corners, offsetVal) {
  while (fStringGroup.children.length > 0) fStringGroup.remove(fStringGroup.children[0]);
  const layer = document.getElementById('f-labels-layer');
  if (layer) layer.innerHTML = '';
  fHtmlLabels = [];

  if (corners.length === 0) return;

  const offsetVec = cornerData.nDir.clone().multiplyScalar(offsetVal);
  const liftedCorners = corners.map(c => (corners.length === 4 ? c.clone().add(offsetVec) : c.clone()));

  corners.forEach((basePt, idx) => {
    const topPt = liftedCorners[idx];

    // Small precision pin at exact plate corner so it never hides the vertex
    const pinDot = new THREE.Mesh(
      new THREE.SphereGeometry(6, 10, 10),
      new THREE.MeshBasicMaterial({ color: 0xfacc15, depthTest: false })
    );
    pinDot.position.copy(basePt);
    fStringGroup.add(pinDot);

    // If offset > 0, draw vertical riser post from plate corner to offset string corner
    if (corners.length === 4 && offsetVal > 0) {
      const postGeom = new THREE.BufferGeometry().setFromPoints([basePt, topPt]);
      fStringGroup.add(new THREE.Line(postGeom, new THREE.LineBasicMaterial({ color: 0xfacc15, depthTest: false })));
    }

    // Add offset arrow callout label slightly away from the exact point
    addCornerCalloutLabel(`C${idx + 1}`, basePt);
  });

  // Connect green string lines between corners
  if (liftedCorners.length >= 2) {
    const linePts = [...liftedCorners];
    if (liftedCorners.length === 4) linePts.push(liftedCorners[0]);

    const geom = new THREE.BufferGeometry().setFromPoints(linePts);
    const mat = new THREE.LineBasicMaterial({ color: 0x10b981, linewidth: 3, depthTest: false });
    fStringGroup.add(new THREE.Line(geom, mat));

    for (let i = 0; i < linePts.length - 1; i++) {
      const pA = linePts[i];
      const pB = linePts[i + 1];
      const dist = pA.distanceTo(pB);
      const mid = new THREE.Vector3().addVectors(pA, pB).multiplyScalar(0.5);
      addEdgeDistanceLabel(`${dist.toFixed(0)} mm`, mid);
    }
  }
}

function addCornerCalloutLabel(text, pos3D) {
  const layer = document.getElementById('f-labels-layer');
  if (!layer) return;
  const el = document.createElement('div');
  el.className = 'f-corner-callout';
  el.innerHTML = `<div class="f-callout-arrow"></div><div class="f-callout-tag">${text}</div>`;
  layer.appendChild(el);
  fHtmlLabels.push({ el, pos3D: pos3D.clone() });
}

function addEdgeDistanceLabel(text, pos3D) {
  const layer = document.getElementById('f-labels-layer');
  if (!layer) return;
  const el = document.createElement('div');
  el.className = 'f-edge-label';
  el.innerText = text;
  layer.appendChild(el);
  fHtmlLabels.push({ el, pos3D: pos3D.clone() });
}

function updateFormingHTMLLabels() {
  if (!fCamera) return;
  const w = window.innerWidth;
  const h = window.innerHeight;
  fHtmlLabels.forEach(item => {
    const v = item.pos3D.clone().project(fCamera);
    if (v.z > 1) {
      item.el.style.display = 'none';
    } else {
      item.el.style.display = 'flex';
      item.el.style.left = ((v.x * 0.5 + 0.5) * w) + 'px';
      item.el.style.top = ((-(v.y * 0.5) + 0.5) * h) + 'px';
    }
  });
}

// ═══════════════════════════════════════════════════════════
// 5. EXACT BILINEAR PLANE DROP & DISTANCE MEASUREMENT
// ═══════════════════════════════════════════════════════════
function getPointOn4CornerPlane(uNorm, vNorm) {
  const offsetVec = cornerData.nDir.clone().multiplyScalar(fPlaneOffset);
  const p1 = cornerData.C1.clone().add(offsetVec);
  const p2 = cornerData.C2.clone().add(offsetVec);
  const p3 = cornerData.C3.clone().add(offsetVec);
  const p4 = cornerData.C4.clone().add(offsetVec);

  const leftPt = new THREE.Vector3().lerpVectors(p1, p4, vNorm);
  const rightPt = new THREE.Vector3().lerpVectors(p2, p3, vNorm);
  return new THREE.Vector3().lerpVectors(leftPt, rightPt, uNorm);
}

function measureFrom4CornerPlane(hitPt, cx, cy) {
  const fromC1 = new THREE.Vector3().subVectors(hitPt, cornerData.C1);
  const distLeft = Math.max(0, fromC1.dot(cornerData.uDir));
  const distRight = Math.max(0, cornerData.length - distLeft);
  const distTop = Math.max(0, fromC1.dot(cornerData.vDir));
  const distBot = Math.max(0, cornerData.width - distTop);

  const uNorm = Math.min(1, Math.max(0, distLeft / (cornerData.length || 1)));
  const vNorm = Math.min(1, Math.max(0, distTop / (cornerData.width || 1)));

  // Exact point on the 4-corner sight mesh directly above/below hitPt
  const planePt = getPointOn4CornerPlane(uNorm, vNorm);
  const dropDepth = hitPt.distanceTo(planePt);

  document.getElementById('f-probe-depth').innerText = dropDepth.toFixed(1) + ' mm';
  document.getElementById('f-dist-left').innerText = distLeft.toFixed(0);
  document.getElementById('f-dist-right').innerText = distRight.toFixed(0);
  document.getElementById('f-dist-top').innerText = distTop.toFixed(0);
  document.getElementById('f-dist-bot').innerText = distBot.toFixed(0);

  if (cx !== undefined && cy !== undefined) {
    const pin = document.getElementById('f-touch-pin');
    pin.style.left = cx + 'px';
    pin.style.top = cy + 'px';
    pin.style.display = 'block';
  }

  while (fProbeGroup.children.length > 0) fProbeGroup.remove(fProbeGroup.children[0]);

  // Yellow vertical drop line from exact 4-corner mesh to plate surface
  fProbeGroup.add(new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([hitPt, planePt]),
    new THREE.LineBasicMaterial({ color: 0xfacc15, linewidth: 3 })
  ));

  // Blue cross lines on the 4-corner mesh showing Left-Right & Top-Bottom string distances
  const leftEdgePt = getPointOn4CornerPlane(0, vNorm);
  const rightEdgePt = getPointOn4CornerPlane(1, vNorm);
  const topEdgePt = getPointOn4CornerPlane(uNorm, 0);
  const botEdgePt = getPointOn4CornerPlane(uNorm, 1);

  const crossMat = new THREE.LineBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.9 });
  fProbeGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([leftEdgePt, rightEdgePt]), crossMat));
  fProbeGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([topEdgePt, botEdgePt]), crossMat));
}

// ═══════════════════════════════════════════════════════════
// 6. MAGNIFIER LOUPE + PRECISION CORNER PICKING
// ═══════════════════════════════════════════════════════════
function snapToNearestVertex(hitPoint) {
  if (!fPlateMesh) return hitPoint;
  const pos = fPlateMesh.geometry.attributes.position.array;
  let bestDistSq = Infinity;
  const bestPt = hitPoint.clone();
  const tmp = new THREE.Vector3();

  for (let i = 0; i < pos.length; i += 3) {
    tmp.set(pos[i], pos[i + 1], pos[i + 2]);
    const dSq = tmp.distanceToSquared(hitPoint);
    if (dSq < bestDistSq) {
      bestDistSq = dSq;
      bestPt.copy(tmp);
    }
  }
  return (Math.sqrt(bestDistSq) < 55) ? bestPt : hitPoint;
}

function updateMagnifier(cx, cy) {
  const magEl = document.getElementById('f-magnifier');
  const magCanvas = document.getElementById('f-mag-canvas');
  if (!magEl || !magCanvas || !fRenderer) return;

  magEl.style.display = 'block';
  magEl.style.left = cx + 'px';
  magEl.style.top = cy + 'px';

  const ctx = magCanvas.getContext('2d');
  const srcCanvas = fRenderer.domElement;
  const dpr = fRenderer.getPixelRatio();
  const rect = srcCanvas.getBoundingClientRect();

  const sx = (cx - rect.left) * dpr;
  const sy = (cy - rect.top) * dpr;
  const zoomSample = 48 * dpr;

  ctx.clearRect(0, 0, magCanvas.width, magCanvas.height);
  ctx.drawImage(
    srcCanvas,
    sx - zoomSample / 2, sy - zoomSample / 2, zoomSample, zoomSample,
    0, 0, magCanvas.width, magCanvas.height
  );
}

function hideMagnifier() {
  const magEl = document.getElementById('f-magnifier');
  if (magEl) magEl.style.display = 'none';
}

function setupFormingCanvasInteractions() {
  const dom = fRenderer.domElement;
  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2();
  let isPickingDrag = false;
  let downX = 0, downY = 0, downTime = 0;
  let lastHitPt = null, lastScreenX = 0, lastScreenY = 0;

  dom.addEventListener('pointerdown', (e) => {
    downX = e.clientX;
    downY = e.clientY;
    downTime = Date.now();

    // When in Pick 4 Corners mode, touch-hold activates magnifier loupe
    if (fMode === 'corners' && e.isPrimary) {
      isPickingDrag = true;
      if (fControls) fControls.enabled = false;
      updateMagnifier(e.clientX, e.clientY);
    }
  });

  dom.addEventListener('pointermove', (e) => {
    if (isPickingDrag && fMode === 'corners') {
      updateMagnifier(e.clientX, e.clientY);
    }
  });

  dom.addEventListener('pointerup', (e) => {
    if (isPickingDrag && fMode === 'corners') {
      isPickingDrag = false;
      hideMagnifier();
      if (fControls) fControls.enabled = true;
      handleFormingPlateTap(e.clientX, e.clientY, raycaster, mouse);
      return;
    }

    const moveDist = Math.hypot(e.clientX - downX, e.clientY - downY);
    const dt = Date.now() - downTime;
    if (moveDist < 10 && dt < 400) {
      handleFormingPlateTap(e.clientX, e.clientY, raycaster, mouse);
    }
  });

  dom.addEventListener('pointercancel', () => {
    isPickingDrag = false;
    hideMagnifier();
    if (fControls) fControls.enabled = true;
  });

  window._reMeasureLastProbe = () => {
    if (lastHitPt && fManualCorners.length === 4) {
      measureFrom4CornerPlane(lastHitPt, lastScreenX, lastScreenY);
    }
  };
  window._setLastProbeHit = (pt, sx, sy) => {
    lastHitPt = pt.clone();
    lastScreenX = sx;
    lastScreenY = sy;
  };
}

function handleFormingPlateTap(cx, cy, raycaster, mouse) {
  if (!fPlateMesh) return;
  const rect = fRenderer.domElement.getBoundingClientRect();
  mouse.x = ((cx - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((cy - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(mouse, fCamera);

  const hits = raycaster.intersectObject(fPlateMesh, false);
  if (hits.length === 0) return;

  const hitPt = hits[0].point;

  // MODE A: PICK 4 CORNERS
  if (fMode === 'corners') {
    const snapped = snapToNearestVertex(hitPt);
    if (fManualCorners.length >= 4) fManualCorners = [];
    fManualCorners.push(snapped);
    applyFormingCorners(fManualCorners);

    if (fManualCorners.length < 4) {
      document.getElementById('f-mode-banner').innerText = `📍 Drag & release on Corner ${fManualCorners.length + 1} of 4`;
    } else {
      document.getElementById('f-mode-banner').innerText = `✅ 4-Corner Sight Mesh Ready! Tap plate to measure`;
      setFormingMode('measure');
    }
    return;
  }

  // MODE B: MEASURE FROM 4-CORNER PLANE
  if (fManualCorners.length < 4) {
    document.getElementById('f-mode-banner').innerText = `⚠️ Pick all 4 corners first!`;
    return;
  }

  window._setLastProbeHit(hitPt, cx, cy);
  measureFrom4CornerPlane(hitPt, cx, cy);
}

// ═══════════════════════════════════════════════════════════
// 7. TEMPLATE GENERATOR & DXF EXPORTER
// ═══════════════════════════════════════════════════════════
function generateFormingTemplates() {
  if (!fPlateMesh || fManualCorners.length < 4) return;
  while (fTemplateGroup.children.length > 0) fTemplateGroup.remove(fTemplateGroup.children[0]);
  fSections = [];

  const interval = parseFloat(document.getElementById('f-inp-interval').value) || 300;
  const cutDir = document.getElementById('f-inp-axis').value;
  const boardMargin = parseFloat(document.getElementById('f-inp-base-depth').value) || 120;

  const isStation = (cutDir === 'station');
  const totalSpan = isStation ? cornerData.length : cornerData.width;
  const sliceAxis = isStation ? cornerData.uDir : cornerData.vDir;
  const baseCorner = cornerData.C1;

  const pos = fPlateMesh.geometry.attributes.position.array;
  const triCount = pos.length / 9;

  let tmplIndex = 1;
  const exportList = document.getElementById('f-template-export-list');
  exportList.innerHTML = '';

  for (let dist = interval / 2; dist < totalSpan; dist += interval) {
    const cutPlanePoint = new THREE.Vector3().copy(baseCorner).addScaledVector(sliceAxis, dist);
    const segments = [];

    for (let i = 0; i < triCount; i++) {
      const idx = i * 9;
      const pA = new THREE.Vector3(pos[idx], pos[idx + 1], pos[idx + 2]);
      const pB = new THREE.Vector3(pos[idx + 3], pos[idx + 4], pos[idx + 5]);
      const pC = new THREE.Vector3(pos[idx + 6], pos[idx + 7], pos[idx + 8]);

      const dA = new THREE.Vector3().subVectors(pA, cutPlanePoint).dot(sliceAxis);
      const dB = new THREE.Vector3().subVectors(pB, cutPlanePoint).dot(sliceAxis);
      const dC = new THREE.Vector3().subVectors(pC, cutPlanePoint).dot(sliceAxis);

      const d = [dA, dB, dC];
      const pts = [pA, pB, pC];
      const hits = [];

      [[0, 1], [1, 2], [2, 0]].forEach(([i1, i2]) => {
        if ((d[i1] <= 0 && d[i2] >= 0) || (d[i1] >= 0 && d[i2] <= 0)) {
          if (Math.abs(d[i1] - d[i2]) > 0.0001) {
            const t = -d[i1] / (d[i2] - d[i1]);
            hits.push(new THREE.Vector3().lerpVectors(pts[i1], pts[i2], t));
          }
        }
      });

      if (hits.length === 2) segments.push({ a: hits[0], b: hits[1] });
    }

    if (segments.length < 2) continue;
    const sortedPts = sortLineSegments(segments);
    if (sortedPts.length < 2) continue;

    const cGeom = new THREE.BufferGeometry().setFromPoints(sortedPts);
    fTemplateGroup.add(new THREE.Line(cGeom, new THREE.LineBasicMaterial({ color: 0xfacc15, linewidth: 2 })));

    const pStart = sortedPts[0];
    const pEnd = sortedPts[sortedPts.length - 1];
    const chordLen = pStart.distanceTo(pEnd);

    const chordLine = new THREE.Line3(pStart, pEnd);
    let maxSagitta = 0;
    sortedPts.forEach(pt => {
      const close = new THREE.Vector3();
      chordLine.closestPointToPoint(pt, true, close);
      const d = pt.distanceTo(close);
      if (d > maxSagitta) maxSagitta = d;
    });

    const tmplName = `${isStation ? 'Stn' : 'WL'}_${tmplIndex}_${dist.toFixed(0)}mm`;
    fSections.push({
      name: tmplName,
      pts: sortedPts,
      chord: chordLen,
      sagitta: maxSagitta,
      boardMargin: boardMargin
    });

    const div = document.createElement('div');
    div.className = 'f-tmpl-item';
    div.innerHTML = `<span><b>${tmplName}</b> (Sag: ${maxSagitta.toFixed(1)} mm)</span>
                     <button class="f-tmpl-dxf-btn" onclick="exportOverlayTemplateToDXF(${fSections.length - 1})">Download DXF</button>`;
    exportList.appendChild(div);
    tmplIndex++;
  }
}

function sortLineSegments(segs) {
  if (segs.length === 0) return [];
  const pts = [segs[0].a, segs[0].b];
  const rem = segs.slice(1);

  while (rem.length > 0) {
    const tail = pts[pts.length - 1];
    let found = -1, rev = false;

    for (let i = 0; i < rem.length; i++) {
      if (tail.distanceTo(rem[i].a) < 1.5) { found = i; rev = false; break; }
      if (tail.distanceTo(rem[i].b) < 1.5) { found = i; rev = true; break; }
    }

    if (found !== -1) {
      const s = rem.splice(found, 1)[0];
      pts.push(rev ? s.a : s.b);
    } else break;
  }
  return pts;
}

window.exportOverlayTemplateToDXF = function(secIdx) {
  const item = fSections[secIdx];
  if (!item || !item.pts || item.pts.length < 2) return;

  const pts3D = item.pts;
  const pStart = pts3D[0];
  const pEnd = pts3D[pts3D.length - 1];

  const chordDir = new THREE.Vector3().subVectors(pEnd, pStart).normalize();
  const normDir = new THREE.Vector3().copy(cornerData.nDir).normalize();

  const pts2D = pts3D.map(p => {
    const diff = new THREE.Vector3().subVectors(p, pStart);
    return { x: diff.dot(chordDir), y: diff.dot(normDir) };
  });

  const chordLength = pStart.distanceTo(pEnd);
  const maxY = Math.max(...pts2D.map(p => p.y));
  const boardTopY = maxY + item.boardMargin;

  let dxf = "0\nSECTION\n2\nENTITIES\n";
  for (let i = 0; i < pts2D.length - 1; i++) {
    dxf += `0\nLINE\n8\nPLATE_CURVE\n10\n${pts2D[i].x.toFixed(2)}\n20\n${pts2D[i].y.toFixed(2)}\n11\n${pts2D[i + 1].x.toFixed(2)}\n21\n${pts2D[i + 1].y.toFixed(2)}\n`;
  }

  const p0 = pts2D[0];
  const pLast = pts2D[pts2D.length - 1];
  dxf += `0\nLINE\n8\nWOOD_FRAME\n10\n${p0.x.toFixed(2)}\n20\n${p0.y.toFixed(2)}\n11\n${p0.x.toFixed(2)}\n21\n${boardTopY.toFixed(2)}\n`;
  dxf += `0\nLINE\n8\nSIGHT_BASE_EDGE\n10\n${p0.x.toFixed(2)}\n20\n${boardTopY.toFixed(2)}\n11\n${pLast.x.toFixed(2)}\n21\n${boardTopY.toFixed(2)}\n`;
  dxf += `0\nLINE\n8\nWOOD_FRAME\n10\n${pLast.x.toFixed(2)}\n20\n${boardTopY.toFixed(2)}\n11\n${pLast.x.toFixed(2)}\n21\n${pLast.y.toFixed(2)}\n`;

  const midX = chordLength / 2;
  dxf += `0\nLINE\n8\nCENTER_DROP_LINE\n10\n${midX.toFixed(2)}\n20\n${boardTopY.toFixed(2)}\n11\n${midX.toFixed(2)}\n21\n${(boardTopY - item.sagitta).toFixed(2)}\n`;
  dxf += "0\nENDSEC\n0\nEOF\n";

  const blob = new Blob([dxf], { type: 'application/dxf' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `${item.name}_ClosedTemplate.dxf`;
  link.click();
};

// ═══════════════════════════════════════════════════════════
// 8. UI EVENTS & SIDE OFFSET CONTROLS
// ═══════════════════════════════════════════════════════════
function setFormingMode(mode) {
  fMode = mode;
  const btnMeasure = document.getElementById('f-btn-mode-measure');
  const btnCorners = document.getElementById('f-btn-mode-corners');
  const banner = document.getElementById('f-mode-banner');

  btnMeasure.classList.remove('active');
  btnCorners.classList.remove('corner-active');

  if (mode === 'measure') {
    btnMeasure.classList.add('active');
    banner.innerText = '📏 Tap plate to measure drop & edge distances';
    banner.style.borderColor = '#0284c7';
    banner.style.color = '#38bdf8';
  } else {
    btnCorners.classList.add('corner-active');
    fManualCorners = [];
    applyFormingCorners([]);
    while (fProbeGroup.children.length > 0) fProbeGroup.remove(fProbeGroup.children[0]);
    document.getElementById('f-touch-pin').style.display = 'none';
    banner.innerText = '📍 Zoom in, touch & release on Corner 1 of 4';
    banner.style.borderColor = '#10b981';
    banner.style.color = '#6ee7b7';
  }
}

function updateSideOffset(newVal) {
  fPlaneOffset = Math.max(0, Math.min(500, newVal));
  document.getElementById('f-side-offset-slider').value = fPlaneOffset;
  document.getElementById('f-side-offset-val').innerText = fPlaneOffset + 'mm';

  if (fManualCorners.length === 4) {
    buildExact4CornerMesh();
    if (window._reMeasureLastProbe) window._reMeasureLastProbe();
  }
}

function setupFormingOverlayEvents() {
  document.getElementById('f-btn-mode-measure').addEventListener('click', () => setFormingMode('measure'));
  document.getElementById('f-btn-mode-corners').addEventListener('click', () => setFormingMode('corners'));

  // Side Offset Slider & +/- Buttons
  document.getElementById('f-side-offset-slider').addEventListener('input', (e) => {
    updateSideOffset(parseFloat(e.target.value) || 0);
  });
  document.getElementById('f-btn-offset-up').addEventListener('click', () => {
    updateSideOffset(fPlaneOffset + 10);
  });
  document.getElementById('f-btn-offset-down').addEventListener('click', () => {
    updateSideOffset(fPlaneOffset - 10);
  });

  // Toggle HUD visibility
  const btnHud = document.getElementById('f-btn-toggle-hud');
  const hud = document.getElementById('f-probe-hud');
  const sidePanel = document.getElementById('f-side-offset-panel');
  btnHud.addEventListener('click', () => {
    const isHidden = hud.classList.toggle('hidden');
    sidePanel.classList.toggle('hidden', isHidden);
    btnHud.innerText = isHidden ? '👁️ Show HUD' : '👁️ Hide HUD';
  });

  // Settings Drawer
  const drawer = document.getElementById('f-settings-drawer');
  const backdrop = document.getElementById('f-drawer-backdrop');
  const openDrawer = () => { drawer.classList.add('open'); backdrop.classList.add('open'); };
  const closeDrawer = () => { drawer.classList.remove('open'); backdrop.classList.remove('open'); };

  document.getElementById('f-btn-open-settings').addEventListener('click', openDrawer);
  document.getElementById('f-btn-close-settings').addEventListener('click', closeDrawer);
  backdrop.addEventListener('click', closeDrawer);

  document.getElementById('f-btn-undo-corner').addEventListener('click', () => {
    if (fManualCorners.length > 0) {
      fManualCorners.pop();
      applyFormingCorners(fManualCorners);
      fMode = 'corners';
      document.getElementById('f-btn-mode-corners').classList.add('corner-active');
      document.getElementById('f-btn-mode-measure').classList.remove('active');
      document.getElementById('f-mode-banner').innerText = `📍 Drag & release on Corner ${fManualCorners.length + 1} of 4`;
    }
  });

  document.getElementById('f-btn-clear-corners').addEventListener('click', () => {
    setFormingMode('corners');
    closeDrawer();
  });

  document.getElementById('f-btn-slice-plates').addEventListener('click', () => {
    generateFormingTemplates();
    closeDrawer();
  });

  document.getElementById('f-btn-toggle-datum').addEventListener('click', () => {
    if (fDatumPlane) fDatumPlane.visible = !fDatumPlane.visible;
  });

  document.getElementById('btn-close-forming').addEventListener('click', () => {
    document.getElementById('forming-studio-modal').style.display = 'none';
    if (window.updateControlsLockState) window.updateControlsLockState();
    else if (window.controls) window.controls.enabled = true;
  });
}
