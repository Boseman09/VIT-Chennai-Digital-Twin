/**
 * Wayfinder Graph Parser and Adjacency Engine
 * Normalized ID management, coordinate parsing, adjacency graph creation,
 * topological validation, and shortest path routing.
 */

export class WayfinderGraph {
  constructor() {
    this.waypoints = new Map(); // id (string) -> Waypoint object
    this.adjacency = new Map(); // id (string) -> Set of targetId (string)
    this.directedAdjacency = new Map();
    this.buildings = new Map(); // buildingKey -> Building object
    this.oneWayRoads = {};
    this.validationReport = {
      totalWaypoints: 0,
      totalEdges: 0,
      missingReferencedIds: [],
      isolatedWaypoints: [],
      totalBuildings: 0,
      buildingsWithValidEntrances: 0,
      buildingsWithMissingEntrances: []
    };
  }

  /**
   * Helper to normalize waypoint ID to standard string representation.
   * Handles integers, strings with leading zeros (e.g., '02' -> '2'), etc.
   */
  static normalizeId(id) {
    if (id === null || id === undefined) return '';
    const s = String(id).trim();
    if (!s) return '';
    if (/^\d+$/.test(s)) {
      return String(parseInt(s, 10));
    }
    return s;
  }

  /**
   * Parse waypoints array
   */
  loadWaypoints(rawWaypoints) {
    if (!Array.isArray(rawWaypoints)) {
      throw new Error('Raw waypoints data must be an array');
    }

    this.waypoints.clear();
    this.adjacency.clear();
    this.directedAdjacency.clear();

    for (const raw of rawWaypoints) {
      const id = WayfinderGraph.normalizeId(raw.id);
      if (!id) continue;

      const x = parseFloat(raw.x) || 0.0;
      const y = parseFloat(raw.y) || 0.0;
      const z = parseFloat(raw.z) || 0.0;
      const lat = raw.lat !== undefined ? parseFloat(raw.lat) : null;
      const lon = raw.lon !== undefined ? parseFloat(raw.lon) : null;
      const type = raw.type || 'road';

      // Support both connection and connections field names
      const rawConnections = raw.connections !== undefined ? raw.connections : raw.connection;
      let rawConnString = '';
      if (typeof rawConnections === 'string') {
        rawConnString = rawConnections;
      } else if (Array.isArray(rawConnections)) {
        rawConnString = rawConnections.join(',');
      } else if (rawConnections !== null && rawConnections !== undefined) {
        rawConnString = String(rawConnections);
      }

      const connectionTokens = rawConnString
        .split(',')
        .map(t => WayfinderGraph.normalizeId(t))
        .filter(t => t.length > 0 && t !== id);

      const wp = {
        id,
        rawId: raw.id,
        x,
        y,
        z,
        lat,
        lon,
        type,
        rawConnections: connectionTokens
      };

      this.waypoints.set(id, wp);
      this.adjacency.set(id, new Set());
      this.directedAdjacency.set(id, new Set());
    }

    this.validationReport.totalWaypoints = this.waypoints.size;
  }

  /**
   * Build adjacency graphs and validate all connections
   */
  buildGraph(rawOneWayRoads = null) {
    const missing = new Set();
    let edgeCount = 0;

    if (rawOneWayRoads) {
      this.oneWayRoads = rawOneWayRoads;
    }

    // Connect declared edges
    for (const [id, wp] of this.waypoints.entries()) {
      for (const targetId of wp.rawConnections) {
        if (!this.waypoints.has(targetId)) {
          missing.add(`${id} -> ${targetId}`);
        } else {
          // Valid edge
          this.directedAdjacency.get(id).add(targetId);
          // General pedestrian campus graph is bidirectional
          this.adjacency.get(id).add(targetId);
          this.adjacency.get(targetId).add(id);
          edgeCount++;
        }
      }
    }

    const isolated = [];
    for (const [id, neighbors] of this.adjacency.entries()) {
      if (neighbors.size === 0) {
        isolated.push(id);
      }
    }

    this.validationReport.totalEdges = edgeCount;
    this.validationReport.missingReferencedIds = Array.from(missing);
    this.validationReport.isolatedWaypoints = isolated;

    return this.validationReport;
  }

  /**
   * Load and validate building entrances
   */
  loadBuildingEntrances(rawEntrances) {
    this.buildings.clear();
    const missingEntrances = [];

    for (const [buildingKey, info] of Object.entries(rawEntrances)) {
      const displayName = info.displayName || buildingKey;
      const rawEnts = Array.isArray(info.entrances) ? info.entrances : [];
      const normalizedEnts = [];
      const validEnts = [];

      for (const ent of rawEnts) {
        const normId = WayfinderGraph.normalizeId(ent);
        normalizedEnts.push(normId);
        if (this.waypoints.has(normId)) {
          validEnts.push(normId);
        } else {
          missingEntrances.push({ buildingKey, displayName, entranceId: normId });
        }
      }

      this.buildings.set(buildingKey, {
        key: buildingKey,
        displayName,
        allEntranceIds: normalizedEnts,
        entranceIds: validEnts,
        primaryEntranceId: validEnts.length > 0 ? validEnts[0] : null
      });
    }

    this.validationReport.totalBuildings = this.buildings.size;
    this.validationReport.buildingsWithMissingEntrances = missingEntrances;
    this.validationReport.buildingsWithValidEntrances =
      this.buildings.size - (new Set(missingEntrances.map(m => m.buildingKey)).size);

    return this.validationReport;
  }

  /**
   * Euclidean distance between two waypoints in 3D
   */
  distance(idA, idB) {
    const a = this.waypoints.get(idA);
    const b = this.waypoints.get(idB);
    if (!a || !b) return Infinity;
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    const dz = a.z - b.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  /**
   * Dijkstra shortest path between two waypoint IDs
   */
  findShortestPath(startId, goalId) {
    const start = WayfinderGraph.normalizeId(startId);
    const goal = WayfinderGraph.normalizeId(goalId);

    if (!this.waypoints.has(start) || !this.waypoints.has(goal)) {
      return null;
    }
    if (start === goal) {
      return { path: [start], distanceMeters: 0, waypoints: [this.waypoints.get(start)] };
    }

    const distances = new Map();
    const previous = new Map();
    const unvisited = new Set(this.waypoints.keys());

    for (const id of this.waypoints.keys()) {
      distances.set(id, Infinity);
    }
    distances.set(start, 0);

    while (unvisited.size > 0) {
      // Find smallest unvisited
      let current = null;
      let minDistance = Infinity;
      for (const id of unvisited) {
        const d = distances.get(id);
        if (d < minDistance) {
          minDistance = d;
          current = id;
        }
      }

      if (current === null || minDistance === Infinity) break;
      if (current === goal) break;

      unvisited.delete(current);

      const neighbors = this.adjacency.get(current) || [];
      for (const neighbor of neighbors) {
        if (!unvisited.has(neighbor)) continue;
        const weight = this.distance(current, neighbor);
        const alt = distances.get(current) + weight;
        if (alt < distances.get(neighbor)) {
          distances.set(neighbor, alt);
          previous.set(neighbor, current);
        }
      }
    }

    if (!previous.has(goal) && start !== goal) {
      return null; // No path found
    }

    const path = [];
    let curr = goal;
    while (curr !== undefined) {
      path.unshift(curr);
      curr = previous.get(curr);
    }

    const totalDistance = distances.get(goal);
    const waypointObjects = path.map(id => this.waypoints.get(id));

    return {
      path,
      distanceMeters: Math.round(totalDistance * 10) / 10,
      waypoints: waypointObjects
    };
  }

  /**
   * Find paths from start to multiple designated exit gates
   */
  findEvacuationRoutes(startId, exitIds = ['111', '188', '33']) {
    const start = WayfinderGraph.normalizeId(startId);
    const routes = [];

    for (const exit of exitIds) {
      const normExit = WayfinderGraph.normalizeId(exit);
      const res = this.findShortestPath(start, normExit);
      if (res) {
        routes.push({
          exitId: normExit,
          ...res
        });
      }
    }

    // Sort by shortest distance
    routes.sort((a, b) => a.distanceMeters - b.distanceMeters);
    return routes;
  }
}
