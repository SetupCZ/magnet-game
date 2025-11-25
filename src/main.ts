import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Ball, BALL_RADIUS } from './Ball';
import { Shaft, type ShaftSize } from './Shaft';
import { ConstraintSolver } from './ConstraintSolver';
import { Logger } from './Logger';

// Types for save/load functionality
interface SavedBall {
    position: { x: number; y: number; z: number };
}

interface SavedShaft {
    size: ShaftSize;
    startBallIndex: number;
    endBallIndex: number | null;
    direction: { x: number; y: number; z: number };
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
    private readonly DRAG_THRESHOLD = 5; // Pixels of movement before it's a drag

    // Preview shaft state
    private previewShaft: THREE.Group | null = null;
    private hoveredBall: Ball | null = null;

    // Mode state
    private isDeleteMode: boolean = false;

    // Save/Load state
    private savedStructures: Map<string, SavedStructure> = new Map();
    private selectedSaveId: string | null = null;
    private readonly STORAGE_KEY = 'magnetic-builder-saves';

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

        document.getElementById('download-log')!.addEventListener('click', () => {
            Logger.copyLogsToClipboard();
        });

        document.querySelectorAll('.shaft-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const target = e.target as HTMLElement;
                document.querySelectorAll('.shaft-btn').forEach(b => b.classList.remove('active'));
                target.classList.add('active');
                this.selectedShaftSize = target.dataset.size as ShaftSize;
            });
        });

        // Mode buttons
        document.getElementById('build-mode')!.addEventListener('click', () => {
            this.setDeleteMode(false);
        });

        document.getElementById('delete-mode')!.addEventListener('click', () => {
            this.setDeleteMode(true);
        });

        // Save/Load buttons
        document.getElementById('save-new')!.addEventListener('click', () => {
            this.saveNewStructure();
        });

        document.getElementById('save-current')!.addEventListener('click', () => {
            this.updateSelectedStructure();
        });

        document.getElementById('export-json')!.addEventListener('click', () => {
            this.exportToJson();
        });

        document.getElementById('import-file')!.addEventListener('click', () => {
            document.getElementById('file-input')!.click();
        });

        document.getElementById('file-input')!.addEventListener('change', (e) => {
            const input = e.target as HTMLInputElement;
            if (input.files && input.files[0]) {
                this.importFromFile(input.files[0]);
                input.value = ''; // Reset for next use
            }
        });

        document.getElementById('import-text')!.addEventListener('click', () => {
            this.importFromText();
        });

        // Load saved structures from localStorage
        this.loadSavedStructures();
    }

    private onWindowResize(): void {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
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
            const clickedBall = this.balls.find(b => b.getMesh() === ballIntersects[0].object);
            if (clickedBall) {
                this.prepareDrag(clickedBall, ballIntersects[0].point);
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

        // Handle hover preview (only when in build mode and not creating a shaft)
        if (!this.pendingShaft && !this.isDeleteMode) {
            this.updateHoverPreview();
        } else {
            this.hidePreviewShaft();
        }
    }

    private onMouseUp(event: MouseEvent): void {
        if (event.button !== 0) return;

        if (this.isDragging) {
            // Was dragging - just end the drag
            this.endDrag();
        } else if (this.draggedBall) {
            // Was not dragging (didn't move enough) - treat as click
            this.cancelDrag();
            this.handleClick(event);
        } else {
            // Clicked on empty space or shaft end
            this.handleClick(event);
        }
    }

    private handleClick(event: MouseEvent): void {
        this.mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
        this.mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

        this.raycaster.setFromCamera(this.mouse, this.camera);

        // In delete mode, handle deletions
        if (this.isDeleteMode) {
            this.handleDeleteClick();
            return;
        }

        // First check for shaft end clicks (higher priority)
        const shaftEndMeshes: THREE.Object3D[] = [];
        this.shafts.forEach(shaft => {
            if (!shaft.isFullyConnected()) {
                shaftEndMeshes.push(shaft.getEndMagnet());
            }
        });

        const shaftEndIntersects = this.raycaster.intersectObjects(shaftEndMeshes, false);
        
        if (shaftEndIntersects.length > 0) {
            const clickedMagnet = shaftEndIntersects[0].object as THREE.Mesh;
            const shaft = clickedMagnet.userData.shaft as Shaft;
            
            if (shaft && !shaft.isFullyConnected()) {
                this.handleShaftEndClick(shaft);
                return;
            }
        }

        // Then check for ball clicks
        const ballMeshes = this.balls.map(b => b.getMesh());
        const ballIntersects = this.raycaster.intersectObjects(ballMeshes);

        if (ballIntersects.length > 0) {
            const clickedBall = this.balls.find(b => b.getMesh() === ballIntersects[0].object);
            if (clickedBall) {
                const intersectionPoint = ballIntersects[0].point;
                this.handleBallClick(clickedBall, intersectionPoint);
            }
        }
    }

    private handleDeleteClick(): void {
        // Check for shaft clicks first (the cylinder mesh)
        const shaftMeshes = this.shafts.map(s => s.getMesh());
        const shaftIntersects = this.raycaster.intersectObjects(shaftMeshes, true);
        
        if (shaftIntersects.length > 0) {
            // Find the shaft from the intersected object
            let shaft: Shaft | null = null;
            let obj = shaftIntersects[0].object;
            while (obj && !shaft) {
                if (obj.userData.shaft) {
                    shaft = obj.userData.shaft as Shaft;
                }
                obj = obj.parent as THREE.Object3D;
            }
            
            if (shaft) {
                this.deleteShaft(shaft);
                return;
            }
        }

        // Then check for ball clicks
        const ballMeshes = this.balls.map(b => b.getMesh());
        const ballIntersects = this.raycaster.intersectObjects(ballMeshes);

        if (ballIntersects.length > 0) {
            const clickedBall = this.balls.find(b => b.getMesh() === ballIntersects[0].object);
            if (clickedBall) {
                this.deleteBall(clickedBall);
            }
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

    private deleteBall(ball: Ball): void {
        // Get connected shafts before removing
        const connectedShafts = [...ball.getConnectedShafts()];
        
        // Disconnect ball from all shafts (but keep the shafts)
        for (const shaft of connectedShafts) {
            if (shaft.getStartBall() === ball) {
                shaft.disconnectStart();
            } else if (shaft.getEndBall() === ball) {
                shaft.disconnectEnd();
            }
            shaft.update();
        }
        
        // Remove ball from scene
        this.scene.remove(ball.getMesh());
        
        // Remove from array
        const index = this.balls.indexOf(ball);
        if (index > -1) {
            this.balls.splice(index, 1);
        }
        
        this.showSnapInfo('Ball deleted - click shaft ends to reconnect', 2000, 'info');
        Logger.logAction('delete-ball', { remainingBalls: this.balls.length });
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
            
            const direction = new THREE.Vector3()
                .subVectors(intersectionPoint, ball.getPosition())
                .normalize();
            
            const shaft = new Shaft(ball.getPosition(), this.selectedShaftSize, direction);
            this.scene.add(shaft.getMesh());
            this.shafts.push(shaft);
            
            shaft.attachToStart(ball, intersectionPoint);
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
                    this.centerCameraOnStructure();
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
                        this.centerCameraOnStructure();
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
            this.centerCameraOnStructure();
            
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
        this.hidePreviewShaft();
        document.getElementById('snap-info')!.style.display = 'none';
    }

    /**
     * Update hover preview - shows transparent shaft when hovering over a ball
     */
    private updateHoverPreview(): void {
        this.raycaster.setFromCamera(this.mouse, this.camera);
        
        // Check for ball intersection
        const ballMeshes = this.balls.map(b => b.getMesh());
        const intersects = this.raycaster.intersectObjects(ballMeshes);
        
        if (intersects.length > 0) {
            const hitBall = this.balls.find(b => b.getMesh() === intersects[0].object);
            const intersectionPoint = intersects[0].point;
            
            if (hitBall) {
                // Create or update preview shaft
                if (!this.previewShaft || this.previewShaft.userData.size !== this.selectedShaftSize) {
                    // Need to create new preview (different size selected)
                    this.hidePreviewShaft();
                    this.previewShaft = Shaft.createPreview(this.selectedShaftSize);
                    this.scene.add(this.previewShaft);
                }
                
                // Calculate direction from ball center to intersection point
                const direction = new THREE.Vector3()
                    .subVectors(intersectionPoint, hitBall.getPosition())
                    .normalize();
                
                // Update preview position and orientation
                Shaft.updatePreview(this.previewShaft, hitBall.getPosition(), direction);
                this.previewShaft.visible = true;
                this.hoveredBall = hitBall;
                return;
            }
        }
        
        // Not hovering over a ball - hide preview
        this.hidePreviewShaft();
    }

    /**
     * Hide the preview shaft
     */
    private hidePreviewShaft(): void {
        if (this.previewShaft) {
            this.previewShaft.visible = false;
        }
        this.hoveredBall = null;
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

    // ==================== Mode Management ====================

    private setDeleteMode(enabled: boolean): void {
        this.isDeleteMode = enabled;
        
        // Update UI
        const buildBtn = document.getElementById('build-mode')!;
        const deleteBtn = document.getElementById('delete-mode')!;
        
        if (enabled) {
            buildBtn.classList.remove('active');
            deleteBtn.classList.add('active');
            this.hidePreviewShaft();
            // Cancel any pending shaft
            if (this.pendingShaft) {
                this.scene.remove(this.pendingShaft.getMesh());
                const index = this.shafts.indexOf(this.pendingShaft);
                if (index > -1) {
                    this.shafts.splice(index, 1);
                }
                this.pendingShaft = null;
                this.pendingBall = null;
            }
            this.showSnapInfo('Delete mode: Click shaft or ball to delete', 2000, 'warning');
        } else {
            deleteBtn.classList.remove('active');
            buildBtn.classList.add('active');
            this.showSnapInfo('Build mode', 1000, 'info');
        }
    }

    // ==================== Camera Centering ====================

    private centerCameraOnStructure(): void {
        if (this.balls.length === 0) return;
        
        // Calculate center of all balls
        const center = new THREE.Vector3();
        for (const ball of this.balls) {
            center.add(ball.getPosition());
        }
        center.divideScalar(this.balls.length);
        
        // Update orbit controls target
        this.controls.target.copy(center);
        this.controls.update();
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
                direction: { x: direction.x, y: direction.y, z: direction.z }
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
            const direction = new THREE.Vector3(
                savedShaft.direction.x,
                savedShaft.direction.y,
                savedShaft.direction.z
            );
            
            const shaft = new Shaft(startBall.getPosition(), savedShaft.size, direction);
            this.scene.add(shaft.getMesh());
            this.shafts.push(shaft);
            
            shaft.attachToStart(startBall);
            
            if (savedShaft.endBallIndex !== null && 
                savedShaft.endBallIndex >= 0 && 
                savedShaft.endBallIndex < this.balls.length) {
                const endBall = this.balls[savedShaft.endBallIndex];
                shaft.attachToEnd(endBall);
            }
        }
        
        // Center camera on the loaded structure
        this.centerCameraOnStructure();
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
            listContainer.innerHTML = '<div style="color: #888; font-size: 12px;">No saved structures</div>';
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
                    <button class="load-btn" style="background: #4CAF50;">Load</button>
                    <button class="delete-btn" style="background: #f44336;">×</button>
                </div>
            `;
            
            // Click to select
            item.addEventListener('click', (e) => {
                if ((e.target as HTMLElement).tagName !== 'BUTTON') {
                    this.selectedSaveId = structure.id;
                    (document.getElementById('structure-name') as HTMLInputElement).value = structure.name;
                    this.updateSavedStructuresList();
                }
            });
            
            // Load button
            item.querySelector('.load-btn')!.addEventListener('click', () => {
                this.deserializeStructure(structure);
                this.selectedSaveId = structure.id;
                (document.getElementById('structure-name') as HTMLInputElement).value = structure.name;
                this.updateSavedStructuresList();
                this.showSnapInfo(`Loaded: ${structure.name || 'Unnamed'}`, 1500, 'success');
            });
            
            // Delete button
            item.querySelector('.delete-btn')!.addEventListener('click', () => {
                this.savedStructures.delete(structure.id);
                if (this.selectedSaveId === structure.id) {
                    this.selectedSaveId = null;
                }
                this.persistSavedStructures();
                this.updateSavedStructuresList();
                this.showSnapInfo('Structure deleted', 1000, 'info');
            });
            
            listContainer.appendChild(item);
        }
    }

    private saveNewStructure(): void {
        const nameInput = document.getElementById('structure-name') as HTMLInputElement;
        const name = nameInput.value.trim() || `Structure ${this.savedStructures.size + 1}`;
        
        const structure = this.serializeStructure();
        structure.name = name;
        
        this.savedStructures.set(structure.id, structure);
        this.selectedSaveId = structure.id;
        
        this.persistSavedStructures();
        this.updateSavedStructuresList();
        this.showSnapInfo(`Saved: ${name}`, 1500, 'success');
    }

    private updateSelectedStructure(): void {
        if (!this.selectedSaveId) {
            this.showSnapInfo('Select a structure first', 2000, 'warning');
            return;
        }
        
        const existing = this.savedStructures.get(this.selectedSaveId);
        if (!existing) {
            this.showSnapInfo('Selected structure not found', 2000, 'error');
            return;
        }
        
        const nameInput = document.getElementById('structure-name') as HTMLInputElement;
        const name = nameInput.value.trim() || existing.name;
        
        const structure = this.serializeStructure();
        structure.id = this.selectedSaveId;
        structure.name = name;
        
        this.savedStructures.set(structure.id, structure);
        
        this.persistSavedStructures();
        this.updateSavedStructuresList();
        this.showSnapInfo(`Updated: ${name}`, 1500, 'success');
    }

    private exportToJson(): void {
        const structure = this.serializeStructure();
        const nameInput = document.getElementById('structure-name') as HTMLInputElement;
        structure.name = nameInput.value.trim() || 'Exported Structure';
        
        const json = JSON.stringify(structure, null, 2);
        
        // Create download
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${structure.name.replace(/[^a-z0-9]/gi, '_')}.json`;
        a.click();
        URL.revokeObjectURL(url);
        
        this.showSnapInfo('Exported to JSON file', 1500, 'success');
    }

    private importFromFile(file: File): void {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const json = e.target?.result as string;
                const structure = JSON.parse(json) as SavedStructure;
                this.validateAndImport(structure);
            } catch (err) {
                this.showSnapInfo('Invalid JSON file', 2000, 'error');
            }
        };
        reader.readAsText(file);
    }

    private importFromText(): void {
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
        } catch (err) {
            this.showSnapInfo('Invalid JSON format', 2000, 'error');
        }
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
        
        this.deserializeStructure(structure);
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
