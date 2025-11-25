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

    // Get the world position of the free end of the shaft
    public getFreeEndPosition(): THREE.Vector3 | null {
        if (this.isFullyConnected() || !this.startBall) return null;
        
        // Get the world position of the end magnet
        const worldPos = new THREE.Vector3();
        this.endMagnet.getWorldPosition(worldPos);
        return worldPos;
    }
}
