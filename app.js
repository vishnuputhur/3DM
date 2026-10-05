'use strict';

let scene, camera, renderer, controls;
const modelRoot = new THREE.Group();
let meshList = [], edgeLinesList = [];
let dirLight1, ambientLight;
let rhinoReady = false, rhinoModule = null;

let currentMode = 'view';
let isFrozen = false, isXRay = false, isDarkMode = false;
let activeProfile = localStorage.getItem('vt_viewer_profile') || 'PRO';

// Screen-Space Constant Sized Pins Group
let pointMarkersGroup = new THREE.Group();
let measurePoints = [], girthPoints = [], anglePoints = [];
let measureLine = null, girthLine = null, angleLines = [];

// Dynamic Snap Cursor
let snapCursorEl = null;
let activeSnappedPoint = null;
let currentHighlightedPart = null;
let selectedColorDotHex = null;

const clipPlane = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0);
let currentCutAxis = 'z', cutInvert = -1, isClippingActive = false;
const modelBBox = new THREE.Box3();

// ═══════════════════════════════════════════════════════════
// 1. THREE.JS INITIALIZATION (GIMBAL LOCK & SPEED FIX)
// ═══════════════════════════════════════════════════════════
function initThree() {
  const container = document.getElementById('viewport');
  snapCursorEl = document.getElementById('snap-cursor');

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf1f5f9);

  camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 1, 1000000);
  camera.position.set(3000, 3000, 3000);

  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.localClippingEnabled = true;
  container.appendChild(renderer.domElement);

  controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.rotateSpeed = 0.45; // സ്പീഡ് ഓവർ ആവാതെ ഒതുക്കി
  controls.zoomSpeed = 1.0;
  controls.minPolarAngle = 0.02; // തലതിരിഞ്ഞ് സ്റ്റക്കാവുന്നത് തടയുന്നു
  controls.maxPolarAngle = Math.PI - 0.02;
  controls.screenSpacePanning = true;

  ambientLight = new THREE.AmbientLight(0xffffff, 0.75);
  scene.add(ambientLight);

  dirLight1 = new THREE.DirectionalLight(0xffffff, 0.85);
  dirLight1.position.set(5000, 8000, 5000);
  scene.add(dirLight1);

  scene.add(modelRoot);
  scene.add(pointMarkersGroup);

  const grid = new THREE.GridHelper(15000, 60, 0x94a3b8, 0xcbd5e1);
  grid.position.y = -0.5;
  scene.add(grid);

  applyQualityProfile(activeProfile);

  window.addEventListener('resize', onWindowResize);
  animate();
}

function animate() {
  requestAnimationFrame(animate);
  if (controls) controls.update();
  if (renderer && scene && camera) renderer.render(scene, camera);
}

function onWindowResize() {
  if (!camera || !renderer) return;
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

// ═══════════════════════════════════════════════════════════
// 2. PRO vs LITE PROFILE MANAGER
// ═══════════════════════════════════════════════════════════
function applyQualityProfile(profile) {
  activeProfile = profile;
  localStorage.setItem('vt_viewer_profile', profile);

  const btnQuality = document.getElementById('btn-quality-toggle');
  const proBadge = document.getElementById('app-pro-tag');

  if (profile === 'PRO') {
    btnQuality.innerText = 'PRO';
    btnQuality.className = 'btn-quality mode-pro';
    proBadge.innerText = 'PRO';
    proBadge.style.background = '#0284c7';
    document.body.classList.remove('lite-mode');

    if (renderer) {
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); // Full HD / 4K Sharpness
    }
    edgeLinesList.forEach(line => line.visible = true);
  } else {
    // LITE MODE - ലോഡ് മാക്സിമം കുറയ്ക്കുന്നു
    btnQuality.innerText = 'LITE';
    btnQuality.className = 'btn-quality mode-lite';
    proBadge.innerText = 'LITE';
    proBadge.style.background = '#64748b';
    document.body.classList.add('lite-mode');

    if (renderer) {
      renderer.setPixelRatio(1.0); // കുറഞ്ഞ മെമ്മറി ലോഡ്
    }
    edgeLinesList.forEach(line => line.visible = false);

    if (!['view', 'coords', 'measure'].includes(currentMode)) {
      switchMode('view');
    }
  }
}

// ═══════════════════════════════════════════════════════════
// 3. CONSTANT SCREEN-SPACE PINS (1mm Fixed Size)
// ═══════════════════════════════════════════════════════════
function createScreenSpacePin(worldPos, colorHex = 0x0284c7) {
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute([worldPos.x, worldPos.y, worldPos.z], 3));
  
  const mat = new THREE.PointsMaterial({
    color: colorHex,
    size: 9, // ഏകദേശം 1mm വലിപ്പത്തിൽ സ്ഥിരമായി നിൽക്കും
    sizeAttenuation: false, // സൂം ചെയ്താൽ വലിപ്പം മാറില്ല
    depthTest: false
  });
  const point = new THREE.Points(geom, mat);
  pointMarkersGroup.add(point);
  return point;
}

function clearAllPins() {
  while (pointMarkersGroup.children.length > 0) {
    pointMarkersGroup.remove(pointMarkersGroup.children[0]);
  }
}

// ═══════════════════════════════════════════════════════════
// 4. MAGNETIC CORNER/EDGE SNAP
// ═══════════════════════════════════════════════════════════
function findMagneticSnapPoint(screenX, screenY) {
  const rect = renderer.domElement.getBoundingClientRect();
  const mouse = new THREE.Vector2(
    ((screenX - rect.left) / rect.width) * 2 - 1,
    -((screenY - rect.top) / rect.height) * 2 + 1
  );
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(mouse, camera);
  const hits = raycaster.intersectObjects(meshList, false);

  if (hits.length === 0) return null;

  const hit = hits[0];
  const geom = hit.object.geometry;
  const posAttr = geom.attributes.position;
  let closestVertex = null;
  let minScreenDist = 28; // മാഗ്നറ്റിക് ക്യാപ്‌ചർ റേഡിയസ്

  const vWorld = new THREE.Vector3();
  const vScreen = new THREE.Vector3();

  for (let i = 0; i < posAttr.count; i++) {
    vWorld.fromBufferAttribute(posAttr, i).applyMatrix4(hit.object.matrixWorld);
    vScreen.copy(vWorld).project(camera);

    const sx = ((vScreen.x + 1) * rect.width) / 2;
    const sy = ((-vScreen.y + 1) * rect.height) / 2;
    const dist = Math.hypot(sx - screenX, sy - screenY);

    if (dist < minScreenDist) {
      minScreenDist = dist;
      closestVertex = vWorld.clone();
    }
  }

  return {
    point: closestVertex || hit.point,
    object: hit.object,
    isCorner: !!closestVertex
  };
}

// ═══════════════════════════════════════════════════════════
// 5. COLOR PALETTE CONTROLS
// ═══════════════════════════════════════════════════════════
function populateColorPalette() {
  const dotsContainer = document.getElementById('model-color-dots');
  dotsContainer.innerHTML = '';
  const uniqueColors = new Set();

  meshList.forEach(m => {
    if (m.material && m.material.color) {
      uniqueColors.add(m.material.color.getHex());
    }
  });

  uniqueColors.forEach(hex => {
    const dot = document.createElement('div');
    dot.className = 'color-dot';
    dot.style.background = '#' + hex.toString(16).padStart(6, '0');
    dot.addEventListener('click', () => {
      selectedColorDotHex = hex;
      document.getElementById('swatch-picker').style.display = 'block';
    });
    dotsContainer.appendChild(dot);
  });
}

function setupColorPaletteEvents() {
  const drawer = document.getElementById('color-palette-drawer');
  document.getElementById('btn-toggle-palette').addEventListener('click', () => {
    drawer.classList.toggle('expanded');
  });

  document.querySelectorAll('.swatch-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (selectedColorDotHex === null) return;
      const targetHex = parseInt(btn.getAttribute('data-color'), 16);

      meshList.forEach(m => {
        if (m.material && m.material.color.getHex() === selectedColorDotHex) {
          m.material.color.setHex(targetHex);
          m.material.needsUpdate = true;
        }
      });
      populateColorPalette();
      document.getElementById('swatch-picker').style.display = 'none';
    });
  });
}

// ═══════════════════════════════════════════════════════════
// 6. LIGHT ENCRYPTION / OBFUSCATION FOR .VTS
// ═══════════════════════════════════════════════════════════
const CRYPTO_SALT = 0x5a;

function obfuscateBuffer(arrayBuffer) {
  const u8 = new Uint8Array(arrayBuffer);
  for (let i = 8; i < u8.length; i++) {
    u8[i] = u8[i] ^ CRYPTO_SALT;
  }
  return arrayBuffer;
}

function deobfuscateBuffer(arrayBuffer) {
  return obfuscateBuffer(arrayBuffer);
}

// ═══════════════════════════════════════════════════════════
// 7. CAMERA VIEWS & MODE SWITCHER
// ═══════════════════════════════════════════════════════════
function setCameraView(type) {
  if (!controls) return;
  const target = controls.target;
  const dist = 3500;

  if (type === 'top') {
    camera.position.set(target.x, target.y + dist, target.z);
    camera.up.set(0, 0, -1);
  } else if (type === 'side') {
    camera.position.set(target.x, target.y, target.z + dist);
    camera.up.set(0, 1, 0);
  } else if (type === 'front') {
    camera.position.set(target.x + dist, target.y, target.z);
    camera.up.set(0, 1, 0);
  } else if (type === 'iso') {
    camera.position.set(target.x + dist, target.y + dist, target.z + dist);
    camera.up.set(0, 1, 0);
  }
  camera.lookAt(target);
  controls.update();
}

function switchMode(newMode) {
  currentMode = newMode;
  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.className = 'mode-btn';
  });
  const activeBtn = document.getElementById(`mode-${newMode}`);
  if (activeBtn) activeBtn.classList.add(`active-${newMode}`);

  document.querySelectorAll('.panel-bottom').forEach(p => p.style.display = 'none');
  const activePanel = document.getElementById(`${newMode}-panel`);
  if (activePanel) activePanel.style.display = 'block';

  clearAllPins();
  if (measureLine) scene.remove(measureLine);
  measurePoints = [];
  snapCursorEl.style.display = 'none';
}

// ═══════════════════════════════════════════════════════════
// 8. EVENT LISTENERS & SETUP
// ═══════════════════════════════════════════════════════════
function setupEvents() {
  const dom = renderer.domElement;

  ['view', 'coords', 'measure', 'girth', 'angle', 'section', 'inspect'].forEach(m => {
    const btn = document.getElementById(`mode-${m}`);
    if (btn) btn.addEventListener('click', () => switchMode(m));
  });

  document.getElementById('btn-view-z').addEventListener('click', () => setCameraView('top'));
  document.getElementById('btn-view-y').addEventListener('click', () => setCameraView('side'));
  document.getElementById('btn-view-x').addEventListener('click', () => setCameraView('front'));
  document.getElementById('btn-view-iso').addEventListener('click', () => setCameraView('iso'));

  document.getElementById('btn-quality-toggle').addEventListener('click', () => {
    applyQualityProfile(activeProfile === 'PRO' ? 'LITE' : 'PRO');
  });

  document.getElementById('btn-freeze-orbit').addEventListener('click', () => {
    isFrozen = !isFrozen;
    controls.enabled = !isFrozen;
    document.getElementById('btn-freeze-orbit').classList.toggle('active-freeze', isFrozen);
  });

  document.getElementById('btn-toggle-xray').addEventListener('click', () => {
    isXRay = !isXRay;
    document.getElementById('btn-toggle-xray').classList.toggle('active-xray', isXRay);
    meshList.forEach(m => {
      m.material.transparent = isXRay;
      m.material.opacity = isXRay ? 0.35 : 1.0;
      m.material.needsUpdate = true;
    });
  });

  document.getElementById('btn-theme-toggle').addEventListener('click', () => {
    isDarkMode = !isDarkMode;
    document.body.classList.toggle('dark-mode', isDarkMode);
    scene.background.setHex(isDarkMode ? 0x0a0f1d : 0xf1f5f9);
    document.getElementById('theme-icon').innerText = isDarkMode ? '🌙' : '☀️';
  });

  document.getElementById('info-pill').addEventListener('click', function() {
    this.classList.toggle('expanded');
  });

  dom.addEventListener('pointermove', (e) => {
    if (['measure', 'coords', 'girth', 'angle'].includes(currentMode)) {
      const snap = findMagneticSnapPoint(e.clientX, e.clientY);
      if (snap) {
        activeSnappedPoint = snap.point;
        snapCursorEl.style.left = `${e.clientX}px`;
        snapCursorEl.style.top = `${e.clientY}px`;
        snapCursorEl.style.display = 'block';
        snapCursorEl.style.borderColor = snap.isCorner ? '#10b981' : '#0284c7';
      } else {
        activeSnappedPoint = null;
        snapCursorEl.style.display = 'none';
      }
    } else {
      snapCursorEl.style.display = 'none';
    }
  });

  dom.addEventListener('pointerup', () => {
    if (!activeSnappedPoint) return;

    if (currentMode === 'measure') {
      if (measurePoints.length >= 2) {
        clearAllPins();
        if (measureLine) scene.remove(measureLine);
        measurePoints = [];
      }
      measurePoints.push(activeSnappedPoint);
      createScreenSpacePin(activeSnappedPoint, 0x0284c7);

      if (measurePoints.length === 2) {
        const [p1, p2] = measurePoints;
        const lineGeom = new THREE.BufferGeometry().setFromPoints([p1, p2]);
        measureLine = new THREE.Line(lineGeom, new THREE.LineBasicMaterial({ color: 0x0284c7, linewidth: 2 }));
        scene.add(measureLine);

        document.getElementById('val-dist').innerText = p1.distanceTo(p2).toFixed(1);
        document.getElementById('val-dx').innerText = Math.abs(p2.x - p1.x).toFixed(1);
        document.getElementById('val-dy').innerText = Math.abs(p2.y - p1.y).toFixed(1);
        document.getElementById('val-dz').innerText = Math.abs(p2.z - p1.z).toFixed(1);
      }
    } else if (currentMode === 'coords') {
      clearAllPins();
      createScreenSpacePin(activeSnappedPoint, 0x059669);
      document.getElementById('inp-coord-x').value = activeSnappedPoint.x.toFixed(1);
      document.getElementById('inp-coord-y').value = activeSnappedPoint.y.toFixed(1);
      document.getElementById('inp-coord-z').value = activeSnappedPoint.z.toFixed(1);
    }
  });

  document.getElementById('btn-clear-measure').addEventListener('click', () => {
    clearAllPins();
    if (measureLine) scene.remove(measureLine);
    measurePoints = [];
    document.getElementById('val-dist').innerText = '0.0';
    document.getElementById('val-dx').innerText = '0.0';
    document.getElementById('val-dy').innerText = '0.0';
    document.getElementById('val-dz').innerText = '0.0';
  });

  document.getElementById('btn-clear-coords').addEventListener('click', () => {
    clearAllPins();
    document.getElementById('inp-coord-x').value = '';
    document.getElementById('inp-coord-y').value = '';
    document.getElementById('inp-coord-z').value = '';
  });

  document.getElementById('file-input').addEventListener('change', handleFileSelect);
}

// ═══════════════════════════════════════════════════════════
// 9. FILE LOADING (RHINO & VTS)
// ═══════════════════════════════════════════════════════════
function handleFileSelect(evt) {
  const file = evt.target.files[0];
  if (!file) return;

  const fileName = file.name.toLowerCase();
  document.getElementById('active-file-display').innerText = file.name;
  document.getElementById('loader').style.display = 'flex';

  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      let buffer = e.target.result;
      if (fileName.endsWith('.vts')) {
        buffer = deobfuscateBuffer(buffer);
        loadBinaryVTSBuffer(buffer);
      } else if (fileName.endsWith('.3dm')) {
        const doc = rhinoModule.File3dm.fromByteArray(new Uint8Array(buffer));
        loadRhinoDoc(doc, file.name);
      } else {
        alert("Parser ready for: " + file.name);
      }
    } catch (err) {
      alert("Error: " + err.message);
    } finally {
      document.getElementById('loader').style.display = 'none';
      populateColorPalette();
    }
  };
  reader.readAsArrayBuffer(file);
}

function loadRhinoDoc(doc, name) {
  while (modelRoot.children.length > 0) modelRoot.remove(modelRoot.children[0]);
  meshList = [];
  edgeLinesList = [];

  const count = doc.objects().count;
  for (let i = 0; i < count; i++) {
    const obj = doc.objects().get(i);
    const geom = obj.geometry();

    if (geom instanceof rhinoModule.Mesh) {
      const threeGeom = new THREE.BufferGeometry();
      const vertices = geom.vertices();
      const faces = geom.faces();

      const pos = [];
      for (let j = 0; j < vertices.count; j++) {
        const v = vertices.get(j);
        pos.push(v[0], v[1], v[2]);
      }
      threeGeom.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));

      const indices = [];
      for (let j = 0; j < faces.count; j++) {
        const f = faces.get(j);
        indices.push(f[0], f[1], f[2]);
        if (f[2] !== f[3]) indices.push(f[2], f[3], f[0]);
      }
      threeGeom.setIndex(indices);
      threeGeom.computeVertexNormals();

      const mat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.4, metalness: 0.2 });
      const mesh = new THREE.Mesh(threeGeom, mat);
      modelRoot.add(mesh);
      meshList.push(mesh);

      const edgesGeom = new THREE.EdgesGeometry(threeGeom, 25);
      const edgeLine = new THREE.LineSegments(edgesGeom, new THREE.LineBasicMaterial({ color: 0x1e293b }));
      edgeLine.visible = activeProfile === 'PRO';
      modelRoot.add(edgeLine);
      edgeLinesList.push(edgeLine);
    }
  }

  modelBBox.setFromObject(modelRoot);
  const center = new THREE.Vector3();
  modelBBox.getCenter(center);
  controls.target.copy(center);
  setCameraView('iso');
}

function loadBinaryVTSBuffer(buffer) {
  // .vts ബൈനറി ഡീകോഡർ
}

// ═══════════════════════════════════════════════════════════
// 10. BOOTSTRAP
// ═══════════════════════════════════════════════════════════
window.addEventListener('DOMContentLoaded', () => {
  initThree();
  setupEvents();
  setupColorPaletteEvents();

  if (typeof rhino3dm !== 'undefined') {
    rhino3dm().then(m => {
      rhinoModule = m;
      rhinoReady = true;
    }).catch(console.warn);
  }
});
