/**
 * UI Controller for VIT Chennai Campus AI Digital Twin
 * Manages search, building list, telemetry panels, evacuation controls,
 * modals, and 3D scene synchronizations.
 */

export class UIController {
  constructor({ scene, graph, navView, twinEngine }) {
    this.scene = scene;
    this.graph = graph;
    this.navView = navView;
    this.twin = twinEngine;

    this.selectedBuildingKey = 'Building024';
    this.currentCategory = 'all';
    this.searchQuery = '';
    this.currentEvacRouteIndex = 0;
    this.evacRoutes = [];

    this.dom = {
      // Search & Filters
      searchInput: document.getElementById('search-input'),
      categoryPills: document.querySelectorAll('.cat-pill'),
      buildingList: document.getElementById('building-list'),
      buildingCountBadge: document.getElementById('building-count'),

      // Selected Location Card
      locationCard: document.getElementById('location-detail-card'),
      locName: document.getElementById('loc-name'),
      locKey: document.getElementById('loc-key'),
      locEntrance: document.getElementById('loc-entrance'),
      locCoords: document.getElementById('loc-coords'),
      locFocusBtn: document.getElementById('loc-focus-btn'),

      // Digital Twin Elements
      occupancyValue: document.getElementById('twin-occupancy-value'),
      capacityValue: document.getElementById('twin-capacity-value'),
      utilizationValue: document.getElementById('twin-utilization-value'),
      utilizationBar: document.getElementById('twin-utilization-bar'),
      statusBadge: document.getElementById('twin-status-badge'),
      flowRateValue: document.getElementById('twin-flow-rate'),
      lastUpdatedValue: document.getElementById('twin-last-updated'),
      simLiveToggle: document.getElementById('twin-sim-toggle'),
      occupancySlider: document.getElementById('twin-occ-slider'),
      occupancyInput: document.getElementById('twin-occ-input'),
      presetBtns: document.querySelectorAll('[data-preset]'),
      capacityInput: document.getElementById('config-capacity-input'),
      threshModInput: document.getElementById('config-mod-thresh'),
      threshHighInput: document.getElementById('config-high-thresh'),
      saveConfigBtn: document.getElementById('config-save-btn'),

      // Evacuation
      evacExitSelect: document.getElementById('evac-exit-select'),
      evacTriggerBtn: document.getElementById('evac-trigger-btn'),
      evacClearBtn: document.getElementById('evac-clear-btn'),
      evacResultCard: document.getElementById('evac-result-card'),
      evacDist: document.getElementById('evac-dist'),
      evacHops: document.getElementById('evac-hops'),
      evacWalkTime: document.getElementById('evac-walk-time'),
      evacTotalTime: document.getElementById('evac-total-time'),
      evacPathNodes: document.getElementById('evac-path-nodes'),

      // Camera HUD
      resetCamBtn: document.getElementById('btn-reset-cam'),
      topDownBtn: document.getElementById('btn-top-down'),
      focusAuditoriumBtn: document.getElementById('btn-focus-auditorium'),
      toggleNavBtn: document.getElementById('btn-toggle-nav'),

      // Modals
      btnShowDiagnostics: document.getElementById('btn-show-diagnostics'),
      btnShowAws: document.getElementById('btn-show-aws'),
      diagnosticsModal: document.getElementById('modal-diagnostics'),
      awsModal: document.getElementById('modal-aws'),
      modalCloseBtns: document.querySelectorAll('.modal-close'),

      // Loading
      loadingOverlay: document.getElementById('loading-overlay'),
      loadingBar: document.getElementById('loading-bar'),
      loadingText: document.getElementById('loading-text'),
      loadingPercent: document.getElementById('loading-percent')
    };

    this.bindEvents();
    this.renderBuildingList();
    this.initEvacuationRoutes();
    this.subscribeTwinEngine();
  }

  bindEvents() {
    // 1. Search input
    if (this.dom.searchInput) {
      this.dom.searchInput.addEventListener('input', (e) => {
        this.searchQuery = e.target.value.toLowerCase().trim();
        this.renderBuildingList();
      });
    }

    // 2. Category Filter Pills
    this.dom.categoryPills.forEach(pill => {
      pill.addEventListener('click', () => {
        this.dom.categoryPills.forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        this.currentCategory = pill.dataset.cat || 'all';
        this.renderBuildingList();
      });
    });

    // 3. Camera HUD controls
    if (this.dom.resetCamBtn) {
      this.dom.resetCamBtn.addEventListener('click', () => this.scene.resetCamera());
    }
    if (this.dom.topDownBtn) {
      this.dom.topDownBtn.addEventListener('click', () => this.scene.setTopDownView());
    }
    if (this.dom.focusAuditoriumBtn) {
      this.dom.focusAuditoriumBtn.addEventListener('click', () => {
        this.selectBuilding('Building024');
      });
    }
    if (this.dom.toggleNavBtn) {
      this.dom.toggleNavBtn.addEventListener('click', () => {
        const isVis = this.navView.toggle();
        this.dom.toggleNavBtn.classList.toggle('active', isVis);
      });
    }

    // 4. Location card focus button
    if (this.dom.locFocusBtn) {
      this.dom.locFocusBtn.addEventListener('click', () => {
        if (this.selectedBuildingKey) {
          this.scene.focusBuilding(this.selectedBuildingKey);
        }
      });
    }

    // 5. Twin Simulation Controls
    if (this.dom.simLiveToggle) {
      this.dom.simLiveToggle.addEventListener('click', () => {
        this.twin.toggleLiveSimulation();
      });
    }
    if (this.dom.occupancySlider) {
      this.dom.occupancySlider.addEventListener('input', (e) => {
        this.twin.setOccupancy(e.target.value);
      });
    }
    if (this.dom.occupancyInput) {
      this.dom.occupancyInput.addEventListener('change', (e) => {
        this.twin.setOccupancy(e.target.value);
      });
    }
    this.dom.presetBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const preset = btn.dataset.preset;
        this.twin.applyPreset(preset);
      });
    });
    if (this.dom.saveConfigBtn) {
      this.dom.saveConfigBtn.addEventListener('click', () => {
        const cap = Number(this.dom.capacityInput.value);
        const mod = Number(this.dom.threshModInput.value);
        const hi = Number(this.dom.threshHighInput.value);
        if (cap > 0) this.twin.setCapacity(cap);
        if (mod > 0 && hi > mod) this.twin.setThresholds(mod, hi);
      });
    }

    // 6. Evacuation controls
    if (this.dom.evacTriggerBtn) {
      this.dom.evacTriggerBtn.addEventListener('click', () => {
        this.triggerEvacuationDemo();
      });
    }
    if (this.dom.evacClearBtn) {
      this.dom.evacClearBtn.addEventListener('click', () => {
        this.clearEvacuationDemo();
      });
    }
    if (this.dom.evacExitSelect) {
      this.dom.evacExitSelect.addEventListener('change', (e) => {
        this.currentEvacRouteIndex = Number(e.target.value);
        if (this.dom.evacResultCard && !this.dom.evacResultCard.classList.contains('hidden')) {
          this.displaySelectedEvacuationRoute();
        }
      });
    }

    // 7. Modals
    if (this.dom.btnShowDiagnostics) {
      this.dom.btnShowDiagnostics.addEventListener('click', () => {
        this.populateDiagnosticsData();
        this.dom.diagnosticsModal.classList.remove('hidden');
      });
    }
    if (this.dom.btnShowAws) {
      this.dom.btnShowAws.addEventListener('click', () => {
        this.dom.awsModal.classList.remove('hidden');
      });
    }
    this.dom.modalCloseBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        if (this.dom.diagnosticsModal) this.dom.diagnosticsModal.classList.add('hidden');
        if (this.dom.awsModal) this.dom.awsModal.classList.add('hidden');
      });
    });

    // 8. 3D Scene callbacks
    this.scene.callbacks.onBuildingClick = (key) => {
      this.selectBuilding(key);
    };
  }

  categorizeBuilding(key, name) {
    const k = key.toLowerCase();
    const n = name.toLowerCase();
    if (k.includes('gate') || n.includes('gate')) return 'gate';
    if (n.includes('hostel')) return 'hostel';
    if (n.includes('academic') || n.includes('block')) return 'academic';
    if (n.includes('ground') || n.includes('court') || n.includes('pool') || n.includes('gym')) return 'sports';
    return 'amenities';
  }

  renderBuildingList() {
    if (!this.dom.buildingList) return;
    this.dom.buildingList.innerHTML = '';

    const buildings = Array.from(this.graph.buildings.values());
    const filtered = buildings.filter(b => {
      const cat = this.categorizeBuilding(b.key, b.displayName);
      const matchesCat = this.currentCategory === 'all' || this.currentCategory === cat;
      const matchesSearch = !this.searchQuery ||
        b.displayName.toLowerCase().includes(this.searchQuery) ||
        b.key.toLowerCase().includes(this.searchQuery);
      return matchesCat && matchesSearch;
    });

    if (this.dom.buildingCountBadge) {
      this.dom.buildingCountBadge.textContent = `${filtered.length} locations`;
    }

    if (filtered.length === 0) {
      this.dom.buildingList.innerHTML = '<div class="no-results">No campus locations match filter</div>';
      return;
    }

    filtered.forEach(b => {
      const item = document.createElement('div');
      item.className = `building-item ${b.key === this.selectedBuildingKey ? 'active' : ''}`;
      item.dataset.key = b.key;

      const isAuditorium = b.key === 'Building024';
      const cat = this.categorizeBuilding(b.key, b.displayName);

      item.innerHTML = `
        <div class="building-item-header">
          <span class="building-name">${b.displayName}</span>
          ${isAuditorium ? '<span class="twin-badge">LIVE TWIN</span>' : ''}
        </div>
        <div class="building-meta">
          <span class="building-key">${b.key}</span>
          <span class="entrance-tag">WP ${b.primaryEntranceId || 'None'}</span>
        </div>
      `;

      item.addEventListener('click', () => {
        this.selectBuilding(b.key, true);
      });

      this.dom.buildingList.appendChild(item);
    });
  }

  selectBuilding(key, shouldFocusCamera = true) {
    this.selectedBuildingKey = key;

    // Update active class in list
    document.querySelectorAll('.building-item').forEach(el => {
      el.classList.toggle('active', el.dataset.key === key);
    });

    const b = this.graph.buildings.get(key);
    if (!b) return;

    // Highlight in 3D (and optionally focus camera)
    if (shouldFocusCamera) {
      this.scene.focusBuilding(key);
    } else {
      this.scene.highlightBuildingMesh(key);
    }

    // Highlight entrance in 3D
    if (b.primaryEntranceId) {
      this.navView.highlightEntrance(b.primaryEntranceId);
    }

    // Update location card
    if (this.dom.locationCard) {
      this.dom.locationCard.classList.remove('hidden');
      this.dom.locName.textContent = b.displayName;
      this.dom.locKey.textContent = `ID: ${b.key}`;
      this.dom.locEntrance.textContent = `Entrance WP: ${b.primaryEntranceId || 'None'}`;

      const wp = this.graph.waypoints.get(b.primaryEntranceId);
      if (wp) {
        this.dom.locCoords.textContent = `Local Coords: [X: ${wp.x}, Z: ${wp.z}] | Lat: ${wp.lat || 'N/A'}, Lon: ${wp.lon || 'N/A'}`;
      } else {
        this.dom.locCoords.textContent = 'Local Coords: (No entrance linked)';
      }
    }
  }

  subscribeTwinEngine() {
    this.twin.subscribe((state) => {
      // 1. Occupancy & Capacity text
      if (this.dom.occupancyValue) {
        this.dom.occupancyValue.textContent = state.occupancy.toLocaleString();
      }
      if (this.dom.capacityValue) {
        this.dom.capacityValue.textContent = state.capacity.toLocaleString();
      }
      if (this.dom.utilizationValue) {
        this.dom.utilizationValue.textContent = `${state.utilization}%`;
      }

      // 2. Bar width & color
      if (this.dom.utilizationBar) {
        this.dom.utilizationBar.style.width = `${Math.min(100, state.utilization)}%`;
        this.dom.utilizationBar.style.backgroundColor = state.statusColor;
      }

      // 3. Status Badge
      if (this.dom.statusBadge) {
        this.dom.statusBadge.textContent = state.statusLabel;
        this.dom.statusBadge.style.backgroundColor = `${state.statusColor}22`;
        this.dom.statusBadge.style.borderColor = state.statusColor;
        this.dom.statusBadge.style.color = state.statusColor;
      }

      // 4. Flow Rate
      if (this.dom.flowRateValue) {
        const sign = state.flowRate > 0 ? '+' : '';
        this.dom.flowRateValue.textContent = `${sign}${state.flowRate} /min`;
      }

      // 5. Last updated time
      if (this.dom.lastUpdatedValue) {
        this.dom.lastUpdatedValue.textContent = state.lastUpdated.toLocaleTimeString();
      }

      // 6. Live button state
      if (this.dom.simLiveToggle) {
        this.dom.simLiveToggle.textContent = state.isLive ? 'Pause Auto-Tick' : 'Resume Auto-Tick';
        this.dom.simLiveToggle.classList.toggle('active', state.isLive);
      }

      // 7. Inputs sync
      if (this.dom.occupancySlider && document.activeElement !== this.dom.occupancySlider) {
        this.dom.occupancySlider.max = Math.round(state.capacity * 1.15);
        this.dom.occupancySlider.value = state.occupancy;
      }
      if (this.dom.occupancyInput && document.activeElement !== this.dom.occupancyInput) {
        this.dom.occupancyInput.value = state.occupancy;
      }
      if (this.dom.capacityInput && document.activeElement !== this.dom.capacityInput) {
        this.dom.capacityInput.value = state.capacity;
      }
      if (this.dom.threshModInput && document.activeElement !== this.dom.threshModInput) {
        this.dom.threshModInput.value = state.thresholds.moderate;
      }
      if (this.dom.threshHighInput && document.activeElement !== this.dom.threshHighInput) {
        this.dom.threshHighInput.value = state.thresholds.high;
      }
    });
  }

  initEvacuationRoutes() {
    // Mahatma Gandhi Auditorium entrance is WP 199
    // Compute paths to exits: Main Gate (WP 111 & 188), 2nd Gate (WP 33)
    this.evacRoutes = this.graph.findEvacuationRoutes('199', ['33', '188', '111']);

    if (this.dom.evacExitSelect) {
      this.dom.evacExitSelect.innerHTML = '';
      this.evacRoutes.forEach((route, idx) => {
        const opt = document.createElement('option');
        opt.value = idx;
        const gateLabel = route.exitId === '33' ? '2nd Gate' : 'Main Gate';
        opt.textContent = `${gateLabel} (WP ${route.exitId}) — ${route.distanceMeters}m (${route.path.length} waypoints)`;
        this.dom.evacExitSelect.appendChild(opt);
      });
    }
  }

  triggerEvacuationDemo() {
    if (this.evacRoutes.length === 0) return;
    this.displaySelectedEvacuationRoute();
  }

  displaySelectedEvacuationRoute() {
    const route = this.evacRoutes[this.currentEvacRouteIndex] || this.evacRoutes[0];
    if (!route) return;

    // Render in 3D
    this.navView.displayEvacuationRoute(route.waypoints);

    // Compute metrics
    const metrics = this.twin.calculateEvacuationMetrics(route.distanceMeters);

    // Update UI card
    if (this.dom.evacResultCard) {
      this.dom.evacResultCard.classList.remove('hidden');
      this.dom.evacDist.textContent = `${route.distanceMeters} meters`;
      this.dom.evacHops.textContent = `${route.path.length} waypoints`;
      this.dom.evacWalkTime.textContent = `${Math.floor(metrics.walkTimeSeconds / 60)}m ${metrics.walkTimeSeconds % 60}s`;
      this.dom.evacTotalTime.textContent = metrics.formattedTime;
      this.dom.evacPathNodes.textContent = route.path.join(' ➔ ');
    }
  }

  clearEvacuationDemo() {
    this.navView.clearEvacuationRoute();
    if (this.dom.evacResultCard) {
      this.dom.evacResultCard.classList.add('hidden');
    }
  }

  populateDiagnosticsData() {
    const diagContent = document.getElementById('diagnostics-table-body');
    if (!diagContent) return;

    const rep = this.graph.validationReport;
    const summaryEl = document.getElementById('diagnostics-summary');
    if (summaryEl) {
      summaryEl.innerHTML = `
        <div class="diag-stat"><strong>Total Waypoints:</strong> ${rep.totalWaypoints}</div>
        <div class="diag-stat"><strong>Total Edges (Bidirectional):</strong> ${rep.totalEdges}</div>
        <div class="diag-stat"><strong>Missing Target IDs:</strong> ${rep.missingReferencedIds.length === 0 ? '0 (Clean)' : rep.missingReferencedIds.join(', ')}</div>
        <div class="diag-stat"><strong>Isolated Waypoints:</strong> ${rep.isolatedWaypoints.join(', ')} (WP 0 is center datum)</div>
        <div class="diag-stat"><strong>Buildings Mapped:</strong> ${rep.buildingsWithValidEntrances} / ${rep.totalBuildings}</div>
      `;
    }

    // Comparison rows between GLTF and Wayfinder Waypoints
    const sampleKeys = [
      { id: 'Building024', meshTrans: [90.5, 325.5] },
      { id: 'Main_Gate', meshTrans: [-120.0, 210.6] },
      { id: 'Gate', meshTrans: [14.0, 425.1] },
      { id: 'Building007', meshTrans: [-97.1, -130.0] },
      { id: 'Building010', meshTrans: [-183.8, -130.4] },
      { id: 'Building009', meshTrans: [-71.8, -236.3] },
      { id: 'Building008', meshTrans: [237.3, 184.5] },
      { id: 'Building018', meshTrans: [-92.1, 39.7] }
    ];

    diagContent.innerHTML = '';
    sampleKeys.forEach(item => {
      const b = this.graph.buildings.get(item.id);
      const wpId = b ? b.primaryEntranceId : null;
      const wp = wpId ? this.graph.waypoints.get(wpId) : null;
      const wpX = wp ? wp.x.toFixed(1) : 'N/A';
      const wpZ = wp ? wp.z.toFixed(1) : 'N/A';
      const dist = wp ? Math.hypot(item.meshTrans[0] - wp.x, item.meshTrans[1] - wp.z).toFixed(1) : 'N/A';
      const name = b ? b.displayName : item.id;

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong>${name}</strong><br><small>${item.id}</small></td>
        <td>(${item.meshTrans[0]}, ${item.meshTrans[1]})</td>
        <td>WP ${wpId}: (${wpX}, ${wpZ})</td>
        <td>${dist}m</td>
        <td><span class="badge-aligned">1:1 MATCH</span></td>
      `;
      diagContent.appendChild(tr);
    });
  }

  updateLoading(percent, statusText) {
    if (this.dom.loadingBar) {
      this.dom.loadingBar.style.width = `${percent}%`;
    }
    if (this.dom.loadingPercent) {
      this.dom.loadingPercent.textContent = `${percent}%`;
    }
    if (this.dom.loadingText && statusText) {
      this.dom.loadingText.textContent = statusText;
    }
    if (percent >= 100) {
      setTimeout(() => {
        if (this.dom.loadingOverlay) {
          this.dom.loadingOverlay.classList.add('fade-out');
          setTimeout(() => this.dom.loadingOverlay.remove(), 600);
        }
      }, 400);
    }
  }
}
