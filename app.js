'use strict';

// ═══════════════════════════════════════════════════════════
// GLOBAL STATE & SYSTEM VARIABLES
// ═══════════════════════════════════════════════════════════
let scene, camera, renderer, controls;
const modelRoot = new THREE.Group();
let meshList = [], edgeLinesList = [];
let rhinoReady = false, rhinoModule = null;

let currentMode = 'view';
let isFrozen = false, isXRay = false, isDarkMode = false;
let activeProfile = localStorage.getItem('vt_viewer_profile') || 'PRO';

// Screen-Space Pins & Measurement State
const pointMarkersGroup = new THREE.Group();
let measurePoints = [], girthPoints = [], anglePoints = [];
let measureLine = null;

let snapCursorEl = null;
let activeSnappedPoint = null;
let selectedColorDotHex = null;

const clipPlane = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0);
let currentCutAxis = 'z', cutInvert = -1;
const modelBBox = new THREE.Box3();

// ═══════════════════════════════════════════════════════════
// 1. THREE.JS INITIALIZATION (Z-UP SHIP ORIENTATION & LIGHTS)
// ═══════════════════════════════════════════════════════════
function initThree() {
  const container = document.getElementById('viewport');
  snapCursorEl = document.getElementById('snap-cursor');

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf1f5f9);

  // Perspective Camera
  camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 1, 2000000);
  
  // Z-UP AXIS SETTING (CSL Ship Coordinate System)
  camera.up.set(0, 0, 1);
  camera.position.set(4000, -4000, 3000);

  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.localClippingEnabled = true;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  container.appendChild(renderer.domElement);

  controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.rotateSpeed = 0.45;
  controls.zoomSpeed = 1.0;
  controls.screenSpacePanning = true;

  // 3-Point Marine Fabrication Studio Lighting
  const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444455, 0.7);
  hemiLight.position.set(0, 0, 5000);
  scene.add(hemiLight);

  const mainSun = new THREE.DirectionalLight(0xffffff, 0.85);
  mainSun.position.set(6000, -6000, 8000);
  scene.add(mainSun);

  const fillSun = new THREE.DirectionalLight(0x90cdf4, 0.45);
  fillSun.position.set(-6000, 6000, -4000);
  scene.add(fillSun);

  scene.add(modelRoot);
  scene.add(pointMarkersGroup);

  // Dynamic Base Grid on XY Plane (Z = 0)
  const grid = new THREE.GridHelper(20000, 80, 0x0284c7, 0xcbd5e1);
  grid.rotation.x = Math.PI / 2; // Z-Up ഗ്രൗണ്ട് ഗ്രിഡ്
  grid.position.z = -0.5;
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
// 2. CAMERA FIT & VIEWS (PERFECT UNIT BOUNDS)
// ═══════════════════════════════════════════════════════════
function fitModelToScreen() {
  if (meshList.length === 0) return;

  modelBBox.setFromObject(modelRoot);
  const center = new THREE.Vector3();
  const size = new THREE.Vector3();
  modelBBox.getCenter(center);
  modelBBox.getSize(size);

  const maxDim = Math.max(size.x, size.y, size.z);
  const fov = camera.fov * (Math.PI / 180);
  let cameraDist = Math.abs(maxDim / 2 / Math.tan(fov / 2)) * 1.5;

  camera.position.set(center.x + cameraDist * 0.7, center.y - cameraDist * 0.7, center.z + cameraDist * 0.6);
  controls.target.copy(center);
  camera.lookAt(center);
  controls.update();
}

function setCameraView(type) {
  if (!controls) return;
  const target = controls.target;
  const size = new THREE.Vector3();
  modelBBox.getSize(size);
  const dist = Math.max(size.x, size.y, size.z, 2000) * 1.6;

  if (type === 'top') { // Z-View (Plan View)
    camera.position.set(target.x, target.y, target.z + dist);
    camera.up.set(0, 1, 0);
  } else if (type === 'front') { // X-View (Fr / Transverse)
    camera.position.set(target.x + dist, target.y, target.z);
    camera.up.set(0, 0, 1);
  } else if (type === 'side') { // Y-View (Longitudinal / Side)
    camera.position.set(target.x, target.y - dist, target.z);
    camera.up.set(0, 0, 1);
  } else if (type === 'iso') { // Isometric 3D
    camera.up.set(0, 0, 1);
    camera.position.set(target.x + dist * 0.7, target.y - dist * 0.7, target.z + dist * 0.6);
  }
  camera.lookAt(target);
  controls.update();
}

// ═══════════════════════════════════════════════════════════
// 3. RHINO LOADER (ORIGINAL COLORS & METALLIC SHADING)
// ═══════════════════════════════════════════════════════════
function loadRhinoDoc(doc, fileName) {
  while (modelRoot.children.length > 0) modelRoot.remove(modelRoot.children[0]);
  meshList = [];
  edgeLinesList = [];

  const layers = [];
  for (let i = 0; i < doc.layers().count; i++) {
    const l = doc.layers().get(i);
    const c = l.color;
    layers.push({ name: l.name, colorHex: (c.r << 16) | (c.g << 8) | c.b });
  }

  const objectsCount = doc.objects().count;
  for (let i = 0; i < objectsCount; i++) {
    const obj = doc.objects().get(i);
    const geom = obj.geometry();
    const attrs = obj.attributes();

    if (geom instanceof rhinoModule.Mesh) {
      // 1. യഥാർത്ഥ കളർ വേർതിരിച്ചെടുക്കുന്നു
      let colorHex = 0x94a3b8; // Default steel
      if (attrs.colorSource === 0 && attrs.objectColor) { // Object Color
        const c = attrs.objectColor;
        colorHex = (c.r << 16) | (c.g << 8) | c.b;
      } else if (layers[attrs.layerIndex]) { // ByLayer Color
        colorHex = layers[attrs.layerIndex].colorHex;
      }

      // 2. ജ്യോമെട്രി നിർമ്മാണം
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

      // 3. ക്രിസ്പ് മെറ്റാലിക് സ്റ്റീൽ ഫിനിഷിംഗ് മെറ്റീരിയൽ
      const mat = new THREE.MeshStandardMaterial({
        color: colorHex,
        roughness: 0.35,
        metalness: 0.25,
        clippingPlanes: [clipPlane],
        clipShadows: true,
        side: THREE.DoubleSide
      });

      const mesh = new THREE.Mesh(threeGeom, mat);
      mesh.userData = {
        name: attrs.name || `Unit-Part-${i + 1}`,
        layer: layers[attrs.layerIndex] ? layers[attrs.layerIndex].name : 'Default',
        originalColor: colorHex
      };

      modelRoot.add(mesh);
      meshList.push(mesh);

      // 4. ഷാർപ്പ് എഡ്ജ് ലൈനുകൾ (Contour lines)
      const edgesGeom = new THREE.EdgesGeometry(threeGeom, 28);
      const edgeLine = new THREE.LineSegments(
        edgesGeom,
        new THREE.LineBasicMaterial({ color: 0x1e293b, linewidth: 1 })
      );
      edgeLine.visible = activeProfile === 'PRO';
      modelRoot.add(edgeLine);
      edgeLinesList.push(edgeLine);
    }
  }

  fitModelToScreen();
  populateColorPalette();
}

// ═══════════════════════════════════════════════════════════
// 4. INDEXEDDB - RECENT MODELS SYSTEM
// ═══════════════════════════════════════════════════════════
const DB_NAME = 'CSL_3D_Viewer_DB';
const DB_STORE = 'recent_models';

function openRecentDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(DB_STORE)) {
        db.createObjectStore(DB_STORE, { keyPath: 'name' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveToRecent(fileName, arrayBuffer) {
  try {
    const db = await openRecentDB();
    const tx = db.transaction(DB_STORE, 'readwrite');
    const store = tx.objectStore(DB_STORE);
    store.put({
      name: fileName,
      data: arrayBuffer,
      date: new Date().toLocaleDateString('en-GB')
    });
  } catch (err) {
    console.warn("Recent save error:", err);
  }
}

async function showRecentModal() {
  const modal = document.getElementById('recent-modal');
  const listContainer = document.getElementById('recent-list-container');
  listContainer.innerHTML = '';
  modal.style.display = 'flex';

  try {
    const db = await openRecentDB();
    const tx = db.transaction(DB_STORE, 'readonly');
    const store = tx.objectStore(DB_STORE);
    const req = store.getAll();

    req.onsuccess = () => {
      const items = req.result;
      if (!items || items.length === 0) {
        listContainer.innerHTML = '<div style="text-align:center; padding:15px; color:#64748b; font-size:12px;">No recent models found.</div>';
        return;
      }

      items.reverse().forEach(item => {
        const row = document.createElement('div');
        row.className = 'recent-item';
        row.innerHTML = `
          <div>
            <div style="font-weight:700; font-size:12px; color:#0f172a;">${item.name}</div>
            <div style="font-size:10px; color:#64748b;">${item.date}</div>
          </div>
          <button class="btn-action" style="background:#0284c7; color:#fff; border:none; padding:4px 8px;">Load</button>
        `;
        row.querySelector('button').addEventListener('click', () => {
          modal.style.display = 'none';
          document.getElementById('active-file-display').innerText = item.name;
          document.getElementById('loader').style.display = 'flex';
          setTimeout(() => {
            const doc = rhinoModule.File3dm.fromByteArray(new Uint8Array(item.data));
            loadRhinoDoc(doc, item.name);
            document.getElementById('loader').style.display = 'none';
          }, 50);
        });
        listContainer.appendChild(row);
      });
    };
  } catch (err) {
    listContainer.innerHTML = '<div style="color:red; font-size:12px;">Failed to load recent files.</div>';
  }
}

// ═══════════════════════════════════════════════════════════
// 5. SCREEN-SPACE PINS & MAGNETIC SNAP (1mm CONSTANT)
// ═══════════════════════════════════════════════════════════
function createScreenSpacePin(worldPos, colorHex = 0x0284c7) {
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute([worldPos.x, worldPos.y, worldPos.z], 3));
  
  const mat = new THREE.PointsMaterial({
    color: colorHex,
    size: 9,
    sizeAttenuation: false,
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
  let minScreenDist = 28;

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
// 6. COLOR PALETTE MANAGEMENT
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
// 7. PROFILE & UI EVENTS
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

    if (renderer) renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    edgeLinesList.forEach(l => l.visible = true);
  } else {
    btnQuality.innerText = 'LITE';
    btnQuality.className = 'btn-quality mode-lite';
    proBadge.innerText = 'LITE';
    proBadge.style.background = '#64748b';
    document.body.classList.add('lite-mode');

    if (renderer) renderer.setPixelRatio(1.0);
    edgeLinesList.forEach(l => l.visible = false);

    if (!['view', 'coords', 'measure'].includes(currentMode)) {
      switchMode('view');
    }
  }
}

function switchMode(newMode) {
  currentMode = newMode;
  document.querySelectorAll('.mode-btn').forEach(btn => btn.className = 'mode-btn');
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

function setupEvents() {
  const dom = renderer.domElement;

  ['view', 'coords', 'measure', 'girth', 'angle', 'section', 'inspect'].forEach(m => {
    const btn = document.getElementById(`mode-${m}`);
    if (btn) btn.addEventListener('click', () => switchMode(m));
  });

  // Camera Views
  document.getElementById('btn-view-z').addEventListener('click', () => setCameraView('top'));
  document.getElementById('btn-view-y').addEventListener('click', () => setCameraView('side'));
  document.getElementById('btn-view-x').addEventListener('click', () => setCameraView('front'));
  document.getElementById('btn-view-iso').addEventListener('click', () => setCameraView('iso'));

  // Header Actions
  document.getElementById('btn-quality-toggle').addEventListener('click', () => {
    applyQualityProfile(activeProfile === 'PRO' ? 'LITE' : 'PRO');
  });

  document.getElementById('btn-show-recent').addEventListener('click', showRecentModal);
  document.getElementById('btn-close-recent').addEventListener('click', () => {
    document.getElementById('recent-modal').style.display = 'none';
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

  // Snapping & Measuring Pointer Events
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
        measureLine = new THREE.Line(lineGeom, new THREE.LineBasicMaterial({ color: 0x0284c7, linewidth: 2, depthTest: false }));
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
// 8. FILE SELECT & HANDLER
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
      const buffer = e.target.result;
      if (fileName.endsWith('.3dm')) {
        const doc = rhinoModule.File3dm.fromByteArray(new Uint8Array(buffer));
        loadRhinoDoc(doc, file.name);
        saveToRecent(file.name, buffer); // Recent-ലേക്ക് സേവ് ചെയ്യുന്നു
      } else {
        alert("Parser ready for: " + file.name);
      }
    } catch (err) {
      alert("Error parsing file: " + err.message);
    } finally {
      document.getElementById('loader').style.display = 'none';
    }
  };
  reader.readAsArrayBuffer(file);
}

// ═══════════════════════════════════════════════════════════
// 9. INITIAL BOOTSTRAP
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
