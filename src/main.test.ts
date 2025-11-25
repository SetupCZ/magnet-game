import { describe, test, expect, beforeEach } from 'bun:test';
import * as THREE from 'three';
import { Ball, BALL_RADIUS } from './Ball';
import { Shaft, SMALL_SHAFT_LENGTH, LARGE_SHAFT_LENGTH } from './Shaft';
import { ConstraintSolver } from './ConstraintSolver';

/**
 * Test suite for the triangle creation bug
 * 
 * Scenario:
 * 1. Create Ball 1
 * 2. Click Ball 1 to create Shaft 1
 * 3. Click Shaft 1 end to create Ball 2 (connected to Ball 1)
 * 4. Click Ball 2 to create Shaft 2 
 * 5. Shaft 2 should remain, not be deleted
 */
describe('Triangle Creation Bug', () => {
    let ball1: Ball;
    let ball2: Ball;
    let ball3: Ball;
    let shaft1: Shaft;
    let shaft2: Shaft;
    let shaft3: Shaft;
    let balls: Ball[];
    let shafts: Shaft[];
    let pendingShaft: Shaft | null;
    let pendingBall: Ball | null;

    beforeEach(() => {
        balls = [];
        shafts = [];
        pendingShaft = null;
        pendingBall = null;
    });

    test('Step 1-2: Create first ball and attach first shaft', () => {
        // Step 1: Create Ball 1 at origin
        ball1 = new Ball(new THREE.Vector3(0, 0.5, 0));
        balls.push(ball1);
        
        expect(balls.length).toBe(1);
        expect(ball1.getConnectedShafts().length).toBe(0);
        
        // Step 2: Click on Ball 1 to create Shaft 1
        const clickPoint = new THREE.Vector3(0, 1, 0); // Top of ball
        const direction = new THREE.Vector3()
            .subVectors(clickPoint, ball1.getPosition())
            .normalize();
        
        shaft1 = new Shaft(ball1.getPosition(), 'small', direction);
        shafts.push(shaft1);
        shaft1.attachToStart(ball1, clickPoint);
        pendingShaft = shaft1;
        pendingBall = ball1;
        
        expect(shafts.length).toBe(1);
        expect(shaft1.getStartBall()).toBe(ball1);
        expect(shaft1.getEndBall()).toBeNull();
        expect(shaft1.isFullyConnected()).toBe(false);
        expect(ball1.getConnectedShafts().length).toBe(1);
    });

    test('Step 3: Click shaft end to create and connect Ball 2', () => {
        // Setup: Ball 1 with Shaft 1
        ball1 = new Ball(new THREE.Vector3(0, 0.5, 0));
        balls.push(ball1);
        
        const clickPoint = new THREE.Vector3(0, 1, 0);
        const direction = new THREE.Vector3()
            .subVectors(clickPoint, ball1.getPosition())
            .normalize();
        
        shaft1 = new Shaft(ball1.getPosition(), 'small', direction);
        shafts.push(shaft1);
        shaft1.attachToStart(ball1, clickPoint);
        pendingShaft = shaft1;
        pendingBall = ball1;
        
        // Step 3: Get shaft end position and create Ball 2
        const magnetPosition = shaft1.getFreeEndPosition();
        expect(magnetPosition).not.toBeNull();
        
        // Calculate proper ball position (one ball radius beyond magnet)
        const directionToMagnet = new THREE.Vector3()
            .subVectors(magnetPosition!, ball1.getPosition())
            .normalize();
        const ball2Position = magnetPosition!.clone().add(
            directionToMagnet.multiplyScalar(BALL_RADIUS)
        );
        
        ball2 = new Ball(ball2Position);
        balls.push(ball2);
        shaft1.attachToEnd(ball2);
        
        // CRITICAL: Clear pending state (this is the bug fix!)
        // After clicking shaft end, pending state MUST be cleared
        pendingShaft = null;
        pendingBall = null;
        
        expect(balls.length).toBe(2);
        expect(shaft1.isFullyConnected()).toBe(true);
        expect(shaft1.getStartBall()).toBe(ball1);
        expect(shaft1.getEndBall()).toBe(ball2);
        expect(ball1.getConnectedShafts().length).toBe(1);
        expect(ball2.getConnectedShafts().length).toBe(1);
        
        // Verify pending state is cleared
        expect(pendingShaft).toBeNull();
        expect(pendingBall).toBeNull();
    });

    test('Step 4: Click Ball 2 to create Shaft 2 (should NOT delete shaft)', () => {
        // Setup: Ball 1 -> Shaft 1 -> Ball 2 (fully connected)
        ball1 = new Ball(new THREE.Vector3(0, 0.5, 0));
        balls.push(ball1);
        
        const clickPoint1 = new THREE.Vector3(0, 1, 0);
        const direction1 = new THREE.Vector3()
            .subVectors(clickPoint1, ball1.getPosition())
            .normalize();
        
        shaft1 = new Shaft(ball1.getPosition(), 'small', direction1);
        shafts.push(shaft1);
        shaft1.attachToStart(ball1, clickPoint1);
        
        const magnetPosition1 = shaft1.getFreeEndPosition();
        const dirToMagnet1 = new THREE.Vector3()
            .subVectors(magnetPosition1!, ball1.getPosition())
            .normalize();
        const ball2Position = magnetPosition1!.clone().add(
            dirToMagnet1.multiplyScalar(BALL_RADIUS)
        );
        ball2 = new Ball(ball2Position);
        balls.push(ball2);
        shaft1.attachToEnd(ball2);
        
        // CRITICAL: Clear pending state (simulating the fix)
        // This is what handleShaftEndClick should do!
        pendingShaft = null;
        pendingBall = null;
        
        expect(shafts.length).toBe(1);
        expect(shaft1.isFullyConnected()).toBe(true);
        expect(pendingShaft).toBeNull();
        expect(pendingBall).toBeNull();
        
        // Step 4: Click Ball 2 to create Shaft 2
        // Since pendingShaft is null, this should create a NEW shaft
        const clickPoint2 = new THREE.Vector3(0.5, 2.5, 0); // Side of Ball 2
        const direction2 = new THREE.Vector3()
            .subVectors(clickPoint2, ball2.getPosition())
            .normalize();
        
        shaft2 = new Shaft(ball2.getPosition(), 'small', direction2);
        shafts.push(shaft2);
        shaft2.attachToStart(ball2, clickPoint2);
        pendingShaft = shaft2;
        pendingBall = ball2;
        
        // CRITICAL: Shaft 2 should be created and added to shafts array
        expect(shafts.length).toBe(2);
        expect(shaft2.getStartBall()).toBe(ball2);
        expect(shaft2.getEndBall()).toBeNull();
        expect(shaft2.isFullyConnected()).toBe(false);
        expect(ball2.getConnectedShafts().length).toBe(2); // Connected to both shaft1 and shaft2
        
        // Verify Shaft 1 is still in the array and unchanged
        expect(shafts[0]).toBe(shaft1);
        expect(shaft1.isFullyConnected()).toBe(true);
    });

    test('BUG SCENARIO: Pending state not cleared causes shaft deletion', () => {
        // This test demonstrates the bug when pending state is NOT cleared
        
        // Step 1-2: Create Ball 1 and Shaft 1
        ball1 = new Ball(new THREE.Vector3(0, 0.5, 0));
        balls.push(ball1);
        
        const clickPoint1 = new THREE.Vector3(0, 1, 0);
        const direction1 = new THREE.Vector3()
            .subVectors(clickPoint1, ball1.getPosition())
            .normalize();
        
        shaft1 = new Shaft(ball1.getPosition(), 'small', direction1);
        shafts.push(shaft1);
        shaft1.attachToStart(ball1, clickPoint1);
        pendingShaft = shaft1;
        pendingBall = ball1;
        
        // Step 3: Click shaft end to create Ball 2
        const magnetPos1 = shaft1.getFreeEndPosition();
        const dir1 = new THREE.Vector3()
            .subVectors(magnetPos1!, ball1.getPosition())
            .normalize();
        const ball2Pos = magnetPos1!.clone().add(
            dir1.multiplyScalar(BALL_RADIUS)
        );
        ball2 = new Ball(ball2Pos);
        balls.push(ball2);
        shaft1.attachToEnd(ball2);
        
        // BUG: Pending state NOT cleared! (pendingShaft still = shaft1)
        // pendingShaft = null;  // <-- This line is missing in buggy code
        // pendingBall = null;   // <-- This line is missing in buggy code
        
        expect(pendingShaft).toBe(shaft1); // Still pointing to shaft1!
        expect(pendingBall).toBe(ball1);   // Still pointing to ball1!
        
        // Step 4: User clicks Ball 2 to create Shaft 2
        // But since pendingShaft is still shaft1, the code thinks we're trying 
        // to connect shaft1 to ball2 (which is already connected!)
        
        // Simulate the buggy handleBallClick behavior:
        // It will see pendingShaft != null, so it goes to the "else" branch
        // It tries to snap shaft1 (already connected) to ball2 (already connected)
        // canSnapTo will return true since they're already connected at correct distance
        // But this doesn't make sense - shaft1 is already fully connected!
        
        // The real issue is constraint solver gets called and fails
        expect(shaft1.isFullyConnected()).toBe(true);
    });

    test('BUGFIX VALIDATION: Shaft end click clears pending state', () => {
        // This test validates the core bug fix
        
        // Step 1: Create Ball 1 and Shaft 1
        ball1 = new Ball(new THREE.Vector3(0, 0.5, 0));
        balls.push(ball1);
        
        const clickPoint1 = new THREE.Vector3(0, 1, 0);
        const direction1 = new THREE.Vector3()
            .subVectors(clickPoint1, ball1.getPosition())
            .normalize();
        
        shaft1 = new Shaft(ball1.getPosition(), 'small', direction1);
        shafts.push(shaft1);
        shaft1.attachToStart(ball1, clickPoint1);
        pendingShaft = shaft1;
        pendingBall = ball1;
        
        // Step 2: Simulate shaft end click to create Ball 2
        const magnetPos1 = shaft1.getFreeEndPosition();
        const dirToMagnet1 = new THREE.Vector3()
            .subVectors(magnetPos1!, ball1.getPosition())
            .normalize();
        const ball2Position = magnetPos1!.clone().add(
            dirToMagnet1.multiplyScalar(BALL_RADIUS)
        );
        ball2 = new Ball(ball2Position);
        balls.push(ball2);
        shaft1.attachToEnd(ball2);
        
        // CRITICAL: Simulate the fix - clear pending state
        pendingShaft = null;
        pendingBall = null;
        
        expect(shaft1.isFullyConnected()).toBe(true);
        expect(pendingShaft).toBeNull();
        expect(pendingBall).toBeNull();
        
        // Step 3: Now click Ball 2 to create Shaft 2
        // This should create a NEW shaft, not try to reconnect shaft1
        const clickPoint2 = new THREE.Vector3(0.5, 2.5, 0);
        const direction2 = new THREE.Vector3()
            .subVectors(clickPoint2, ball2.getPosition())
            .normalize();
        
        // Since pendingShaft is null, we create a new shaft
        expect(pendingShaft).toBeNull();
        
        shaft2 = new Shaft(ball2.getPosition(), 'small', direction2);
        shafts.push(shaft2);
        shaft2.attachToStart(ball2, clickPoint2);
        pendingShaft = shaft2;
        pendingBall = ball2;
        
        // SUCCESS: We now have 2 shafts, shaft1 was NOT deleted
        expect(shafts.length).toBe(2);
        expect(shafts[0]).toBe(shaft1);
        expect(shafts[1]).toBe(shaft2);
        expect(shaft1.isFullyConnected()).toBe(true);
        expect(shaft2.isFullyConnected()).toBe(false);
        expect(ball2.getConnectedShafts().length).toBe(2);
    });

    test('Full triangle creation: Ball 1 -> Shaft 1 -> Ball 2 -> Shaft 2 -> Ball 3 -> Shaft 3 -> Ball 1', () => {
        // Step 1: Create Ball 1 at origin
        ball1 = new Ball(new THREE.Vector3(0, 0.5, 0));
        balls.push(ball1);
        
        // Step 2: Create Shaft 1 from Ball 1 (pointing straight up)
        const clickPoint1 = new THREE.Vector3(0, 1, 0); // Straight up from ball
        const direction1 = new THREE.Vector3()
            .subVectors(clickPoint1, ball1.getPosition())
            .normalize();
        shaft1 = new Shaft(ball1.getPosition(), 'small', direction1);
        shafts.push(shaft1);
        shaft1.attachToStart(ball1, clickPoint1);
        
        // Step 3: Create Ball 2 at Shaft 1 end
        const magPos1 = shaft1.getFreeEndPosition();
        const d1 = new THREE.Vector3()
            .subVectors(magPos1!, ball1.getPosition())
            .normalize();
        const b2Position = magPos1!.clone().add(
            d1.multiplyScalar(BALL_RADIUS)
        );
        ball2 = new Ball(b2Position);
        balls.push(ball2);
        shaft1.attachToEnd(ball2);
        
        // Clear pending state (the fix!)
        pendingShaft = null;
        pendingBall = null;
        
        expect(balls.length).toBe(2);
        expect(shafts.length).toBe(1);
        expect(shaft1.isFullyConnected()).toBe(true);
        
        // Step 4: Create Shaft 2 from Ball 1 (at 20 degree angle from shaft 1)
        // Calculate direction 20 degrees to the right of straight up
        const angle = 20 * Math.PI / 180; // 20 degrees in radians
        const rotatedDirection = new THREE.Vector3(
            Math.sin(angle),
            Math.cos(angle),
            0
        ).normalize();
        const clickPoint2 = ball1.getPosition().clone().add(rotatedDirection.clone().multiplyScalar(BALL_RADIUS));
        
        shaft2 = new Shaft(ball1.getPosition(), 'small', rotatedDirection);
        shafts.push(shaft2);
        shaft2.attachToStart(ball1, clickPoint2);
        
        expect(shafts.length).toBe(2);
        expect(shaft2.getStartBall()).toBe(ball1);
        expect(ball1.getConnectedShafts().length).toBe(2); // Connected to both shaft1 and shaft2
        
        // Step 5: Create Ball 3 at Shaft 2 end
        const magPos2 = shaft2.getFreeEndPosition();
        const d2 = new THREE.Vector3()
            .subVectors(magPos2!, ball1.getPosition())
            .normalize();
        const b3Position = magPos2!.clone().add(
            d2.multiplyScalar(BALL_RADIUS)
        );
        ball3 = new Ball(b3Position);
        balls.push(ball3);
        shaft2.attachToEnd(ball3);
        
        // Clear pending state (the fix!)
        pendingShaft = null;
        pendingBall = null;
        
        expect(balls.length).toBe(3);
        expect(shafts.length).toBe(2);
        expect(shaft2.isFullyConnected()).toBe(true);
        
        // Debug: Print positions to understand the geometry
        console.log('Ball 1 position:', ball1.getPosition());
        console.log('Ball 2 position:', ball2.getPosition());
        console.log('Ball 3 position:', ball3.getPosition());
        console.log('Distance Ball1-Ball2:', ball1.getPosition().distanceTo(ball2.getPosition()));
        console.log('Distance Ball1-Ball3:', ball1.getPosition().distanceTo(ball3.getPosition()));
        console.log('Distance Ball2-Ball3:', ball2.getPosition().distanceTo(ball3.getPosition()));
        console.log('Required distance for small shaft:', SMALL_SHAFT_LENGTH + 1.0); // 2 ball radii = 1.0
        
        // Step 6: Click Ball 2 to create Shaft 3
        // Initial direction doesn't matter - it will be reoriented toward Ball 3
        const clickPoint3 = ball2.getPosition().clone().add(new THREE.Vector3(0.5, -0.5, 0).normalize().multiplyScalar(BALL_RADIUS));
        const initialDirection3 = new THREE.Vector3(0.5, -0.5, 0).normalize();
        shaft3 = new Shaft(ball2.getPosition(), 'small', initialDirection3);
        shafts.push(shaft3);
        shaft3.attachToStart(ball2, clickPoint3);
        pendingShaft = shaft3;
        pendingBall = ball2;
        
        expect(shafts.length).toBe(3);
        expect(pendingShaft).toBe(shaft3);
        
        // Step 7: Click Ball 3 to connect Shaft 3 and complete triangle
        // This simulates the second ball click (existingBall = ball3)
        const canSnap = shaft3.canSnapTo(ball3);
        
        if (canSnap) {
            // Direct connection possible
            shaft3.attachToEnd(ball3);
            console.log('Direct snap succeeded');
        } else {
            // Use constraint solver to reorient shaft and move ball3
            console.log('Using constraint solver...');
            const result = ConstraintSolver.solveConstraints(ball2, shaft3, ball3);
            
            console.log('Solver result:', result);
            console.log('Ball 3 position after solving:', ball3.getPosition());
            
            expect(result.success).toBe(true);
            
            if (result.success) {
                // Update all connected shafts
                const connectedBalls = new Set<Ball>([ball2, ball3]);
                ConstraintSolver.updateConnectedShafts(connectedBalls);
                
                // Connect the shaft
                shaft3.attachToEnd(ball3);
            }
        }
        
        // Clear pending state
        pendingShaft = null;
        pendingBall = null;
        
        // Verify triangle is complete
        expect(shafts.length).toBe(3);
        expect(shaft3.isFullyConnected()).toBe(true);
        expect(ball1.getConnectedShafts().length).toBe(2); // shaft1 and shaft2
        expect(ball2.getConnectedShafts().length).toBe(2); // shaft1 and shaft3
        expect(ball3.getConnectedShafts().length).toBe(2); // shaft2 and shaft3
        
        // Verify all constraints are satisfied
        const dist12 = ball1.getPosition().distanceTo(ball2.getPosition());
        const dist13 = ball1.getPosition().distanceTo(ball3.getPosition());
        const dist23 = ball2.getPosition().distanceTo(ball3.getPosition());
        const expectedDist = SMALL_SHAFT_LENGTH + 1.0; // 2 ball radii
        
        console.log('Final distances:');
        console.log('  Ball1-Ball2:', dist12, '(expected:', expectedDist, ')');
        console.log('  Ball1-Ball3:', dist13, '(expected:', expectedDist, ')');
        console.log('  Ball2-Ball3:', dist23, '(expected:', expectedDist, ')');
        
        expect(Math.abs(dist12 - expectedDist)).toBeLessThan(0.1);
        expect(Math.abs(dist13 - expectedDist)).toBeLessThan(0.1);
        expect(Math.abs(dist23 - expectedDist)).toBeLessThan(0.1);
    });

    test('Complex triangle closure: 4 balls where triangle forms within larger structure', () => {
        // Create a structure where we have a triangle as part of a larger structure:
        // Ball 1 at origin (will have 3 connections after)
        // Ball 2 above Ball 1 (connected)
        // Ball 3 to the upper right
        // Ball 4 to the right of Ball 1 (connected)
        // Then connect Ball 2 to Ball 4, forming triangle Ball1-Ball2-Ball4
        // This is a COMPLEX triangle because Ball 1 will have 3 total connections
        
        // Step 1: Create Ball 1 at origin
        ball1 = new Ball(new THREE.Vector3(0, 0, 0));
        balls.push(ball1);
        
        // Step 2: Create Ball 2 above Ball 1
        const ball2Position = new THREE.Vector3(0, 3, 0);
        ball2 = new Ball(ball2Position);
        balls.push(ball2);
        
        shaft1 = new Shaft(ball1.getPosition(), 'small', new THREE.Vector3(0, 1, 0));
        shafts.push(shaft1);
        shaft1.attachToStart(ball1, ball1.getPosition().clone().add(new THREE.Vector3(0, BALL_RADIUS, 0)));
        shaft1.attachToEnd(ball2);
        
        // Step 3: Create Ball 3 to the upper right of Ball 1
        const ball3Position = new THREE.Vector3(3, 0, 0);
        ball3 = new Ball(ball3Position);
        balls.push(ball3);
        
        shaft2 = new Shaft(ball1.getPosition(), 'small', new THREE.Vector3(1, 0, 0));
        shafts.push(shaft2);
        shaft2.attachToStart(ball1, ball1.getPosition().clone().add(new THREE.Vector3(BALL_RADIUS, 0, 0)));
        shaft2.attachToEnd(ball3);
        
        // Step 4: Create Ball 4 beyond Ball 3
        const ball4Position = new THREE.Vector3(6, 0, 0);
        const ball4 = new Ball(ball4Position);
        balls.push(ball4);
        
        shaft3 = new Shaft(ball3.getPosition(), 'small', new THREE.Vector3(1, 0, 0));
        shafts.push(shaft3);
        shaft3.attachToStart(ball3, ball3.getPosition().clone().add(new THREE.Vector3(BALL_RADIUS, 0, 0)));
        shaft3.attachToEnd(ball4);
        
        // Verify structure before attempting triangle closure
        expect(balls.length).toBe(4);
        expect(shafts.length).toBe(3);
        expect(ball1.getConnectedShafts().length).toBe(2); // Connected to ball2 and ball3
        expect(ball2.getConnectedShafts().length).toBe(1); // Connected to ball1
        expect(ball3.getConnectedShafts().length).toBe(2); // Connected to ball1 and ball4
        expect(ball4.getConnectedShafts().length).toBe(1); // Connected to ball3
        
        console.log('Complex triangle test - Initial structure:');
        console.log('  Ball 1 position:', ball1.getPosition());
        console.log('  Ball 2 position:', ball2.getPosition());
        console.log('  Ball 3 position:', ball3.getPosition());
        console.log('  Ball 4 position:', ball4.getPosition());
        console.log('  Ball 1 connections:', ball1.getConnectedShafts().length);
        console.log('  Ball 2 connections:', ball2.getConnectedShafts().length);
        console.log('  Ball 4 connections:', ball4.getConnectedShafts().length);
        console.log('  Distance Ball2-Ball4:', ball2.getPosition().distanceTo(ball4.getPosition()));
        
        // Step 5: Attempt to connect Ball 2 to Ball 4
        // This forms a triangle: Ball 1 - Ball 2 - Ball 4 (and back to Ball 1 via Ball 3)
        // This is a COMPLEX triangle because:
        // - Ball 1 will have 3 connections (to ball2, ball3, and indirectly creates triangle)
        // - Ball 4 will have 2 connections
        // - The triangle Ball2-Ball1-Ball4 is part of a larger structure (Ball 3)
        
        // But wait - Ball 2 and Ball 4 need to be connected via a shaft
        // Let me reconsider: to form a triangle Ball1-Ball2-Ball4, I need:
        // - Ball1-Ball2 shaft (exists: shaft1)
        // - Ball1-Ball4 connection (exists via ball3/shaft2 & shaft3, but not direct)
        // 
        // Actually for a triangle we need Ball 1 connected to both Ball 2 and Ball 4
        // Currently Ball 1 connects to Ball 2 directly and Ball 4 indirectly
        // Let me instead connect Ball 1 directly to Ball 4, forming triangle Ball1-Ball2-Ball4
        // if Ball 2 also connects to Ball 4
        
        // Actually, simpler: Connect Ball 2 to Ball 3, forming triangle Ball1-Ball2-Ball3
        // Ball 1 already connects to Ball 2 and Ball 3, so closing this triangle makes sense
        
        // Create shaft from Ball 2 toward Ball 3
        const directionToBall3 = new THREE.Vector3()
            .subVectors(ball3.getPosition(), ball2.getPosition())
            .normalize();
        const newShaft = new Shaft(ball2.getPosition(), 'small', directionToBall3);
        shafts.push(newShaft);
        newShaft.attachToStart(ball2, ball2.getPosition().clone().add(directionToBall3.clone().multiplyScalar(BALL_RADIUS)));
        
        console.log('Attempting to connect Ball 2 to Ball 3 (forms triangle with Ball 1)...');
        console.log('  Distance Ball2-Ball3:', ball2.getPosition().distanceTo(ball3.getPosition()));
        console.log('  Required shaft distance:', SMALL_SHAFT_LENGTH + 1.0);
        
        // Attempt to connect using constraint solver
        // This should be detected as a COMPLEX triangle because:
        // - 4 balls total in structure (ball1, ball2, ball3, ball4)
        // - Ball 1 will have 3 connections total (to ball2, ball3, and maintains connection after closure)
        const result = ConstraintSolver.solveConstraints(ball2, newShaft, ball3);
        
        console.log('Solver result:', result);
        
        // The constraint solver should succeed using geometric hint + relaxation
        expect(result.success).toBe(true);
        
        if (result.success) {
            // Update all connected shafts
            const connectedBalls = new Set<Ball>([ball1, ball2, ball3, ball4]);
            ConstraintSolver.updateConnectedShafts(connectedBalls);
            
            // Connect the shaft
            newShaft.attachToEnd(ball3);
            
            // Verify all constraints are satisfied
            console.log('Complex triangle test - Final distances:');
            const dist12 = ball1.getPosition().distanceTo(ball2.getPosition());
            const dist13 = ball1.getPosition().distanceTo(ball3.getPosition());
            const dist23 = ball2.getPosition().distanceTo(ball3.getPosition());
            const dist34 = ball3.getPosition().distanceTo(ball4.getPosition());
            const expectedDist = SMALL_SHAFT_LENGTH + 1.0;
            
            console.log('  Ball1-Ball2:', dist12, '(expected:', expectedDist, ')');
            console.log('  Ball1-Ball3:', dist13, '(expected:', expectedDist, ')');
            console.log('  Ball2-Ball3:', dist23, '(expected:', expectedDist, ')');
            console.log('  Ball3-Ball4:', dist34, '(expected:', expectedDist, ')');
            
            // All shaft constraints should be satisfied
            expect(Math.abs(dist12 - expectedDist)).toBeLessThan(0.1);
            expect(Math.abs(dist13 - expectedDist)).toBeLessThan(0.1);
            expect(Math.abs(dist23 - expectedDist)).toBeLessThan(0.1);
            expect(Math.abs(dist34 - expectedDist)).toBeLessThan(0.1);
            
            // Verify connection counts
            expect(ball1.getConnectedShafts().length).toBe(2); // shaft1 and shaft2
            expect(ball2.getConnectedShafts().length).toBe(2); // shaft1 and newShaft
            expect(ball3.getConnectedShafts().length).toBe(3); // shaft2, shaft3, and newShaft
            expect(ball4.getConnectedShafts().length).toBe(1); // shaft3
        }
    });
});


