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
            case 'vadodara': return PresetLayouts.vadodaraCity();
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

    /**
     * Vadodara-inspired layout (schematic, medium size).
     * Landmarks: Sayajigunj, Alkapuri, Fatehgunj, Gotri, Manjalpur, Waghodiya Chowkdi,
     * plus a Ring Road and Highway corridor.
     */
    static vadodaraCity() {
        const junctions = [];
        const roads = [];
        let jId = 1;
        let rId = 1;

        const addJ = (x, y, type, label) => {
            const id = `j${jId++}`;
            junctions.push({
                id,
                x, y,
                type,
                connections: [],
                signalState: null,
                signalPhases: null,
                metadata: { label }
            });
            return id;
        };

        const addR = (from, to, type = RoadType.NORMAL, lanes = 2, speed = 50, bidirectional = true, controlPoint = null) => {
            const fromJ = junctions.find(j => j.id === from);
            const toJ = junctions.find(j => j.id === to);
            if (!fromJ || !toJ) return;
            const dx = toJ.x - fromJ.x;
            const dy = toJ.y - fromJ.y;
            roads.push({
                id: `r${rId++}`,
                from,
                to,
                type,
                lanes,
                speedLimit: speed,
                length: Math.sqrt(dx * dx + dy * dy),
                bidirectional,
                blocked: false,
                blockReason: null,
                vehicles: [],
                metadata: {},
                controlPoint
            });
        };

        const curveOutward = (fromId, toId, center, offset) => {
            const fromJ = junctions.find(j => j.id === fromId);
            const toJ = junctions.find(j => j.id === toId);
            if (!fromJ || !toJ) return null;
            const mx = (fromJ.x + toJ.x) / 2;
            const my = (fromJ.y + toJ.y) / 2;
            const vx = mx - center.x;
            const vy = my - center.y;
            const mag = Math.sqrt(vx * vx + vy * vy) || 1;
            return { x: mx + (vx / mag) * offset, y: my + (vy / mag) * offset };
        };

        // Core nodes (approximate positions, wider layout)
        const sayajigunj = addJ(0, -80, JunctionType.INTERSECTION, 'Sayajigunj');
        const alkapuri = addJ(180, -20, JunctionType.INTERSECTION, 'Alkapuri');
        const fatehgunj = addJ(-80, -200, JunctionType.INTERSECTION, 'Fatehgunj');
        const gotri = addJ(320, -80, JunctionType.INTERSECTION, 'Gotri');
        const manjalpur = addJ(200, 180, JunctionType.INTERSECTION, 'Manjalpur');
        const vrundavan = addJ(60, 260, JunctionType.INTERSECTION, 'Vrundavan');
        const waghodiya = addJ(420, 80, JunctionType.INTERSECTION, 'Waghodiya Chowkdi');
        const vipRoad = addJ(260, -200, JunctionType.INTERSECTION, 'VIP Road');

        // Ring road junctions (wider rectangle)
        const ringN = addJ(80, -320, JunctionType.ENTRY_EXIT, 'Ring-N');
        const ringNE = addJ(360, -280, JunctionType.ENTRY_EXIT, 'Ring-NE');
        const ringE = addJ(500, 0, JunctionType.ENTRY_EXIT, 'Ring-E');
        const ringSE = addJ(360, 300, JunctionType.ENTRY_EXIT, 'Ring-SE');
        const ringS = addJ(80, 360, JunctionType.ENTRY_EXIT, 'Ring-S');
        const ringSW = addJ(-240, 300, JunctionType.ENTRY_EXIT, 'Ring-SW');
        const ringW = addJ(-320, 0, JunctionType.ENTRY_EXIT, 'Ring-W');
        const ringNW = addJ(-240, -280, JunctionType.ENTRY_EXIT, 'Ring-NW');

        // Highway corridor (diagonal)
        const hwyNW = addJ(-420, -160, JunctionType.ENTRY_EXIT, 'NH-48 NW');
        const hwyMid = addJ(-300, -60, JunctionType.INTERSECTION, 'NH-48 Mid');
        const hwySE = addJ(-180, 40, JunctionType.ENTRY_EXIT, 'NH-48 SE');

        // Central grid connectors
        const coreN = addJ(80, -140, JunctionType.INTERSECTION, 'Core-N');
        const coreNW = addJ(-40, -140, JunctionType.INTERSECTION, 'Core-NW');
        const coreW = addJ(-80, -20, JunctionType.INTERSECTION, 'Core-W');
        const coreC = addJ(60, 40, JunctionType.INTERSECTION, 'Core-C');
        const coreE = addJ(200, 40, JunctionType.INTERSECTION, 'Core-E');
        const coreSE = addJ(200, 140, JunctionType.INTERSECTION, 'Core-SE');
        const coreS = addJ(60, 160, JunctionType.INTERSECTION, 'Core-S');

        // Ring road loop
        const ringRoadType = RoadType.HIGHWAY;
        const ringCenter = { x: 40, y: -20 };
        addR(ringN, ringNE, ringRoadType, 3, 80, true, curveOutward(ringN, ringNE, ringCenter, 120));
        addR(ringNE, ringE, ringRoadType, 3, 80, true, curveOutward(ringNE, ringE, ringCenter, 120));
        addR(ringE, ringSE, ringRoadType, 3, 80, true, curveOutward(ringE, ringSE, ringCenter, 120));
        addR(ringSE, ringS, ringRoadType, 3, 80, true, curveOutward(ringSE, ringS, ringCenter, 120));
        addR(ringS, ringSW, ringRoadType, 3, 80, true, curveOutward(ringS, ringSW, ringCenter, 120));
        addR(ringSW, ringW, ringRoadType, 3, 80, true, curveOutward(ringSW, ringW, ringCenter, 120));
        addR(ringW, ringNW, ringRoadType, 3, 80, true, curveOutward(ringW, ringNW, ringCenter, 120));
        addR(ringNW, ringN, ringRoadType, 3, 80, true, curveOutward(ringNW, ringN, ringCenter, 120));

        // Core arterial roads
        addR(fatehgunj, sayajigunj, RoadType.NORMAL, 2, 50);
        addR(sayajigunj, alkapuri, RoadType.NORMAL, 2, 50);
        addR(alkapuri, gotri, RoadType.NORMAL, 2, 50);
        addR(alkapuri, manjalpur, RoadType.NORMAL, 2, 45);
        addR(manjalpur, vrundavan, RoadType.RESIDENTIAL, 2, 35);
        addR(gotri, waghodiya, RoadType.NORMAL, 2, 55);
        addR(fatehgunj, vipRoad, RoadType.NORMAL, 2, 55);
        addR(vipRoad, alkapuri, RoadType.NORMAL, 2, 55);
        addR(vipRoad, gotri, RoadType.NORMAL, 2, 55);

        // Core grid
        addR(fatehgunj, coreNW, RoadType.NORMAL, 2, 45);
        addR(coreNW, coreN, RoadType.NORMAL, 2, 45);
        addR(coreN, sayajigunj, RoadType.NORMAL, 2, 45);
        addR(coreN, alkapuri, RoadType.NORMAL, 2, 45);
        addR(coreW, sayajigunj, RoadType.NORMAL, 2, 45);
        addR(coreW, coreC, RoadType.NORMAL, 2, 40);
        addR(coreC, coreE, RoadType.NORMAL, 2, 40);
        addR(coreC, coreS, RoadType.NORMAL, 2, 40);
        addR(coreE, gotri, RoadType.NORMAL, 2, 45);
        addR(coreSE, manjalpur, RoadType.NORMAL, 2, 40);
        addR(coreS, coreSE, RoadType.NORMAL, 2, 40);
        addR(coreS, vrundavan, RoadType.RESIDENTIAL, 2, 35);

        // Ring connectors
        addR(ringNW, fatehgunj, RoadType.NORMAL, 2, 55);
        addR(ringN, sayajigunj, RoadType.NORMAL, 2, 55);
        addR(ringNE, gotri, RoadType.NORMAL, 2, 55);
        addR(ringE, waghodiya, RoadType.NORMAL, 2, 55);
        addR(ringSE, manjalpur, RoadType.NORMAL, 2, 55);
        addR(ringS, vrundavan, RoadType.NORMAL, 2, 45);
        addR(ringSW, coreS, RoadType.NORMAL, 2, 45);
        addR(ringW, coreW, RoadType.NORMAL, 2, 45);
        addR(ringNE, vipRoad, RoadType.NORMAL, 2, 55);

        // Highway diagonal
        addR(hwyNW, hwyMid, RoadType.HIGHWAY, 3, 90);
        addR(hwyMid, hwySE, RoadType.HIGHWAY, 3, 90);
        addR(hwyMid, ringW, RoadType.NORMAL, 2, 55);
        addR(hwySE, coreW, RoadType.NORMAL, 2, 50);

        return { junctions, roads };
    }
}
