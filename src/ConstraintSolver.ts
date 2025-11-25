import * as THREE from 'three';
import { Ball, BALL_RADIUS } from './Ball';
import { Shaft } from './Shaft';
import { Logger } from './Logger';

const POSITION_TOLERANCE = 0.001;
const MAX_ITERATIONS = 500;

interface BallState {
    ball: Ball;
    originalPosition: THREE.Vector3;
    newPosition: THREE.Vector3;
    mass: number; // Higher mass = moves less
}

interface Constraint {
    ball1: Ball;
    ball2: Ball;
    distance: number;
    shaft: Shaft | null; // null for pending connection
}

interface ConnectionPlan {
    valid: boolean;
    message: string;
    ballStates: Map<Ball, BallState>;
}

export class ConstraintSolver {
    /**
     * Main entry point: attempts to connect a pending shaft to a target ball.
     */
    public static solveConstraints(
        sourceBall: Ball,
        newShaft: Shaft,
        targetBall: Ball
    ): { success: boolean; message: string } {
        Logger.log('[ConstraintSolver] Starting connection attempt', {
            sourceBallPos: sourceBall.getPosition(),
            targetBallPos: targetBall.getPosition(),
            shaftLength: newShaft.getLength()
        });

        const requiredDistance = newShaft.getLength() + BALL_RADIUS * 2;
        const currentDistance = sourceBall.getPosition().distanceTo(targetBall.getPosition());
        
        Logger.log('[ConstraintSolver] Distance analysis', {
            currentDistance,
            requiredDistance,
            gap: currentDistance - requiredDistance
        });

        // Get all connected balls
        const allBalls = this.getAllConnectedBalls(sourceBall, targetBall);
        
        Logger.log('[ConstraintSolver] Structure analysis', {
            totalBalls: allBalls.size
        });

        // Orient the shaft toward the target ball
        const direction = new THREE.Vector3()
            .subVectors(targetBall.getPosition(), sourceBall.getPosition())
            .normalize();
        newShaft.setStartDirection(direction);

        // Create the connection plan
        const plan = this.createPlan(sourceBall, targetBall, requiredDistance, allBalls);

        if (!plan.valid) {
            Logger.log('[ConstraintSolver] Plan invalid', { message: plan.message });
            return { success: false, message: plan.message };
        }

        // Validate
        const validation = this.validatePlan(plan, newShaft, sourceBall, targetBall);
        if (!validation.valid) {
            Logger.log('[ConstraintSolver] Validation failed', { message: validation.message });
            return { success: false, message: validation.message };
        }

        // Apply
        this.applyPlan(plan);
        
        Logger.log('[ConstraintSolver] Connection successful');
        return { success: true, message: `Connected! Adjusted ${plan.ballStates.size} balls.` };
    }

    /**
     * Gets all balls connected to either source or target
     */
    private static getAllConnectedBalls(sourceBall: Ball, targetBall: Ball): Set<Ball> {
        const visited = new Set<Ball>();
        const queue: Ball[] = [sourceBall, targetBall];
        
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

    /**
     * Creates a plan to satisfy all constraints including the new connection
     */
    private static createPlan(
        sourceBall: Ball,
        targetBall: Ball,
        requiredDistance: number,
        allBalls: Set<Ball>
    ): ConnectionPlan {
        // Initialize ball states
        const ballStates = new Map<Ball, BallState>();
        for (const ball of allBalls) {
            const connections = ball.getConnectedShafts().filter(s => s.isFullyConnected()).length;
            ballStates.set(ball, {
                ball,
                originalPosition: ball.getPosition().clone(),
                newPosition: ball.getPosition().clone(),
                mass: 1 + connections // More connections = higher mass = moves less
            });
        }

        // Collect all constraints (existing shafts + new connection)
        const constraints = this.collectConstraints(allBalls, sourceBall, targetBall, requiredDistance);
        
        Logger.log('[Planner] Constraints collected', {
            total: constraints.length,
            existing: constraints.filter(c => c.shaft !== null).length,
            pending: constraints.filter(c => c.shaft === null).length
        });

        // Run iterative solver
        const result = this.solve(ballStates, constraints);

        if (!result.converged) {
            return {
                valid: false,
                message: `Cannot satisfy constraints (error: ${result.maxError.toFixed(3)})`,
                ballStates
            };
        }

        return { valid: true, message: 'Plan created', ballStates };
    }

    /**
     * Collects all constraints
     */
    private static collectConstraints(
        allBalls: Set<Ball>,
        sourceBall: Ball,
        targetBall: Ball,
        requiredDistance: number
    ): Constraint[] {
        const constraints: Constraint[] = [];
        const seenShafts = new Set<Shaft>();

        // Collect existing shaft constraints
        for (const ball of allBalls) {
            for (const shaft of ball.getConnectedShafts()) {
                if (seenShafts.has(shaft)) continue;
                if (!shaft.isFullyConnected()) continue;
                
                seenShafts.add(shaft);
                
                constraints.push({
                    ball1: shaft.getStartBall()!,
                    ball2: shaft.getEndBall()!,
                    distance: shaft.getLength() + BALL_RADIUS * 2,
                    shaft
                });
            }
        }

        // Add the pending connection constraint
        constraints.push({
            ball1: sourceBall,
            ball2: targetBall,
            distance: requiredDistance,
            shaft: null
        });

        return constraints;
    }

    /**
     * Iterative position-based constraint solver
     */
    private static solve(
        ballStates: Map<Ball, BallState>,
        constraints: Constraint[]
    ): { converged: boolean; maxError: number; iterations: number } {
        let maxError = Infinity;
        
        for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
            maxError = 0;

            // Apply each constraint
            for (const constraint of constraints) {
                const state1 = ballStates.get(constraint.ball1);
                const state2 = ballStates.get(constraint.ball2);
                if (!state1 || !state2) continue;

                const pos1 = state1.newPosition;
                const pos2 = state2.newPosition;
                
                const delta = new THREE.Vector3().subVectors(pos2, pos1);
                const currentDist = delta.length();
                
                if (currentDist < 0.0001) {
                    // Balls are at same position - nudge them apart
                    delta.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
                } else {
                    delta.normalize();
                }

                const error = currentDist - constraint.distance;
                maxError = Math.max(maxError, Math.abs(error));

                if (Math.abs(error) > POSITION_TOLERANCE) {
                    // Calculate correction based on inverse mass weighting
                    const totalInvMass = (1 / state1.mass) + (1 / state2.mass);
                    const w1 = (1 / state1.mass) / totalInvMass;
                    const w2 = (1 / state2.mass) / totalInvMass;

                    // Relaxation factor - start high for fast convergence, reduce for stability
                    const relaxation = 0.5;
                    
                    // Apply corrections: move balls toward/away from each other
                    // If error > 0, balls are too far apart, move them closer
                    // If error < 0, balls are too close, move them apart
                    const correction = error * relaxation;
                    
                    pos1.add(delta.clone().multiplyScalar(correction * w1));
                    pos2.sub(delta.clone().multiplyScalar(correction * w2));
                }
            }

            if (maxError < POSITION_TOLERANCE) {
                Logger.log('[Solver] Converged', { iter, maxError });
                return { converged: true, maxError, iterations: iter };
            }

            // Log progress
            if (iter % 100 === 0) {
                Logger.log('[Solver] Progress', { iter, maxError: maxError.toFixed(4) });
            }
        }

        Logger.log('[Solver] Did not converge', { maxError: maxError.toFixed(4) });
        return { converged: maxError < POSITION_TOLERANCE * 100, maxError, iterations: MAX_ITERATIONS };
    }

    /**
     * Validates the plan
     */
    private static validatePlan(
        plan: ConnectionPlan,
        newShaft: Shaft,
        sourceBall: Ball,
        targetBall: Ball
    ): { valid: boolean; message: string } {
        const requiredNewDist = newShaft.getLength() + BALL_RADIUS * 2;
        
        const sourceState = plan.ballStates.get(sourceBall);
        const targetState = plan.ballStates.get(targetBall);
        
        if (!sourceState || !targetState) {
            return { valid: false, message: 'Missing ball states' };
        }
        
        // Check new connection
        const newConnDist = sourceState.newPosition.distanceTo(targetState.newPosition);
        const newConnError = Math.abs(newConnDist - requiredNewDist);
        
        if (newConnError > POSITION_TOLERANCE * 100) {
            return { 
                valid: false, 
                message: `New connection error: ${newConnError.toFixed(3)}` 
            };
        }

        // Check existing shafts
        const checkedShafts = new Set<Shaft>();
        let maxError = 0;
        
        for (const [ball] of plan.ballStates) {
            for (const shaft of ball.getConnectedShafts()) {
                if (checkedShafts.has(shaft) || !shaft.isFullyConnected()) continue;
                checkedShafts.add(shaft);
                
                const start = plan.ballStates.get(shaft.getStartBall()!);
                const end = plan.ballStates.get(shaft.getEndBall()!);
                if (!start || !end) continue;
                
                const dist = start.newPosition.distanceTo(end.newPosition);
                const required = shaft.getLength() + BALL_RADIUS * 2;
                const error = Math.abs(dist - required);
                
                maxError = Math.max(maxError, error);
            }
        }

        if (maxError > POSITION_TOLERANCE * 100) {
            return { 
                valid: false, 
                message: `Constraint violation: ${maxError.toFixed(3)}` 
            };
        }

        return { valid: true, message: 'Valid' };
    }

    /**
     * Applies the plan
     */
    private static applyPlan(plan: ConnectionPlan): void {
        for (const [ball, state] of plan.ballStates) {
            const moved = state.originalPosition.distanceTo(state.newPosition) > POSITION_TOLERANCE;
            if (moved) {
                Logger.log('[Apply] Moving ball', {
                    from: state.originalPosition,
                    to: state.newPosition,
                    distance: state.originalPosition.distanceTo(state.newPosition).toFixed(3)
                });
                ball.setPosition(state.newPosition);
            }
        }
    }

    /**
     * Updates all shafts connected to the given balls
     */
    public static updateConnectedShafts(balls: Set<Ball>): void {
        const updatedShafts = new Set<Shaft>();
        
        for (const ball of balls) {
            for (const shaft of ball.getConnectedShafts()) {
                if (!updatedShafts.has(shaft)) {
                    shaft.update();
                    updatedShafts.add(shaft);
                }
            }
        }
    }
}
