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
        window.addEventListener('click', (e) => this.onClick(e));

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

    private onClick(event: MouseEvent): void {
        if (event.button !== 0) return; // Only left click

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
        document.getElementById('snap-info')!.style.display = 'none';
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
