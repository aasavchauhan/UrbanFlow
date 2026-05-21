/**
 * Charts — Lightweight canvas-based charting for the dashboard.
 * No external dependencies.
 */
export class Charts {
    /**
     * Draw a line chart on a canvas element.
     * @param {HTMLCanvasElement} canvas
     * @param {number[]} data
     * @param {object} options
     */
    static drawLineChart(canvas, data, options = {}) {
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.getBoundingClientRect();

        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        const w = rect.width;
        const h = rect.height;
        const padding = { top: 10, right: 10, bottom: 20, left: 35 };

        const {
            lineColor = '#60a5fa',
            fillColor = 'rgba(96, 165, 250, 0.1)',
            gridColor = 'rgba(255, 255, 255, 0.05)',
            textColor = 'rgba(200, 220, 255, 0.5)',
            label = '',
            unit = '',
        } = options;

        // Clear
        ctx.clearRect(0, 0, w, h);

        // Background
        ctx.fillStyle = 'rgba(10, 14, 26, 0.5)';
        ctx.fillRect(0, 0, w, h);

        if (data.length === 0) {
            ctx.fillStyle = textColor;
            ctx.font = '11px Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('No data yet', w / 2, h / 2);
            return;
        }

        const chartW = w - padding.left - padding.right;
        const chartH = h - padding.top - padding.bottom;

        // Calculate scale
        const maxVal = Math.max(...data, 1);
        const minVal = 0;
        const range = maxVal - minVal || 1;

        // Grid lines
        ctx.strokeStyle = gridColor;
        ctx.lineWidth = 0.5;
        const gridLines = 3;
        for (let i = 0; i <= gridLines; i++) {
            const y = padding.top + (chartH / gridLines) * i;
            ctx.beginPath();
            ctx.moveTo(padding.left, y);
            ctx.lineTo(w - padding.right, y);
            ctx.stroke();

            // Label
            const val = maxVal - (range / gridLines) * i;
            ctx.fillStyle = textColor;
            ctx.font = '9px JetBrains Mono, monospace';
            ctx.textAlign = 'right';
            ctx.fillText(val.toFixed(1), padding.left - 4, y + 3);
        }

        // Draw filled area
        ctx.beginPath();
        for (let i = 0; i < data.length; i++) {
            const x = padding.left + (i / Math.max(1, data.length - 1)) * chartW;
            const y = padding.top + chartH - ((data[i] - minVal) / range) * chartH;

            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.lineTo(padding.left + chartW, padding.top + chartH);
        ctx.lineTo(padding.left, padding.top + chartH);
        ctx.closePath();
        ctx.fillStyle = fillColor;
        ctx.fill();

        // Draw line
        ctx.beginPath();
        for (let i = 0; i < data.length; i++) {
            const x = padding.left + (i / Math.max(1, data.length - 1)) * chartW;
            const y = padding.top + chartH - ((data[i] - minVal) / range) * chartH;

            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = lineColor;
        ctx.lineWidth = 2;
        ctx.lineJoin = 'round';
        ctx.stroke();

        // Latest value dot
        if (data.length > 0) {
            const lastX = padding.left + ((data.length - 1) / Math.max(1, data.length - 1)) * chartW;
            const lastY = padding.top + chartH - ((data[data.length - 1] - minVal) / range) * chartH;

            ctx.fillStyle = lineColor;
            ctx.beginPath();
            ctx.arc(lastX, lastY, 3, 0, Math.PI * 2);
            ctx.fill();

            // Glow
            ctx.fillStyle = lineColor.replace(')', ', 0.3)').replace('rgb', 'rgba');
            ctx.beginPath();
            ctx.arc(lastX, lastY, 6, 0, Math.PI * 2);
            ctx.fill();
        }

        // Label
        if (label) {
            ctx.fillStyle = textColor;
            ctx.font = '9px Inter, sans-serif';
            ctx.textAlign = 'left';
            ctx.fillText(label, padding.left, h - 3);
        }
    }

    /**
     * Draw a bar chart for comparison (Fixed vs AI).
     */
    static drawComparisonChart(canvas, data, options = {}) {
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.getBoundingClientRect();

        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        const w = rect.width;
        const h = rect.height;
        const padding = { top: 20, right: 15, bottom: 40, left: 40 };

        const {
            textColor = 'rgba(200, 220, 255, 0.6)',
        } = options;

        // Clear
        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = 'rgba(10, 14, 26, 0.5)';
        ctx.fillRect(0, 0, w, h);

        if (!data || data.length === 0) {
            ctx.fillStyle = textColor;
            ctx.font = '11px Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('Run both Fixed and AI simulations to compare', w / 2, h / 2);
            return;
        }

        const chartW = w - padding.left - padding.right;
        const chartH = h - padding.top - padding.bottom;
        const barWidth = chartW / (data.length * 3);
        const maxVal = Math.max(...data.map(d => Math.max(d.fixed || 0, d.ai || 0)), 1);

        // Grid
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
        ctx.lineWidth = 0.5;
        for (let i = 0; i <= 3; i++) {
            const y = padding.top + (chartH / 3) * i;
            ctx.beginPath();
            ctx.moveTo(padding.left, y);
            ctx.lineTo(w - padding.right, y);
            ctx.stroke();

            const val = maxVal - (maxVal / 3) * i;
            ctx.fillStyle = textColor;
            ctx.font = '9px JetBrains Mono, monospace';
            ctx.textAlign = 'right';
            ctx.fillText(val.toFixed(0), padding.left - 4, y + 3);
        }

        // Bars
        for (let i = 0; i < data.length; i++) {
            const groupX = padding.left + (i / data.length) * chartW + chartW / (data.length * 2) - barWidth;

            // Fixed bar
            const fixedH = ((data[i].fixed || 0) / maxVal) * chartH;
            ctx.fillStyle = 'rgba(239, 68, 68, 0.6)';
            ctx.fillRect(groupX, padding.top + chartH - fixedH, barWidth, fixedH);
            ctx.strokeStyle = '#ef4444';
            ctx.lineWidth = 1;
            ctx.strokeRect(groupX, padding.top + chartH - fixedH, barWidth, fixedH);

            // AI bar
            const aiH = ((data[i].ai || 0) / maxVal) * chartH;
            ctx.fillStyle = 'rgba(34, 197, 94, 0.6)';
            ctx.fillRect(groupX + barWidth + 4, padding.top + chartH - aiH, barWidth, aiH);
            ctx.strokeStyle = '#22c55e';
            ctx.lineWidth = 1;
            ctx.strokeRect(groupX + barWidth + 4, padding.top + chartH - aiH, barWidth, aiH);

            // Label
            ctx.fillStyle = textColor;
            ctx.font = '9px Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(data[i].label || '', groupX + barWidth + 2, h - padding.bottom + 14);
        }

        // Legend
        ctx.fillStyle = '#ef4444';
        ctx.fillRect(padding.left, h - 16, 8, 8);
        ctx.fillStyle = textColor;
        ctx.font = '9px Inter, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText('Fixed', padding.left + 12, h - 9);

        ctx.fillStyle = '#22c55e';
        ctx.fillRect(padding.left + 55, h - 16, 8, 8);
        ctx.fillStyle = textColor;
        ctx.fillText('AI', padding.left + 67, h - 9);
    }
}
