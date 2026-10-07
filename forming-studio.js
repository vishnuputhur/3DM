'use strict';

// ═══════════════════════════════════════════════════════════
// TRUE 4-CORNER STRING-LINE SIGHT PLANE (YARD BENCH METHOD)
// ═══════════════════════════════════════════════════════════

let fScene, fCamera, fRenderer, fControls;
let fPlateMesh = null, fDatumPlane = null;
let fTemplateGroup = new THREE.Group(), fProbeGroup = new THREE.Group();
let fStringLinesGroup = new THREE.Group();
let fSections = [];
let formingStudioInitialized = false;

// പ്ലേറ്റിന്റെ യഥാർത്ഥ 4 മൂലകളും സൈറ്റ് ഫ്രെയിമും
let cornerData = {
  C1: new THREE.Vector3(), // Top-Left
  C2: new THREE.Vector3(), // Top-Right
  C3: new THREE.Vector3(), // Bottom-Right
  C4: new THREE.Vector3(), // Bottom-Left
  center: new THREE.Vector3(),
  uDir: new THREE.Vector3(), // നീളമുള്ള നൂലിന്റെ ദിശ (String Line 1-2)
  vDir: new THREE.Vector3(), // വീതിയുള്ള വശത്തിന്റെ ദിശ
  nDir: new THREE.Vector3(), // സൈറ്റ് പ്ലെയിൻ ലംബം
  length: 0,
  width: 0,
  lift: 50,
  planeOrigin: new THREE.Vector3()
};

function initFormingOverlay() {
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
  fScene.add(fProbeGroup);
  fScene.add(fStringLinesGroup);

  setupFormingProbeLogic();
  setupFormingOverlayEvents();
  formingStudioInitialized = true;

  function animForming() {
    requestAnimationFrame(animForming);
    const modal = document.getElementById('forming-studio-modal');
    if (modal && modal.style.display === 'block') {
      if (fControls) fControls.update();
      if (fRenderer && fScene && fCamera) fRenderer.render(fScene, fCamera);
    }
  }
  animForming();
}

// ═══════════════════════════════════════════════════════════
// പ്ലേറ്റിന്റെ യഥാർത്ഥ 4 അഗ്ര മൂലകൾ (True 4 Corners) കണ്ടെത്തുന്നു
// ═══════════════════════════════════════════════════════════
function detectTruePlateCorners(geom) {
  const pos = geom.attributes.position.array;
  const count = pos.length / 3;

  // 1. പ്ലേറ്റിന്റെ സെന്റർ കണ്ടെത്തുന്നു
  const center = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    center.x += pos[i * 3];
    center.y += pos[i * 3 + 1];
    center.z += pos[i * 3 + 2];
  }
  center.divideScalar(count);

  // 2. ഏറ്റവും അകലെയുള്ള ആദ്യത്തെ രണ്ട് മൂലകൾ കണ്ടെത്തുന്നു (Diagonal Corners C1 & C3)
  let maxD2 = 0;
  let c1 = new THREE.Vector3(), c3 = new THREE.Vector3();
  const step = Math.max(1, Math.floor(count / 200));

  for (let i = 0; i < count; i += step) {
    const pA = new THREE.Vector3(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
    for (let j = i + 1; j < count; j += step) {
      const pB = new THREE.Vector3(pos[j * 3], pos[j * 3 + 1], pos[j * 3 + 2]);
      const d2 = pA.distanceToSquared(pB);
      if (d2 > maxD2) {
        maxD2 = d2;
        c1.copy(pA);
        c3.copy(pB);
      }
    }
  }

  // C1 - C3 ഡയഗണൽ ലൈൻ
  const diagLine = new THREE.Line3(c1, c3);
  const tempClose = new THREE.Vector3();

  // 3. ഈ ഡയഗണലിൽ നിന്ന് രണ്ട് വശങ്ങളിലേക്കും ഏറ്റവും അകലെയുള്ള മറ്റ് രണ്ട് മൂലകൾ കണ്ടെത്തുന്നു (C2 & C4)
  let maxSideA = 0, maxSideB = 0;
  let c2 = new THREE.Vector3(), c4 = new THREE.Vector3();

  // ഡയഗണലിന്റെ നോർമൽ റഫറൻസ്
  const diagDir = new THREE.Vector3().subVectors(c3, c1).normalize();
  const refUp = new THREE.Vector3(0, 0, 1);
  if (Math.abs(diagDir.dot(refUp)) > 0.9) refUp.set(0, 1, 0);
  const sideVec = new THREE.Vector3().crossVectors(diagDir, refUp).normalize();

  for (let i = 0; i < count; i++) {
    const pt = new THREE.Vector3(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
    diagLine.closestPointToPoint(pt, false, tempClose);
    const toPt = new THREE.Vector3().subVectors(pt, tempClose);
    const dist = toPt.length();
    const sign = toPt.dot(sideVec);

    if (sign >= 0 && dist > maxSideA) {
      maxSideA = dist;
      c2.copy(pt);
    } else if (sign < 0 && dist > maxSideB) {
      maxSideB = dist;
      c4.copy(pt);
    }
  }

  // മൂലകൾ ക്ലോക്ക് വൈസ് ഓർഡറിൽ ക്രമീകരിക്കുന്നു
  cornerData.C1.copy(c1);
  cornerData.C2.copy(c2);
  cornerData.C3.copy(c3);
  cornerData.C4.copy(c4);
  cornerData.center.copy(center);

  // പ്ലേറ്റിന്റെ പ്രാക്ടിക്കൽ സൈറ്റ് ലൈൻ വെക്റ്ററുകൾ
  // U = C1 മുതൽ C2 വരെയുള്ള പ്രധാന അഗ്രം (നീളം)
  cornerData.uDir.subVectors(c2, c1).normalize();

  // V = C1 മുതൽ C4 വരെയുള്ള വീതി
  cornerData.vDir.subVectors(c4, c1).normalize();

  // N = പ്ലേറ്റിന്റെ ഉപരിതലത്തിൽ നിന്ന് കൃത്യമായി മുകളിലേക്കുള്ള ലംബ ദിശ (String Plane Normal)
  cornerData.nDir.crossVectors(cornerData.uDir, cornerData.vDir).normalize();
  if (cornerData.nDir.z < 0) cornerData.nDir.negate();

  // ശരിയായ ഓർത്തോഗൊണൽ ആക്സിസ് ഉറപ്പാക്കുന്നു
  cornerData.vDir.crossVectors(cornerData.nDir, cornerData.uDir).normalize();

  cornerData.length = c1.distanceTo(c2);
  cornerData.width = c1.distanceTo(c4);
}

// ═══════════════════════════════════════════════════════════
// ഓപ്പൺ ഫോമിംഗ് സ്റ്റുഡിയോ (മെയിൻ ഫംഗ്ഷൻ)
// ═══════════════════════════════════════════════════════════
window.openDirectFormingStudio = function(meshObj) {
  const modal = document.getElementById('forming-studio-modal');
  modal.style.display = 'block';

  if (!formingStudioInitialized) {
    initFormingOverlay();
  }

  if (window.controls) window.controls.enabled = false;

  if (fPlateMesh) { fScene.remove(fPlateMesh); fPlateMesh = null; }
  while (fTemplateGroup.children.length > 0) fTemplateGroup.remove(fTemplateGroup.children[0]);
  while (fProbeGroup.children.length > 0) fProbeGroup.remove(fProbeGroup.children[0]);
  while (fStringLinesGroup.children.length > 0) fStringLinesGroup.remove(fStringLinesGroup.children[0]);

  // പ്ലേറ്റ് ജ്യാമിതി യഥാർത്ഥ വേൾഡ് സ്കെയിലിൽ എടുക്കുന്നു
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

  // 4 മൂലകൾ തിട്ടപ്പെടുത്തുന്നു
  detectTruePlateCorners(g);

  // മൂലകളിൽ പച്ച കളർ സ്ട്രിംഗ് ലൈനുകൾ (നൂലുകൾ) ഇടുന്നു
  drawCornerStringLines();

  // സൈറ്റ് പ്ലെയിൻ നിർമ്മിക്കുന്നു
  createCornerSightPlane();

  // വ്യൂ ക്യാമറ ക്രമീകരിക്കുന്നു
  fControls.target.copy(cornerData.center);
  const d = Math.max(cornerData.length, cornerData.width) * 1.5;
  fCamera.position.copy(cornerData.center)
    .addScaledVector(cornerData.nDir, d * 0.9)
    .addScaledVector(cornerData.vDir, -d * 0.5);
  fCamera.up.copy(cornerData.nDir);
  fControls.update();

  fRenderer.setSize(window.innerWidth, window.innerHeight);
  fCamera.aspect = window.innerWidth / window.innerHeight;
  fCamera.updateProjectionMatrix();

  generateFormingTemplates();
};

// ═══════════════════════════════════════════════════════════
// 4 മൂലകൾ തമ്മിൽ ബന്ധിപ്പിച്ച് നൂലുകൾ (String Lines) വരയ്ക്കുന്നു
// ═══════════════════════════════════════════════════════════
function drawCornerStringLines() {
  while (fStringLinesGroup.children.length > 0) fStringLinesGroup.remove(fStringLinesGroup.children[0]);

  const { C1, C2, C3, C4 } = cornerData;
  const pts = [C1, C2, C3, C4, C1];

  const geom = new THREE.BufferGeometry().setFromPoints(pts);
  const mat = new THREE.LineBasicMaterial({ color: 0x10b981, linewidth: 3, depthTest: false });
  const stringLoop = new THREE.Line(geom, mat);
  fStringLinesGroup.add(stringLoop);

  // മൂലകളിൽ ചെറിയ പിൻ മാർക്കർ ഇടുന്നു
  [C1, C2, C3, C4].forEach((c, idx) => {
    const pGeom = new THREE.BufferGeometry().setFromPoints([c]);
    const pMat = new THREE.PointsMaterial({ color: 0xfacc15, size: 8, depthTest: false });
    fStringLinesGroup.add(new THREE.Points(pGeom, pMat));
  });
}

// ═══════════════════════════════════════════════════════════
// 4 മൂലകളിൽ തൊട്ടിരിക്കുന്ന യഥാർത്ഥ SIGHT BASELINE PLANE
// ═══════════════════════════════════════════════════════════
function createCornerSightPlane() {
  if (fDatumPlane) fScene.remove(fDatumPlane);

  const lift = parseFloat(document.getElementById('f-inp-lift').value) || 0;
  cornerData.lift = lift;

  // മൂലകളുടെ ആവറേജ് പ്ലെയിനിൽ നിന്ന് Lift മുകളിലേക്ക് മാറ്റുന്നു
  const avgCornerCenter = new THREE.Vector3()
    .add(cornerData.C1).add(cornerData.C2).add(cornerData.C3).add(cornerData.C4)
    .multiplyScalar(0.25);

  cornerData.planeOrigin.copy(avgCornerCenter).addScaledVector(cornerData.nDir, lift);

  const w = cornerData.length * 1.1;
  const h = cornerData.width * 1.1;

  const geom = new THREE.PlaneGeometry(w, h, 6, 6);
  const mat = new THREE.MeshBasicMaterial({
    color: 0x0284c7,
    wireframe: true,
    transparent: true,
    opacity: 0.45,
    side: THREE.DoubleSide
  });

  fDatumPlane = new THREE.Mesh(geom, mat);

  const rotM = new THREE.Matrix4().makeBasis(cornerData.uDir, cornerData.vDir, cornerData.nDir);
  fDatumPlane.setRotationFromMatrix(rotM);
  fDatumPlane.position.copy(cornerData.planeOrigin);

  fScene.add(fDatumPlane);
}

// ═══════════════════════════════════════════════════════════
// പ്ലേറ്റിന്റെ യഥാർത്ഥ വളവ് അളക്കുന്ന ടെംപ്ലേറ്റ് ജനറേറ്റർ
// ═══════════════════════════════════════════════════════════
function generateFormingTemplates() {
  if (!fPlateMesh) return;
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
  const tableBody = document.querySelector('#f-sagitta-table tbody');
  const exportList = document.getElementById('f-template-export-list');
  tableBody.innerHTML = '';
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

      const edges = [[0, 1], [1, 2], [2, 0]];
      edges.forEach(([i1, i2]) => {
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

    // 3D-യിൽ വളവ് മഞ്ഞ വരയായി കാണിക്കുന്നു
    const cGeom = new THREE.BufferGeometry().setFromPoints(sortedPts);
    fTemplateGroup.add(new THREE.Line(cGeom, new THREE.LineBasicMaterial({ color: 0xfacc15, linewidth: 2.5 })));

    // കോർഡും മാക്സിമം ഡെപ്തും (Sagitta) കണക്കാക്കുന്നു
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

    const tmplName = `${isStation ? 'Stn' : 'WL'}_${tmplIndex}_${dist.toFixed(0)}`;
    fSections.push({
      name: tmplName,
      pts: sortedPts,
      dist: dist,
      chord: chordLen,
      sagitta: maxSagitta,
      boardMargin: boardMargin
    });

    // ടേബിളിൽ വിവരങ്ങൾ കാണിക്കുന്നു
    const tr = document.createElement('tr');
    tr.innerHTML = `<td><b>${tmplName}</b></td><td>${chordLen.toFixed(0)} mm</td><td><b style="color:#facc15;">${maxSagitta.toFixed(1)} mm</b></td>`;
    tableBody.appendChild(tr);

    // DXF ബട്ടൺ
    const div = document.createElement('div');
    div.className = 'f-tmpl-item';
    div.innerHTML = `<span><b>${tmplName}</b> (Max Sag: ${maxSagitta.toFixed(1)} mm)</span>
                     <button class="f-tmpl-dxf-btn" onclick="exportOverlayTemplateToDXF(${fSections.length - 1})">Export DXF</button>`;
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
      if (tail.distanceTo(rem[i].a) < 1.0) { found = i; rev = false; break; }
      if (tail.distanceTo(rem[i].b) < 1.0) { found = i; rev = true; break; }
    }

    if (found !== -1) {
      const s = rem.splice(found, 1)[0];
      pts.push(rev ? s.a : s.b);
    } else {
      break;
    }
  }
  return pts;
}

// ═══════════════════════════════════════════════════════════
// ഫിംഗർ പ്രോബ് (നൂലിൽ നിന്നോ പ്ലെയിനിൽ നിന്നോ ഉള്ള ലംബ ആഴം)
// ═══════════════════════════════════════════════════════════
function setupFormingProbeLogic() {
  const dom = fRenderer.domElement;
  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2();
  const hudVal = document.getElementById('f-probe-depth');
  const hudCoord = document.getElementById('f-probe-coord');
  const pin = document.getElementById('f-touch-pin');

  function inspect(cx, cy) {
    const rect = dom.getBoundingClientRect();
    mouse.x = ((cx - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((cy - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(mouse, fCamera);
    if (!fPlateMesh) return;
    const hits = raycaster.intersectObject(fPlateMesh, false);

    if (hits.length > 0) {
      const hitPt = hits[0].point;

      // സൈറ്റ് പ്ലെയിനിൽ നിന്നുള്ള ലംബ ഡ്രോപ്പ് (Vertical drop from sight plane)
      const toPlane = new THREE.Vector3().subVectors(cornerData.planeOrigin, hitPt);
      const dropDepth = Math.abs(toPlane.dot(cornerData.nDir));

      // മൂല C1-ൽ നിന്നുള്ള നീളവും വീതിയും
      const fromCorner = new THREE.Vector3().subVectors(hitPt, cornerData.C1);
      const uVal = fromCorner.dot(cornerData.uDir);
      const vVal = fromCorner.dot(cornerData.vDir);

      hudVal.innerText = dropDepth.toFixed(1) + ' mm';
      hudCoord.innerText = `L:${uVal.toFixed(0)} W:${vVal.toFixed(0)} Drop:${dropDepth.toFixed(1)}`;

      pin.style.left = cx + 'px';
      pin.style.top = cy + 'px';
      pin.style.display = 'block';

      while (fProbeGroup.children.length > 0) fProbeGroup.remove(fProbeGroup.children[0]);
      const sightPt = new THREE.Vector3().copy(hitPt).addScaledVector(cornerData.nDir, dropDepth);
      const lGeom = new THREE.BufferGeometry().setFromPoints([hitPt, sightPt]);
      fProbeGroup.add(new THREE.Line(lGeom, new THREE.LineBasicMaterial({ color: 0xfacc15, linewidth: 2 })));
    } else {
      pin.style.display = 'none';
    }
  }

  dom.addEventListener('pointermove', (e) => inspect(e.clientX, e.clientY));
  dom.addEventListener('pointerdown', (e) => inspect(e.clientX, e.clientY));
}

function setupFormingOverlayEvents() {
  document.getElementById('f-btn-slice-plates').addEventListener('click', generateFormingTemplates);
  document.getElementById('f-btn-toggle-datum').addEventListener('click', () => {
    if (fDatumPlane) fDatumPlane.visible = !fDatumPlane.visible;
  });

  const liftSlider = document.getElementById('f-inp-lift');
  liftSlider.addEventListener('input', () => {
    document.getElementById('f-lbl-lift-val').innerText = liftSlider.value + ' mm';
    createCornerSightPlane();
  });

  document.getElementById('btn-close-forming').addEventListener('click', () => {
    document.getElementById('forming-studio-modal').style.display = 'none';
    if (window.updateControlsLockState) window.updateControlsLockState();
  });
}

// ═══════════════════════════════════════════════════════════
// യഥാർത്ഥ വളവുള്ള CLOSED CNC WOODEN TEMPLATE DXF BUILDER
// ═══════════════════════════════════════════════════════════
window.exportOverlayTemplateToDXF = function(secIdx) {
  const item = fSections[secIdx];
  if (!item || !item.pts || item.pts.length < 2) return;

  const pts3D = item.pts;
  const pStart = pts3D[0];
  const pEnd = pts3D[pts3D.length - 1];

  // 1. കോർഡ് അക്ഷം (2D X-Axis: പ്ലേറ്റ് കോർഡിന്റെ നേരെ)
  const chordDir = new THREE.Vector3().subVectors(pEnd, pStart).normalize();

  // 2. ഉയരത്തിന്റെ അക്ഷം (2D Y-Axis: പ്ലേറ്റിന് ലംബമായ നോർമൽ)
  const normDir = new THREE.Vector3().copy(cornerData.nDir).normalize();

  // 3D വളവ് പോയിന്റുകളെ 2D പ്ലെയിനിലേക്ക് പ്രൊജക്റ്റ് ചെയ്യുന്നു
  const pts2D = pts3D.map(p => {
    const diff = new THREE.Vector3().subVectors(p, pStart);
    return {
      x: diff.dot(chordDir),
      y: diff.dot(normDir)
    };
  });

  const chordLength = pStart.distanceTo(pEnd);

  // പലകയുടെ മുകളിലെ സ്ട്രെയിറ്റ് ലൈൻ (Sight Baseline Board Top)
  const maxY = Math.max(...pts2D.map(p => p.y));
  const boardTopY = maxY + item.boardMargin;

  let dxf = "0\nSECTION\n2\nENTITIES\n";

  // A. യഥാർത്ഥ പ്ലേറ്റ് കർവേച്ചർ (Plate Curvature Profile)
  for (let i = 0; i < pts2D.length - 1; i++) {
    dxf += `0\nLINE\n8\nPLATE_CURVE\n10\n${pts2D[i].x.toFixed(2)}\n20\n${pts2D[i].y.toFixed(2)}\n11\n${pts2D[i + 1].x.toFixed(2)}\n21\n${pts2D[i + 1].y.toFixed(2)}\n`;
  }

  // B. ഇടത് ലംബ വശം (Left Vertical Edge)
  const p0 = pts2D[0];
  dxf += `0\nLINE\n8\nWOOD_FRAME\n10\n${p0.x.toFixed(2)}\n20\n${p0.y.toFixed(2)}\n11\n${p0.x.toFixed(2)}\n21\n${boardTopY.toFixed(2)}\n`;

  // C. മുകളിലെ നേർരേഖ (Sight Reference Base Line)
  const pLast = pts2D[pts2D.length - 1];
  dxf += `0\nLINE\n8\nSIGHT_BASE_EDGE\n10\n${p0.x.toFixed(2)}\n20\n${boardTopY.toFixed(2)}\n11\n${pLast.x.toFixed(2)}\n21\n${boardTopY.toFixed(2)}\n`;

  // D. വലത് ലംബ വശം (Right Vertical Edge)
  dxf += `0\nLINE\n8\nWOOD_FRAME\n10\n${pLast.x.toFixed(2)}\n20\n${boardTopY.toFixed(2)}\n11\n${pLast.x.toFixed(2)}\n21\n${pLast.y.toFixed(2)}\n`;

  // E. സെന്റർ ഡ്രോപ്പ് ലൈൻ (Center Drop / Sagitta Line)
  const midX = chordLength / 2;
  dxf += `0\nLINE\n8\nCENTER_DROP_LINE\n10\n${midX.toFixed(2)}\n20\n${boardTopY.toFixed(2)}\n11\n${midX.toFixed(2)}\n21\n${(boardTopY - item.sagitta).toFixed(2)}\n`;

  dxf += "0\nENDSEC\n0\nEOF\n";

  const blob = new Blob([dxf], { type: 'application/dxf' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `${item.name}_ClosedTemplate.dxf`;
  link.click();
};
