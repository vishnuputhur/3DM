'use strict';

// ═══════════════════════════════════════════════════════════
// GLOBAL ENGINE & SCENE STATE
// ═══════════════════════════════════════════════════════════
let rhinoReady = false;
let rhinoModule = null;

let scene, camera, renderer, controls;
const modelRoot = new THREE.Group();
let meshList = [];
let edgeLinesList = [];
let dirLight1, dirLight2, hemiLight, ambientLight;

const clipPlane = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0);
let currentCutAxis = 'z';
let cutInvert = -1;
const modelBBox = new THREE.Box3();
let isClippingActive = false;

// Constant Screen-Space Pins & Measurement States
const pointMarkersGroup = new THREE.Group();
let measurePoints = [], pinMarkers = [], measureLine = null;
let girthPoints = [], girthMarkers = [], girthLine = null;
let anglePoints = [], angleMarkers = [], angleLines = [];
let coordMarker = null;

let isFrozen = false, isXRay = false, isDarkMode = false;
let snapCursorEl = null, activeSnappedPoint = null, selectedColorDotHex = null;
let selectedObject = null, selectedLocalBox = null;
const dimensionLinesGroup = new THREE.Group();

let currentScale = window.innerWidth >= 768 ? 1.25 : 1.0;
let activeProfile = localStorage.getItem('vt_viewer_profile') || 'PRO';

// Pointer state for differentiating drag and tap
let pointerDownPos = { x: 0, y: 0, time: 0 };

// ═══════════════════════════════════════════════════════════
// 1. INDEXEDDB PERSISTENT RECENT STORAGE
// ═══════════════════════════════════════════════════════════
const DB_NAME = 'VTSoft_3DM_Storage';
const DB_VERSION = 3;
const STORE_NAME = 'models';
let db = null, dbAvailable = false;

function initDB() {
  return new Promise((resolve, reject) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const dbInstance = e.target.result;
        if (!dbInstance.objectStoreNames.contains(STORE_NAME)) {
          const store = dbInstance.createObjectStore(STORE_NAME, { keyPath: 'name' });
          store.createIndex('timestamp', 'timestamp', { unique: false });
        }
      };
      req.onsuccess = (e) => { db = e.target.result; dbAvailable = true; resolve(db); };
      req.onerror = (e) => { dbAvailable = false; reject(e.target.error || e); };
    } catch (err) { dbAvailable = false; reject(err); }
  });
}

async function saveModelToStorage(name, buffer) {
  if (!dbAvailable) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction([STORE_NAME], 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const vtsName = name.replace(/\.[^/.]+$/, '') + '.vts';
      store.put({
        name: vtsName,
        buffer: buffer,
        size: (buffer.byteLength / (1024 * 1024)).toFixed(2) + ' MB',
        timestamp: Date.now()
      });
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    } catch (e) { resolve(false); }
  });
}

async function getAllRecentModels() {
  if (!dbAvailable) return [];
  return new Promise((resolve) => {
    try {
      const tx = db.transaction([STORE_NAME], 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => resolve((req.result || []).sort((a, b) => b.timestamp - a.timestamp));
      req.onerror = () => resolve([]);
    } catch (e) { resolve([]); }
  });
}

async function deleteModelFromStorage(name) {
  if (!dbAvailable) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction([STORE_NAME], 'readwrite');
      tx.objectStore(STORE_NAME).delete(name);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    } catch (e) { resolve(false); }
  });
}

// ═══════════════════════════════════════════════════════════
// 2. BINARY VTS STORAGE ENCODER / DECODER
// ═══════════════════════════════════════════════════════════
function pad4(n) { return (4 - (n % 4)) % 4; }

function encodeModelToBinaryVTS() {
  let totalBytes = 8;
  const parts = [];

  meshList.forEach(m => {
    const pos = m.geometry.attributes.position.array;
    const nameBytes = new TextEncoder().encode(m.userData.name || 'Part');
    const layerBytes = new TextEncoder().encode(m.userData.layerName || 'Default');
    const color = m.material.color.getHex();

    const namePad = pad4(nameBytes.length);
    const layerPad = pad4(layerBytes.length);

    totalBytes += 4 + nameBytes.length + namePad +
                  4 + layerBytes.length + layerPad +
                  4 + 4 + (pos.length * 4);

    parts.push({ nameBytes, namePad, layerBytes, layerPad, color, pos });
  });

  const buffer = new ArrayBuffer(totalBytes);
  const view = new DataView(buffer);
  const uint8 = new Uint8Array(buffer);

  uint8[0] = 0x56; uint8[1] = 0x54; uint8[2] = 0x53; uint8[3] = 0x31;
  view.setUint32(4, parts.length, true);

  let offset = 8;
  parts.forEach(p => {
    view.setUint32(offset, p.nameBytes.length, true); offset += 4;
    uint8.set(p.nameBytes, offset); offset += p.nameBytes.length + p.namePad;

    view.setUint32(offset, p.layerBytes.length, true); offset += 4;
    uint8.set(p.layerBytes, offset); offset += p.layerBytes.length + p.layerPad;

    view.setUint32(offset, p.color, true); offset += 4;
    view.setUint32(offset, p.pos.length, true); offset += 4;

    new Float32Array(buffer, offset, p.pos.length).set(p.pos);
    offset += p.pos.length * 4;
  });

  return buffer;
}

function loadBinaryVTSBuffer(buffer) {
  const uint8 = new Uint8Array(buffer);
  if (uint8[0] !== 0x56 || uint8[1] !== 0x54 || uint8[2] !== 0x53 || uint8[3] !== 0x31) {
    throw new Error('Invalid .vts signature.');
  }

  clearModelScene();

  const view = new DataView(buffer);
  const partCount = view.getUint32(4, true);
  let offset = 8;
  const decoder = new TextDecoder();

  for (let i = 0; i < partCount; i++) {
    const nameLen = view.getUint32(offset, true); offset += 4;
    const name = decoder.decode(new Uint8Array(buffer, offset, nameLen));
    offset += nameLen + pad4(nameLen);

    const layerLen = view.getUint32(offset, true); offset += 4;
    const layer = decoder.decode(new Uint8Array(buffer, offset, layerLen));
    offset += layerLen + pad4(layerLen);

    const color = view.getUint32(offset, true); offset += 4;
    const floatCount = view.getUint32(offset, true); offset += 4;
    const floatData = new Float32Array(buffer.slice(offset, offset + floatCount * 4));
    offset += floatCount * 4;

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(floatData, 3));
    geom.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({
      color: color, roughness: 0.3, metalness: 0.25, side: THREE.DoubleSide
    });

    const mesh = new THREE.Mesh(geom, mat);
    mesh.userData = { name, layerName: layer, originalColor: color };

    try {
      const edges = new THREE.EdgesGeometry(geom, 45);
      const edgeLine = new THREE.LineSegments(
        edges,
        new THREE.LineBasicMaterial({ color: 0x0f172a, linewidth: 1, transparent: true, opacity: 0.65 })
      );
      mesh.add(edgeLine);
      edgeLinesList.push(edgeLine);
    } catch (e) {}

    modelRoot.add(mesh);
    meshList.push(mesh);
  }

  calibrateModelView();
  applyCurrentProfileToMeshes();
  populateColorPalette();
}

// ═══════════════════════════════════════════════════════════
// 3. THREE.JS INITIALIZATION (Z-UP, NATURAL CONTROLS, NO MESH)
// ═══════════════════════════════════════════════════════════
function initThree() {
  const container = document.getElementById('viewport');
  snapCursorEl = document.getElementById('snap-cursor');

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf1f5f9);

  camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 1, 2000000);
  camera.up.set(0, 0, 1);
  camera.position.set(4000, -4000, 3000);

  renderer = new THREE.WebGLRenderer({
    antialias: true, alpha: false, powerPreference: 'high-performance'
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  if (THREE.sRGBEncoding !== undefined) renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.localClippingEnabled = true;
  container.appendChild(renderer.domElement);

  controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.rotateSpeed = 0.65;
  controls.zoomSpeed = 1.1;
  controls.panSpeed = 0.8;
  controls.screenSpacePanning = true;

  ambientLight = new THREE.AmbientLight(0xffffff, 0.75);
  scene.add(ambientLight);

  hemiLight = new THREE.HemisphereLight(0xffffff, 0xcbd5e1, 0.45);
  hemiLight.position.set(0, 0, 5000);
  scene.add(hemiLight);

  dirLight1 = new THREE.DirectionalLight(0xffffff, 0.85);
  dirLight1.position.set(5000, -5000, 8000);
  scene.add(dirLight1);

  dirLight2 = new THREE.DirectionalLight(0x94a3b8, 0.45);
  dirLight2.position.set(-5000, 5000, -3000);
  scene.add(dirLight2);

  scene.add(modelRoot);
  scene.add(dimensionLinesGroup);
  scene.add(pointMarkersGroup);

  window.addEventListener('resize', onWindowResize);
  window.addEventListener('orientationchange', () => setTimeout(onWindowResize, 100));
  animate();
}

function initRhino() {
  if (typeof rhino3dm === 'undefined') return;
  const config = { locateFile: (path) => path.endsWith('.wasm') ? './rhino3dm.wasm' : path };
  rhino3dm(config).then(m => {
    rhinoModule = m;
    rhinoReady = true;
  }).catch(() => {
    rhino3dm().then(m => {
      rhinoModule = m;
      rhinoReady = true;
    }).catch(console.error);
  });
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
// 4. MODEL LIFECYCLE & AUTOMATIC DEFAULT ISOMETRIC VIEW
// ═══════════════════════════════════════════════════════════
function clearModelScene() {
  while (modelRoot.children.length > 0) modelRoot.remove(modelRoot.children[0]);
  meshList = [];
  edgeLinesList = [];
  clearMeasurements();
  clearGirthMeasurement();
  clearCoordinatePoint();
  clearAngleMeasurement();
  clearDimensionHelper();
  selectedObject = null;
  selectedLocalBox = null;
}

function calibrateModelView() {
  modelBBox.setFromObject(modelRoot);
  const center = modelBBox.getCenter(new THREE.Vector3());
  controls.target.copy(center);

  // മോഡൽ ഓപ്പൺ ആകുമ്പോൾത്തന്നെ നേരിട്ട് ISO വ്യൂവിലേക്ക്
  setCameraView('iso');

  if (isClippingActive) updateClipPlane();
  hideLoader();
}

function loadRhinoDoc(doc, originalFileName) {
  try {
    clearModelScene();

    const materialColorMap = {};
    try {
      const materials = doc.materials();
      if (materials && materials.count) {
        for (let m = 0; m < materials.count; m++) {
          const mat = materials.get(m);
          if (mat && mat.diffuseColor) {
            const dc = mat.diffuseColor;
            materialColorMap[mat.index] = new THREE.Color(dc.r / 255, dc.g / 255, dc.b / 255);
          }
        }
      }
    } catch (e) {}

    const layerColorMap = {}, layerNameMap = {}, layerMaterialMap = {};
    try {
      const layers = doc.layers();
      if (layers && layers.count) {
        for (let l = 0; l < layers.count; l++) {
          const layer = layers.get(l);
          if (layer) {
            if (layer.name) layerNameMap[layer.index] = layer.name;
            if (layer.color && typeof layer.color.r === 'number') {
              layerColorMap[layer.index] = new THREE.Color(layer.color.r / 255, layer.color.g / 255, layer.color.b / 255);
            }
            if (layer.renderMaterialIndex !== undefined && layer.renderMaterialIndex >= 0) {
              layerMaterialMap[layer.index] = layer.renderMaterialIndex;
            }
          }
        }
      }
    } catch (e) {}

    const objects = doc.objects();
    const count = objects ? objects.count : 0;
    const edgeThreshold = 45;

    for (let i = 0; i < count; i++) {
      try {
        const obj = objects.get(i);
        if (!obj) continue;
        const geom = obj.geometry();
        const attr = obj.attributes();
        let mesh = null;

        if (geom instanceof rhinoModule.Mesh) mesh = geom;
        else if (geom instanceof rhinoModule.Brep) {
          mesh = new rhinoModule.Mesh();
          const faces = geom.faces();
          if (faces && faces.count) {
            for (let f = 0; f < faces.count; f++) {
              const faceMesh = faces.get(f).getMesh(rhinoModule.MeshType.Render);
              if (faceMesh) mesh.append(faceMesh);
            }
          }
        }

        if (mesh && mesh.vertices && mesh.vertices().count > 0) {
          const threeGeom = convertRhinoMeshToThree(mesh);
          threeGeom.computeVertexNormals();

          let resolvedColor = null;
          if (attr && attr.materialIndex !== undefined && attr.materialIndex >= 0 && materialColorMap[attr.materialIndex]) {
            resolvedColor = materialColorMap[attr.materialIndex].clone();
          }
          if (!resolvedColor && attr) {
            let oc = null;
            try { if (typeof attr.drawColor === 'function') oc = attr.drawColor(doc); } catch (e) {}
            if (!oc && attr.objectColor) oc = attr.objectColor;
            if (oc && typeof oc.r === 'number') {
              if (!(oc.r === 255 && oc.g === 255 && oc.b === 255) && !(oc.r === 0 && oc.g === 0 && oc.b === 0)) {
                resolvedColor = new THREE.Color(oc.r / 255, oc.g / 255, oc.b / 255);
              }
            }
          }
          if (!resolvedColor && attr && attr.layerIndex !== undefined) {
            const lMatIdx = layerMaterialMap[attr.layerIndex];
            if (lMatIdx !== undefined && materialColorMap[lMatIdx]) resolvedColor = materialColorMap[lMatIdx].clone();
          }
          if (!resolvedColor && attr && attr.layerIndex !== undefined && layerColorMap[attr.layerIndex]) {
            resolvedColor = layerColorMap[attr.layerIndex].clone();
          }
          if (!resolvedColor) resolvedColor = new THREE.Color(0x3b82f6);

          const material = new THREE.MeshStandardMaterial({
            color: resolvedColor, roughness: 0.3, metalness: 0.25, side: THREE.DoubleSide
          });
          const threeMesh = new THREE.Mesh(threeGeom, material);

          threeMesh.userData = {
            name: attr ? (attr.name || `Unit_Part_${i + 1}`) : `Unit_Part_${i + 1}`,
            layerName: (attr && attr.layerIndex !== undefined)
              ? (layerNameMap[attr.layerIndex] || `Layer ${attr.layerIndex}`)
              : 'Default',
            originalColor: resolvedColor.getHex()
          };

          try {
            const edges = new THREE.EdgesGeometry(threeGeom, edgeThreshold);
            const edgeLine = new THREE.LineSegments(
              edges,
              new THREE.LineBasicMaterial({ color: 0x0f172a, linewidth: 1, transparent: true, opacity: 0.65 })
            );
            threeMesh.add(edgeLine);
            edgeLinesList.push(edgeLine);
          } catch (e) {}

          modelRoot.add(threeMesh);
          meshList.push(threeMesh);
        }
      } catch (objErr) {
        console.warn('Skipped object', i, objErr);
      }
    }

    if (meshList.length === 0) {
      hideLoader();
      alert('No renderable meshes found in this file.');
      return;
    }

    calibrateModelView();
    applyCurrentProfileToMeshes();
    populateColorPalette();

    if (originalFileName) {
      setTimeout(async () => {
        try {
          const buf = encodeModelToBinaryVTS();
          await saveModelToStorage(originalFileName, buf);
        } catch (e) {}
      }, 150);
    }
  } catch (err) {
    console.error('Rendering failed:', err);
    hideLoader();
    alert('Render error:\n' + err.message);
  }
}

function convertRhinoMeshToThree(rMesh) {
  const geom = new THREE.BufferGeometry();
  const vertices = rMesh.vertices();
  const faces = rMesh.faces();
  const positions = [];
  for (let i = 0; i < faces.count; i++) {
    const face = faces.get(i);
    const pA = vertices.get(face[0]);
    const pB = vertices.get(face[1]);
    const pC = vertices.get(face[2]);
    positions.push(pA[0], pA[1], pA[2], pB[0], pB[1], pB[2], pC[0], pC[1], pC[2]);
    if (face[2] !== face[3]) {
      const pD = vertices.get(face[3]);
      positions.push(pA[0], pA[1], pA[2], pC[0], pC[1], pC[2], pD[0], pD[1], pD[2]);
    }
  }
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  return geom;
}

// ═══════════════════════════════════════════════════════════
// 5. CAMERA PRESETS & ISO ALIGNMENT
// ═══════════════════════════════════════════════════════════
function setCameraView(preset) {
  const bbox = new THREE.Box3().setFromObject(modelRoot);
  if (bbox.isEmpty()) return;

  const center = bbox.getCenter(new THREE.Vector3());
  const size = bbox.getSize(new THREE.Vector3());
  const d = (Math.max(size.x, size.y, size.z) || 1000) * 1.8;

  controls.target.copy(center);

  if (preset === 'top') {
    camera.position.set(center.x, center.y, center.z + d);
    camera.up.set(0, 1, 0);
  } else if (preset === 'side') {
    camera.position.set(center.x, center.y - d, center.z);
    camera.up.set(0, 0, 1);
  } else if (preset === 'front') {
    camera.position.set(center.x + d, center.y, center.z);
    camera.up.set(0, 0, 1);
  } else if (preset === 'iso') {
    camera.up.set(0, 0, 1);
    camera.position.set(center.x + d * 0.85, center.y - d * 0.85, center.z + d * 0.75);
  }

  camera.lookAt(center);
  controls.update();
}

// ═══════════════════════════════════════════════════════════
// 6. SCREEN PINS & MAGNETIC SNAP
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
// 7. COLOR PALETTE CONTROLLER
// ═══════════════════════════════════════════════════════════
function populateColorPalette() {
  const dotsContainer = document.getElementById('model-color-dots');
  if (!dotsContainer) return;
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
  const toggleBtn = document.getElementById('btn-toggle-palette');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => drawer.classList.toggle('expanded'));
  }

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
// 8. PROFILE & GRAPHICS QUALITY
// ═══════════════════════════════════════════════════════════
function applyQualityProfile(profile) {
  activeProfile = profile;
  localStorage.setItem('vt_viewer_profile', profile);

  const btnQuality = document.getElementById('btn-quality-toggle');
  const proBadge = document.getElementById('app-pro-tag');

  if (profile === 'PRO') {
    if (btnQuality) { btnQuality.innerText = 'PRO'; btnQuality.className = 'btn-quality mode-pro'; }
    if (proBadge) { proBadge.innerText = 'PRO'; proBadge.style.background = 'linear-gradient(135deg, #0284c7, #0369a1)'; }
    document.body.classList.remove('lite-mode');

    if (renderer) renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    edgeLinesList.forEach(line => line.visible = true);
  } else {
    if (btnQuality) { btnQuality.innerText = 'LITE'; btnQuality.className = 'btn-quality mode-lite'; }
    if (proBadge) { proBadge.innerText = 'LITE'; proBadge.style.background = '#64748b'; }
    document.body.classList.add('lite-mode');

    if (renderer) renderer.setPixelRatio(1.0);
    edgeLinesList.forEach(line => line.visible = false);

    if (!['view', 'coords', 'measure'].includes(currentMode)) {
      switchMode('view');
    }
  }
}

function applyCurrentProfileToMeshes() {
  meshList.forEach(m => {
    if (!m.material) return;
    if (activeProfile === 'LITE') {
      m.material.roughness = 0.5;
      m.material.metalness = 0.1;
    } else {
      m.material.roughness = 0.3;
      m.material.metalness = 0.25;
    }
    if (isXRay) {
      m.material.transparent = true;
      m.material.opacity = 0.35;
      m.material.depthWrite = false;
    }
    m.material.needsUpdate = true;
  });
}

// ═══════════════════════════════════════════════════════════
// 9. COMPLETE MEASUREMENT & CALIPER LOGIC
// ═══════════════════════════════════════════════════════════
function registerMeasurementPoint(worldPt) {
  if (measurePoints.length >= 2) clearMeasurements();
  measurePoints.push(worldPt);

  const pin = createScreenSpacePin(worldPt, 0x0284c7);
  pinMarkers.push(pin);

  if (measurePoints.length === 1) {
    const p1Disp = document.getElementById('p1-coords-display');
    if (p1Disp) p1Disp.innerText = `P1: [${worldPt.x.toFixed(1)}, ${worldPt.y.toFixed(1)}, ${worldPt.z.toFixed(1)}]`;
  } else if (measurePoints.length === 2) {
    const p2Disp = document.getElementById('p2-coords-display');
    if (p2Disp) p2Disp.innerText = `P2: [${worldPt.x.toFixed(1)}, ${worldPt.y.toFixed(1)}, ${worldPt.z.toFixed(1)}]`;

    const lineGeom = new THREE.BufferGeometry().setFromPoints(measurePoints);
    const lineMat = new THREE.LineBasicMaterial({ color: 0x0284c7, linewidth: 2, depthTest: false });
    measureLine = new THREE.Line(lineGeom, lineMat);
    scene.add(measureLine);

    const [p1, p2] = measurePoints;
    document.getElementById('val-dist').innerText = p1.distanceTo(p2).toFixed(1);
    document.getElementById('val-dx').innerText = Math.abs(p2.x - p1.x).toFixed(1);
    document.getElementById('val-dy').innerText = Math.abs(p2.y - p1.y).toFixed(1);
    document.getElementById('val-dz').innerText = Math.abs(p2.z - p1.z).toFixed(1);
  }
}

function clearMeasurements() {
  pinMarkers.forEach(p => pointMarkersGroup.remove(p));
  pinMarkers = [];
  if (measureLine) { scene.remove(measureLine); measureLine = null; }
  measurePoints = [];
  document.getElementById('val-dist').innerText = '0.0';
  document.getElementById('val-dx').innerText = '0.0';
  document.getElementById('val-dy').innerText = '0.0';
  document.getElementById('val-dz').innerText = '0.0';
  const p1Disp = document.getElementById('p1-coords-display');
  const p2Disp = document.getElementById('p2-coords-display');
  if (p1Disp) p1Disp.innerText = 'P1: [---, ---, ---]';
  if (p2Disp) p2Disp.innerText = 'P2: [---, ---, ---]';
}

function registerCoordinatePoint(worldPt) {
  clearCoordinatePoint();
  coordMarker = createScreenSpacePin(worldPt, 0x059669);

  document.getElementById('inp-coord-x').value = worldPt.x.toFixed(1);
  document.getElementById('inp-coord-y').value = worldPt.y.toFixed(1);
  document.getElementById('inp-coord-z').value = worldPt.z.toFixed(1);
}

function clearCoordinatePoint() {
  if (coordMarker) { pointMarkersGroup.remove(coordMarker); coordMarker = null; }
}

function jumpToInputCoordinates() {
  const x = parseFloat(document.getElementById('inp-coord-x').value);
  const y = parseFloat(document.getElementById('inp-coord-y').value);
  const z = parseFloat(document.getElementById('inp-coord-z').value);
  if (isNaN(x) || isNaN(y) || isNaN(z)) {
    alert('Please enter valid X, Y, and Z numeric coordinates.');
    return;
  }
  const targetPt = new THREE.Vector3(x, y, z);
  registerCoordinatePoint(targetPt);
  controls.target.copy(targetPt);
  controls.update();
}

// ═══════════════════════════════════════════════════════════
// 10. GIRTH & ANGLE FINDER
// ═══════════════════════════════════════════════════════════
function registerGirthPoint(worldPt, meshObj) {
  if (girthPoints.length >= 2) clearGirthMeasurement();
  girthPoints.push({ pt: worldPt, mesh: meshObj });

  const pin = createScreenSpacePin(worldPt, 0xd97706);
  girthMarkers.push(pin);

  if (girthPoints.length === 2) {
    calculateSmoothSurfaceGirth();
  }
}

function calculateSmoothSurfaceGirth() {
  const p1 = girthPoints[0].pt;
  const p2 = girthPoints[1].pt;
  const mesh = girthPoints[1].mesh;

  const chordDist = p1.distanceTo(p2);
  document.getElementById('val-girth-chord').innerText = chordDist.toFixed(1) + ' mm';

  const geom = mesh.geometry;
  const pos = geom.attributes.position;
  const vertexCount = pos.count;

  const worldVerts = new Float32Array(vertexCount * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < vertexCount; i++) {
    v.fromBufferAttribute(pos, i);
    v.applyMatrix4(mesh.matrixWorld);
    worldVerts[i * 3] = v.x;
    worldVerts[i * 3 + 1] = v.y;
    worldVerts[i * 3 + 2] = v.z;
  }

  const chordDir = new THREE.Vector3().subVectors(p2, p1).normalize();
  const numSamples = 20;
  const sampledRidge = [p1.clone()];

  for (let s = 1; s < numSamples; s++) {
    const t = s / numSamples;
    const targetPt = new THREE.Vector3().lerpVectors(p1, p2, t);
    let bestDistSq = Infinity, bestPt = targetPt;

    for (let i = 0; i < vertexCount; i++) {
      const dx = worldVerts[i * 3] - targetPt.x;
      const dy = worldVerts[i * 3 + 1] - targetPt.y;
      const dz = worldVerts[i * 3 + 2] - targetPt.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < bestDistSq) {
        bestDistSq = d2;
        bestPt = new THREE.Vector3(worldVerts[i * 3], worldVerts[i * 3 + 1], worldVerts[i * 3 + 2]);
      }
    }

    const projVec = new THREE.Vector3().subVectors(bestPt, p1);
    const dot = projVec.dot(chordDir);
    const projected = new THREE.Vector3().copy(p1).addScaledVector(chordDir, dot);
    const bulgeOffset = new THREE.Vector3().subVectors(bestPt, projected);

    sampledRidge.push(new THREE.Vector3().lerpVectors(p1, p2, t).add(bulgeOffset));
  }
  sampledRidge.push(p2.clone());

  const smoothCurve = new THREE.CatmullRomCurve3(sampledRidge, false, 'centripetal', 0.5);
  const curvePoints = smoothCurve.getPoints(50);

  let totalGirth = 0;
  for (let i = 0; i < curvePoints.length - 1; i++) {
    totalGirth += curvePoints[i].distanceTo(curvePoints[i + 1]);
  }
  if (totalGirth < chordDist) totalGirth = chordDist;

  const gGeom = new THREE.BufferGeometry().setFromPoints(curvePoints);
  const gMat = new THREE.LineBasicMaterial({ color: 0xd97706, linewidth: 3, depthTest: false });
  girthLine = new THREE.Line(gGeom, gMat);
  scene.add(girthLine);

  document.getElementById('val-girth-arc').innerText = totalGirth.toFixed(1) + ' mm';
}

function clearGirthMeasurement() {
  girthMarkers.forEach(p => pointMarkersGroup.remove(p));
  girthMarkers = [];
  if (girthLine) { scene.remove(girthLine); girthLine = null; }
  girthPoints = [];
  document.getElementById('val-girth-arc').innerText = '0.0 mm';
  document.getElementById('val-girth-chord').innerText = '0.0 mm';
}

function registerAnglePoint(worldPt) {
  if (anglePoints.length >= 3) clearAngleMeasurement();
  anglePoints.push(worldPt);

  const pinColors = [0x38bdf8, 0x7c3aed, 0xf43f5e];
  const pin = createScreenSpacePin(worldPt, pinColors[anglePoints.length - 1]);
  angleMarkers.push(pin);

  if (anglePoints.length === 3) {
    const [p1, pV, p3] = anglePoints;
    const lineMat = new THREE.LineBasicMaterial({ color: 0x7c3aed, linewidth: 2, depthTest: false });
    const l1 = new THREE.Line(new THREE.BufferGeometry().setFromPoints([pV, p1]), lineMat);
    const l2 = new THREE.Line(new THREE.BufferGeometry().setFromPoints([pV, p3]), lineMat);
    scene.add(l1); scene.add(l2);
    angleLines.push(l1, l2);

    const vA = new THREE.Vector3().subVectors(p1, pV).normalize();
    const vB = new THREE.Vector3().subVectors(p3, pV).normalize();
    const deg = THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(vA.dot(vB), -1, 1)));
    document.getElementById('val-angle-deg').innerText = deg.toFixed(2) + '°';
  }
}

function clearAngleMeasurement() {
  angleMarkers.forEach(p => pointMarkersGroup.remove(p));
  angleMarkers = [];
  angleLines.forEach(l => scene.remove(l));
  angleLines = [];
  anglePoints = [];
  document.getElementById('val-angle-deg').innerText = '0.00°';
}

// ═══════════════════════════════════════════════════════════
// 11. INSPECT & WEIGHT CALCULATOR
// ═══════════════════════════════════════════════════════════
const STEEL_DENSITY = 7.85e-6;

function handleInspectClick(hit) {
  selectedObject = hit.object;
  meshList.forEach(m => {
    if (m.material && m.material.emissive) m.material.emissive.setHex(0x000000);
  });
  if (selectedObject.material.emissive) selectedObject.material.emissive.setHex(0x38bdf8);

  document.getElementById('meta-part-name').innerText = selectedObject.userData.name || 'Ship Part';
  document.getElementById('meta-part-layer').innerText = selectedObject.userData.layerName || 'Default';

  selectedObject.geometry.computeBoundingBox();
  selectedLocalBox = selectedObject.geometry.boundingBox;
  const size = new THREE.Vector3();
  selectedLocalBox.getSize(size);

  document.getElementById('part-bx').innerText = size.x.toFixed(1);
  document.getElementById('part-by').innerText = size.y.toFixed(1);
  document.getElementById('part-bz').innerText = size.z.toFixed(1);

  const sortedDims = [size.x, size.y, size.z].sort((a, b) => b - a);
  const L = sortedDims[0], B = sortedDims[1], T = Math.max(sortedDims[2], 0.5);
  const weightKg = (L * B * T * 0.7) * STEEL_DENSITY;

  let weightStr = (weightKg < 1) ? (weightKg * 1000).toFixed(0) + ' g' : (weightKg < 1000) ? weightKg.toFixed(2) + ' KG' : (weightKg / 1000).toFixed(3) + ' T';
  document.getElementById('meta-part-weight').innerText = weightStr;
  document.getElementById('meta-part-perim').innerText = (2 * (L + B)).toFixed(1) + ' mm';
}

function highlightAxisDimension(axis) {
  if (!selectedObject || !selectedLocalBox) return;
  clearDimensionHelper();

  const min = selectedLocalBox.min, max = selectedLocalBox.max;
  const p0 = new THREE.Vector3(min.x, min.y, min.z);
  const pX = new THREE.Vector3(max.x, min.y, min.z);
  const pY = new THREE.Vector3(min.x, max.y, min.z);
  const pZ = new THREE.Vector3(min.x, min.y, max.z);
  selectedObject.localToWorld(p0);
  selectedObject.localToWorld(pX);
  selectedObject.localToWorld(pY);
  selectedObject.localToWorld(pZ);

  function makeLine(a, b, color) {
    return new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([a, b]),
      new THREE.LineBasicMaterial({ color, linewidth: 2, depthTest: false })
    );
  }
  if (axis === 'x') dimensionLinesGroup.add(makeLine(p0, pX, 0x0284c7));
  else if (axis === 'y') dimensionLinesGroup.add(makeLine(p0, pY, 0x059669));
  else if (axis === 'z') dimensionLinesGroup.add(makeLine(p0, pZ, 0xe11d48));
}

function clearDimensionHelper() {
  while (dimensionLinesGroup.children.length > 0) {
    dimensionLinesGroup.remove(dimensionLinesGroup.children[0]);
  }
}

// ═══════════════════════════════════════════════════════════
// 12. SECTION CUTTER LOGIC
// ═══════════════════════════════════════════════════════════
function setupSectionCutControls() {
  const cutX = document.getElementById('cut-axis-x');
  const cutY = document.getElementById('cut-axis-y');
  const cutZ = document.getElementById('cut-axis-z');
  const slider = document.getElementById('cut-slider');
  const inputVal = document.getElementById('cut-manual-input');
  const btnGo = document.getElementById('btn-cut-go');
  const flipBtn = document.getElementById('btn-cut-flip');
  const resetCutBtn = document.getElementById('btn-reset-cut');

  function setAxis(axis) {
    currentCutAxis = axis;
    cutX.classList.toggle('active-axis', axis === 'x');
    cutY.classList.toggle('active-axis', axis === 'y');
    cutZ.classList.toggle('active-axis', axis === 'z');
    updateClipPlane();
  }

  if (cutX) cutX.addEventListener('click', () => setAxis('x'));
  if (cutY) cutY.addEventListener('click', () => setAxis('y'));
  if (cutZ) cutZ.addEventListener('click', () => setAxis('z'));
  if (flipBtn) flipBtn.addEventListener('click', () => { cutInvert *= -1; updateClipPlane(); });
  if (slider) slider.addEventListener('input', updateClipPlane);

  if (btnGo) {
    btnGo.addEventListener('click', () => {
      const val = parseFloat(inputVal.value);
      if (!isNaN(val)) setCutToExactCoordinate(val);
    });
  }

  if (resetCutBtn) {
    resetCutBtn.addEventListener('click', () => {
      slider.value = 100;
      inputVal.value = '';
      cutInvert = -1;
      enableClipping(false);
    });
  }
}

function updateClipPlane() {
  enableClipping(true);
  const slider = document.getElementById('cut-slider');
  const inputVal = document.getElementById('cut-manual-input');
  if (!slider || !inputVal) return;

  const sliderVal = parseFloat(slider.value);
  const min = modelBBox.min, max = modelBBox.max;
  const normal = new THREE.Vector3();
  let minVal = 0, maxVal = 0;

  if (currentCutAxis === 'x') { normal.set(cutInvert, 0, 0); minVal = min.x; maxVal = max.x; }
  else if (currentCutAxis === 'y') { normal.set(0, cutInvert, 0); minVal = min.y; maxVal = max.y; }
  else { normal.set(0, 0, cutInvert); minVal = min.z; maxVal = max.z; }

  const targetCoord = minVal + (maxVal - minVal) * (sliderVal / 100);
  clipPlane.normal.copy(normal);
  clipPlane.constant = (cutInvert < 0) ? targetCoord : -targetCoord;
  inputVal.value = targetCoord.toFixed(1);
}

function setCutToExactCoordinate(exactCoord) {
  enableClipping(true);
  const min = modelBBox.min, max = modelBBox.max;
  let minVal = 0, maxVal = 0;

  if (currentCutAxis === 'x') { minVal = min.x; maxVal = max.x; }
  else if (currentCutAxis === 'y') { minVal = min.y; maxVal = max.y; }
  else { minVal = min.z; maxVal = max.z; }

  const clamped = Math.max(minVal, Math.min(maxVal, exactCoord));
  const percent = ((clamped - minVal) / Math.max(maxVal - minVal, 0.0001)) * 100;
  document.getElementById('cut-slider').value = percent;
  updateClipPlane();
}

function enableClipping(enabled) {
  isClippingActive = enabled;
  meshList.forEach(m => {
    if (m.material) {
      m.material.clippingPlanes = enabled ? [clipPlane] : [];
      m.material.needsUpdate = true;
    }
  });
}

// ═══════════════════════════════════════════════════════════
// 13. RECENT MODELS MODAL UI (HIGH CONTRAST & CLEAR TEXT)
// ═══════════════════════════════════════════════════════════
async function showRecentModal() {
  const container = document.getElementById('recent-list-container');
  if (!container) return;
  container.innerHTML = '<div style="text-align:center; padding:20px; font-size:12px; color:#64748b;">Loading recent files...</div>';
  document.getElementById('recent-modal').style.display = 'flex';

  const items = await getAllRecentModels();

  if (!items || items.length === 0) {
    container.innerHTML = `<div style="text-align:center; padding:30px 10px; color:#64748b; font-size:12px;">
        No recently opened 3D models found.<br>Click <b>Open</b> to load a file.
      </div>`;
    return;
  }

  container.innerHTML = '';
  items.forEach(item => {
    const dateStr = new Date(item.timestamp).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' });
    const div = document.createElement('div');
    div.className = 'recent-item';
    div.innerHTML = `
      <div class="recent-item-info">
        <div class="recent-item-title">${item.name}</div>
        <div class="recent-item-meta">${item.size} • ${dateStr}</div>
      </div>
      <button class="recent-del-btn" title="Remove">&times;</button>
    `;

    div.querySelector('.recent-item-info').addEventListener('click', () => {
      document.getElementById('recent-modal').style.display = 'none';
      document.getElementById('active-file-display').innerText = item.name.toLowerCase();
      showLoader(`Loading ${item.name}...`);

      setTimeout(() => {
        try {
          const u8 = new Uint8Array(item.buffer);
          if (u8.length >= 4 && u8[0] === 0x56 && u8[1] === 0x54 && u8[2] === 0x53 && u8[3] === 0x31) {
            loadBinaryVTSBuffer(item.buffer);
          } else if (rhinoReady && rhinoModule) {
            const doc = rhinoModule.File3dm.fromByteArray(u8);
            if (doc) loadRhinoDoc(doc, item.name);
            else throw new Error('Could not parse cached model data.');
          }
        } catch (err) {
          alert('Failed to open cached model:\n' + err.message);
        } finally {
          hideLoader();
        }
      }, 30);
    });

    div.querySelector('.recent-del-btn').addEventListener('click', async (e) => {
      e.stopPropagation();
      await deleteModelFromStorage(item.name);
      showRecentModal();
    });

    container.appendChild(div);
  });
}

// ═══════════════════════════════════════════════════════════
// 14. MODE SWITCHING & EVENT LISTENERS
// ═══════════════════════════════════════════════════════════
function switchMode(newMode) {
  currentMode = newMode;
  clearDimensionHelper();

  // എല്ലാ ടാബുകളുടെയും ക്ലാസുകൾ റീസെറ്റ് ചെയ്യുന്നു
  document.querySelectorAll('.mode-btn').forEach(b => {
    b.className = 'mode-btn';
  });

  // സെലക്ട് ചെയ്ത ടാബ് ഹൈലൈറ്റ് ചെയ്യുന്നു
  const activeBtn = document.getElementById(`mode-${newMode}`);
  if (activeBtn) {
    activeBtn.className = `mode-btn active-${newMode}`;
  }

  // പാനലുകൾ ഹൈഡ്/ഷോ ചെയ്യുന്നു
  document.querySelectorAll('.panel-bottom').forEach(p => p.style.display = 'none');
  const activePanel = document.getElementById(`${newMode}-panel`);
  if (activePanel) {
    activePanel.style.display = 'block';
  }

  controls.enabled = !isFrozen;
  if (newMode === 'section') updateClipPlane();
  if (snapCursorEl) snapCursorEl.style.display = 'none';
}

function setupEvents() {
  const dom = renderer.domElement;

  // മോഡ് ബാർ ബട്ടണുകൾ
  ['view', 'coords', 'measure', 'girth', 'angle', 'section', 'inspect'].forEach(m => {
    const btn = document.getElementById(`mode-${m}`);
    if (btn) {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        switchMode(m);
      });
    }
  });

  // ഫ്രീസ്, എക്സ്-റേ, പ്രോ ക്വാളിറ്റി
  const btnFreeze = document.getElementById('btn-freeze-orbit');
  if (btnFreeze) {
    btnFreeze.addEventListener('click', () => {
      isFrozen = !isFrozen;
      controls.enabled = !isFrozen;
      btnFreeze.classList.toggle('active-freeze', isFrozen);
      btnFreeze.innerText = isFrozen ? 'LOCKED' : 'LOCK';
    });
  }

  const btnXray = document.getElementById('btn-toggle-xray');
  if (btnXray) {
    btnXray.addEventListener('click', () => {
      isXRay = !isXRay;
      btnXray.classList.toggle('active-xray', isXRay);
      meshList.forEach(m => {
        if (!m.material) return;
        m.material.transparent = isXRay;
        m.material.opacity = isXRay ? 0.35 : 1.0;
        m.material.depthWrite = !isXRay;
        m.material.needsUpdate = true;
      });
    });
  }

  const btnQuality = document.getElementById('btn-quality-toggle');
  if (btnQuality) {
    btnQuality.addEventListener('click', () => {
      applyQualityProfile(activeProfile === 'PRO' ? 'LITE' : 'PRO');
    });
  }

  // വ്യൂസ് ബാർ
  const vZ = document.getElementById('btn-view-z');
  const vY = document.getElementById('btn-view-y');
  const vX = document.getElementById('btn-view-x');
  const vIso = document.getElementById('btn-view-iso');
  if (vZ) vZ.addEventListener('click', () => setCameraView('top'));
  if (vY) vY.addEventListener('click', () => setCameraView('side'));
  if (vX) vX.addEventListener('click', () => setCameraView('front'));
  if (vIso) vIso.addEventListener('click', () => setCameraView('iso'));

  // തീം ടോഗിൾ
  const btnTheme = document.getElementById('btn-theme-toggle');
  if (btnTheme) {
    btnTheme.addEventListener('click', () => {
      isDarkMode = !isDarkMode;
      document.body.classList.toggle('dark-mode', isDarkMode);
      document.getElementById('theme-icon').innerText = isDarkMode ? '🌙' : '☀️';
      if (scene) scene.background = new THREE.Color(isDarkMode ? 0x0a0f1d : 0xf1f5f9);
      localStorage.setItem('vt_viewer_theme', isDarkMode ? 'dark' : 'light');
    });
  }

  // ഇൻഫോ പിൽ
  const pill = document.getElementById('info-pill');
  if (pill) {
    pill.addEventListener('click', function(e) {
      e.stopPropagation();
      this.classList.toggle('expanded');
    });
    window.addEventListener('click', (e) => {
      if (!pill.contains(e.target)) pill.classList.remove('expanded');
    });
  }

  // പോയിന്റർ & ടച്ച് ഇവന്റുകൾ
  dom.addEventListener('pointerdown', (e) => {
    pointerDownPos = { x: e.clientX, y: e.clientY, time: performance.now() };
  });

  dom.addEventListener('pointermove', (e) => {
    if (['measure', 'coords', 'girth', 'angle'].includes(currentMode)) {
      const snap = findMagneticSnapPoint(e.clientX, e.clientY);
      if (snap) {
        activeSnappedPoint = snap;
        snapCursorEl.style.left = `${e.clientX}px`;
        snapCursorEl.style.top = `${e.clientY}px`;
        snapCursorEl.style.display = 'block';
        snapCursorEl.style.borderColor = snap.isCorner ? '#10b981' : '#0284c7';
      } else {
        activeSnappedPoint = null;
        snapCursorEl.style.display = 'none';
      }
    } else {
      if (snapCursorEl) snapCursorEl.style.display = 'none';
    }
  });

  dom.addEventListener('pointerup', (e) => {
    const dx = Math.abs(e.clientX - pointerDownPos.x);
    const dy = Math.abs(e.clientY - pointerDownPos.y);
    const isClickOrTap = (dx < 10 && dy < 10);

    if (!isClickOrTap) return;

    if (['measure', 'coords', 'girth', 'angle'].includes(currentMode)) {
      const snap = findMagneticSnapPoint(e.clientX, e.clientY);
      if (snap) {
        const pt = snap.point;
        const mesh = snap.object;

        if (currentMode === 'measure') registerMeasurementPoint(pt);
        else if (currentMode === 'coords') registerCoordinatePoint(pt);
        else if (currentMode === 'girth') registerGirthPoint(pt, mesh);
        else if (currentMode === 'angle') registerAnglePoint(pt);
      }
    } else if (currentMode === 'inspect') {
      const snap = findMagneticSnapPoint(e.clientX, e.clientY);
      if (snap) handleInspectClick(snap);
    }
  });

  // ഫയൽ സെലക്ഷൻ & റീസെറ്റ് ബട്ടണുകൾ
  const fileInp = document.getElementById('file-input');
  if (fileInp) fileInp.addEventListener('change', handleFileSelect);

  const btnClrM = document.getElementById('btn-clear-measure');
  if (btnClrM) btnClrM.addEventListener('click', clearMeasurements);

  const btnClrG = document.getElementById('btn-clear-girth');
  if (btnClrG) btnClrG.addEventListener('click', clearGirthMeasurement);

  const btnClrC = document.getElementById('btn-clear-coords');
  if (btnClrC) btnClrC.addEventListener('click', clearCoordinatePoint);

  const btnClrA = document.getElementById('btn-clear-angle');
  if (btnClrA) btnClrA.addEventListener('click', clearAngleMeasurement);

  const btnClrL = document.getElementById('btn-clear-lines');
  if (btnClrL) btnClrL.addEventListener('click', clearDimensionHelper);

  const btnRecent = document.getElementById('btn-show-recent');
  if (btnRecent) btnRecent.addEventListener('click', showRecentModal);

  const btnCloseRecent = document.getElementById('btn-close-recent');
  if (btnCloseRecent) {
    btnCloseRecent.addEventListener('click', () => {
      document.getElementById('recent-modal').style.display = 'none';
    });
  }

  const btnJump = document.getElementById('btn-jump-coord');
  if (btnJump) btnJump.addEventListener('click', jumpToInputCoordinates);

  const btnHidePart = document.getElementById('btn-hide-part');
  if (btnHidePart) {
    btnHidePart.addEventListener('click', () => {
      if (selectedObject) { selectedObject.visible = false; clearDimensionHelper(); }
    });
  }

  const btnIsoPart = document.getElementById('btn-isolate-part');
  if (btnIsoPart) {
    btnIsoPart.addEventListener('click', () => {
      if (!selectedObject) return;
      meshList.forEach(m => m.visible = (m === selectedObject));
    });
  }

  const btnUnhideAll = document.getElementById('btn-unhide-all');
  if (btnUnhideAll) {
    btnUnhideAll.addEventListener('click', () => {
      meshList.forEach(m => m.visible = true);
    });
  }

  // ഫോണ്ട് സൈസ് അഡ്ജസ്റ്റ്മെന്റ്
  const fInc = document.getElementById('btn-font-inc');
  const fDec = document.getElementById('btn-font-dec');
  if (fInc) {
    fInc.addEventListener('click', () => {
      if (currentScale < 1.7) {
        currentScale = +(currentScale + 0.1).toFixed(2);
        document.documentElement.style.setProperty('--ui-scale', currentScale);
      }
    });
  }
  if (fDec) {
    fDec.addEventListener('click', () => {
      if (currentScale > 0.8) {
        currentScale = +(currentScale - 0.1).toFixed(2);
        document.documentElement.style.setProperty('--ui-scale', currentScale);
      }
    });
  }
}

function handleFileSelect(evt) {
  const file = evt.target.files && evt.target.files[0];
  if (!file) return;

  const fileName = file.name.toLowerCase();
  document.getElementById('active-file-display').innerText = fileName;
  showLoader('Reading file...');

  const reader = new FileReader();
  reader.onerror = () => { hideLoader(); alert('Failed to read file.'); };
  reader.onload = function(e) {
    (async () => {
      try {
        const buffer = e.target.result;
        if (fileName.endsWith('.vts')) {
          loadBinaryVTSBuffer(buffer);
          await saveModelToStorage(file.name, buffer);
        } else {
          if (!rhinoReady || !rhinoModule) throw new Error('Rhino engine initializing. Please wait...');
          const doc = rhinoModule.File3dm.fromByteArray(new Uint8Array(buffer));
          if (!doc) throw new Error('Unable to parse 3DM format.');
          loadRhinoDoc(doc, file.name);
        }
      } catch (err) {
        alert('Error opening file:\n' + err.message);
      } finally {
        evt.target.value = '';
        hideLoader();
      }
    })();
  };
  reader.readAsArrayBuffer(file);
}

function showLoader(txt) {
  document.getElementById('loader-msg').innerText = txt || 'Loading...';
  document.getElementById('loader').style.display = 'flex';
}
function hideLoader() {
  document.getElementById('loader').style.display = 'none';
}

// ═══════════════════════════════════════════════════════════
// 15. BOOTSTRAP INITIALIZATION (AUTO RECENT LAUNCH)
// ═══════════════════════════════════════════════════════════
window.addEventListener('DOMContentLoaded', async () => {
  initThree();
  initRhino();
  setupEvents();
  setupColorPaletteEvents();
  setupSectionCutControls();
  applyQualityProfile(activeProfile);

  window.setCameraView = setCameraView;
  window.highlightAxisDimension = highlightAxisDimension;

  // IndexedDB ഇനിഷ്യലൈസ് ചെയ്ത് ഫയലുകൾ ഉണ്ടെങ്കിൽ നേരിട്ട് Recent പേജ് തുറക്കുന്നു
  try {
    await initDB();
    const recents = await getAllRecentModels();
    if (recents && recents.length > 0) {
      showRecentModal();
    }
  } catch (e) {
    console.warn('DB initialization error:', e);
  }

  const savedTheme = localStorage.getItem('vt_viewer_theme');
  if (savedTheme === 'dark') {
    isDarkMode = true;
    document.body.classList.add('dark-mode');
    document.getElementById('theme-icon').innerText = '🌙';
    if (scene) scene.background = new THREE.Color(0x0a0f1d);
  }
});
