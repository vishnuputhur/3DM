'use strict';

// ═══════════════════════════════════════════════════════════
// 1. BRIDGE FOR MAIN VIEWER (index.html -> forming.html)
// ═══════════════════════════════════════════════════════════
window.openDirectFormingStudio = function(meshObj) {
  if (!meshObj || !meshObj.geometry) {
    alert('ദയവായി ഒരു ഷെൽ പ്ലേറ്റ് ആദ്യം സെലക്ട് ചെയ്യുക.');
    return;
  }

  meshObj.updateMatrixWorld(true);
  let geom = meshObj.geometry.clone();
  geom.applyMatrix4(meshObj.matrixWorld);
  if (geom.index) geom = geom.toNonIndexed();

  const posAttr = geom.attributes.position;
  if (!posAttr || posAttr.array.length < 9) {
    alert('തിരഞ്ഞെടുത്ത പ്ലേറ്റിന്റെ ജ്യാമിതി ശരിയല്ല.');
    return;
  }

  const platePayload = {
    name: (meshObj.userData && meshObj.userData.name) ? meshObj.userData.name : 'Shell Plate',
    plateNo: (meshObj.userData && meshObj.userData.partNo) ? meshObj.userData.partNo : '',
    color: (meshObj.material && meshObj.material.color) ? meshObj.material.color.getHex() : 0x38bdf8,
    vertices: Array.from(posAttr.array)
  };

  try {
    localStorage.setItem('vt_forming_plate_data', JSON.stringify(platePayload));
    window.location.href = 'forming.html';
  } catch (err) {
    console.error('Failed to transfer plate data:', err);
    alert('പ്ലേറ്റ് ഡാറ്റ ട്രാൻസ്ഫർ ചെയ്യുന്നതിൽ പിഴവ് സംഭവിച്ചു.');
  }
};

// ═══════════════════════════════════════════════════════════
// 2. INDEXED-DB STORAGE FOR PLATES & MULTI-LINES
// ═══════════════════════════════════════════════════════════
const DB_NAME = 'VTSoftFormingDB';
const STORE_NAME = 'plates';

function openFormingDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbSavePlate(record) {
  const db = await openFormingDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(record);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

async function dbGetAllPlates() {
  const db = await openFormingDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function dbDeletePlate(id) {
  const db = await openFormingDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

// ═══════════════════════════════════════════════════════════
// 3. FORMING STUDIO 3D ENGINE (RUNS ON forming.html)
// ═══════════════════════════════════════════════════════════
let scene, camera, renderer, controls;
let plateMesh = null;
let linesVisualGroup = new THREE.Group();
let tempPickGroup = new THREE.Group();

let currentPlate = null;
let plateEdgesInfo = [];
let topEdgeMid = null, fwdEdgeMid = null;
let htmlLabels = [];

// Modes: 'view' | 'pick_start' | 'pick_end'
let mode = 'view';
let tempStartPt = null;
let divisionPitch = 200;
let activeLineId = null;

function initFormingStudioPage() {
  const container = document.getElementById('canvas-container');
  if (!container) return; // Skip if loaded inside index.html

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x090d16);

  camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 10, 500000);
  camera.up.set(0, 0, 1);

  renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  container.appendChild(renderer.domElement);

  controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;

  scene.add(new THREE.AmbientLight(0xffffff, 0.8));
  const d1 = new THREE.DirectionalLight(0xffffff, 0.85);
  d1.position.set(5000, -5000, 8000);
  scene.add(d1);
  const d2 = new THREE.DirectionalLight(0xffffff, 0.45);
  d2.position.set(-5000, 5000, -6000);
  scene.add(d2);

  scene.add(linesVisualGroup);
  scene.add(tempPickGroup);

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  setupInteractions();
  setupUI();
  bootPlateLoader();
  animate();
}

function animate() {
  requestAnimationFrame(animate);
  if (controls && controls.enabled) controls.update();
  updateHTMLLabels();
  renderer.render(scene, camera);
}

// ═══════════════════════════════════════════════════════════
// 4. BOOT: LOAD FROM VIEWER REDIRECT OR DIRECT SAVED LIBRARY
// ═══════════════════════════════════════════════════════════
async function bootPlateLoader() {
  const rawRedirect = localStorage.getItem('vt_forming_plate_data') || localStorage.getItem('active_forming_part');

  if (rawRedirect) {
    try {
      const parsed = JSON.parse(rawRedirect);
      localStorage.removeItem('vt_forming_plate_data');
      localStorage.removeItem('active_forming_part');

      const existing = await dbGetAllPlates();
      const match = existing.find(p => p.name === parsed.name && p.vertices.length === parsed.vertices.length);

      if (match) {
        loadPlateRecord(match);
      } else {
        const newRec = {
          id: 'plate_' + Date.now(),
          plateNo: parsed.plateNo || 'P-' + (existing.length + 1),
          name: parsed.name || 'Shell Plate',
          color: parsed.color !== undefined ? parsed.color : 0x38bdf8,
          vertices: Array.from(parsed.vertices),
          lines: [],
          updatedAt: Date.now()
        };
        await dbSavePlate(newRec);
        loadPlateRecord(newRec);
      }
      return;
    } catch (e) {
      console.error(e);
    }
  }

  // Direct visit -> load most recent saved plate or show welcome card
  const saved = await dbGetAllPlates();
  if (saved.length > 0) {
    saved.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    loadPlateRecord(saved[0]);
  } else {
    document.getElementById('welcome-card').classList.remove('hidden');
  }
}

// ═══════════════════════════════════════════════════════════
// 5. LOAD PLATE + COLOR TOP (NEON GREEN) & FORWARD (YELLOW) EDGES
// ═══════════════════════════════════════════════════════════
function loadPlateRecord(record) {
  document.getElementById('welcome-card').classList.add('hidden');
  currentPlate = record;
  tempStartPt = null;
  activeLineId = null;

  if (plateMesh) { scene.remove(plateMesh); plateMesh = null; }
  while (linesVisualGroup.children.length > 0) linesVisualGroup.remove(linesVisualGroup.children[0]);
  while (tempPickGroup.children.length > 0) tempPickGroup.remove(tempPickGroup.children[0]);

  document.getElementById('plate-badge').innerText = `${record.plateNo}: ${record.name}`;
  document.getElementById('inp-plate-no').value = record.plateNo || '';
  document.getElementById('inp-plate-name').value = record.name || '';

  const floatArr = new Float32Array(record.vertices);
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(floatArr, 3));
  geom.computeVertexNormals();

  classifyAndColorPlateEdges(geom, record.color || 0x38bdf8);

  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.38,
    metalness: 0.22,
    side: THREE.DoubleSide
  });

  plateMesh = new THREE.Mesh(geom, mat);
  scene.add(plateMesh);

  geom.computeBoundingBox();
  const bbox = geom.boundingBox;
  const center = bbox.getCenter(new THREE.Vector3());
  const size = bbox.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z) || 1000;

  controls.target.copy(center);
  camera.position.set(center.x + maxDim * 0.7, center.y - maxDim * 0.7, center.z + maxDim * 0.8);
  controls.update();

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
    tris.push({ i, area, n, centroid, a: a.clone(), b: b.clone(), c: c.clone(), isEdge: false });
  }

  const broadNormal = new THREE.Vector3();
  tris.forEach(t => {
    if (t.area > maxArea * 0.15) {
      const sign = (broadNormal.lengthSq() > 0 && t.n.dot(broadNormal) < 0) ? -1 : 1;
      broadNormal.addScaledVector(t.n, sign * t.area);
    }
  });
  broadNormal.normalize();

  const edgeTris = [];
  tris.forEach(t => {
    if (Math.abs(t.n.dot(broadNormal)) < 0.45) {
      t.isEdge = true;
      edgeTris.push(t);
    }
  });

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
// 6. EDGE TRACING & 90° SQUARE-TO-LINE MEASUREMENT ENGINE
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

  // Exact 90° Square direction perpendicular to the String Line toward the plate surface
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
      const hits = raycaster.intersectObject(plateMesh, false);
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
  const pos = plateMesh.geometry.attributes.position.array;
  const norm = plateMesh.geometry.attributes.normal.array;
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
  const pos = plateMesh.geometry.attributes.position.array;
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
// 7. RENDER SAVED LINES, 90° DROP BARS & CLEAN 3D TEXT LABELS
// ═══════════════════════════════════════════════════════════
function rebuildAllSavedLinesVisuals() {
  while (linesVisualGroup.children.length > 0) linesVisualGroup.remove(linesVisualGroup.children[0]);
  const layer = document.getElementById('labels-layer');
  layer.innerHTML = '';
  htmlLabels = [];

  if (topEdgeMid) addClean3DLabel('TOP', topEdgeMid, 'txt-top');
  if (fwdEdgeMid) addClean3DLabel('FWD', fwdEdgeMid, 'txt-fwd');

  if (!currentPlate || !currentPlate.lines) return;
  document.getElementById('lbl-line-count').innerText = currentPlate.lines.length;

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
    linesVisualGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([sVec, eVec]), lineMat));

    [sVec, eVec].forEach(p => {
      const dot = new THREE.Mesh(
        new THREE.SphereGeometry(isSelected ? 6 : 4, 10, 10),
        new THREE.MeshBasicMaterial({ color: 0xf43f5e, depthTest: false })
      );
      dot.position.copy(p);
      linesVisualGroup.add(dot);
    });

    if (isSelected) {
      addClean3DLabel(`${line.name} (S)`, sVec, 'txt-end');
      addClean3DLabel(`E`, eVec, 'txt-end');

      line.stations.forEach(st => {
        const pTop = new THREE.Vector3(st.linePt.x, st.linePt.y, st.linePt.z);
        const pBot = new THREE.Vector3(st.platePt.x, st.platePt.y, st.platePt.z);

        linesVisualGroup.add(new THREE.Line(
          new THREE.BufferGeometry().setFromPoints([pTop, pBot]),
          new THREE.LineBasicMaterial({ color: 0xfacc15, linewidth: 2, depthTest: false })
        ));

        const pDot = new THREE.Mesh(
          new THREE.SphereGeometry(3.5, 8, 8),
          new THREE.MeshBasicMaterial({ color: 0x38bdf8, depthTest: false })
        );
        pDot.position.copy(pTop);
        linesVisualGroup.add(pDot);

        addClean3DLabel(`${st.label}: ${st.dropHeight.toFixed(1)}`, pTop, 'txt-pt');
      });
    }
  });

  updateMeasurementTableUI(selectedLineObj);
}

function addClean3DLabel(text, pos3D, cssClass) {
  const el = document.createElement('div');
  el.className = `clean-3d-text ${cssClass}`;
  el.innerText = text;
  document.getElementById('labels-layer').appendChild(el);
  htmlLabels.push({ el, pos3D: pos3D.clone() });
}

function updateHTMLLabels() {
  if (!camera) return;
  const w = window.innerWidth, h = window.innerHeight;
  htmlLabels.forEach(item => {
    const v = item.pos3D.clone().project(camera);
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
  const titleEl = document.getElementById('tbl-line-title');
  const traceEl = document.getElementById('tbl-trace-info');
  const tbody = document.getElementById('tbl-points-body');
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
// 8. ZOOM-SAFE POINT PICKER + MAGNIFIER LOUPE
// ═══════════════════════════════════════════════════════════
function findPlatePointAtScreen(cx, cy) {
  if (!plateMesh || !camera || !renderer) return null;
  const rect = renderer.domElement.getBoundingClientRect();
  const nx = ((cx - rect.left) / rect.width) * 2 - 1;
  const ny = -((cy - rect.top) / rect.height) * 2 + 1;

  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(new THREE.Vector2(nx, ny), camera);
  const hits = raycaster.intersectObject(plateMesh, false);
  if (hits.length > 0) return hits[0].point.clone();

  const pos = plateMesh.geometry.attributes.position.array;
  const tmp = new THREE.Vector3(), proj = new THREE.Vector3();
  let bestPx = 32, bestPt = null;
  for (let i = 0; i < pos.length; i += 3) {
    tmp.set(pos[i], pos[i + 1], pos[i + 2]);
    proj.copy(tmp).project(camera);
    if (proj.z > 1 || proj.z < -1) continue;
    const sx = (proj.x * 0.5 + 0.5) * rect.width + rect.left;
    const sy = (-proj.y * 0.5 + 0.5) * rect.height + rect.top;
    const d = Math.hypot(sx - cx, sy - cy);
    if (d < bestPx) { bestPx = d; bestPt = tmp.clone(); }
  }
  return bestPt;
}

function updateMagnifier(cx, cy) {
  const magEl = document.getElementById('magnifier');
  const magCanvas = document.getElementById('mag-canvas');
  magEl.style.display = 'block';
  magEl.style.left = cx + 'px';
  magEl.style.top = cy + 'px';

  renderer.render(scene, camera);
  const ctx = magCanvas.getContext('2d');
  const src = renderer.domElement;
  const dpr = renderer.getPixelRatio();
  const rect = src.getBoundingClientRect();
  const sx = (cx - rect.left) * dpr;
  const sy = (cy - rect.top) * dpr;
  const sample = 44 * dpr;

  ctx.clearRect(0, 0, magCanvas.width, magCanvas.height);
  ctx.drawImage(src, sx - sample / 2, sy - sample / 2, sample, sample, 0, 0, magCanvas.width, magCanvas.height);
}

function setupInteractions() {
  const dom = renderer.domElement;
  let isPickingDrag = false;
  let lastX = 0, lastY = 0;
  let pendingPt = null;

  async function handleReleasePick() {
    if (!isPickingDrag) return;
    isPickingDrag = false;
    document.getElementById('magnifier').style.display = 'none';

    const pt = pendingPt || findPlatePointAtScreen(lastX, lastY);
    pendingPt = null;

    if (!pt) {
      setMode('view', '⚠️ Missed plate. Zoom & tap "Create Line" again');
      return;
    }

    if (mode === 'pick_start') {
      tempStartPt = pt.clone();
      while (tempPickGroup.children.length > 0) tempPickGroup.remove(tempPickGroup.children[0]);
      const dot = new THREE.Mesh(
        new THREE.SphereGeometry(6, 10, 10),
        new THREE.MeshBasicMaterial({ color: 0xf43f5e, depthTest: false })
      );
      dot.position.copy(tempStartPt);
      tempPickGroup.add(dot);

      setMode('view', '✅ Start (S) Locked! Zoom to End Point, then tap "Pick End (2/2)"');
    } else if (mode === 'pick_end' && tempStartPt) {
      while (tempPickGroup.children.length > 0) tempPickGroup.remove(tempPickGroup.children[0]);

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

      await dbSavePlate(currentPlate);
      rebuildAllSavedLinesVisuals();

      document.getElementById('table-wrapper').classList.remove('collapsed');
      setMode('view', `✅ ${newLine.name} Created & Saved!`);
    }
  }

  dom.addEventListener('pointerdown', (e) => {
    lastX = e.clientX; lastY = e.clientY;
    if (mode === 'pick_start' || mode === 'pick_end') {
      e.stopImmediatePropagation();
      isPickingDrag = true;
      controls.enabled = false;
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
// 9. UI MODES, SAVED PLATES & MULTI-LINE MANAGER
// ═══════════════════════════════════════════════════════════
function setMode(newMode, customMsg) {
  mode = newMode;
  document.getElementById('magnifier').style.display = 'none';

  const btnCreate = document.getElementById('btn-create-line');
  const btnUndo = document.getElementById('btn-undo-pt');
  const banner = document.getElementById('mode-banner');

  btnCreate.classList.remove('pick-armed', 'active');
  btnUndo.classList.toggle('hidden', !tempStartPt);

  if (newMode === 'pick_start') {
    controls.enabled = false;
    btnCreate.classList.add('pick-armed');
    btnCreate.innerText = '🎯 Touch Start (1/2)';
    banner.innerText = customMsg || '🎯 Touch & release on Start Point (Magnifier Active)';
    banner.style.borderColor = '#10b981'; banner.style.color = '#6ee7b7';
  } else if (newMode === 'pick_end') {
    controls.enabled = false;
    btnCreate.classList.add('pick-armed');
    btnCreate.innerText = '🎯 Touch End (2/2)';
    banner.innerText = customMsg || '🎯 Touch & release on End Point';
    banner.style.borderColor = '#10b981'; banner.style.color = '#6ee7b7';
  } else {
    controls.enabled = true;
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
  closeAllSheets();
  document.getElementById('modal-backdrop').classList.add('open');
  document.getElementById(id).classList.add('open');
}

window.closeAllSheets = function() {
  document.getElementById('modal-backdrop').classList.remove('open');
  document.querySelectorAll('.sheet-drawer').forEach(el => el.classList.remove('open'));
};

function renderLinesManager() {
  const container = document.getElementById('lines-list-container');
  container.innerHTML = '';

  if (!currentPlate || !currentPlate.lines || currentPlate.lines.length === 0) {
    container.innerHTML = '<p style="font-size:12px; color:#94a3b8; text-align:center; padding:14px;">No lines drawn on this plate yet.</p>';
    return;
  }

  currentPlate.lines.forEach((line) => {
    const isSel = (line.id === activeLineId);
    const card = document.createElement('div');
    card.className = 'list-card' + (isSel ? ' selected' : '');
    card.innerHTML = `
      <div class="list-card-info" onclick="selectSavedLine('${line.id}')">
        <div class="list-card-title">${line.name} (${line.totalLength.toFixed(0)} mm)</div>
        <div class="list-card-sub">${line.stations.length} pts • ${line.startTrace.edgeLabel}</div>
      </div>
      <div class="card-actions">
        <button class="icon-btn ${line.visible ? 'primary' : ''}" onclick="toggleLineVisibility('${line.id}')">${line.visible ? '👁️ On' : '🙈 Off'}</button>
        <button class="icon-btn danger" onclick="deleteSavedLine('${line.id}')">🗑️</button>
      </div>
    `;
    container.appendChild(card);
  });
}

window.selectSavedLine = async function(lineId) {
  if (!currentPlate) return;
  activeLineId = lineId;
  const line = currentPlate.lines.find(l => l.id === lineId);
  if (line) line.visible = true;
  await dbSavePlate(currentPlate);
  rebuildAllSavedLinesVisuals();
  document.getElementById('table-wrapper').classList.remove('collapsed');
  closeAllSheets();
};

window.toggleLineVisibility = async function(lineId) {
  if (!currentPlate) return;
  const line = currentPlate.lines.find(l => l.id === lineId);
  if (line) {
    line.visible = !line.visible;
    if (line.visible) activeLineId = line.id;
    await dbSavePlate(currentPlate);
    rebuildAllSavedLinesVisuals();
    renderLinesManager();
  }
};

window.deleteSavedLine = async function(lineId) {
  if (!currentPlate) return;
  currentPlate.lines = currentPlate.lines.filter(l => l.id !== lineId);
  if (activeLineId === lineId) {
    activeLineId = currentPlate.lines.length > 0 ? currentPlate.lines[currentPlate.lines.length - 1].id : null;
  }
  await dbSavePlate(currentPlate);
  rebuildAllSavedLinesVisuals();
  renderLinesManager();
};

async function renderSavedPlatesList() {
  const container = document.getElementById('plates-list-container');
  container.innerHTML = '<p style="font-size:12px; color:#94a3b8;">Loading saved plates...</p>';
  const plates = await dbGetAllPlates();
  plates.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

  container.innerHTML = '';
  if (plates.length === 0) {
    container.innerHTML = '<p style="font-size:12px; color:#94a3b8; text-align:center; padding:14px;">No saved plates found. Select a plate from Viewer first.</p>';
    return;
  }

  plates.forEach(p => {
    const isCurrent = (currentPlate && currentPlate.id === p.id);
    const card = document.createElement('div');
    card.className = 'list-card' + (isCurrent ? ' selected' : '');
    card.innerHTML = `
      <div class="list-card-info" onclick="openSavedPlateById('${p.id}')">
        <div class="list-card-title">${p.plateNo || 'Plate'} — ${p.name}</div>
        <div class="list-card-sub">${(p.lines || []).length} saved lines • ${new Date(p.updatedAt).toLocaleDateString()}</div>
      </div>
      <div class="card-actions">
        <button class="icon-btn primary" onclick="openSavedPlateById('${p.id}')">Open</button>
        <button class="icon-btn danger" onclick="removeSavedPlate('${p.id}')">🗑️</button>
      </div>
    `;
    container.appendChild(card);
  });
}

window.openSavedPlateById = async function(id) {
  const plates = await dbGetAllPlates();
  const target = plates.find(p => p.id === id);
  if (target) {
    loadPlateRecord(target);
    closeAllSheets();
  }
};

window.removeSavedPlate = async function(id) {
  await dbDeletePlate(id);
  renderSavedPlatesList();
};

function setupUI() {
  document.getElementById('btn-create-line').addEventListener('click', () => {
    if (!currentPlate) return;
    if (mode === 'pick_start' || mode === 'pick_end') {
      setMode('view');
      return;
    }
    if (!tempStartPt) setMode('pick_start');
    else setMode('pick_end');
  });

  document.getElementById('btn-undo-pt').addEventListener('click', () => {
    tempStartPt = null;
    while (tempPickGroup.children.length > 0) tempPickGroup.remove(tempPickGroup.children[0]);
    setMode('view', '↩ Start point cancelled.');
  });

  document.getElementById('btn-toggle-table').addEventListener('click', () => {
    document.getElementById('table-wrapper').classList.toggle('collapsed');
  });

  document.getElementById('btn-open-lines').addEventListener('click', () => {
    renderLinesManager();
    openSheet('sheet-lines');
  });

  document.getElementById('btn-open-plates').addEventListener('click', () => {
    renderSavedPlatesList();
    openSheet('sheet-plates');
  });
  document.getElementById('btn-welcome-saved').addEventListener('click', () => {
    renderSavedPlatesList();
    openSheet('sheet-plates');
  });

  document.getElementById('btn-open-save-plate').addEventListener('click', () => {
    if (!currentPlate) return;
    openSheet('sheet-save-plate');
  });

  document.getElementById('btn-confirm-save-plate').addEventListener('click', async () => {
    if (!currentPlate) return;
    currentPlate.plateNo = document.getElementById('inp-plate-no').value.trim() || 'Plate';
    currentPlate.name = document.getElementById('inp-plate-name').value.trim() || 'Shell Plate';
    currentPlate.updatedAt = Date.now();
    await dbSavePlate(currentPlate);
    document.getElementById('plate-badge').innerText = `${currentPlate.plateNo}: ${currentPlate.name}`;
    closeAllSheets();
    setMode('view', `💾 Saved as ${currentPlate.plateNo}: ${currentPlate.name}`);
  });

  document.getElementById('btn-open-settings').addEventListener('click', () => openSheet('sheet-settings'));
  document.getElementById('btn-apply-settings').addEventListener('click', async () => {
    const val = parseFloat(document.getElementById('inp-pitch').value);
    if (val >= 50) {
      divisionPitch = val;
      if (currentPlate && currentPlate.lines) {
        currentPlate.lines.forEach(line => {
          const sVec = new THREE.Vector3(line.start.x, line.start.y, line.start.z);
          const eVec = new THREE.Vector3(line.end.x, line.end.y, line.end.z);
          const calc = calculateLineSquareMeasurements(sVec, eVec, divisionPitch);
          line.stations = calc.stations;
        });
        await dbSavePlate(currentPlate);
        rebuildAllSavedLinesVisuals();
      }
    }
    closeAllSheets();
  });

  document.getElementById('modal-backdrop').addEventListener('click', closeAllSheets);
}

window.addEventListener('DOMContentLoaded', initFormingStudioPage);
