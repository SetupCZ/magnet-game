import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Ball, BALL_RADIUS } from './Ball';
import { Shaft, type ShaftSize } from './Shaft';
import { ConstraintSolver } from './ConstraintSolver';
import { Logger } from './Logger';

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

        // Handle hover preview (only when not in pending shaft mode)
        if (!this.pendingShaft) {
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
