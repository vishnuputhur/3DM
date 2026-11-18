'use strict';

// ═══════════════════════════════════════════════════════════
// MOBILE-FIRST 4-CORNER STRING-LINE FORMING STUDIO (OVERLAY)
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
let fManualCorners = []; // Up to 4 THREE.Vector3 points
let fHtmlLabels = [];

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
  width: 0,
  planeOrigin: new THREE.Vector3()
};

// ═══════════════════════════════════════════════════════════
// 1. INJECT MOBILE-OPTIMIZED MODAL UI & STYLES
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
          left: 12px; right: auto; bottom: auto; top: 62px;
          width: 345px; border-radius: 14px; border: 1px solid #334155;
          transform: translateX(-120%);
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
      .f-input-group input[type="range"] { width: 100%; accent-color: #0284c7; height: 24px; }
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

      .f-label-3d {
        position: absolute; background: rgba(9, 13, 22, 0.88); color: #facc15;
        border: 1px solid #10b981; padding: 2px 6px; border-radius: 4px;
        font-size: 10px; font-family: monospace; font-weight: 700;
        pointer-events: none; transform: translate(-50%, -50%); z-index: 12; white-space: nowrap;
      }
      .f-label-3d.corner-tag { background: #059669; color: #fff; border-color: #fff; }

      #f-touch-pin {
        position: absolute; width: 14px; height: 14px; border-radius: 50%;
        border: 2px solid #facc15; background: rgba(250, 204, 21, 0.45);
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
      📏 Tap plate to measure drop & edge distances
    </div>

    <div class="f-probe-hud" id="f-probe-hud">
      <div class="f-probe-label">String Drop Depth</div>
      <div class="f-probe-val" id="f-probe-depth">0.0 mm</div>
      <div class="f-probe-grid">
        <div><span>Left:</span> <b id="f-dist-left">-</b></div>
        <div><span>Right:</span> <b id="f-dist-right">-</b></div>
        <div><span>Top:</span> <b id="f-dist-top">-</b></div>
        <div><span>Bot:</span> <b id="f-dist-bot">-</b></div>
      </div>
    </div>

    <div id="f-labels-layer"></div>
    <div id="f-touch-pin"></div>

    <div class="f-bottom-dock">
      <button class="f-dock-btn active" id="f-btn-mode-measure">📏 Measure</button>
      <button class="f-dock-btn" id="f-btn-mode-corners">📍 Pick 4 Corners</button>
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
          <button class="f-btn f-btn-danger" id="f-btn-auto-corners">🔄 Auto 4 Corners</button>
        </div>
      </div>

      <div class="f-input-group">
        <div style="display:flex; justify-content:space-between;">
          <label>String Plane Lift from Corners (mm)</label>
          <span id="f-lbl-lift-val" style="font-size:11px; color:#38bdf8; font-weight:700;">0 mm</span>
        </div>
        <input type="range" id="f-inp-lift" min="0" max="500" value="0" step="5" />
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
        <button class="f-btn f-btn-secondary" id="f-btn-toggle-datum">🌐 Plane On/Off</button>
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
// 2. INITIALIZE THREE.JS OVERLAY SCENE
// ═══════════════════════════════════════════════════════════
function initFormingOverlay() {
  buildFormingModalDOM();

  const container = document.getElementById('forming-canvas-container');
  fScene = new THREE.Scene();
  fScene.background = new THREE.Color(0x090d16);

  fCamera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 10, 500000);
  fCamera.up.set(0, 0, 1);

  fRenderer = new THREE.WebGLRenderer({ antialias: true });
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
// 3. OPEN FORMING STUDIO ENTRY POINT (CALLED FROM VIEWER)
// ═══════════════════════════════════════════════════════════
window.openDirectFormingStudio = function(meshObj) {
  if (!formingStudioInitialized) {
    initFormingOverlay();
  }

  const modal = document.getElementById('forming-studio-modal');
  modal.style.display = 'block';

  if (window.controls) window.controls.enabled = false;

  if (fPlateMesh) { fScene.remove(fPlateMesh); fPlateMesh = null; }
  while (fTemplateGroup.children.length > 0) fTemplateGroup.remove(fTemplateGroup.children[0]);
  while (fStringGroup.children.length > 0) fStringGroup.remove(fStringGroup.children[0]);
  while (fProbeGroup.children.length > 0) fProbeGroup.remove(fProbeGroup.children[0]);

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

  autoDetectPlateCorners(g);
  applyFormingCorners(fManualCorners);
  setFormingMode('measure');

  fControls.target.copy(cornerData.center);
  const d = Math.max(cornerData.length, cornerData.width) * 1.45;
  fCamera.position.copy(cornerData.center)
    .addScaledVector(cornerData.nDir, d * 0.9)
    .addScaledVector(cornerData.vDir, -d * 0.5);
  fCamera.up.set(0, 0, 1);
  fControls.update();

  fRenderer.setSize(window.innerWidth, window.innerHeight);
  fCamera.aspect = window.innerWidth / window.innerHeight;
  fCamera.updateProjectionMatrix();
};

// ═══════════════════════════════════════════════════════════
// 4. AUTO & MANUAL 4-CORNER STRING LINE LOGIC
// ═══════════════════════════════════════════════════════════
function autoDetectPlateCorners(geom) {
  const pos = geom.attributes.position.array;
  const count = pos.length / 3;

  const center = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    center.x += pos[i * 3];
    center.y += pos[i * 3 + 1];
    center.z += pos[i * 3 + 2];
  }
  center.divideScalar(count);

  let maxD2 = 0;
  let c1 = new THREE.Vector3(), c3 = new THREE.Vector3();
  const step = Math.max(1, Math.floor(count / 200));

  for (let i = 0; i < count; i += step) {
    const pA = new THREE.Vector3(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
    for (let j = i + 1; j < count; j += step) {
      const pB = new THREE.Vector3(pos[j * 3], pos[j * 3 + 1], pos[j * 3 + 2]);
      const d2 = pA.distanceToSquared(pB);
      if (d2 > maxD2) { maxD2 = d2; c1.copy(pA); c3.copy(pB); }
    }
  }

  const diagLine = new THREE.Line3(c1, c3);
  const tempClose = new THREE.Vector3();
  const diagDir = new THREE.Vector3().subVectors(c3, c1).normalize();
  const refUp = Math.abs(diagDir.z) > 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);
  const sideVec = new THREE.Vector3().crossVectors(diagDir, refUp).normalize();

  let maxSideA = 0, maxSideB = 0;
  let c2 = new THREE.Vector3(), c4 = new THREE.Vector3();

  for (let i = 0; i < count; i++) {
    const pt = new THREE.Vector3(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
    diagLine.closestPointToPoint(pt, false, tempClose);
    const toPt = new THREE.Vector3().subVectors(pt, tempClose);
    const dist = toPt.length();
    if (toPt.dot(sideVec) >= 0 && dist > maxSideA) { maxSideA = dist; c2.copy(pt); }
    else if (toPt.dot(sideVec) < 0 && dist > maxSideB) { maxSideB = dist; c4.copy(pt); }
  }

  cornerData.center.copy(center);
  fManualCorners = [c1, c2, c3, c4];
}

function applyFormingCorners(corners) {
  drawCornerStringLines(corners);
  if (corners.length < 4) return;

  const [c1, c2, c3, c4] = corners;
  cornerData.C1.copy(c1);
  cornerData.C2.copy(c2);
  cornerData.C3.copy(c3);
  cornerData.C4.copy(c4);

  cornerData.center.copy(c1).add(c2).add(c3).add(c4).multiplyScalar(0.25);
  cornerData.uDir.subVectors(c2, c1).normalize();
  cornerData.vDir.subVectors(c4, c1).normalize();

  cornerData.nDir.crossVectors(cornerData.uDir, cornerData.vDir).normalize();
  if (cornerData.nDir.z < 0) cornerData.nDir.negate();
  cornerData.vDir.crossVectors(cornerData.nDir, cornerData.uDir).normalize();

  cornerData.length = c1.distanceTo(c2);
  cornerData.width = c1.distanceTo(c4);

  createCornerSightPlane();
  generateFormingTemplates();
}

function drawCornerStringLines(corners) {
  while (fStringGroup.children.length > 0) fStringGroup.remove(fStringGroup.children[0]);
  const layer = document.getElementById('f-labels-layer');
  if (layer) layer.innerHTML = '';
  fHtmlLabels = [];

  if (corners.length === 0) return;

  corners.forEach((c, idx) => {
    const sphere = new THREE.Mesh(
      new THREE.SphereGeometry(18, 12, 12),
      new THREE.MeshBasicMaterial({ color: 0x10b981, depthTest: false })
    );
    sphere.position.copy(c);
    fStringGroup.add(sphere);
    addFormingHTMLLabel(`C${idx + 1}`, c, true);
  });

  if (corners.length >= 2) {
    const linePts = [...corners];
    if (corners.length === 4) linePts.push(corners[0]);

    const geom = new THREE.BufferGeometry().setFromPoints(linePts);
    const mat = new THREE.LineBasicMaterial({ color: 0x10b981, linewidth: 3, depthTest: false });
    fStringGroup.add(new THREE.Line(geom, mat));

    for (let i = 0; i < linePts.length - 1; i++) {
      const pA = linePts[i];
      const pB = linePts[i + 1];
      const dist = pA.distanceTo(pB);
      const mid = new THREE.Vector3().addVectors(pA, pB).multiplyScalar(0.5);
      addFormingHTMLLabel(`${dist.toFixed(0)} mm`, mid, false);
    }
  }
}

function addFormingHTMLLabel(text, pos3D, isCorner) {
  const layer = document.getElementById('f-labels-layer');
  if (!layer) return;
  const el = document.createElement('div');
  el.className = 'f-label-3d' + (isCorner ? ' corner-tag' : '');
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
      item.el.style.display = 'block';
      item.el.style.left = ((v.x * 0.5 + 0.5) * w) + 'px';
      item.el.style.top = ((-(v.y * 0.5) + 0.5) * h) + 'px';
    }
  });
}

// ═══════════════════════════════════════════════════════════
// 5. SIGHT PLANE & STATION TEMPLATES
// ═══════════════════════════════════════════════════════════
function createCornerSightPlane() {
  if (fDatumPlane) fScene.remove(fDatumPlane);
  if (fManualCorners.length < 4) return;

  const lift = parseFloat(document.getElementById('f-inp-lift').value) || 0;
  cornerData.planeOrigin.copy(cornerData.center).addScaledVector(cornerData.nDir, lift);

  const geom = new THREE.PlaneGeometry(cornerData.length * 1.08, cornerData.width * 1.08, 6, 6);
  const mat = new THREE.MeshBasicMaterial({
    color: 0x0284c7, wireframe: true, transparent: true, opacity: 0.4, side: THREE.DoubleSide
  });

  fDatumPlane = new THREE.Mesh(geom, mat);
  const rotM = new THREE.Matrix4().makeBasis(cornerData.uDir, cornerData.vDir, cornerData.nDir);
  fDatumPlane.setRotationFromMatrix(rotM);
  fDatumPlane.position.copy(cornerData.planeOrigin);
  fScene.add(fDatumPlane);
}

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

// ═══════════════════════════════════════════════════════════
// 6. TAP INTERACTION: PICK CORNERS & MEASURE DROP + DISTANCES
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
  return (Math.sqrt(bestDistSq) < 60) ? bestPt : hitPoint;
}

function setupFormingCanvasInteractions() {
  const dom = fRenderer.domElement;
  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2();
  let downX = 0, downY = 0, downTime = 0;

  dom.addEventListener('pointerdown', (e) => {
    downX = e.clientX;
    downY = e.clientY;
    downTime = Date.now();
  });

  dom.addEventListener('pointerup', (e) => {
    const moveDist = Math.hypot(e.clientX - downX, e.clientY - downY);
    const dt = Date.now() - downTime;

    // Trigger only on clean tap (ignores finger drag rotation)
    if (moveDist < 10 && dt < 400) {
      handleFormingPlateTap(e.clientX, e.clientY, raycaster, mouse);
    }
  });
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
      document.getElementById('f-mode-banner').innerText = `📍 Tap Corner ${fManualCorners.length + 1} of 4`;
    } else {
      document.getElementById('f-mode-banner').innerText = `✅ 4 Corners & String Lines Connected!`;
      setFormingMode('measure');
    }
    return;
  }

  // MODE B: MEASURE DROP DEPTH & SIDE DISTANCES
  if (fManualCorners.length < 4) {
    document.getElementById('f-mode-banner').innerText = `⚠️ Pick all 4 corners first!`;
    return;
  }

  const toPlane = new THREE.Vector3().subVectors(cornerData.planeOrigin, hitPt);
  const dropDepth = Math.abs(toPlane.dot(cornerData.nDir));

  const fromC1 = new THREE.Vector3().subVectors(hitPt, cornerData.C1);
  const distLeft = Math.max(0, fromC1.dot(cornerData.uDir));
  const distRight = Math.max(0, cornerData.length - distLeft);
  const distTop = Math.max(0, fromC1.dot(cornerData.vDir));
  const distBot = Math.max(0, cornerData.width - distTop);

  document.getElementById('f-probe-depth').innerText = dropDepth.toFixed(1) + ' mm';
  document.getElementById('f-dist-left').innerText = distLeft.toFixed(0);
  document.getElementById('f-dist-right').innerText = distRight.toFixed(0);
  document.getElementById('f-dist-top').innerText = distTop.toFixed(0);
  document.getElementById('f-dist-bot').innerText = distBot.toFixed(0);

  const pin = document.getElementById('f-touch-pin');
  pin.style.left = cx + 'px';
  pin.style.top = cy + 'px';
  pin.style.display = 'block';

  while (fProbeGroup.children.length > 0) fProbeGroup.remove(fProbeGroup.children[0]);

  // Yellow vertical drop line
  const sightPt = hitPt.clone().addScaledVector(cornerData.nDir, dropDepth);
  fProbeGroup.add(new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([hitPt, sightPt]),
    new THREE.LineBasicMaterial({ color: 0xfacc15, linewidth: 3 })
  ));

  // Blue cross lines showing Left-Right & Top-Bottom distances to string edges
  const leftPt = sightPt.clone().addScaledVector(cornerData.uDir, -distLeft);
  const rightPt = sightPt.clone().addScaledVector(cornerData.uDir, distRight);
  const topPt = sightPt.clone().addScaledVector(cornerData.vDir, -distTop);
  const botPt = sightPt.clone().addScaledVector(cornerData.vDir, distBot);

  const crossMat = new THREE.LineBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.85 });
  fProbeGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([leftPt, rightPt]), crossMat));
  fProbeGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([topPt, botPt]), crossMat));
}

// ═══════════════════════════════════════════════════════════
// 7. UI EVENTS & DRAWER CONTROLS
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
    banner.innerText = '📍 Zoom in & tap Corner 1 of 4';
    banner.style.borderColor = '#10b981';
    banner.style.color = '#6ee7b7';
  }
}

function setupFormingOverlayEvents() {
  document.getElementById('f-btn-mode-measure').addEventListener('click', () => setFormingMode('measure'));
  document.getElementById('f-btn-mode-corners').addEventListener('click', () => setFormingMode('corners'));

  // Toggle HUD visibility
  const btnHud = document.getElementById('f-btn-toggle-hud');
  const hud = document.getElementById('f-probe-hud');
  btnHud.addEventListener('click', () => {
    const isHidden = hud.classList.toggle('hidden');
    btnHud.innerText = isHidden ? '👁️ Show HUD' : '👁️ Hide HUD';
  });

  // Settings Drawer open/close
  const drawer = document.getElementById('f-settings-drawer');
  const backdrop = document.getElementById('f-drawer-backdrop');
  const openDrawer = () => { drawer.classList.add('open'); backdrop.classList.add('open'); };
  const closeDrawer = () => { drawer.classList.remove('open'); backdrop.classList.remove('open'); };

  document.getElementById('f-btn-open-settings').addEventListener('click', openDrawer);
  document.getElementById('f-btn-close-settings').addEventListener('click', closeDrawer);
  backdrop.addEventListener('click', closeDrawer);

  // Undo / Auto Corners
  document.getElementById('f-btn-undo-corner').addEventListener('click', () => {
    if (fManualCorners.length > 0) {
      fManualCorners.pop();
      applyFormingCorners(fManualCorners);
      document.getElementById('f-mode-banner').innerText = `📍 Tap Corner ${fManualCorners.length + 1} of 4`;
    }
  });

  document.getElementById('f-btn-auto-corners').addEventListener('click', () => {
    if (!fPlateMesh) return;
    autoDetectPlateCorners(fPlateMesh.geometry);
    applyFormingCorners(fManualCorners);
    setFormingMode('measure');
    closeDrawer();
  });

  // Lift slider & Template actions
  const liftSlider = document.getElementById('f-inp-lift');
  liftSlider.addEventListener('input', () => {
    document.getElementById('f-lbl-lift-val').innerText = liftSlider.value + ' mm';
    createCornerSightPlane();
  });

  document.getElementById('f-btn-slice-plates').addEventListener('click', () => {
    createCornerSightPlane();
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

// ═══════════════════════════════════════════════════════════
// 8. CLOSED CNC WOODEN TEMPLATE DXF EXPORTER
// ═══════════════════════════════════════════════════════════
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
