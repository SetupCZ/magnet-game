import * as THREE from 'three';
import { Ball, BALL_RADIUS } from './Ball';

export type ShaftSize = 'small' | 'large';

// Shaft dimensions - thicker for kid-friendly look
const SHAFT_RADIUS = 0.15;
const BEVEL_SIZE = 0.08;

// Calculate shaft lengths
// For a cube with side length 2 (2 ball radii apart):
// - Small shaft connects adjacent corners: length = 2 units
// - Large shaft connects diagonal corners: length = 2 * sqrt(3) ≈ 3.464 units
const CUBE_SIDE = 2.0;
export const SMALL_SHAFT_LENGTH = CUBE_SIDE;
export const LARGE_SHAFT_LENGTH = CUBE_SIDE * Math.sqrt(3);

const SNAP_TOLERANCE = 0.1; // Tolerance for snapping

// Pastel color palette for kid-friendly shafts
const PASTEL_COLORS = [
    0xFFB3BA, // Light pink
    0xFFDFBA, // Light peach
    0xFFFFBA, // Light yellow
    0xBAFFC9, // Light mint
    0xBAE1FF, // Light blue
    0xE0BBE4, // Light lavender
    0xFFC8DD, // Pink
    0xBDE0FE, // Sky blue
    0xA2D2FF, // Light cornflower
    0xCDB4DB, // Light purple
    0xFFC09F, // Light coral
    0xADF7B6, // Light green
];

/**
 * Generate a random pastel color
 */
function getRandomPastelColor(): number {
    const color = PASTEL_COLORS[Math.floor(Math.random() * PASTEL_COLORS.length)];
    return color !== undefined ? color : 0xFFB3BA; // Fallback to light pink
}

/**
 * Create a hexagonal prism geometry with beveled ends
 */
function createHexagonalShaftGeometry(length: number): THREE.BufferGeometry {
    const shape = new THREE.Shape();
    const sides = 6;
    const radius = SHAFT_RADIUS;
    
    // Create hexagon shape
    for (let i = 0; i < sides; i++) {
        const angle = (i / sides) * Math.PI * 2 - Math.PI / 2;
        const x = Math.cos(angle) * radius;
        const y = Math.sin(angle) * radius;
        if (i === 0) {
            shape.moveTo(x, y);
        } else {
            shape.lineTo(x, y);
        }
    }
    shape.closePath();
    
    // Extrude with bevel for rounded edges
    const extrudeSettings = {
        depth: length,
        bevelEnabled: true,
        bevelThickness: BEVEL_SIZE,
        bevelSize: BEVEL_SIZE,
        bevelSegments: 3,
    };
    
    const geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);
    
    // Rotate to align with Y axis (default is Z)
    geometry.rotateX(-Math.PI / 2);
    // Center the geometry
    geometry.translate(0, -length / 2, 0);
    
    return geometry;
}

/**
 * Create a beveled hexagonal cap for shaft ends
 */
function createEndCapGeometry(): THREE.BufferGeometry {
    const shape = new THREE.Shape();
    const sides = 6;
    const radius = SHAFT_RADIUS + BEVEL_SIZE;
    
    for (let i = 0; i < sides; i++) {
        const angle = (i / sides) * Math.PI * 2 - Math.PI / 2;
        const x = Math.cos(angle) * radius;
        const y = Math.sin(angle) * radius;
        if (i === 0) {
            shape.moveTo(x, y);
        } else {
            shape.lineTo(x, y);
        }
    }
    shape.closePath();
    
    const geometry = new THREE.ShapeGeometry(shape);
    geometry.rotateX(-Math.PI / 2);
    
    return geometry;
}

export class Shaft {
    private mesh: THREE.Group;
    private shaftMesh: THREE.Mesh;
    private size: ShaftSize;
    private length: number;
    private color: number;
    private startBall: Ball | null = null;
    private endBall: Ball | null = null;
    private startDirection: THREE.Vector3 = new THREE.Vector3(0, 1, 0);
    private startMagnet: THREE.Mesh;
    private endMagnet: THREE.Mesh;

    constructor(startPosition: THREE.Vector3, size: ShaftSize, direction?: THREE.Vector3, color?: number) {
        this.size = size;
        this.length = size === 'small' ? SMALL_SHAFT_LENGTH : LARGE_SHAFT_LENGTH;
        this.color = color ?? getRandomPastelColor();
        
        if (direction) {
            this.startDirection = direction.clone().normalize();
        }
        
        // Create group to hold all shaft parts
        this.mesh = new THREE.Group();
        this.mesh.userData.shaft = this;
        
        // Create hexagonal shaft with beveled ends
        const geometry = createHexagonalShaftGeometry(this.length);
        
        // Colorful pastel material
        const material = new THREE.MeshStandardMaterial({
            color: this.color,
            metalness: 0.1,
            roughness: 0.4,
        });
        
        this.shaftMesh = new THREE.Mesh(geometry, material);
        this.shaftMesh.castShadow = true;
        this.shaftMesh.receiveShadow = true;
        this.shaftMesh.userData.shaft = this;
        this.mesh.add(this.shaftMesh);
        
        // Create glowing magnet end indicators
        const magnetGeometry = new THREE.SphereGeometry(SHAFT_RADIUS * 1.3, 16, 16);
        const magnetMaterial = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            metalness: 0.2,
            roughness: 0.3,
            emissive: 0xffffff,
            emissiveIntensity: 0.3,
        });
        
        // Start magnet (connected end)
        this.startMagnet = new THREE.Mesh(magnetGeometry, magnetMaterial.clone());
        this.startMagnet.userData.shaftEnd = 'start';
        this.startMagnet.userData.shaft = this;
        this.mesh.add(this.startMagnet);
        
        // End magnet (free end)
        this.endMagnet = new THREE.Mesh(magnetGeometry, magnetMaterial.clone());
        this.endMagnet.userData.shaftEnd = 'end';
        this.endMagnet.userData.shaft = this;
        this.mesh.add(this.endMagnet);
        
        // Position the shaft
        this.mesh.position.copy(startPosition);
    }

    public getMesh(): THREE.Group {
        return this.mesh;
    }

    public getStartMagnet(): THREE.Mesh {
        return this.startMagnet;
    }

    public getEndMagnet(): THREE.Mesh {
        return this.endMagnet;
    }

    public getSize(): ShaftSize {
        return this.size;
    }

    public getLength(): number {
        return this.length;
    }

    public getColor(): number {
        return this.color;
    }

    public setStartDirection(direction: THREE.Vector3): void {
        this.startDirection = direction.clone().normalize();
    }

    public attachToStart(ball: Ball, connectionPoint?: THREE.Vector3): void {
        this.startBall = ball;
        ball.addConnectedShaft(this);
        
        if (connectionPoint) {
            // Calculate direction from ball center to connection point
            const direction = new THREE.Vector3()
                .subVectors(connectionPoint, ball.getPosition())
                .normalize();
            this.startDirection = direction;
        }
        
        this.update();
    }

    public attachToEnd(ball: Ball): void {
        this.endBall = ball;
        ball.addConnectedShaft(this);
        this.update();
    }

    public canSnapTo(targetBall: Ball): boolean {
        if (!this.startBall) return false;
        
        const distance = this.startBall.getPosition().distanceTo(targetBall.getPosition());
        const targetDistance = this.length + BALL_RADIUS * 2;
        
        return Math.abs(distance - targetDistance) < SNAP_TOLERANCE;
    }

    public update(): void {
        if (!this.startBall) return;

        const startPos = this.startBall.getPosition();
        
        if (this.endBall) {
            // Both ends connected - position shaft between balls
            const endPos = this.endBall.getPosition();
            
            // Calculate midpoint
            const midpoint = new THREE.Vector3()
                .addVectors(startPos, endPos)
                .multiplyScalar(0.5);
            
            this.mesh.position.copy(midpoint);
            
            // Calculate rotation to point from start to end
            const direction = new THREE.Vector3().subVectors(endPos, startPos);
            const actualLength = direction.length();
            
            // Adjust shaft length to fit between balls (accounting for ball radii)
            const adjustedLength = actualLength - BALL_RADIUS * 2;
            this.shaftMesh.scale.y = adjustedLength / this.length;
            
            // Orient shaft
            this.mesh.quaternion.setFromUnitVectors(
                new THREE.Vector3(0, 1, 0),
                direction.normalize()
            );
            
            // Position magnets at both ends (scaled position)
            const scaledHalfLength = (adjustedLength / 2);
            this.startMagnet.position.set(0, -scaledHalfLength, 0);
            this.endMagnet.position.set(0, scaledHalfLength, 0);
            
            // Hide magnets when both ends are connected
            this.startMagnet.visible = false;
            this.endMagnet.visible = false;
            
        } else {
            // Only start connected - shaft points in the start direction
            // Reset scale
            this.shaftMesh.scale.y = 1;
            
            const connectionPoint = startPos.clone().add(
                this.startDirection.clone().multiplyScalar(BALL_RADIUS)
            );
            
            const shaftCenter = connectionPoint.clone().add(
                this.startDirection.clone().multiplyScalar(this.length / 2)
            );
            
            this.mesh.position.copy(shaftCenter);
            
            // Orient shaft in the direction
            this.mesh.quaternion.setFromUnitVectors(
                new THREE.Vector3(0, 1, 0),
                this.startDirection
            );
            
            // Position magnets at ends
            this.startMagnet.position.set(0, -this.length / 2, 0);
            this.endMagnet.position.set(0, this.length / 2, 0);
            
            // Show end magnet, hide start magnet
            this.startMagnet.visible = false;
            this.endMagnet.visible = true;
            
            // Make end magnet pulse with a soft glow
            const material = this.endMagnet.material as THREE.MeshStandardMaterial;
            material.emissiveIntensity = 0.4 + Math.sin(Date.now() * 0.004) * 0.2;
        }
    }

    public getStartBall(): Ball | null {
        return this.startBall;
    }

    public getEndBall(): Ball | null {
        return this.endBall;
    }

    public isFullyConnected(): boolean {
        return this.startBall !== null && this.endBall !== null;
    }

    /**
     * Disconnect the shaft from both balls
     */
    public disconnect(): void {
        if (this.startBall) {
            this.startBall.removeConnectedShaft(this);
            this.startBall = null;
        }
        if (this.endBall) {
            this.endBall.removeConnectedShaft(this);
            this.endBall = null;
        }
    }

    /**
     * Disconnect only the start ball, keeping the shaft attached to the end ball
     * The end ball becomes the new start ball
     */
    public disconnectStart(): void {
        if (this.startBall) {
            this.startBall.removeConnectedShaft(this);
            
            if (this.endBall) {
                this.startBall = this.endBall;
                this.endBall = null;
                this.startDirection.negate();
            } else {
                this.startBall = null;
            }
        }
    }

    /**
     * Disconnect only the end ball
     */
    public disconnectEnd(): void {
        if (this.endBall) {
            this.endBall.removeConnectedShaft(this);
            this.endBall = null;
        }
    }

    // Get the world position of the free end of the shaft
    public getFreeEndPosition(): THREE.Vector3 | null {
        if (this.isFullyConnected() || !this.startBall) return null;
        
        const worldPos = new THREE.Vector3();
        this.endMagnet.getWorldPosition(worldPos);
        return worldPos;
    }

    /**
     * Create a transparent preview shaft for hover visualization
     */
    public static createPreview(size: ShaftSize): THREE.Group {
        const length = size === 'small' ? SMALL_SHAFT_LENGTH : LARGE_SHAFT_LENGTH;
        
        const group = new THREE.Group();
        
        // Create hexagonal shaft preview
        const geometry = createHexagonalShaftGeometry(length);
        
        const material = new THREE.MeshStandardMaterial({
            color: 0xcccccc,
            metalness: 0.1,
            roughness: 0.4,
            transparent: true,
            opacity: 0.4,
            depthWrite: false,
        });
        
        const mesh = new THREE.Mesh(geometry, material);
        mesh.castShadow = false;
        mesh.receiveShadow = false;
        group.add(mesh);
        
        // Create end indicator
        const magnetGeometry = new THREE.SphereGeometry(SHAFT_RADIUS * 1.3, 16, 16);
        const magnetMaterial = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            metalness: 0.2,
            roughness: 0.3,
            transparent: true,
            opacity: 0.5,
            depthWrite: false,
        });
        
        const endMagnet = new THREE.Mesh(magnetGeometry, magnetMaterial);
        endMagnet.position.set(0, length / 2, 0);
        group.add(endMagnet);
        
        group.userData.length = length;
        group.userData.size = size;
        
        return group;
    }

    /**
     * Update preview shaft position based on ball position and direction
     */
    public static updatePreview(
        preview: THREE.Group, 
        ballPosition: THREE.Vector3, 
        direction: THREE.Vector3
    ): void {
        const length = preview.userData.length as number;
        
        const connectionPoint = ballPosition.clone().add(
            direction.clone().normalize().multiplyScalar(BALL_RADIUS)
        );
        
        const shaftCenter = connectionPoint.clone().add(
            direction.clone().normalize().multiplyScalar(length / 2)
        );
        
        preview.position.copy(shaftCenter);
        
        preview.quaternion.setFromUnitVectors(
            new THREE.Vector3(0, 1, 0),
            direction.clone().normalize()
        );
    }
}
