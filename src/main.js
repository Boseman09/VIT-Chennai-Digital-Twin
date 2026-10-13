import { CampusScene } from './scene.js';
import { WayfinderGraph } from './graph.js';
import { NavigationView } from './navigationView.js';
import { TwinSimulationEngine } from './twinSimulation.js';
import { UIController } from './ui.js';

async function bootstrap() {
  const canvasContainer = document.getElementById('canvas-container');

  // 1. Initialize Wayfinder Graph
  const graph = new WayfinderGraph();

  // 2. Fetch and parse Wayfinder datasets
  try {
    const [waypointsRes, entrancesRes, oneWayRes] = await Promise.all([
      fetch('/waypoints.json'),
      fetch('/buildingEntrances.json'),
      fetch('/oneWayRoads.json')
    ]);

    const rawWaypoints = await waypointsRes.json();
    const rawEntrances = await entrancesRes.json();
    const rawOneWayRoads = await oneWayRes.json();

    graph.loadWaypoints(rawWaypoints);
    const graphStats = graph.buildGraph(rawOneWayRoads);
    const entranceStats = graph.loadBuildingEntrances(rawEntrances);

    console.log('Wayfinder Graph & Entrances Validated:', {
      graphStats,
      entranceStats
    });
  } catch (err) {
    console.error('Failed to load Wayfinder datasets:', err);
  }

  // 3. Initialize Twin Simulation Engine for Mahatma Gandhi Auditorium (Building024)
  const twinEngine = new TwinSimulationEngine({
    capacity: 2400,
    moderateThreshold: 50,
    highThreshold: 80,
    initialOccupancy: 1480,
    isLive: true
  });

  // 4. Initialize Three.js 3D Campus Scene
  let ui = null;
  let navView = null;

  const scene = new CampusScene(canvasContainer, {
    onProgress: (p) => {
      if (ui) {
        ui.updateLoading(
          Math.min(95, Math.round(p.percent * 0.95)),
          `Loading 3D Campus Geometry (${(p.loaded / (1024 * 1024)).toFixed(1)} MB / 20.3 MB)...`
        );
      }
    },
    onLoaded: ({ buildingsFound }) => {
      console.log(`GLB Loaded: Found ${buildingsFound} building meshes.`);

      // Create Navigation View overlay once scene is ready
      navView = new NavigationView(scene.scene, graph);

      // Register navView update loop into scene animation
      const originalAnimate = scene.animate;
      scene.animate = () => {
        if (navView) {
          navView.update(scene.clock.getElapsedTime());
        }
        originalAnimate();
      };

      // Connect UI controller
      ui = new UIController({
        scene,
        graph,
        navView,
        twinEngine
      });

      // Expose to window for testing/verification
      window.__campusScene = scene;
      window.__wayfinderGraph = graph;
      window.__twinEngine = twinEngine;
      window.__ui = ui;

      // Finish loading bar and focus Auditorium by default
      ui.updateLoading(100, 'Campus 3D Twin Ready!');
      setTimeout(() => {
        ui.selectBuilding('Building024');
      }, 700);
    },
    onError: (err) => {
      console.error('Error loading campus GLB:', err);
      const loadingText = document.getElementById('loading-text');
      if (loadingText) {
        loadingText.innerHTML = `<span style="color: #ef4444;">Failed to load campus GLB model: ${err.message || 'Network error'}. Please refresh or verify asset path.</span>`;
      }
    }
  });

  // Start model loading
  scene.loadCampusModel('/vit_map.glb');
}

// Launch application
window.addEventListener('DOMContentLoaded', bootstrap);
