import * as THREE from 'three';
import { Ball, BALL_RADIUS } from './Ball';

export type ShaftSize = 'small' | 'large';

// Shaft dimensions - thicker for kid-friendly look
const SHAFT_RADIUS = 0.15;
const BEVEL_SIZE = 0.08;

// Calculate shaft lengths
// - Small shaft: base length for building
// - Large shaft: sqrt(2) * small, allowing right-angle triangles
const CUBE_SIDE = 2.0;
export const SMALL_SHAFT_LENGTH = CUBE_SIDE;
export const LARGE_SHAFT_LENGTH = CUBE_SIDE * Math.sqrt(2);

const SNAP_TOLERANCE = 0.1; // Tolerance for snapping

// Vibrant color palette for kid-friendly shafts
const VIBRANT_COLORS = [
    0xFF4D6A, // Vibrant pink/red
    0xFF8C42, // Bright orange
    0xFFD93D, // Sunny yellow
    0x6BCB77, // Fresh green
    0x4D96FF, // Bright blue
    0x9B59B6, // Purple
    0xE84393, // Hot pink
    0x00D2D3, // Turquoise
    0xFF6B6B, // Coral red
    0x54A0FF, // Sky blue
    0x5F27CD, // Deep purple
    0x00B894, // Mint green
];

/**
 * Generate a random pastel color
 */
function getRandomPastelColor(): number {
    const color = VIBRANT_COLORS[Math.floor(Math.random() * VIBRANT_COLORS.length)];
    return color !== undefined ? color : 0xFF4D6A; // Fallback to vibrant pink
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

    public highlightForDeletion(highlight: boolean): void {
        const material = this.shaftMesh.material as THREE.MeshStandardMaterial;
        if (highlight) {
            material.emissive = new THREE.Color(0xff0000);
            material.emissiveIntensity = 0.5;
        } else {
            material.emissive = new THREE.Color(0x000000);
            material.emissiveIntensity = 0;
        }
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
