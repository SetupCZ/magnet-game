import * as THREE from 'three';

// Check for LOG env flag via Vite's import.meta.env or URL param
function isLoggingEnabled(): boolean {
    // Check URL param first (for runtime toggle)
    if (typeof window !== 'undefined') {
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.has('LOG')) return true;
    }
    // Check Vite env variable
    // @ts-ignore - Vite injects this at build time
    return import.meta.env?.VITE_LOG === 'true';
}

export const LOG_ENABLED = isLoggingEnabled();

export class Logger {
    private static logs: string[] = [];
    private static sessionStart: number = Date.now();
    private static actionCounter: number = 0;

    /**
     * Log a user action (click, button press, etc.)
     */
    public static logAction(action: string, details?: any): void {
        if (!LOG_ENABLED) return;
        
        this.actionCounter++;
        const timestamp = this.getTimestamp();
        const log = `[${timestamp}] [ACTION #${this.actionCounter}] ${action}`;
        
        if (details) {
            this.logs.push(log);
            this.logs.push(JSON.stringify(details, this.vector3Replacer, 2));
        } else {
            this.logs.push(log);
        }
        
        console.log(log, details || '');
    }

    /**
     * Log ball and shaft positions
     */
    public static logPositions(balls: any[], shafts: any[]): void {
        if (!LOG_ENABLED) return;
        
        const timestamp = this.getTimestamp();
        this.logs.push(`[${timestamp}] [POSITIONS]`);
        
        balls.forEach((ball, i) => {
            const pos = ball.getPosition();
            const shaftCount = ball.getConnectedShafts().length;
            this.logs.push(`  Ball ${i}: pos=(${pos.x.toFixed(3)}, ${pos.y.toFixed(3)}, ${pos.z.toFixed(3)}), shafts=${shaftCount}`);
        });
        
        shafts.forEach((shaft, i) => {
            const startBall = shaft.getStartBall();
            const endBall = shaft.getEndBall();
            const length = shaft.getLength();
            const connected = shaft.isFullyConnected();
            
            let startPos = startBall ? startBall.getPosition() : null;
            let endPos = endBall ? endBall.getPosition() : null;
            let actualDist = startPos && endPos ? startPos.distanceTo(endPos) : null;
            
            this.logs.push(`  Shaft ${i}: length=${length}, connected=${connected}, start=${startBall ? 'yes' : 'no'}, end=${endBall ? 'yes' : 'no'}, actualDist=${actualDist?.toFixed(3) || 'N/A'}`);
        });
    }

    /**
     * Log constraint solver iteration
     */
    public static logSolverIteration(iteration: number, error: number, ballPositions: Map<string, THREE.Vector3>): void {
        if (!LOG_ENABLED) return;
        
        const timestamp = this.getTimestamp();
        this.logs.push(`[${timestamp}] [SOLVER] Iteration ${iteration}: error=${error.toFixed(4)}`);
        
        ballPositions.forEach((pos, ballId) => {
            this.logs.push(`    ${ballId}: (${pos.x.toFixed(3)}, ${pos.y.toFixed(3)}, ${pos.z.toFixed(3)})`);
        });
    }

    /**
     * Log constraint solver start
     */
    public static logSolverStart(targetBall: any, existingBall: any, newShaft: any, allBalls: Set<any>): void {
        if (!LOG_ENABLED) return;
        
        const timestamp = this.getTimestamp();
        this.logs.push(`[${timestamp}] [SOLVER START]`);
        this.logs.push(`  Target ball: (${targetBall.getPosition().x.toFixed(3)}, ${targetBall.getPosition().y.toFixed(3)}, ${targetBall.getPosition().z.toFixed(3)})`);
        this.logs.push(`  Existing ball: (${existingBall.getPosition().x.toFixed(3)}, ${existingBall.getPosition().y.toFixed(3)}, ${existingBall.getPosition().z.toFixed(3)})`);
        this.logs.push(`  New shaft length: ${newShaft.getLength()}`);
        this.logs.push(`  Total balls in structure: ${allBalls.size}`);
        
        let ballIndex = 0;
        allBalls.forEach(ball => {
            const pos = ball.getPosition();
            const shafts = ball.getConnectedShafts().length;
            this.logs.push(`    Ball ${ballIndex++}: pos=(${pos.x.toFixed(3)}, ${pos.y.toFixed(3)}, ${pos.z.toFixed(3)}), shafts=${shafts}`);
        });
    }

    /**
     * Log constraint solver result
     */
    public static logSolverResult(success: boolean, message: string, finalPositions?: Map<string, THREE.Vector3>): void {
        if (!LOG_ENABLED) return;
        
        const timestamp = this.getTimestamp();
        this.logs.push(`[${timestamp}] [SOLVER RESULT] ${success ? 'SUCCESS' : 'FAILURE'}`);
        this.logs.push(`  Message: ${message}`);
        
        if (finalPositions) {
            this.logs.push(`  Final positions:`);
            finalPositions.forEach((pos, ballId) => {
                this.logs.push(`    ${ballId}: (${pos.x.toFixed(3)}, ${pos.y.toFixed(3)}, ${pos.z.toFixed(3)})`);
            });
        }
    }

    /**
     * Log triangle detection
     */
    public static logTriangleDetection(detected: boolean, details: any): void {
        if (!LOG_ENABLED) return;
        
        const timestamp = this.getTimestamp();
        this.logs.push(`[${timestamp}] [TRIANGLE] Detected: ${detected}`);
        this.logs.push(JSON.stringify(details, this.vector3Replacer, 2));
    }

    /**
     * Log an error
     */
    public static logError(context: string, error: any): void {
        if (!LOG_ENABLED) return;
        
        const timestamp = this.getTimestamp();
        this.logs.push(`[${timestamp}] [ERROR] ${context}`);
        this.logs.push(`  ${error.toString()}`);
        if (error.stack) {
            this.logs.push(`  Stack: ${error.stack}`);
        }
        console.error(`[ERROR] ${context}`, error);
    }

    /**
     * Log a general message
     */
    public static log(message: string, data?: any): void {
        if (!LOG_ENABLED) return;
        
        const timestamp = this.getTimestamp();
        const log = `[${timestamp}] ${message}`;
        this.logs.push(log);
        
        if (data) {
            this.logs.push(JSON.stringify(data, this.vector3Replacer, 2));
        }
        
        console.log(log, data || '');
    }

    /**
     * Copy logs to clipboard
     */
    public static copyLogsToClipboard(): void {
        const content = this.logs.join('\n');
        navigator.clipboard.writeText(content).then(() => {
            this.log('[SYSTEM] Logs copied to clipboard');
            alert('Logs copied to clipboard!');
        }).catch(err => {
            console.error('Failed to copy logs:', err);
            alert('Failed to copy logs to clipboard');
        });
    }

    /**
     * Clear all logs
     */
    public static clear(): void {
        this.logs = [];
        this.sessionStart = Date.now();
        this.actionCounter = 0;
        this.log('Log cleared - new session started');
    }

    /**
     * Get all logs as a string
     */
    public static getLogs(): string {
        return this.logs.join('\n');
    }

    /**
     * Get timestamp relative to session start
     */
    private static getTimestamp(): string {
        const elapsed = Date.now() - this.sessionStart;
        const seconds = (elapsed / 1000).toFixed(3);
        return `+${seconds}s`;
    }

    /**
     * Custom JSON replacer to handle Vector3 objects
     */
    private static vector3Replacer(key: string, value: any): any {
        if (value && typeof value === 'object' && 'x' in value && 'y' in value && 'z' in value && 'isVector3' in value) {
            return { x: value.x, y: value.y, z: value.z };
        }
        return value;
    }
}
