import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Ball, BALL_RADIUS } from './Ball';
import { Shaft, type ShaftSize } from './Shaft';
import { ConstraintSolver } from './ConstraintSolver';
import { Logger, LOG_ENABLED } from './Logger';

// Types for save/load functionality
interface SavedBall {
  position: { x: number; y: number; z: number };
}

interface SavedShaft {
  size: ShaftSize;
  startBallIndex: number;
  endBallIndex: number | null;
  direction: { x: number; y: number; z: number };
  color: number;
}

interface SavedStructure {
  id: string;
  name: string;
  timestamp: number;
  balls: SavedBall[];
  shafts: SavedShaft[];
}

class MagneticBuilder {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private controls: OrbitControls;
  private raycaster: THREE.Raycaster;
  private mouse: THREE.Vector2;

  private balls: Ball[] = [];
  private shafts: Shaft[] = [];
  private selectedShaftSize: ShaftSize = 'small';
  private pendingShaft: Shaft | null = null;
  private pendingBall: Ball | null = null;

  // Drag state
  private isDragging: boolean = false;
  private draggedBall: Ball | null = null;
  private dragPlane: THREE.Plane = new THREE.Plane();
  private dragOffset: THREE.Vector3 = new THREE.Vector3();
  private dragStartPositions: Map<Ball, THREE.Vector3> = new Map();
  private mouseDownPosition: THREE.Vector2 = new THREE.Vector2();
  private hasDragged: boolean = false; // True if mouse moved enough to be a drag
  private justEndedDrag: boolean = false; // Prevent click after drag
  private readonly DRAG_THRESHOLD = 5; // Pixels of movement before it's a drag

    // Preview shaft state
    private previewShaft: THREE.Group | null = null;
    private hoveredBall: Ball | null = null;
    private hoveredShaftForDeletion: Shaft | null = null;

  // Save/Load state
  private savedStructures: Map<string, SavedStructure> = new Map();
  private selectedSaveId: string | null = null;
  private readonly STORAGE_KEY = 'magnetic-builder-saves';

  // Grid snapping state
  private isShiftHeld: boolean = false;

  constructor() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1a1a1a);

    this.camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );
    this.camera.position.set(10, 10, 10);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const container = document.getElementById('canvas-container')!;
    container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;

    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();

    this.setupLighting();
    this.setupGrid();
    this.setupEventListeners();
    this.animate();
  }

  private setupLighting(): void {
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    this.scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(10, 20, 10);
    directionalLight.castShadow = true;
    directionalLight.shadow.camera.near = 0.1;
    directionalLight.shadow.camera.far = 50;
    directionalLight.shadow.camera.left = -20;
    directionalLight.shadow.camera.right = 20;
    directionalLight.shadow.camera.top = 20;
    directionalLight.shadow.camera.bottom = -20;
    this.scene.add(directionalLight);

    const hemisphereLight = new THREE.HemisphereLight(0xffffff, 0x444444, 0.3);
    this.scene.add(hemisphereLight);
  }

  private setupGrid(): void {
    const gridHelper = new THREE.GridHelper(20, 20, 0x444444, 0x222222);
    this.scene.add(gridHelper);

    const axesHelper = new THREE.AxesHelper(5);
    this.scene.add(axesHelper);
  }

  private setupEventListeners(): void {
    window.addEventListener('resize', () => this.onWindowResize());

    // Keyboard events for grid snapping modifier
    window.addEventListener('keydown', (e) => this.onKeyDown(e));
    window.addEventListener('keyup', (e) => this.onKeyUp(e));

    // Mouse events for both clicking and dragging
    window.addEventListener('mousedown', (e) => this.onMouseDown(e));
    window.addEventListener('mousemove', (e) => this.onMouseMove(e));
    window.addEventListener('mouseup', (e) => this.onMouseUp(e));

    document.getElementById('add-ball')!.addEventListener('click', () => {
      this.addBall(new THREE.Vector3(0, 0.5, 0));
    });

    document.getElementById('clear-all')!.addEventListener('click', () => {
      this.clearAll();
    });

    // Only show log button if logging is enabled
    const logButton = document.getElementById('download-log')!;
    if (LOG_ENABLED) {
      logButton.style.display = 'block';
      logButton.addEventListener('click', () => {
        Logger.copyLogsToClipboard();
      });
    } else {
      logButton.style.display = 'none';
    }

    document.querySelectorAll('.shaft-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        document.querySelectorAll('.shaft-btn').forEach(b => b.classList.remove('active'));
        target.classList.add('active');
        this.selectedShaftSize = target.dataset.size as ShaftSize;
      });
    });

    // Save/Load UI setup
    this.setupSaveLoadUI();

    // Load saved structures from localStorage
    this.loadSavedStructures();
  }

  private setupSaveLoadUI(): void {
    // Panel toggle (collapse/expand)
    document.getElementById('panel-toggle')!.addEventListener('click', () => {
      document.getElementById('save-panel')!.classList.toggle('collapsed');
    });

    // Single Save button - smart behavior
    document.getElementById('save-btn')!.addEventListener('click', () => {
      this.handleSave();
    });

    // Import button - show import modal
    document.getElementById('import-btn')!.addEventListener('click', () => {
      this.showModal('import-modal');
    });

    // Export button - show export modal
    document.getElementById('export-btn')!.addEventListener('click', () => {
      this.showModal('export-modal');
    });

    // Name modal events
    document.getElementById('name-cancel')!.addEventListener('click', () => {
      this.hideModal('name-modal');
    });

    document.getElementById('name-confirm')!.addEventListener('click', () => {
      this.confirmSaveWithName();
    });

    // Allow Enter key to confirm save name
    document.getElementById('structure-name-input')!.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter') {
        this.confirmSaveWithName();
      }
    });

    // Import modal events
    document.getElementById('import-cancel')!.addEventListener('click', () => {
      this.hideModal('import-modal');
    });

    document.getElementById('import-confirm')!.addEventListener('click', () => {
      this.confirmImport();
    });

    // File drop zone
    const dropZone = document.getElementById('file-drop-zone')!;
    dropZone.addEventListener('click', () => {
      document.getElementById('file-input')!.click();
    });

    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.classList.add('dragover');
    });

    dropZone.addEventListener('dragleave', () => {
      dropZone.classList.remove('dragover');
    });

    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('dragover');
      const files = (e as DragEvent).dataTransfer?.files;
      if (files && files[0]) {
        this.handleImportFile(files[0]);
      }
    });

    document.getElementById('file-input')!.addEventListener('change', (e) => {
      const input = e.target as HTMLInputElement;
      if (input.files && input.files[0]) {
        this.handleImportFile(input.files[0]);
        input.value = ''; // Reset for next use
      }
    });

    // Export modal events
    document.getElementById('export-cancel')!.addEventListener('click', () => {
      this.hideModal('export-modal');
    });

    document.getElementById('export-file')!.addEventListener('click', () => {
      this.exportToFile();
      this.hideModal('export-modal');
    });

    document.getElementById('export-clipboard')!.addEventListener('click', () => {
      this.exportToClipboard();
      this.hideModal('export-modal');
    });

    // Close modals when clicking overlay
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
          (overlay as HTMLElement).classList.remove('visible');
        }
      });
    });
  }

  private showModal(id: string): void {
    document.getElementById(id)!.classList.add('visible');
    // Focus first input if exists
    const input = document.querySelector(`#${id} input[type="text"], #${id} textarea`) as HTMLElement;
    if (input) {
      setTimeout(() => input.focus(), 100);
    }
  }

  private hideModal(id: string): void {
    document.getElementById(id)!.classList.remove('visible');
  }

  private handleSave(): void {
    if (this.selectedSaveId) {
      // Update existing structure
      this.updateSelectedStructure();
    } else {
      // New structure - ask for name
      (document.getElementById('structure-name-input') as HTMLInputElement).value = '';
      this.showModal('name-modal');
    }
  }

  private confirmSaveWithName(): void {
    const nameInput = document.getElementById('structure-name-input') as HTMLInputElement;
    const name = nameInput.value.trim() || `Structure ${this.savedStructures.size + 1}`;
    
    const structure = this.serializeStructure();
    structure.name = name;

    this.savedStructures.set(structure.id, structure);
    this.selectedSaveId = structure.id;

    this.persistSavedStructures();
    this.updateSavedStructuresList();
    this.updateCurrentStructureDisplay();
    this.hideModal('name-modal');
    this.showSnapInfo(`Saved: ${name}`, 1500, 'success');
  }

  private confirmImport(): void {
    const textarea = document.getElementById('json-input') as HTMLTextAreaElement;
    const json = textarea.value.trim();

    if (!json) {
      this.showSnapInfo('Paste JSON first', 2000, 'warning');
      return;
    }

    try {
      const structure = JSON.parse(json) as SavedStructure;
      this.validateAndImport(structure);
      textarea.value = '';
      this.hideModal('import-modal');
    } catch (err) {
      this.showSnapInfo('Invalid JSON format', 2000, 'error');
    }
  }

  private handleImportFile(file: File): void {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const json = e.target?.result as string;
        const structure = JSON.parse(json) as SavedStructure;
        this.validateAndImport(structure);
        this.hideModal('import-modal');
      } catch (err) {
        this.showSnapInfo('Invalid JSON file', 2000, 'error');
      }
    };
    reader.readAsText(file);
  }

  private exportToFile(): void {
    const structure = this.serializeStructure();
    const currentName = this.selectedSaveId 
      ? this.savedStructures.get(this.selectedSaveId)?.name || 'Structure'
      : 'Structure';
    structure.name = currentName;

    const json = JSON.stringify(structure, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${currentName.replace(/[^a-z0-9]/gi, '_')}.json`;
    a.click();
    URL.revokeObjectURL(url);

    this.showSnapInfo('Exported to file', 1500, 'success');
  }

  private exportToClipboard(): void {
    const structure = this.serializeStructure();
    const currentName = this.selectedSaveId 
      ? this.savedStructures.get(this.selectedSaveId)?.name || 'Structure'
      : 'Structure';
    structure.name = currentName;

    const json = JSON.stringify(structure, null, 2);
    navigator.clipboard.writeText(json).then(() => {
      this.showSnapInfo('Copied to clipboard', 1500, 'success');
    }).catch(() => {
      this.showSnapInfo('Failed to copy', 2000, 'error');
    });
  }

  private updateCurrentStructureDisplay(): void {
    const nameEl = document.getElementById('current-name')!;
    if (this.selectedSaveId) {
      const structure = this.savedStructures.get(this.selectedSaveId);
      nameEl.textContent = structure?.name || 'Unknown';
      nameEl.classList.remove('unsaved');
    } else {
      nameEl.textContent = 'Unsaved';
      nameEl.classList.add('unsaved');
    }
  }

  private onWindowResize(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Shift' && !this.isShiftHeld) {
      this.isShiftHeld = true;
      // Update preview immediately if hovering over a ball
      if (this.hoveredBall && !this.pendingShaft) {
        this.updateHoverPreview();
      }
    }
  }

  private onKeyUp(event: KeyboardEvent): void {
    if (event.key === 'Shift') {
      this.isShiftHeld = false;
      // Update preview immediately if hovering over a ball
      if (this.hoveredBall && !this.pendingShaft) {
        this.updateHoverPreview();
      }
    }
  }

  /**
   * Snap a direction vector to the nearest 3D grid direction.
   * Supports 26 directions: 6 cardinal (axes), 12 face diagonals, 8 space diagonals.
   */
  private snapDirectionToGrid(direction: THREE.Vector3): THREE.Vector3 {
    // Define all 26 possible grid directions (normalized)
    const gridDirections: THREE.Vector3[] = [
      // 6 cardinal directions (along axes)
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(-1, 0, 0),
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(0, -1, 0),
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(0, 0, -1),
      
      // 12 face diagonals (edges of cube, on axis-aligned planes)
      new THREE.Vector3(1, 1, 0).normalize(),
      new THREE.Vector3(1, -1, 0).normalize(),
      new THREE.Vector3(-1, 1, 0).normalize(),
      new THREE.Vector3(-1, -1, 0).normalize(),
      new THREE.Vector3(1, 0, 1).normalize(),
      new THREE.Vector3(1, 0, -1).normalize(),
      new THREE.Vector3(-1, 0, 1).normalize(),
      new THREE.Vector3(-1, 0, -1).normalize(),
      new THREE.Vector3(0, 1, 1).normalize(),
      new THREE.Vector3(0, 1, -1).normalize(),
      new THREE.Vector3(0, -1, 1).normalize(),
      new THREE.Vector3(0, -1, -1).normalize(),
      
      // 8 space diagonals (corners of cube)
      new THREE.Vector3(1, 1, 1).normalize(),
      new THREE.Vector3(1, 1, -1).normalize(),
      new THREE.Vector3(1, -1, 1).normalize(),
      new THREE.Vector3(1, -1, -1).normalize(),
      new THREE.Vector3(-1, 1, 1).normalize(),
      new THREE.Vector3(-1, 1, -1).normalize(),
      new THREE.Vector3(-1, -1, 1).normalize(),
      new THREE.Vector3(-1, -1, -1).normalize(),
    ];

    // Find the grid direction with the highest dot product (closest alignment)
    let bestDirection = gridDirections[0]!;
    let bestDot = direction.dot(bestDirection);

    for (let i = 1; i < gridDirections.length; i++) {
      const gridDir = gridDirections[i]!;
      const dot = direction.dot(gridDir);
      if (dot > bestDot) {
        bestDot = dot;
        bestDirection = gridDir;
      }
    }

    return bestDirection.clone();
  }

  private onMouseDown(event: MouseEvent): void {
    if (event.button !== 0) return; // Only left click

    // Store the mouse down position for drag detection
    this.mouseDownPosition.set(event.clientX, event.clientY);
    this.hasDragged = false;

    this.mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    this.mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);

    // Check for ball intersection (potential drag start)
    const ballMeshes = this.balls.map(b => b.getMesh());
    const ballIntersects = this.raycaster.intersectObjects(ballMeshes);

    if (ballIntersects.length > 0 && !this.pendingShaft) {
      // Only prepare for drag if not in shaft creation mode
      const firstHit = ballIntersects[0];
      if (firstHit) {
        const clickedBall = this.balls.find(b => b.getMesh() === firstHit.object);
        if (clickedBall) {
          this.prepareDrag(clickedBall, firstHit.point);
        }
      }
    }
  }

  private onMouseMove(event: MouseEvent): void {
    // Always update mouse position for hover preview
    this.mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    this.mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

    // Handle drag detection and execution
    if (this.draggedBall) {
      // Check if we've moved enough to start dragging
      const dx = event.clientX - this.mouseDownPosition.x;
      const dy = event.clientY - this.mouseDownPosition.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (!this.isDragging && distance >= this.DRAG_THRESHOLD) {
        // Start actual dragging
        this.startDrag();
      }

      if (this.isDragging) {
        this.raycaster.setFromCamera(this.mouse, this.camera);

        // Find intersection with drag plane
        const intersection = new THREE.Vector3();
        if (this.raycaster.ray.intersectPlane(this.dragPlane, intersection)) {
          // Calculate the new position for the dragged ball
          const newPosition = intersection.sub(this.dragOffset);

          // Calculate delta from original position
          const originalPos = this.dragStartPositions.get(this.draggedBall)!;
          const delta = newPosition.clone().sub(originalPos);

          // Move all balls in the assembly by the same delta
          this.moveAssembly(delta);

          // Update all shafts
          this.shafts.forEach(shaft => shaft.update());
        }
      }

      // Hide preview while dragging
      this.hidePreviewShaft();
      return;
    }

    // Handle hover preview (only when not creating a shaft)
    if (!this.pendingShaft) {
      this.updateHoverPreview();
    } else {
      this.hidePreviewShaft();
    }
  }

  private onMouseUp(event: MouseEvent): void {
    if (event.button !== 0) return;

    if (this.isDragging) {
      // Was dragging - just end the drag, don't process as click
      this.endDrag();
      this.justEndedDrag = true;
      // Reset the flag after a short delay to prevent click processing
      setTimeout(() => { this.justEndedDrag = false; }, 50);
      return;
    } else if (this.draggedBall) {
      // Was not dragging (didn't move enough) - treat as click
      this.cancelDrag();
      if (!this.justEndedDrag) {
        this.handleClick(event);
      }
    } else if (!this.justEndedDrag) {
      // Clicked on empty space or shaft end
      this.handleClick(event);
    }
  }

  private handleClick(event: MouseEvent): void {
    this.mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    this.mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);

    // Collect all interactive objects
    const allObjects: THREE.Object3D[] = [];
    
    // Add ball meshes
    const ballMeshes = this.balls.map(b => b.getMesh());
    allObjects.push(...ballMeshes);
    
    // Add shaft end magnets (for unconnected shafts)
    this.shafts.forEach(shaft => {
      if (!shaft.isFullyConnected()) {
        allObjects.push(shaft.getEndMagnet());
      }
    });
    
    // Add shaft meshes (for deletion)
    const shaftGroups = this.shafts.map(s => s.getMesh());
    allObjects.push(...shaftGroups);

    // Single raycast to find closest hit
    const intersects = this.raycaster.intersectObjects(allObjects, true);
    
    const closest = intersects[0];
    if (!closest) return;
    
    const hitObject = closest.object;
    
    // Determine what was hit by traversing up the parent chain
    let obj: THREE.Object3D | null = hitObject;
    
    // Check if we hit a ball
    const hitBall = this.balls.find(b => b.getMesh() === hitObject);
    if (hitBall) {
      this.handleBallClick(hitBall, closest.point);
      return;
    }
    
    // Check if we hit a shaft end magnet
    if (hitObject.userData.shaftEnd === 'end') {
      const shaft = hitObject.userData.shaft as Shaft;
      if (shaft && !shaft.isFullyConnected()) {
        this.handleShaftEndClick(shaft);
        return;
      }
    }
    
    // Check if we hit a shaft (for deletion) - traverse up to find shaft userData
    obj = hitObject;
    while (obj) {
      if (obj.userData.shaft) {
        const shaft = obj.userData.shaft as Shaft;
        // Only delete if not creating a shaft and shaft is fully connected
        if (!this.pendingShaft && shaft.isFullyConnected()) {
          this.deleteShaft(shaft);
        }
        return;
      }
      obj = obj.parent;
    }
  }

  private deleteShaft(shaft: Shaft): void {
    // Disconnect from balls
    shaft.disconnect();

    // Remove from scene
    this.scene.remove(shaft.getMesh());

    // Remove from array
    const index = this.shafts.indexOf(shaft);
    if (index > -1) {
      this.shafts.splice(index, 1);
    }

    // Remove stranded balls (balls with no connections)
    this.removeStrandedBalls();

    this.showSnapInfo('Shaft deleted', 1000, 'info');
    Logger.logAction('delete-shaft', { remainingShafts: this.shafts.length });
  }

  private removeStrandedBalls(): void {
    // Find balls with no connections
    const strandedBalls = this.balls.filter(ball => ball.getConnectedShafts().length === 0);

    for (const ball of strandedBalls) {
      this.scene.remove(ball.getMesh());
      const index = this.balls.indexOf(ball);
      if (index > -1) {
        this.balls.splice(index, 1);
      }
    }

    if (strandedBalls.length > 0) {
      Logger.logAction('remove-stranded-balls', { count: strandedBalls.length });
    }
  }

  private handleBallClick(ball: Ball, intersectionPoint: THREE.Vector3): void {
    if (!this.pendingShaft) {
      // First click: create a shaft attached to this ball at the clicked point
      Logger.logAction('ball-click-first', {
        ballIndex: this.balls.indexOf(ball),
        ballPosition: ball.getPosition(),
        intersectionPoint: intersectionPoint,
        selectedShaftSize: this.selectedShaftSize
      });

      let direction = new THREE.Vector3()
        .subVectors(intersectionPoint, ball.getPosition())
        .normalize();

      // Apply grid snapping if shift is held
      if (this.isShiftHeld) {
        direction = this.snapDirectionToGrid(direction);
      }

      const shaft = new Shaft(ball.getPosition(), this.selectedShaftSize, direction);
      this.scene.add(shaft.getMesh());
      this.shafts.push(shaft);

      // Calculate the connection point on the ball surface using the (possibly snapped) direction
      const connectionPoint = ball.getPosition().clone().add(
        direction.clone().multiplyScalar(BALL_RADIUS)
      );
      shaft.attachToStart(ball, connectionPoint);
      this.pendingShaft = shaft;
      this.pendingBall = ball;

      Logger.logPositions(this.balls, this.shafts);
      this.showSnapInfo('Click another ball or shaft end to connect', 0, 'info');
    } else {
      // Second click: try to snap the shaft to this ball
      Logger.logAction('ball-click-second', {
        targetBallIndex: this.balls.indexOf(ball),
        targetBallPosition: ball.getPosition(),
        pendingBallIndex: this.balls.indexOf(this.pendingBall!),
        pendingShaftLength: this.pendingShaft.getLength()
      });

      if (ball !== this.pendingBall) {
        const canSnap = this.pendingShaft.canSnapTo(ball);

        if (canSnap) {
          // Direct snap - balls are already at correct distance
          Logger.logAction('direct-snap', { success: true });
          this.pendingShaft.attachToEnd(ball);
          Logger.logPositions(this.balls, this.shafts);
          this.showSnapInfo('Shaft connected!', 1000, 'success');
        } else {
          // Reorient shaft and adjust positions using constraint solver
          this.showSnapInfo('Adjusting structure...', 0, 'warning');

          // The constraint solver will:
          // 1. Reorient the shaft to point toward the clicked ball
          // 2. Move the clicked ball toward the shaft
          // 3. Adjust connected shafts while keeping anchor balls in place
          const result = ConstraintSolver.solveConstraints(
            this.pendingBall!,
            this.pendingShaft,
            ball
          );

          if (result.success) {
            // Update all shafts to reflect new positions
            // The solver may have moved many balls in the chain
            this.shafts.forEach(shaft => shaft.update());

            // Connect the shaft
            this.pendingShaft.attachToEnd(ball);
            Logger.logPositions(this.balls, this.shafts);
            this.showSnapInfo(result.message, 2000, 'success');
          } else {
            // Cannot connect - show error and remove shaft
            Logger.logError('Connection failed', new Error(result.message));
            this.showSnapInfo(result.message, 3000, 'error');
            this.scene.remove(this.pendingShaft.getMesh());
            const index = this.shafts.indexOf(this.pendingShaft);
            if (index > -1) {
              this.shafts.splice(index, 1);
            }
          }
        }
      }

      this.pendingShaft = null;
      this.pendingBall = null;
    }
  }

  private handleShaftEndClick(shaft: Shaft): void {
    // Create a new ball at the free end of the shaft
    // The free end position is where the magnet is, but we need to place
    // the ball center one ball radius further out
    const magnetPosition = shaft.getFreeEndPosition();

    Logger.logAction('shaft-end-click', {
      shaftIndex: this.shafts.indexOf(shaft),
      magnetPosition: magnetPosition,
      shaftLength: shaft.getLength()
    });

    if (magnetPosition && shaft.getStartBall()) {
      // Calculate direction from start ball to magnet
      const direction = new THREE.Vector3()
        .subVectors(magnetPosition, shaft.getStartBall()!.getPosition())
        .normalize();

      // Place ball center one ball radius beyond the magnet
      const ballPosition = magnetPosition.clone().add(
        direction.multiplyScalar(BALL_RADIUS)
      );

      const newBall = this.addBall(ballPosition);
      shaft.attachToEnd(newBall);
      Logger.logPositions(this.balls, this.shafts);
      this.showSnapInfo('Ball created and connected!', 1000, 'success');

      // Clear pending state so user can create new shaft
      this.pendingShaft = null;
      this.pendingBall = null;
    }
  }

  private showSnapInfo(message: string, duration: number = 0, type: 'info' | 'success' | 'warning' | 'error' = 'info'): void {
    const infoDiv = document.getElementById('snap-info')!;
    infoDiv.textContent = message;
    infoDiv.style.display = 'block';

    // Remove all type classes
    infoDiv.classList.remove('success', 'warning', 'error');

    // Add the appropriate type class
    if (type !== 'info') {
      infoDiv.classList.add(type);
    }

    if (duration > 0) {
      setTimeout(() => {
        infoDiv.style.display = 'none';
      }, duration);
    }
  }

  public addBall(position: THREE.Vector3): Ball {
    const ball = new Ball(position);
    this.scene.add(ball.getMesh());
    this.balls.push(ball);
    Logger.logAction('add-ball', { position: position, ballIndex: this.balls.length - 1 });
    return ball;
  }

  private clearAll(): void {
    this.balls.forEach(ball => this.scene.remove(ball.getMesh()));
    this.shafts.forEach(shaft => this.scene.remove(shaft.getMesh()));
    this.balls = [];
    this.shafts = [];
    this.pendingShaft = null;
    this.pendingBall = null;
    this.hoveredShaftForDeletion = null;
    this.selectedSaveId = null;
    this.hidePreviewShaft();
    this.updateCurrentStructureDisplay();
    document.getElementById('snap-info')!.style.display = 'none';
  }

  /**
   * Update hover preview - shows transparent shaft when hovering over a ball
   * or highlights shaft for deletion when hovering over a connected shaft
   */
  private updateHoverPreview(): void {
    this.raycaster.setFromCamera(this.mouse, this.camera);

    // Collect all interactive objects for hover detection
    const allObjects: THREE.Object3D[] = [];
    
    // Add ball meshes
    const ballMeshes = this.balls.map(b => b.getMesh());
    allObjects.push(...ballMeshes);
    
    // Add shaft meshes (for deletion preview)
    const shaftGroups = this.shafts.map(s => s.getMesh());
    allObjects.push(...shaftGroups);

    // Single raycast to find closest hit
    const intersects = this.raycaster.intersectObjects(allObjects, true);
    
    // Clear previous shaft highlight
    if (this.hoveredShaftForDeletion) {
      this.hoveredShaftForDeletion.highlightForDeletion(false);
      this.hoveredShaftForDeletion = null;
    }
    
    const closest = intersects[0];
    if (!closest) {
      this.hidePreviewShaft();
      return;
    }
    
    const hitObject = closest.object;
    
    // Check if we hit a ball - show shaft preview
    const hitBall = this.balls.find(b => b.getMesh() === hitObject);
    if (hitBall) {
      // Create or update preview shaft
      if (!this.previewShaft || this.previewShaft.userData.size !== this.selectedShaftSize) {
        this.hidePreviewShaft();
        this.previewShaft = Shaft.createPreview(this.selectedShaftSize);
        this.scene.add(this.previewShaft);
      }

      // Calculate direction from ball center to intersection point
      let direction = new THREE.Vector3()
        .subVectors(closest.point, hitBall.getPosition())
        .normalize();

      // If shift is held, snap direction to 3D grid
      if (this.isShiftHeld) {
        direction = this.snapDirectionToGrid(direction);
      }

      // Update preview position and orientation
      Shaft.updatePreview(this.previewShaft, hitBall.getPosition(), direction);
      this.previewShaft.visible = true;
      this.hoveredBall = hitBall;
      return;
    }
    
    // Hide shaft preview since we're not over a ball
    this.hidePreviewShaft();
    
    // Check if we hit a shaft - highlight for deletion
    let obj: THREE.Object3D | null = hitObject;
    while (obj) {
      if (obj.userData.shaft) {
        const shaft = obj.userData.shaft as Shaft;
        // Only highlight fully connected shafts for deletion
        if (shaft.isFullyConnected()) {
          shaft.highlightForDeletion(true);
          this.hoveredShaftForDeletion = shaft;
        }
        return;
      }
      obj = obj.parent;
    }
  }

  /**
   * Hide the preview shaft and clear shaft deletion highlight
   */
  private hidePreviewShaft(): void {
    if (this.previewShaft) {
      this.previewShaft.visible = false;
    }
    this.hoveredBall = null;
    // Note: we don't clear hoveredShaftForDeletion here as it's managed separately
  }

  /**
   * Prepare for potential drag - store state but don't start dragging yet.
   * Called on mousedown when clicking a ball.
   */
  private prepareDrag(ball: Ball, intersectionPoint: THREE.Vector3): void {
    this.draggedBall = ball;
    this.hasDragged = false;

    // Create a drag plane perpendicular to the camera
    const cameraDirection = new THREE.Vector3();
    this.camera.getWorldDirection(cameraDirection);
    this.dragPlane.setFromNormalAndCoplanarPoint(cameraDirection, ball.getPosition());

    // Calculate offset from ball center to intersection point projected onto drag plane
    const ballPosOnPlane = new THREE.Vector3();
    this.raycaster.ray.intersectPlane(this.dragPlane, ballPosOnPlane);
    this.dragOffset.copy(ballPosOnPlane).sub(ball.getPosition());

    // Store original positions of all connected balls
    this.dragStartPositions.clear();
    const connectedBalls = this.getConnectedAssembly(ball);
    for (const b of connectedBalls) {
      this.dragStartPositions.set(b, b.getPosition().clone());
    }
  }

  /**
   * Actually start dragging - called when mouse has moved beyond threshold.
   * Assumes prepareDrag was already called.
   */
  private startDrag(): void {
    if (!this.draggedBall) return;

    this.isDragging = true;
    this.hasDragged = true;

    // Disable orbit controls while dragging
    this.controls.enabled = false;

    // Highlight the assembly being dragged
    const connectedBalls = this.getConnectedAssembly(this.draggedBall);
    for (const b of connectedBalls) {
      b.highlight(true);
    }

    Logger.logAction('drag-start', {
      ballIndex: this.balls.indexOf(this.draggedBall),
      assemblySize: connectedBalls.size
    });
  }

  /**
   * Cancel a prepared drag - called when mouseup happens before drag threshold.
   * This allows the click to be processed normally.
   */
  private cancelDrag(): void {
    this.draggedBall = null;
    this.dragStartPositions.clear();
    this.hasDragged = false;
  }

  private endDrag(): void {
    // Remove highlight from all balls
    if (this.draggedBall) {
      const connectedBalls = this.getConnectedAssembly(this.draggedBall);
      for (const b of connectedBalls) {
        b.highlight(false);
      }
    }

    Logger.logAction('drag-end', {
      ballIndex: this.draggedBall ? this.balls.indexOf(this.draggedBall) : -1
    });

    this.isDragging = false;
    this.draggedBall = null;
    this.dragStartPositions.clear();
    this.hasDragged = false;

    // Re-enable orbit controls
    this.controls.enabled = true;
  }

  private getConnectedAssembly(startBall: Ball): Set<Ball> {
    const visited = new Set<Ball>();
    const queue: Ball[] = [startBall];

    while (queue.length > 0) {
      const ball = queue.shift()!;
      if (visited.has(ball)) continue;
      visited.add(ball);

      for (const connected of ball.getConnectedBalls()) {
        if (!visited.has(connected)) {
          queue.push(connected);
        }
      }
    }

    return visited;
  }

  private moveAssembly(delta: THREE.Vector3): void {
    // Move all balls in the assembly by delta from their original positions
    for (const [ball, originalPos] of this.dragStartPositions) {
      const newPos = originalPos.clone().add(delta);
      ball.setPosition(newPos);
    }
  }


  // ==================== Save/Load System ====================

  private serializeStructure(): SavedStructure {
    const balls: SavedBall[] = this.balls.map(ball => ({
      position: {
        x: ball.getPosition().x,
        y: ball.getPosition().y,
        z: ball.getPosition().z
      }
    }));

    const shafts: SavedShaft[] = this.shafts.map(shaft => {
      const startBall = shaft.getStartBall();
      const endBall = shaft.getEndBall();

      // Get direction from the shaft mesh orientation
      const direction = new THREE.Vector3(0, 1, 0);
      direction.applyQuaternion(shaft.getMesh().quaternion);

      return {
        size: shaft.getSize(),
        startBallIndex: startBall ? this.balls.indexOf(startBall) : -1,
        endBallIndex: endBall ? this.balls.indexOf(endBall) : null,
        direction: { x: direction.x, y: direction.y, z: direction.z },
        color: shaft.getColor()
      };
    });

    return {
      id: crypto.randomUUID(),
      name: '',
      timestamp: Date.now(),
      balls,
      shafts
    };
  }

  private deserializeStructure(data: SavedStructure): void {
    // Clear current structure
    this.clearAll();

    // Create balls
    for (const savedBall of data.balls) {
      const position = new THREE.Vector3(
        savedBall.position.x,
        savedBall.position.y,
        savedBall.position.z
      );
      this.addBall(position);
    }

    // Create shafts and connect them
    for (const savedShaft of data.shafts) {
      if (savedShaft.startBallIndex < 0 || savedShaft.startBallIndex >= this.balls.length) {
        continue;
      }

      const startBall = this.balls[savedShaft.startBallIndex];
      if (!startBall) continue;
      
      const direction = new THREE.Vector3(
        savedShaft.direction.x,
        savedShaft.direction.y,
        savedShaft.direction.z
      );

      const shaft = new Shaft(startBall.getPosition(), savedShaft.size, direction, savedShaft.color);
      this.scene.add(shaft.getMesh());
      this.shafts.push(shaft);

      shaft.attachToStart(startBall);

      if (savedShaft.endBallIndex !== null &&
        savedShaft.endBallIndex >= 0 &&
        savedShaft.endBallIndex < this.balls.length) {
        const endBall = this.balls[savedShaft.endBallIndex];
        if (endBall) shaft.attachToEnd(endBall);
      }
    }

  }

  private loadSavedStructures(): void {
    try {
      const saved = localStorage.getItem(this.STORAGE_KEY);
      if (saved) {
        const structures: SavedStructure[] = JSON.parse(saved);
        this.savedStructures.clear();
        for (const structure of structures) {
          this.savedStructures.set(structure.id, structure);
        }
      }
    } catch (e) {
      console.error('Failed to load saved structures:', e);
    }
    this.updateSavedStructuresList();
    this.updateCurrentStructureDisplay();
  }

  private persistSavedStructures(): void {
    try {
      const structures = Array.from(this.savedStructures.values());
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(structures));
    } catch (e) {
      console.error('Failed to save structures:', e);
      this.showSnapInfo('Failed to save to localStorage', 2000, 'error');
    }
  }

  private updateSavedStructuresList(): void {
    const listContainer = document.getElementById('saved-list')!;
    listContainer.innerHTML = '';

    if (this.savedStructures.size === 0) {
      listContainer.innerHTML = '<div style="color: #666; font-size: 11px; text-align: center; padding: 10px;">No saved structures yet</div>';
      return;
    }

    // Sort by timestamp (newest first)
    const sorted = Array.from(this.savedStructures.values())
      .sort((a, b) => b.timestamp - a.timestamp);

    for (const structure of sorted) {
      const item = document.createElement('div');
      item.className = 'saved-item' + (this.selectedSaveId === structure.id ? ' selected' : '');
      item.innerHTML = `
                <span class="saved-item-name">${structure.name || 'Unnamed'}</span>
                <div class="saved-item-actions">
                    <button class="delete-btn">×</button>
                </div>
            `;

      // Click to load
      item.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).tagName !== 'BUTTON') {
          this.deserializeStructure(structure);
          this.selectedSaveId = structure.id;
          this.updateSavedStructuresList();
          this.updateCurrentStructureDisplay();
          this.showSnapInfo(`Loaded: ${structure.name || 'Unnamed'}`, 1500, 'success');
        }
      });

      // Delete button
      item.querySelector('.delete-btn')!.addEventListener('click', (e) => {
        e.stopPropagation();
        this.savedStructures.delete(structure.id);
        if (this.selectedSaveId === structure.id) {
          this.selectedSaveId = null;
          this.updateCurrentStructureDisplay();
        }
        this.persistSavedStructures();
        this.updateSavedStructuresList();
        this.showSnapInfo('Structure deleted', 1000, 'info');
      });

      listContainer.appendChild(item);
    }
  }

  private updateSelectedStructure(): void {
    if (!this.selectedSaveId) {
      this.showSnapInfo('No structure selected', 2000, 'warning');
      return;
    }

    const existing = this.savedStructures.get(this.selectedSaveId);
    if (!existing) {
      this.showSnapInfo('Selected structure not found', 2000, 'error');
      return;
    }

    const structure = this.serializeStructure();
    structure.id = this.selectedSaveId;
    structure.name = existing.name;

    this.savedStructures.set(structure.id, structure);

    this.persistSavedStructures();
    this.updateSavedStructuresList();
    this.showSnapInfo(`Updated: ${existing.name}`, 1500, 'success');
  }

  private validateAndImport(structure: SavedStructure): void {
    // Basic validation
    if (!structure.balls || !Array.isArray(structure.balls)) {
      this.showSnapInfo('Invalid structure: missing balls', 2000, 'error');
      return;
    }
    if (!structure.shafts || !Array.isArray(structure.shafts)) {
      this.showSnapInfo('Invalid structure: missing shafts', 2000, 'error');
      return;
    }

    // Generate new ID for imported structure
    structure.id = crypto.randomUUID();
    structure.timestamp = Date.now();

    // Save to list and select it
    this.savedStructures.set(structure.id, structure);
    this.persistSavedStructures();

    // Load it
    this.deserializeStructure(structure);
    this.selectedSaveId = structure.id;
    this.updateSavedStructuresList();
    this.updateCurrentStructureDisplay();
    this.showSnapInfo(`Imported: ${structure.name || 'Unnamed'}`, 1500, 'success');
  }

  private animate(): void {
    requestAnimationFrame(() => this.animate());

    this.controls.update();

    // Update shafts
    this.shafts.forEach(shaft => shaft.update());

    this.renderer.render(this.scene, this.camera);
  }
}

// Initialize the application
const app = new MagneticBuilder();

// Add initial ball
app.addBall(new THREE.Vector3(0, 0.5, 0));
