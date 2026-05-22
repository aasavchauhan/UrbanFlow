/**
 * Geometry — Math utilities for 2D Splines and Bezier Curves.
 * Used for lane generation and vehicle turning arcs.
 */

export class Vector2 {
    constructor(x, y) {
        this.x = x;
        this.y = y;
    }
    
    add(v) { return new Vector2(this.x + v.x, this.y + v.y); }
    sub(v) { return new Vector2(this.x - v.x, this.y - v.y); }
    mult(n) { return new Vector2(this.x * n, this.y * n); }
    mag() { return Math.sqrt(this.x * this.x + this.y * this.y); }
    normalize() {
        const m = this.mag();
        return m === 0 ? new Vector2(0, 0) : new Vector2(this.x / m, this.y / m);
    }
    // Rotate by angle in radians
    rotate(angle) {
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        return new Vector2(
            this.x * cos - this.y * sin,
            this.x * sin + this.y * cos
        );
    }
    // Perpendicular normal (right side)
    normal() {
        return new Vector2(-this.y, this.x).normalize();
    }
}

/**
 * Quadratic Bezier Curve
 */
export class BezierCurve {
    /**
     * @param {Vector2} p0 - Start point
     * @param {Vector2} p1 - Control point
     * @param {Vector2} p2 - End point
     */
    constructor(p0, p1, p2) {
        this.p0 = p0;
        this.p1 = p1;
        this.p2 = p2;
        this.length = this._approximateLength();
    }

    /**
     * Get position at time t (0..1)
     */
    getPoint(t) {
        const mt = 1 - t;
        const mt2 = mt * mt;
        const t2 = t * t;
        
        return new Vector2(
            mt2 * this.p0.x + 2 * mt * t * this.p1.x + t2 * this.p2.x,
            mt2 * this.p0.y + 2 * mt * t * this.p1.y + t2 * this.p2.y
        );
    }

    /**
     * Get normalized tangent vector at time t (0..1)
     */
    getTangent(t) {
        const mt = 1 - t;
        const dx = 2 * mt * (this.p1.x - this.p0.x) + 2 * t * (this.p2.x - this.p1.x);
        const dy = 2 * mt * (this.p1.y - this.p0.y) + 2 * t * (this.p2.y - this.p1.y);
        return new Vector2(dx, dy).normalize();
    }

    _approximateLength(steps = 20) {
        let len = 0;
        let prev = this.p0;
        for (let i = 1; i <= steps; i++) {
            const pt = this.getPoint(i / steps);
            len += pt.sub(prev).mag();
            prev = pt;
        }
        return len;
    }
}

/**
 * Linear Segment (Straight Line) with same API as BezierCurve
 */
export class LineSegment {
    constructor(p0, p1) {
        this.p0 = p0;
        this.p1 = p1;
        this.dir = p1.sub(p0);
        this.length = this.dir.mag();
    }
    
    getPoint(t) {
        return new Vector2(
            this.p0.x + this.dir.x * t,
            this.p0.y + this.dir.y * t
        );
    }
    
    getTangent(t) {
        return this.dir.normalize();
    }
}

/**
 * Polyline curve with linear segments and arc-length parameterization.
 */
export class PolylineCurve {
    /**
     * @param {Vector2[]} points
     */
    constructor(points) {
        this.points = points || [];
        this._segments = [];
        this._lengths = [];
        this.length = 0;
        this._build();
    }

    _build() {
        this._segments = [];
        this._lengths = [0];
        this.length = 0;
        if (this.points.length < 2) return;

        for (let i = 0; i < this.points.length - 1; i++) {
            const seg = new LineSegment(this.points[i], this.points[i + 1]);
            this._segments.push(seg);
            this.length += seg.length;
            this._lengths.push(this.length);
        }
    }

    getPoint(t) {
        if (this._segments.length === 0) {
            return this.points[0] || new Vector2(0, 0);
        }
        const target = Math.max(0, Math.min(1, t)) * this.length;
        for (let i = 0; i < this._segments.length; i++) {
            const segStart = this._lengths[i];
            const segEnd = this._lengths[i + 1];
            if (target <= segEnd || i === this._segments.length - 1) {
                const seg = this._segments[i];
                const segLen = seg.length || 1;
                const localT = (target - segStart) / segLen;
                return seg.getPoint(localT);
            }
        }
        return this.points[this.points.length - 1];
    }

    getTangent(t) {
        if (this._segments.length === 0) {
            return new Vector2(1, 0);
        }
        const target = Math.max(0, Math.min(1, t)) * this.length;
        for (let i = 0; i < this._segments.length; i++) {
            const segStart = this._lengths[i];
            const segEnd = this._lengths[i + 1];
            if (target <= segEnd || i === this._segments.length - 1) {
                return this._segments[i].getTangent(0);
            }
        }
        return this._segments[this._segments.length - 1].getTangent(0);
    }
}
