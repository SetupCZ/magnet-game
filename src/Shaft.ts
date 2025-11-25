import * as THREE from 'three';
import { Ball, BALL_RADIUS } from './Ball';

export type ShaftSize = 'small' | 'large';

// Shaft dimensions
// Small shaft: for cube edges (distance between adjacent corners)
// Large shaft: for cube diagonals (distance between opposite corners)
const SHAFT_RADIUS = 0.08;

// Calculate shaft lengths
// For a cube with side length 2 (2 ball radii apart):
// - Small shaft connects adjacent corners: length = 2 units
// - Large shaft connects diagonal corners: length = 2 * sqrt(3) ≈ 3.464 units
const CUBE_SIDE = 2.0;
export const SMALL_SHAFT_LENGTH = CUBE_SIDE;
export const LARGE_SHAFT_LENGTH = CUBE_SIDE * Math.sqrt(3);

const SNAP_TOLERANCE = 0.1; // Tolerance for snapping

export class Shaft {
    private mesh: THREE.Mesh;
    private size: ShaftSize;
    private length: number;
    private startBall: Ball | null = null;
    private endBall: Ball | null = null;
    private startDirection: THREE.Vector3 = new THREE.Vector3(0, 1, 0);
    private startMagnet: THREE.Mesh; // Visual indicator for start magnet
    private endMagnet: THREE.Mesh; // Visual indicator for end magnet

    constructor(startPosition: THREE.Vector3, size: ShaftSize, direction?: THREE.Vector3) {
        this.size = size;
        this.length = size === 'small' ? SMALL_SHAFT_LENGTH : LARGE_SHAFT_LENGTH;
        
        if (direction) {
            this.startDirection = direction.clone().normalize();
        }
        
        // Create cylinder shaft
        const geometry = new THREE.CylinderGeometry(
            SHAFT_RADIUS,
            SHAFT_RADIUS,
            this.length,
            16
        );
        
        // Silver metallic material for shaft
        const material = new THREE.MeshStandardMaterial({
            color: 0xaaaaaa,
            metalness: 0.8,
            roughness: 0.3,
        });
        
        this.mesh = new THREE.Mesh(geometry, material);
        this.mesh.castShadow = true;
        this.mesh.receiveShadow = true;
        this.mesh.userData.shaft = this;
        
        // Create magnet end indicators (clickable spheres at both ends)
        const magnetGeometry = new THREE.SphereGeometry(SHAFT_RADIUS * 2, 16, 16);
        const magnetMaterial = new THREE.MeshStandardMaterial({
            color: size === 'small' ? 0x4CAF50 : 0x2196F3, // Green for small, blue for large
            metalness: 0.7,
            roughness: 0.4,
            emissive: size === 'small' ? 0x4CAF50 : 0x2196F3,
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

    public getMesh(): THREE.Mesh {
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
        const targetDistance = this.length + BALL_RADIUS * 2; // Account for both ball radii
        
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
            const length = direction.length();
            
            // Adjust shaft length to fit between balls (accounting for ball radii)
            const adjustedLength = length - BALL_RADIUS * 2;
            this.mesh.scale.y = adjustedLength / this.length;
            
            // Orient shaft
            this.mesh.quaternion.setFromUnitVectors(
                new THREE.Vector3(0, 1, 0),
                direction.normalize()
            );
            
            // Position magnets at both ends
            this.startMagnet.position.set(0, -adjustedLength / 2, 0);
            this.endMagnet.position.set(0, adjustedLength / 2, 0);
            
            // Hide magnets when both ends are connected
            this.startMagnet.visible = false;
            this.endMagnet.visible = false;
            
        } else {
            // Only start connected - shaft points in the start direction
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
            
            // Position magnets
            this.startMagnet.position.set(0, -this.length / 2, 0);
            this.endMagnet.position.set(0, this.length / 2, 0);
            
            // Show end magnet, hide start magnet
            this.startMagnet.visible = false;
            this.endMagnet.visible = true;
            
            // Make end magnet pulse
            const material = this.endMagnet.material as THREE.MeshStandardMaterial;
            material.emissiveIntensity = 0.5 + Math.sin(Date.now() * 0.003) * 0.3;
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
            
            // If there's an end ball, make it the new start
            if (this.endBall) {
                this.startBall = this.endBall;
                this.endBall = null;
                // Reverse direction
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
        
        // Get the world position of the end magnet
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
        
        // Create cylinder shaft with transparent material
        const geometry = new THREE.CylinderGeometry(
            SHAFT_RADIUS,
            SHAFT_RADIUS,
            length,
            16
        );
        
        const material = new THREE.MeshStandardMaterial({
            color: 0xaaaaaa,
            metalness: 0.5,
            roughness: 0.3,
            transparent: true,
            opacity: 0.4,
            depthWrite: false,
        });
        
        const mesh = new THREE.Mesh(geometry, material);
        mesh.castShadow = false;
        mesh.receiveShadow = false;
        group.add(mesh);
        
        // Create magnet end indicator (only show the free end)
        const magnetGeometry = new THREE.SphereGeometry(SHAFT_RADIUS * 2, 16, 16);
        const magnetMaterial = new THREE.MeshStandardMaterial({
            color: size === 'small' ? 0x4CAF50 : 0x2196F3,
            metalness: 0.5,
            roughness: 0.4,
            transparent: true,
            opacity: 0.5,
            depthWrite: false,
        });
        
        const endMagnet = new THREE.Mesh(magnetGeometry, magnetMaterial);
        endMagnet.position.set(0, length / 2, 0);
        group.add(endMagnet);
        
        // Store length for positioning calculations
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
        
        // Position: start from ball surface, then offset to center of shaft
        const connectionPoint = ballPosition.clone().add(
            direction.clone().normalize().multiplyScalar(BALL_RADIUS)
        );
        
        const shaftCenter = connectionPoint.clone().add(
            direction.clone().normalize().multiplyScalar(length / 2)
        );
        
        preview.position.copy(shaftCenter);
        
        // Orient shaft in the direction
        preview.quaternion.setFromUnitVectors(
            new THREE.Vector3(0, 1, 0),
            direction.clone().normalize()
        );
    }
}
