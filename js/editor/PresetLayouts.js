/**
 * PresetLayouts — Pre-built city layouts for quick setup.
 * Each preset returns data compatible with CityGraph.fromJSON().
 */
import { JunctionType, RoadType } from '../core/CityGraph.js';

export class PresetLayouts {
    /**
     * Generate a preset layout.
     * @param {string} name - 'grid' | 'ring' | 'highway'
     * @returns {object} { junctions, roads } for CityGraph.fromJSON()
     */
    static generate(name) {
        switch (name) {
            case 'grid': return PresetLayouts.gridCity();
            case 'ring': return PresetLayouts.ringCity();
            case 'highway': return PresetLayouts.highwayTown();
            default: return PresetLayouts.gridCity();
        }
    }

    /**
     * 4×4 grid of intersections (16 junctions, 24 roads).
     */
    static gridCity() {
        const junctions = [];
        const roads = [];
        const spacing = 150;
        const offsetX = -spacing * 1.5;
        const offsetY = -spacing * 1.5;
        let jId = 1;
        let rId = 1;

        // Create 4×4 grid of junctions
        const grid = [];
        for (let row = 0; row < 4; row++) {
            grid[row] = [];
            for (let col = 0; col < 4; col++) {
                const id = `j${jId++}`;
                const isEdge = row === 0 || row === 3 || col === 0 || col === 3;
                junctions.push({
                    id,
                    x: offsetX + col * spacing,
                    y: offsetY + row * spacing,
                    type: isEdge ? JunctionType.ENTRY_EXIT : JunctionType.INTERSECTION,
                    connections: [],
                    signalState: null,
                    signalPhases: null,
                    metadata: {},
                });
                grid[row][col] = id;
            }
        }

        // Horizontal roads
        for (let row = 0; row < 4; row++) {
            for (let col = 0; col < 3; col++) {
                const fromJ = junctions.find(j => j.id === grid[row][col]);
                const toJ = junctions.find(j => j.id === grid[row][col + 1]);
                const id = `r${rId++}`;
                roads.push({
                    id,
                    from: grid[row][col],
                    to: grid[row][col + 1],
                    type: RoadType.NORMAL,
                    lanes: 2,
                    speedLimit: 60,
                    length: spacing,
                    bidirectional: true,
                    blocked: false,
                    blockReason: null,
                    vehicles: [],
                    metadata: {},
                });
            }
        }

        // Vertical roads
        for (let row = 0; row < 3; row++) {
            for (let col = 0; col < 4; col++) {
                const id = `r${rId++}`;
                roads.push({
                    id,
                    from: grid[row][col],
                    to: grid[row + 1][col],
                    type: RoadType.NORMAL,
                    lanes: 2,
                    speedLimit: 60,
                    length: spacing,
                    bidirectional: true,
                    blocked: false,
                    blockReason: null,
                    vehicles: [],
                    metadata: {},
                });
            }
        }

        return { junctions, roads };
    }

    /**
     * Central ring with radial spokes (13 junctions).
     */
    static ringCity() {
        const junctions = [];
        const roads = [];
        let jId = 1;
        let rId = 1;

        // Center junction
        const centerId = `j${jId++}`;
        junctions.push({
            id: centerId,
            x: 0, y: 0,
            type: JunctionType.ROUNDABOUT,
            connections: [],
            signalState: null,
            signalPhases: null,
            metadata: {},
        });

        // Inner ring (6 junctions)
        const innerRadius = 120;
        const innerIds = [];
        for (let i = 0; i < 6; i++) {
            const angle = (i / 6) * Math.PI * 2 - Math.PI / 2;
            const id = `j${jId++}`;
            innerIds.push(id);
            junctions.push({
                id,
                x: Math.round(Math.cos(angle) * innerRadius),
                y: Math.round(Math.sin(angle) * innerRadius),
                type: JunctionType.INTERSECTION,
                connections: [],
                signalState: null,
                signalPhases: null,
                metadata: {},
            });
        }

        // Outer ring (6 junctions — entry/exit points)
        const outerRadius = 280;
        const outerIds = [];
        for (let i = 0; i < 6; i++) {
            const angle = (i / 6) * Math.PI * 2 - Math.PI / 2;
            const id = `j${jId++}`;
            outerIds.push(id);
            junctions.push({
                id,
                x: Math.round(Math.cos(angle) * outerRadius),
                y: Math.round(Math.sin(angle) * outerRadius),
                type: JunctionType.ENTRY_EXIT,
                connections: [],
                signalState: null,
                signalPhases: null,
                metadata: {},
            });
        }

        // Center → Inner ring roads
        for (const innerId of innerIds) {
            const fromJ = junctions.find(j => j.id === centerId);
            const toJ = junctions.find(j => j.id === innerId);
            const dx = toJ.x - fromJ.x;
            const dy = toJ.y - fromJ.y;
            roads.push({
                id: `r${rId++}`,
                from: centerId,
                to: innerId,
                type: RoadType.NORMAL,
                lanes: 2,
                speedLimit: 50,
                length: Math.sqrt(dx * dx + dy * dy),
                bidirectional: true,
                blocked: false, blockReason: null, vehicles: [], metadata: {},
            });
        }

        // Inner ring connections (circular)
        for (let i = 0; i < innerIds.length; i++) {
            const from = innerIds[i];
            const to = innerIds[(i + 1) % innerIds.length];
            const fromJ = junctions.find(j => j.id === from);
            const toJ = junctions.find(j => j.id === to);
            const dx = toJ.x - fromJ.x;
            const dy = toJ.y - fromJ.y;
            roads.push({
                id: `r${rId++}`,
                from, to,
                type: RoadType.NORMAL,
                lanes: 2,
                speedLimit: 50,
                length: Math.sqrt(dx * dx + dy * dy),
                bidirectional: true,
                blocked: false, blockReason: null, vehicles: [], metadata: {},
            });
        }

        // Inner → Outer radial roads
        for (let i = 0; i < 6; i++) {
            const from = innerIds[i];
            const to = outerIds[i];
            const fromJ = junctions.find(j => j.id === from);
            const toJ = junctions.find(j => j.id === to);
            const dx = toJ.x - fromJ.x;
            const dy = toJ.y - fromJ.y;
            roads.push({
                id: `r${rId++}`,
                from, to,
                type: RoadType.NORMAL,
                lanes: 2,
                speedLimit: 70,
                length: Math.sqrt(dx * dx + dy * dy),
                bidirectional: true,
                blocked: false, blockReason: null, vehicles: [], metadata: {},
            });
        }

        return { junctions, roads };
    }

    /**
     * Highway with side town (18 junctions).
     */
    static highwayTown() {
        const junctions = [];
        const roads = [];
        let jId = 1;
        let rId = 1;

        // Highway — horizontal line of 6 junctions
        const hwSpacing = 180;
        const hwY = -100;
        const hwIds = [];
        for (let i = 0; i < 6; i++) {
            const id = `j${jId++}`;
            hwIds.push(id);
            junctions.push({
                id,
                x: -hwSpacing * 2.5 + i * hwSpacing,
                y: hwY,
                type: i === 0 || i === 5 ? JunctionType.ENTRY_EXIT : JunctionType.INTERSECTION,
                connections: [],
                signalState: null,
                signalPhases: null,
                metadata: {},
            });
        }

        // Highway roads (high speed)
        for (let i = 0; i < 5; i++) {
            roads.push({
                id: `r${rId++}`,
                from: hwIds[i],
                to: hwIds[i + 1],
                type: RoadType.HIGHWAY,
                lanes: 3,
                speedLimit: 100,
                length: hwSpacing,
                bidirectional: true,
                blocked: false, blockReason: null, vehicles: [], metadata: {},
            });
        }

        // Town grid below highway (3×4 grid, 12 junctions)
        const townSpacing = 120;
        const townOffsetX = -townSpacing * 1.5;
        const townOffsetY = 50;
        const townGrid = [];

        for (let row = 0; row < 3; row++) {
            townGrid[row] = [];
            for (let col = 0; col < 4; col++) {
                const id = `j${jId++}`;
                townGrid[row][col] = id;
                const isEdge = row === 2 || col === 0 || col === 3;
                junctions.push({
                    id,
                    x: townOffsetX + col * townSpacing,
                    y: townOffsetY + row * townSpacing,
                    type: isEdge ? JunctionType.ENTRY_EXIT : JunctionType.INTERSECTION,
                    connections: [],
                    signalState: null,
                    signalPhases: null,
                    metadata: {},
                });
            }
        }

        // Town horizontal roads
        for (let row = 0; row < 3; row++) {
            for (let col = 0; col < 3; col++) {
                const fromJ = junctions.find(j => j.id === townGrid[row][col]);
                const toJ = junctions.find(j => j.id === townGrid[row][col + 1]);
                roads.push({
                    id: `r${rId++}`,
                    from: townGrid[row][col],
                    to: townGrid[row][col + 1],
                    type: RoadType.RESIDENTIAL,
                    lanes: 2,
                    speedLimit: 40,
                    length: townSpacing,
                    bidirectional: true,
                    blocked: false, blockReason: null, vehicles: [], metadata: {},
                });
            }
        }

        // Town vertical roads
        for (let row = 0; row < 2; row++) {
            for (let col = 0; col < 4; col++) {
                roads.push({
                    id: `r${rId++}`,
                    from: townGrid[row][col],
                    to: townGrid[row + 1][col],
                    type: RoadType.RESIDENTIAL,
                    lanes: 2,
                    speedLimit: 40,
                    length: townSpacing,
                    bidirectional: true,
                    blocked: false, blockReason: null, vehicles: [], metadata: {},
                });
            }
        }

        // On-ramps: connect highway to town top row
        // Connect highway junction 2 to town[0][1], highway junction 3 to town[0][2]
        const connectPairs = [
            [hwIds[1], townGrid[0][0]],
            [hwIds[2], townGrid[0][1]],
            [hwIds[3], townGrid[0][2]],
            [hwIds[4], townGrid[0][3]],
        ];

        for (const [hwId, townId] of connectPairs) {
            const fromJ = junctions.find(j => j.id === hwId);
            const toJ = junctions.find(j => j.id === townId);
            if (!fromJ || !toJ) continue;
            const dx = toJ.x - fromJ.x;
            const dy = toJ.y - fromJ.y;
            roads.push({
                id: `r${rId++}`,
                from: hwId,
                to: townId,
                type: RoadType.NORMAL,
                lanes: 2,
                speedLimit: 50,
                length: Math.sqrt(dx * dx + dy * dy),
                bidirectional: true,
                blocked: false, blockReason: null, vehicles: [], metadata: {},
            });
        }

        return { junctions, roads };
    }
}
