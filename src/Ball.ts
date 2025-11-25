import * as THREE from 'three';
import type { Shaft } from './Shaft';

export const BALL_RADIUS = 0.5;

export class Ball {
    private mesh: THREE.Mesh;
    private position: THREE.Vector3;
    private connectedShafts: Shaft[] = [];
    private locked: boolean = false; // For constraint solving

    constructor(position: THREE.Vector3) {
        this.position = position.clone();
        
        // Create metallic steel ball
        const geometry = new THREE.SphereGeometry(BALL_RADIUS, 32, 32);
        const material = new THREE.MeshStandardMaterial({
            color: 0x888888,
            metalness: 0.9,
            roughness: 0.2,
        });
        
        this.mesh = new THREE.Mesh(geometry, material);
        this.mesh.position.copy(this.position);
        this.mesh.castShadow = true;
        this.mesh.receiveShadow = true;
        
        // Store reference to this Ball instance in the mesh userData
        this.mesh.userData.ball = this;
    }

    public getMesh(): THREE.Mesh {
        return this.mesh;
    }

    public getPosition(): THREE.Vector3 {
        return this.mesh.position;
    }

    public setPosition(position: THREE.Vector3): void {
        this.mesh.position.copy(position);
        this.position.copy(position);
    }

    public addConnectedShaft(shaft: Shaft): void {
        if (!this.connectedShafts.includes(shaft)) {
            this.connectedShafts.push(shaft);
        }
    }

    public removeConnectedShaft(shaft: Shaft): void {
        const index = this.connectedShafts.indexOf(shaft);
        if (index > -1) {
            this.connectedShafts.splice(index, 1);
        }
    }

    public getConnectedShafts(): Shaft[] {
        return this.connectedShafts;
    }

    public getConnectedBalls(): Ball[] {
        const balls: Ball[] = [];
        this.connectedShafts.forEach(shaft => {
            if (shaft.getStartBall() === this && shaft.getEndBall()) {
                balls.push(shaft.getEndBall()!);
            } else if (shaft.getEndBall() === this && shaft.getStartBall()) {
                balls.push(shaft.getStartBall()!);
            }
        });
        return balls;
    }

    public setLocked(locked: boolean): void {
        this.locked = locked;
    }

    public isLocked(): boolean {
        return this.locked;
    }

    // Calculate the connection point on the ball's surface facing toward a target
    public getConnectionPoint(target: THREE.Vector3): THREE.Vector3 {
        const direction = new THREE.Vector3()
            .subVectors(target, this.position)
            .normalize();
        
        return this.position.clone().add(direction.multiplyScalar(BALL_RADIUS));
    }

    // Highlight the ball when hovered
    public highlight(isHighlighted: boolean): void {
        const material = this.mesh.material as THREE.MeshStandardMaterial;
        if (isHighlighted) {
            material.emissive = new THREE.Color(0x2196F3);
            material.emissiveIntensity = 0.3;
        } else {
            material.emissive = new THREE.Color(0x000000);
            material.emissiveIntensity = 0;
        }
    }
}
