import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export class CampusScene {
  constructor(canvasContainer, options = {}) {
    this.container = canvasContainer;
    this.callbacks = {
      onProgress: options.onProgress || (() => {}),
      onLoaded: options.onLoaded || (() => {}),
      onError: options.onError || (() => {}),
      onBuildingClick: options.onBuildingClick || (() => {}),
      onBuildingHover: options.onBuildingHover || (() => {})
    };

    // State
    this.buildingMeshes = new Map(); // normalizedKey -> Mesh/Object3D
    this.selectedBuildingMesh = null;
    this.originalMaterials = new Map();
    this.hoveredBuildingKey = null;

    // Camera animation state
    this.isTransitioningCamera = false;
    this.cameraAnim = null;

    // Default frame state
    this.defaultCameraPos = new THREE.Vector3(0, 750, 1050);
    this.defaultTarget = new THREE.Vector3(0, 0, 0);

    this.init();
  }

  init() {
    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;

    // 1. Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a0f1d);
    this.scene.fog = new THREE.FogExp2(0x0a0f1d, 0.00035);

    // 2. Camera
    this.camera = new THREE.PerspectiveCamera(45, width / height, 1, 10000);
    this.camera.position.copy(this.defaultCameraPos);

    // 3. Renderer
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
      alpha: false
    });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.container.appendChild(this.renderer.domElement);

    // 4. Controls
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.screenSpacePanning = false;
    this.controls.minDistance = 15;
    this.controls.maxDistance = 4500;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.02; // Keep camera above ground
    this.controls.target.copy(this.defaultTarget);

    // 5. Lighting
    this.setupLighting();

    // 6. Subtle Ground Grid
    this.setupGroundHelpers();

    // 7. Raycaster
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2(-999, -999);
    this.setupInteractions();

    // 8. Resize Listener
    this.onWindowResize = this.onWindowResize.bind(this);
    window.addEventListener('resize', this.onWindowResize);

    // 9. Render Loop
    this.animate = this.animate.bind(this);
    this.clock = new THREE.Clock();
    requestAnimationFrame(this.animate);
  }

  setupLighting() {
    // Ambient light
    const ambient = new THREE.AmbientLight(0xffffff, 0.9);
    this.scene.add(ambient);

    // Hemisphere light (sky vs ground tint)
    const hemiLight = new THREE.HemisphereLight(0xbad2ff, 0x1f293d, 0.85);
    hemiLight.position.set(0, 500, 0);
    this.scene.add(hemiLight);

    // Sun directional light
    const sunLight = new THREE.DirectionalLight(0xfff5ea, 1.6);
    sunLight.position.set(400, 800, 450);
    this.scene.add(sunLight);

    // Fill light
    const fillLight = new THREE.DirectionalLight(0x7399db, 0.6);
    fillLight.position.set(-400, 400, -350);
    this.scene.add(fillLight);
  }

  setupGroundHelpers() {
    // Grid helper covering campus area
    const grid = new THREE.GridHelper(3000, 60, 0x1e293b, 0x141e2e);
    grid.position.y = -1.5;
    this.scene.add(grid);
  }

  /**
   * Load the campus 3D GLB model with progress and error handling
   */
  loadCampusModel(glbUrl = '/vit_map.glb') {
    const loader = new GLTFLoader();

    loader.load(
      glbUrl,
      (gltf) => {
        this.campusRoot = gltf.scene;
        this.scene.add(this.campusRoot);

        // Analyze and map building meshes
        this.processModelMeshes(gltf.scene);

        // Frame campus in view
        this.frameCampusView();

        if (this.callbacks.onLoaded) {
          this.callbacks.onLoaded({
            scene: gltf.scene,
            buildingsFound: this.buildingMeshes.size
          });
        }
      },
      (xhr) => {
        if (xhr.lengthComputable && xhr.total > 0) {
          const percent = Math.round((xhr.loaded / xhr.total) * 100);
          this.callbacks.onProgress({
            loaded: xhr.loaded,
            total: xhr.total,
            percent
          });
        } else {
          // Estimated fallback for chunked transfer
          this.callbacks.onProgress({
            loaded: xhr.loaded,
            total: 20313904, // 20.3MB vit_map.glb
            percent: Math.min(99, Math.round((xhr.loaded / 20313904) * 100))
          });
        }
      },
      (error) => {
        console.error('Failed to load campus GLB model:', error);
        if (this.callbacks.onError) {
          this.callbacks.onError(error);
        }
      }
    );
  }

  /**
   * Traverse model and index building meshes
   */
  processModelMeshes(root) {
    this.buildingMeshes.clear();
    this.clickableObjects = [];

    root.traverse((child) => {
      // Find building key by checking child and its parents
      let normKey = null;
      let matchingNode = null;
      let curr = child;

      while (curr && curr !== root) {
        normKey = this.normalizeBuildingName(curr.name);
        if (normKey) {
          matchingNode = curr;
          break;
        }
        curr = curr.parent;
      }

      if (normKey && child.isMesh) {
        child.userData.buildingKey = normKey;
        child.userData.rawMeshName = matchingNode ? matchingNode.name : child.name;

        // Optimize materials
        if (child.material) {
          child.material.roughness = 0.7;
          child.material.metalness = 0.1;
        }

        // Cache original material
        this.originalMaterials.set(child.uuid, child.material);
        this.buildingMeshes.set(normKey, child);
        this.clickableObjects.push(child);
      }
    });

    console.log(`Indexed ${this.buildingMeshes.size} building meshes in 3D scene.`);
  }

  normalizeBuildingName(name) {
    if (!name || typeof name !== 'string') return null;
    const trimmed = name.trim();
    if (trimmed === 'Main_Gate') return 'Main_Gate';
    if (trimmed === 'Gate') return 'Gate';
    if (trimmed === 'Building') return 'Building';

    // Handles 'Building.024', 'Building.001', 'Building024', etc.
    const match = trimmed.match(/^Building\.?(\d+)$/i);
    if (match) {
      return `Building${match[1]}`;
    }
    return null;
  }

  /**
   * Frame campus bounding box smoothly on initial load
   */
  frameCampusView() {
    if (!this.campusRoot) return;

    const bbox = new THREE.Box3().setFromObject(this.campusRoot);
    const center = new THREE.Vector3();
    const size = new THREE.Vector3();
    bbox.getCenter(center);
    bbox.getSize(size);

    const maxDim = Math.max(size.x, size.z);
    const cameraDistance = maxDim * 0.9;
    const cameraHeight = maxDim * 0.55;

    this.defaultTarget.copy(center);
    this.defaultCameraPos.set(center.x, center.y + cameraHeight, center.z + cameraDistance);

    this.camera.position.copy(this.defaultCameraPos);
    this.controls.target.copy(this.defaultTarget);
    this.controls.update();

    console.log('Campus framed:', { center, size, defaultCameraPos: this.defaultCameraPos });
  }

  /**
   * Reset camera smoothly back to default campus overview
   */
  resetCamera(duration = 1000) {
    this.animateCameraTo(this.defaultCameraPos, this.defaultTarget, duration);
  }

  /**
   * Top-down plan view
   */
  setTopDownView(duration = 1000) {
    const topPos = new THREE.Vector3(
      this.defaultTarget.x,
      this.defaultTarget.y + 1400,
      this.defaultTarget.z + 0.1 // slight epsilon to avoid gimbal lock
    );
    this.animateCameraTo(topPos, this.defaultTarget, duration);
  }

  /**
   * Focus camera on a specific building
   */
  focusBuilding(buildingKey, duration = 1200) {
    const mesh = this.buildingMeshes.get(buildingKey);
    if (!mesh) {
      console.warn(`Mesh for building ${buildingKey} not found in 3D scene.`);
      return;
    }

    const bbox = new THREE.Box3().setFromObject(mesh);
    const center = new THREE.Vector3();
    const size = new THREE.Vector3();
    bbox.getCenter(center);
    bbox.getSize(size);

    const radius = Math.max(size.x, size.z, size.y, 35);
    const targetPos = new THREE.Vector3(
      center.x + radius * 1.4,
      center.y + radius * 1.1 + 25,
      center.z + radius * 1.5
    );

    this.highlightBuildingMesh(buildingKey);
    this.animateCameraTo(targetPos, center, duration);
  }

  /**
   * Focus camera on arbitrary position
   */
  focusPosition(pos, distance = 120, duration = 1000) {
    const targetPos = new THREE.Vector3(pos.x + distance, pos.y + distance * 0.8, pos.z + distance);
    const lookAt = new THREE.Vector3(pos.x, pos.y, pos.z);
    this.animateCameraTo(targetPos, lookAt, duration);
  }

  /**
   * Visually highlight a building mesh with emissive glow
   */
  highlightBuildingMesh(buildingKey) {
    // Restore previous
    if (this.selectedBuildingMesh) {
      const origMat = this.originalMaterials.get(this.selectedBuildingMesh.uuid);
      if (origMat) {
        this.selectedBuildingMesh.material = origMat;
      }
      this.selectedBuildingMesh = null;
    }

    if (!buildingKey) return;

    const mesh = this.buildingMeshes.get(buildingKey);
    if (mesh) {
      this.selectedBuildingMesh = mesh;
      const origMat = this.originalMaterials.get(mesh.uuid);

      // Clone material with bright cyan/amber accent
      if (origMat) {
        const highlightMat = origMat.clone();
        highlightMat.emissive = new THREE.Color(buildingKey === 'Building024' ? 0x00d4ff : 0xf59e0b);
        highlightMat.emissiveIntensity = 0.45;
        mesh.material = highlightMat;
      }
    }
  }

  /**
   * Smooth camera animation
   */
  animateCameraTo(targetPos, targetLookAt, duration = 1000) {
    const startPos = this.camera.position.clone();
    const startTarget = this.controls.target.clone();
    const startTime = performance.now();

    this.isTransitioningCamera = true;
    this.cameraAnim = {
      startPos,
      targetPos: targetPos.clone(),
      startTarget,
      targetLookAt: targetLookAt.clone(),
      startTime,
      duration
    };
  }

  setupInteractions() {
    const dom = this.renderer.domElement;

    dom.addEventListener('pointermove', (e) => {
      const rect = dom.getBoundingClientRect();
      this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      this.checkHover();
    });

    dom.addEventListener('click', (e) => {
      const rect = dom.getBoundingClientRect();
      this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      this.checkClick(e);
    });
  }

  checkHover() {
    if (!this.clickableObjects || this.clickableObjects.length === 0) return;
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const intersects = this.raycaster.intersectObjects(this.clickableObjects, false);

    if (intersects.length > 0) {
      const hit = intersects[0].object;
      const bKey = hit.userData.buildingKey;
      if (bKey && bKey !== this.hoveredBuildingKey) {
        this.hoveredBuildingKey = bKey;
        this.container.style.cursor = 'pointer';
        if (this.callbacks.onBuildingHover) {
          this.callbacks.onBuildingHover(bKey, hit.userData.rawMeshName);
        }
      }
    } else {
      if (this.hoveredBuildingKey) {
        this.hoveredBuildingKey = null;
        this.container.style.cursor = 'default';
        if (this.callbacks.onBuildingHover) {
          this.callbacks.onBuildingHover(null, null);
        }
      }
    }
  }

  checkClick(e) {
    if (!this.clickableObjects || this.clickableObjects.length === 0) return;
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const intersects = this.raycaster.intersectObjects(this.clickableObjects, false);

    if (intersects.length > 0) {
      const hit = intersects[0].object;
      const bKey = hit.userData.buildingKey;
      if (bKey && this.callbacks.onBuildingClick) {
        this.callbacks.onBuildingClick(bKey, hit);
      }
    }
  }

  onWindowResize() {
    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  animate() {
    requestAnimationFrame(this.animate);

    // Update smooth camera transition
    if (this.isTransitioningCamera && this.cameraAnim) {
      const now = performance.now();
      const elapsed = now - this.cameraAnim.startTime;
      const progress = Math.min(1, elapsed / this.cameraAnim.duration);

      // Smooth easeInOutCubic
      const ease = progress < 0.5
        ? 4 * progress * progress * progress
        : 1 - Math.pow(-2 * progress + 2, 3) / 2;

      this.camera.position.lerpVectors(this.cameraAnim.startPos, this.cameraAnim.targetPos, ease);
      this.controls.target.lerpVectors(this.cameraAnim.startTarget, this.cameraAnim.targetLookAt, ease);

      if (progress >= 1) {
        this.isTransitioningCamera = false;
        this.cameraAnim = null;
      }
    }

    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}
