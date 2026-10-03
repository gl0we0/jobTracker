(function() {
const app = {
  settings: {
    headings: {
      pencil: { mult: 2, addon: 26, makeup: 32 },
      triple: { mult: 2, addon: 40, makeup: 45 },
      eyelet: { mult: 1.5, addon: 32, makeup: 37, unitPrice: 2.0 },
      wave:   { mult: 2, addon: 26, makeup: 37 }
    },
    roman: {
      hAddon: 20, wAddon: 20, baseMakeup: 50, perWidthMakeup: 35,
      stdMech: [[30,35],[60,35],[100,45],[150,50],[200,60],[300,80]],
      elecMech: [[50,213],[100,229],[150,242],[200,254],[250,266],[300,283],[350,294]]
    }
  },

  // ---------------------------
  // Helpers
  // ---------------------------
  clamp(v, a, b) { return Math.max(a, Math.min(b, v)); },
  isOdd(n) { return (n % 2) === 1; },
  toEven(n) { return (n % 2 === 0) ? n : n + 1; },
  cmToMetresText(cm) { return (Math.ceil(cm) / 100) + "m"; },
  setConvertChip(inputId, show) {
    const chip = document.getElementById(`${inputId}-convert-chip`);
    if (!chip) return;
    chip.style.display = show ? "inline-block" : "none";
  },
  parseDimensionCm(inputId) {
    const el = document.getElementById(inputId);
    if (!el) return 0;

    const raw = String(el.value || "").trim();
    if (!raw) {
      this.setConvertChip(inputId, false);
      return 0;
    }

    if (raw.includes('"') || /\b(in|inch|inches)\b/i.test(raw)) {
      const match = raw.match(/-?\d+(?:\.\d+)?/);
      if (!match) return 0;
      const inches = parseFloat(match[0]);
      if (!Number.isFinite(inches)) return 0;
      const cm = Math.max(0, Math.ceil(inches * 2.54));
      el.value = String(cm);
      this.setConvertChip(inputId, true);
      return cm;
    }

    if (document.activeElement === el) {
      this.setConvertChip(inputId, false);
    }

    const cm = parseFloat(raw);
    return Number.isFinite(cm) ? cm : 0;
  },

  // legacy rounding: ties go DOWN (4.5 -> 4)
  roundNearestIntTiesDown(x) {
    const r = Math.round(x);
    if (r - x === 0.5) return Math.floor(x);
    return r;
  },

  setupCanvas() {
    const canvas = document.getElementById("diagram");
    const rect = canvas.getBoundingClientRect();
    const cssW = Math.max(320, Math.floor(rect.width));
    const cssH = Math.max(220, Math.floor(rect.height));
    const dpr = window.devicePixelRatio || 1;
    const pxW = Math.floor(cssW * dpr);
    const pxH = Math.floor(cssH * dpr);

    if (canvas.width !== pxW || canvas.height !== pxH) {
      canvas.width = pxW;
      canvas.height = pxH;
    }

    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    return { ctx, width: cssW, height: cssH };
  },

  // ---------------------------
  // Half drop math
  // ---------------------------
  calculateHalfDrop({ cutDropCm, patternRepeatCm, numDrops, productType }) {
    const rawRepeats = cutDropCm / patternRepeatCm;
    const nearestWholeRepeats = this.roundNearestIntTiesDown(rawRepeats);
    const useAB = nearestWholeRepeats < rawRepeats;

    if (!useAB) {
      // ODD/EVEN
      const adjustedCutDropRepeats = nearestWholeRepeats;
      const adjustedCutDropCm = adjustedCutDropRepeats * patternRepeatCm;

      // qty = drops * ACD + 1 PR
      const quantityCm = (numDrops * adjustedCutDropCm) + patternRepeatCm;

      const lastOddIndex = this.isOdd(numDrops) ? numDrops : (numDrops - 1);
      const cutPlan = [];
      for (let i = 1; i <= numDrops; i++) {
        const odd = this.isOdd(i);
        const isLastOdd = odd && (i === lastOddIndex);
        cutPlan.push({
          index: i,
          label: odd ? "ODD" : "EVEN",
          patternOffsetCm: odd ? 0 : (patternRepeatCm / 2),
          lengthCm: isLastOdd ? adjustedCutDropCm + (patternRepeatCm / 2) : adjustedCutDropCm
        });
      }

      return {
        method: "ODD_EVEN",
        rawRepeats,
        adjustedCutDropRepeats,
        adjustedCutDropCm,
        quantityCm,
        quantityText: this.cmToMetresText(quantityCm),
        cutPlan
      };
    }

    // A/B
    const adjustedCutDropRepeats = nearestWholeRepeats + 0.5;
    const adjustedCutDropCm = adjustedCutDropRepeats * patternRepeatCm;

    const makingPair = (productType === "pairCurtains");
    const oddDrops = this.isOdd(numDrops);

    const addCm = (makingPair && oddDrops) ? patternRepeatCm : (patternRepeatCm / 2);
    const quantityCm = (numDrops * adjustedCutDropCm) + addCm;

    const cutPlan = [];
    for (let i = 1; i <= numDrops; i++) {
      const isA = this.isOdd(i);
      const isLast = (i === numDrops);
      const lastIsExtraHalf = (makingPair && oddDrops && isLast && isA);

      cutPlan.push({
        index: i,
        label: isA ? "A" : "B",
        patternOffsetCm: (i === 1) ? (patternRepeatCm / 2) : 0,
        lengthCm: lastIsExtraHalf ? adjustedCutDropCm + (patternRepeatCm / 2) : adjustedCutDropCm
      });
    }

    return {
      method: "A_B",
      rawRepeats,
      adjustedCutDropRepeats,
      adjustedCutDropCm,
      quantityCm,
      quantityText: this.cmToMetresText(quantityCm),
      cutPlan
    };
  },

  // ---------------------------
  // Hardware calculators (hooks / eyelets)
  // Returns marker positions in cm along the track (0..railW)
  // ---------------------------
  computeHardware({ headingType, railW, fabricWidthCm, widths, isPair, waveCarrierCm = 8 }) {
    const safeRail = Math.max(1, railW);

    const splitWidths = (w) => {
      if (!isPair) return { left: w, right: 0 };
      return { left: Math.ceil(w / 2), right: Math.floor(w / 2) };
    };

    const splitCount = (n) => {
      if (!isPair) return { left: n, right: 0 };
      return { left: Math.ceil(n / 2), right: Math.floor(n / 2) };
    };

    // helpers for positions
    const linearPositions = (count, start, end) => {
      const c = Math.max(2, Math.floor(count));
      const s = start, e = end;
      const span = e - s;
      const arr = [];
      for (let i = 0; i < c; i++) {
        arr.push(s + (span * (i / (c - 1))));
      }
      return arr;
    };

    if (headingType === "pencil") {
      // ~1 hook per 7cm of track width
      const hooksTotal = Math.max(2, Math.round(safeRail / 7) + 1);
      const positions = linearPositions(hooksTotal, 0, safeRail);
      const split = splitCount(hooksTotal);
      return { kind: "hooks", total: hooksTotal, split, positionsCm: positions, tapeDepthCm: 8 };
    }

    if (headingType === "wave") {
      // Count driven by runner spacing on track (6cm or 8cm), with tape spacing = 2x.
      // Pair curtains: each panel gets an even count rounded up.
      const carrier = this.clamp(Number(waveCarrierCm) || 8, 6, 8);
      const tapeSpacing = carrier * 2;

      let total;
      let split;
      if (isPair) {
        const perPanelRaw = (safeRail / 2) / carrier;
        const perPanelEven = this.toEven(Math.ceil(perPanelRaw));
        split = { left: perPanelEven, right: perPanelEven };
        total = split.left + split.right;
      } else {
        total = this.toEven(Math.ceil(safeRail / carrier));
        split = { left: total, right: 0 };
      }

      const positions = linearPositions(total, 0, safeRail);
      return {
        kind: "hooks",
        total,
        split,
        positionsCm: positions,
        tapeDepthCm: 8,
        waveCarrierCm: carrier,
        waveTapeSpacingCm: tapeSpacing
      };
    }

    if (headingType === "triple") {
      // Hybrid: track-based ~15cm gaps with ~7cm ends, capped by ~4 pleats per fabric width
      const edge = 7;
      const usable = Math.max(0, safeRail - 2 * edge);
      const pleatsTrack = Math.max(2, Math.floor(usable / 15) + 2);
      const pleatsFromWidths = Math.max(2, widths * 4);
      const pleats = Math.max(2, Math.min(pleatsTrack, pleatsFromWidths));

      const positions = linearPositions(pleats, edge, safeRail - edge);
      const split = splitCount(pleats);
      return { kind: "hooks", total: pleats, split, positionsCm: positions, tapeDepthCm: 13 };
    }

    if (headingType === "eyelet") {
      // 8 per fabric width when fabric width is 140cm, must be even
      const perWidthRaw = 8 * (fabricWidthCm / 140);
      let perWidthEven = this.toEven(Math.max(6, Math.round(perWidthRaw)));
      // keep sensible bounds
      perWidthEven = this.clamp(perWidthEven, 6, 14);

      if (isPair) {
        // Pair curtains should have symmetric eyelet counts per panel.
        const totalFromWidths = perWidthEven * Math.max(1, widths);
        const perPanel = this.toEven(Math.ceil(totalFromWidths / 2));
        const eyeletsLeft = perPanel;
        const eyeletsRight = perPanel;
        const total = eyeletsLeft + eyeletsRight;
        const edge = 8;
        const positions = linearPositions(Math.max(2, total), edge, safeRail - edge);

        return {
          kind: "eyelets",
          total,
          split: { left: eyeletsLeft, right: eyeletsRight },
          positionsCm: positions,
          tapeDepthCm: 13,
          perWidthEven
        };
      } else {
        let eyeletsLeft = perWidthEven * Math.max(1, widths);
        if (eyeletsLeft % 2 === 1) eyeletsLeft++;
        const total = eyeletsLeft;
        const edge = 8;
        const positions = linearPositions(Math.max(2, total), edge, safeRail - edge);

        return {
          kind: "eyelets",
          total,
          split: { left: eyeletsLeft, right: 0 },
          positionsCm: positions,
          tapeDepthCm: 13,
          perWidthEven
        };
      }
    }

    // default
    return { kind: "hooks", total: 0, split: {left:0,right:0}, positionsCm: [], tapeDepthCm: 8 };
  },

  // ---------------------------
  // Canvas drawing
  // ---------------------------
  drawHangingView({
    railW, dropCm, isPair, headingType, fabricWidthCm,
    openClosed01, hardware, isCurtain
  }) {
    const { ctx, width: canvasW, height: canvasH } = this.setupCanvas();

    // Layout
    const pad = 24;
    const trackY = 34;
    const topCurtainY = trackY + 12;

    const usableW = canvasW - pad * 2;
    const usableH = canvasH - pad - topCurtainY - 24;

    // True scale cm->px: one shared factor for width and drop, no artificial cap.
    const safeRail = Math.max(1, railW);
    const safeDrop = Math.max(1, dropCm);

    const s = Math.max(0.05, Math.min(usableW / safeRail, usableH / safeDrop));
    const sx = s;
    const sy = s;
    const eyeletOffsetPx = 5 * sy;
    const poleY = (isCurtain && headingType === "eyelet")
      ? (topCurtainY + eyeletOffsetPx)
      : trackY;

    const drawTrackW = safeRail * sx;
    const trackX1 = pad + ((usableW - drawTrackW) / 2);
    const trackX2 = trackX1 + drawTrackW;

    // Background "window"
    ctx.fillStyle = "#f1f5f9";
    ctx.fillRect(trackX1, topCurtainY, trackX2 - trackX1, safeDrop * sy);

    // Caption
    ctx.fillStyle = "#334155";
    ctx.font = "12px system-ui";
    const label = isCurtain ? "Hanging view (heading + markers)" : "Blind view (markers + folds style)";
    ctx.fillText(label, pad, 18);

    // Track line
    ctx.strokeStyle = "#334155";
    ctx.lineWidth = 6;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(trackX1 - 8, poleY);
    ctx.lineTo(trackX2 + 8, poleY);
    ctx.stroke();

    // Panel geometry (1 or 2 panels)
    const panelH = safeDrop * sy;
    const totalW = (trackX2 - trackX1);

    // Open/close: openClosed01 = 0 open, 1 closed
    const closed = this.clamp(openClosed01, 0, 1);
    const open = 1 - closed;

    const textureDensity = 1 + (open * 0.85);

    let panels = [];
    if (isPair) {
      const panelW = totalW / 2;
      const minStackW = Math.max(28, panelW * 0.16);
      const visibleW = minStackW + (panelW - minStackW) * closed;

      panels = [
        { side: "L", x: trackX1, y: topCurtainY, w: visibleW, h: panelH },
        { side: "R", x: trackX2 - visibleW, y: topCurtainY, w: visibleW, h: panelH }
      ];
    } else {
      const panelW = totalW;
      const minStackW = Math.max(34, panelW * 0.22);
      const visibleW = minStackW + (panelW - minStackW) * closed;
      panels = [{ side: "S", x: trackX1, y: topCurtainY, w: visibleW, h: panelH }];
    }

    const drawVerticalWaveFlow = (p, opts = {}) => {
      const bandW = Math.max(8, (opts.bandW || 18) / textureDensity);
      const alphaBase = opts.alphaBase ?? 0.018;
      const alphaAmp = opts.alphaAmp ?? 0.055;
      const freq = opts.freq ?? 9;
      const endX = p.x + p.w;
      for (let xx = p.x; xx < endX; xx += bandW) {
        const drawW = Math.min(bandW, endX - xx);
        const rel = (xx - p.x) / Math.max(1, p.w);
        const alpha = alphaBase + alphaAmp * (0.5 + 0.5 * Math.sin(rel * Math.PI * freq));
        ctx.fillStyle = `rgba(15,23,42,${alpha.toFixed(4)})`;
        ctx.fillRect(xx, p.y, drawW, p.h);
      }
    };

    // Marker positions move with open/close and panel contraction.
    const closedPositionsPx = hardware.positionsCm.map(cm => trackX1 + cm * sx);
    const positionsPx = closedPositionsPx.map((x) => {
      if (!isCurtain || hardware.positionsCm.length === 0) return x;
      if (isPair) {
        const halfW = totalW / 2;
        const mid = trackX1 + halfW;
        if (x <= mid) {
          const t = (x - trackX1) / Math.max(1, halfW);
          return panels[0].x + (t * panels[0].w);
        }
        const t = (x - mid) / Math.max(1, halfW);
        return panels[1].x + (t * panels[1].w);
      }
      const t = (x - trackX1) / Math.max(1, totalW);
      return panels[0].x + (t * panels[0].w);
    });

    // Tape dotted line depth
    const tapeDepthPx = hardware.tapeDepthCm * sy;
    for (const p of panels) {
      // panel fill
      ctx.fillStyle = isCurtain ? "rgba(37,99,235,0.10)" : "rgba(37,99,235,0.08)";
      ctx.fillRect(p.x, p.y, p.w, p.h);

      // tape line (dotted)
      ctx.save();
      ctx.strokeStyle = "#94a3b8";
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y + tapeDepthPx);
      ctx.lineTo(p.x + p.w, p.y + tapeDepthPx);
      ctx.stroke();
      ctx.restore();

      // heading texture by type
      if (!isCurtain) {
        // simple roman fold lines
        ctx.strokeStyle = "rgba(15,23,42,0.55)";
        ctx.lineWidth = 1.2;
        for (let i = 1; i < 5; i++) {
          const yy = p.y + (i * (p.h / 5));
          ctx.beginPath();
          ctx.moveTo(p.x, yy);
          ctx.lineTo(p.x + p.w, yy);
          ctx.stroke();
        }
      } else {
        if (headingType === "pencil") {
          // alternating light/dark bars to imply gather
          const barW = Math.max(3, 6 / textureDensity);
          for (let xx = p.x; xx < p.x + p.w; xx += barW) {
            const i = Math.floor((xx - p.x) / barW);
            ctx.fillStyle = (i % 2 === 0) ? "rgba(15,23,42,0.06)" : "rgba(15,23,42,0.02)";
            ctx.fillRect(xx, p.y, barW, p.h);
          }
        }

        if (headingType === "triple") {
          // flat sections with triple pleat marks near the top, aligned to hook positions
          // We'll draw pleats across the panel width based on visible hook positions in that side.
          const pleatTop = p.y + 2;
          const pleatBottom = p.y + tapeDepthPx;

          // determine which hardware positions belong to this panel (left/right split by mid)
          const mid = trackX1 + (totalW / 2);
          const xs = positionsPx.filter(x => {
            if (p.side === "L") return x <= mid;
            if (p.side === "R") return x >= mid;
            return true;
          });

          // Background flat shading
          ctx.fillStyle = "rgba(15,23,42,0.02)";
          ctx.fillRect(p.x, p.y, p.w, p.h);

          // Pleat triplets
          ctx.strokeStyle = "rgba(15,23,42,0.35)";
          ctx.lineWidth = 1.2;

          for (const hx of xs) {
            // map hook x into panel local x range (roughly)
            const x = this.clamp(hx, p.x + 10, p.x + p.w - 10);

            // pinch at bottom ~1cm; spread at top ~4cm (scaled)
            const spread = 10; // px
            const pinch = 3;   // px

            ctx.beginPath(); ctx.moveTo(x - spread, pleatTop); ctx.lineTo(x - pinch, pleatBottom); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(x,         pleatTop); ctx.lineTo(x,         pleatBottom); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(x + spread, pleatTop); ctx.lineTo(x + pinch, pleatBottom); ctx.stroke();
          }
        }

        if (headingType === "eyelet") {
          // Vertical wave flow shading to show in/out depth along folds.
          drawVerticalWaveFlow(p, { bandW: 20, alphaBase: 0.02, alphaAmp: 0.052, freq: 10 });
        }

        if (headingType === "wave") {
          // Vertical flow shading for wave headings (not horizontal strips).
          ctx.fillStyle = "rgba(15,23,42,0.02)";
          ctx.fillRect(p.x, p.y, p.w, p.h);
          drawVerticalWaveFlow(p, { bandW: 18, alphaBase: 0.02, alphaAmp: 0.06, freq: 11 });
        }
      }

      // Panel outline
      ctx.strokeStyle = "rgba(15,23,42,0.35)";
      ctx.lineWidth = 1;
      ctx.strokeRect(p.x, p.y, p.w, p.h);
    }

    if (hardware.kind === "hooks") {
      ctx.strokeStyle = "#0f172a";
      ctx.lineWidth = 2;
      for (const x of positionsPx) {
        ctx.beginPath();
        ctx.moveTo(x, poleY);
        ctx.lineTo(x, topCurtainY + 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(x, topCurtainY + 4, 2.4, 0, Math.PI * 2);
        ctx.fillStyle = "#0f172a";
        ctx.fill();
      }
    } else if (hardware.kind === "eyelets") {
      for (const x of positionsPx) {
        const cx = x;
        const cy = topCurtainY + eyeletOffsetPx;
        const rx = 5, ry = 4;
        ctx.strokeStyle = "#0f172a";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = "#64748b";
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx - 2.2, ry - 1.6, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    // Summary text (counts)
    ctx.fillStyle = "#0f172a";
    ctx.font = "12px system-ui";

    const splitText = isPair
      ? ` (${hardware.split.left} L / ${hardware.split.right} R)`
      : "";

    const countLabel = (hardware.kind === "eyelets") ? "Eyelets" : "Hooks";
    ctx.fillText(`${countLabel}: ${hardware.total}${splitText}`, pad, canvasH - 16);

    // small note on tape depth
    ctx.fillStyle = "#64748b";
    ctx.fillText(`Tape: ${hardware.tapeDepthCm}cm`, pad + 170, canvasH - 16);
  },

  // Half-drop cut plan view + top strip showing track markers
  drawHalfDropCutPlan({
    railW, fabricWidthCm, patternRepeatCm, dropCm,
    headingType, isPair, openClosed01, hardware, planTitle, plan
  }) {
    const { ctx, width: canvasW, height: canvasH } = this.setupCanvas();

    const pad = 14;
    const headerH = 56;
    const cutAreaY = pad + headerH;
    const cutAreaH = canvasH - cutAreaY - pad;

    // Header title
    ctx.fillStyle = "#0f172a";
    ctx.font = "14px system-ui";
    ctx.fillText(planTitle, pad, pad + 16);

    ctx.fillStyle = "#475569";
    ctx.font = "12px system-ui";
    const countLabel = (hardware.kind === "eyelets") ? "Eyelets" : "Hooks";
    const splitText = isPair ? ` (${hardware.split.left} L / ${hardware.split.right} R)` : "";
    ctx.fillText(`${countLabel}: ${hardware.total}${splitText}  |  PR ${patternRepeatCm}cm  |  Fabric width ${fabricWidthCm}cm  |  Method ${plan.method}`, pad, pad + 36);

    // Draw a small track strip in the header
    const safeRail = Math.max(1, railW);
    const trackX1 = pad;
    const trackX2 = canvasW - pad;
    const trackY = pad + 48;
    const sx = (trackX2 - trackX1) / safeRail;

    ctx.strokeStyle = "#334155";
    ctx.lineWidth = 5;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(trackX1, trackY);
    ctx.lineTo(trackX2, trackY);
    ctx.stroke();

    const positionsPx = hardware.positionsCm.map(cm => trackX1 + cm * sx);
    if (hardware.kind === "hooks") {
      ctx.strokeStyle = "#0f172a";
      ctx.lineWidth = 2;
      for (const x of positionsPx) {
        ctx.beginPath();
        ctx.moveTo(x, trackY);
        ctx.lineTo(x, trackY + 10);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(x, trackY + 12, 2.2, 0, Math.PI * 2);
        ctx.fillStyle = "#0f172a";
        ctx.fill();
      }
    } else {
      for (const x of positionsPx) {
        const cx = x, cy = trackY + 6;
        ctx.strokeStyle = "#0f172a"; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.ellipse(cx, cy, 6, 4, 0, 0, Math.PI*2); ctx.stroke();
        ctx.strokeStyle = "#64748b"; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.ellipse(cx, cy, 3.8, 2.6, 0, 0, Math.PI*2); ctx.stroke();
      }
    }

    // Cut plan drawing
    const usableW = canvasW - pad * 2;
    const usableH = cutAreaH;

    const num = plan.cutPlan.length;
    const dropW = Math.min(120, Math.max(70, usableW / Math.max(6, num)));
    const gap = 12;

    const maxLenCm = Math.max(...plan.cutPlan.map(d => d.lengthCm));
    const pxPerCm = Math.min(usableH / (maxLenCm * 1.10), 2.4);

    const baseY = cutAreaY + usableH;
    let x = pad;

    for (const d of plan.cutPlan) {
      const h = d.lengthCm * pxPerCm;
      const y = baseY - h;

      // box
      ctx.strokeStyle = "rgba(15,23,42,0.75)";
      ctx.lineWidth = 1;
      ctx.strokeRect(x, y, dropW, h);

      // faint fill
      ctx.fillStyle = "rgba(37,99,235,0.08)";
      ctx.fillRect(x, y, dropW, h);

      // label
      ctx.fillStyle = "#0f172a";
      ctx.font = "12px system-ui";
      ctx.fillText(`#${d.index} ${d.label}`, x + 6, y - 6);

      // length
      ctx.fillStyle = "#334155";
      ctx.font = "11px system-ui";
      ctx.fillText(`${d.lengthCm.toFixed(1)}cm`, x + 6, y + 14);

      // offset marker
      const offsetRatio = Math.min(1, d.patternOffsetCm / patternRepeatCm);
      const markerY = y + 24;
      const markerX1 = x + 6;
      const markerX2 = x + 6 + (dropW - 12) * offsetRatio;

      ctx.strokeStyle = "#94a3b8";
      ctx.beginPath();
      ctx.moveTo(markerX1, markerY);
      ctx.lineTo(markerX2, markerY);
      ctx.stroke();

      ctx.fillStyle = "#64748b";
      ctx.fillText(d.patternOffsetCm ? `${d.patternOffsetCm.toFixed(1)}cm offset` : `0cm offset`, x + 6, markerY + 13);

      x += dropW + gap;
      if (x + dropW > pad + usableW) x = pad;
    }
  },

  // ---------------------------
  // App lifecycle
  // ---------------------------
  init() {
    if (!document.getElementById('curtainPricingApp')) {
      return;
    }
    this.configureContextActions();
    this.renderSettings();
    window.addEventListener("resize", () => this.update());
    this.update();
  },

  configureContextActions() {
    const addToJobButton = document.getElementById('cp-add-to-job');
    if (!addToJobButton) {
      return;
    }

    const inIframe = window.self !== window.top;
    const inJobViewPanel = inIframe
      && window.frameElement
      && typeof window.frameElement.closest === 'function'
      && !!window.frameElement.closest('.curtain-side-panel');

    addToJobButton.hidden = !inJobViewPanel;
  },

  syncHeading() {
    const hKey = document.getElementById('heading').value;
    document.getElementById('fullness').value = this.settings.headings[hKey].mult;
    this.update();
  },

  update() {
    const modeEl = document.querySelector('input[name="mode"]:checked');
    if (!modeEl) return;
    const isCurtain = modeEl.value === 'curtain';

    document.getElementById('curtain-only').style.display = isCurtain ? 'block' : 'none';
    document.getElementById('roman-only').style.display = isCurtain ? 'none' : 'block';

    const railW = this.parseDimensionCm('width');
    const finishedDropCm = this.parseDimensionCm('drop');

    const fabPrice = parseFloat(document.getElementById('fab-price').value) || 0;
    const fabricWidthCm = parseFloat(document.getElementById('fab-width').value) || 140;
    const patternRepeatCm = parseFloat(document.getElementById('fab-repeat').value) || 0;
    const matchType = document.getElementById('fab-match').value;
    const liningPrice = parseFloat(document.getElementById('lining').value) || 0;

    // curtains-only inputs (safe defaults)
    const headingType = isCurtain ? document.getElementById('heading').value : "roman";
    const isPair = isCurtain ? (document.getElementById('curtain-config').value === "pair") : false;
    const waveCarrierSelected = document.querySelector('input[name="wave-carrier"]:checked');
    const waveCarrierCm = isCurtain ? (parseFloat(waveCarrierSelected?.value || "8") || 8) : 8;
    const closedPct = isCurtain ? (parseInt(document.getElementById('open').value, 10) || 0) : 50;
    if (isCurtain) document.getElementById('open-val').innerText = String(closedPct);
    const openClosed01 = this.clamp(closedPct / 100, 0, 1);
    const waveCarrierGroup = document.getElementById('wave-carrier-group');
    waveCarrierGroup.style.display = (isCurtain && headingType === "wave") ? 'block' : 'none';
    document.getElementById('open-group').style.display = isCurtain ? 'block' : 'none';

    let widths = 1;
    let baseCutHeightCm = finishedDropCm;
    let totalFabM = 0;
    let totalLiningM = 0;
    let makeupCost = 0;
    let extraCost = 0;
    let hardwareCost = 0;
    let hardwareUnitCost = 0;
    let title = "";
    let matchDebug = "";
    let hardware = { kind:"hooks", total:0, split:{left:0,right:0}, positionsCm:[], tapeDepthCm:8 };

    if (isCurtain) {
      const hConf = this.settings.headings[headingType];
      const fullness = parseFloat(document.getElementById('fullness').value);
      document.getElementById('fullness-val').innerText = fullness.toFixed(1);

      widths = Math.ceil((railW * fullness) / fabricWidthCm);
      baseCutHeightCm = finishedDropCm + hConf.addon;

      // Hardware for canvas + output
      hardware = this.computeHardware({
        headingType,
        railW,
        fabricWidthCm,
        widths,
        isPair,
        waveCarrierCm
      });

      // info box (keep your original eyelet estimate, but upgrade it)
      const eyeletBox = document.getElementById('eyelet-info');
      if (headingType === 'eyelet') {
        hardwareUnitCost = this.settings.headings.eyelet.unitPrice || 0;
        hardwareCost = hardware.total * hardwareUnitCost;
        eyeletBox.style.display = 'block';
        const perWidth = hardware.perWidthEven ?? 0;
        const perPanel = isPair ? ` (${hardware.split.left} L / ${hardware.split.right} R)` : "";
        eyeletBox.innerText = `Eyelets: ${hardware.total}${perPanel}  |  ~${perWidth} per fabric width  |  £${hardwareCost.toFixed(2)}`;
      } else if (headingType === "wave") {
        eyeletBox.style.display = 'block';
        const perPanel = isPair ? ` (${hardware.split.left} L / ${hardware.split.right} R)` : "";
        eyeletBox.innerText = `Wave hooks: ${hardware.total}${perPanel}  |  Carrier ${hardware.waveCarrierCm}cm  |  Tape ${hardware.waveTapeSpacingCm}cm`;
      } else if (hardware.kind === "hooks") {
        eyeletBox.style.display = 'block';
        const perPanel = isPair ? ` (${hardware.split.left} L / ${hardware.split.right} R)` : "";
        eyeletBox.innerText = `Hooks: ${hardware.total}${perPanel}`;
      } else {
        eyeletBox.style.display = 'none';
      }

      // Pattern matching
      if (patternRepeatCm > 0 && matchType !== 'none') {
        if (matchType === 'normal') {
          const adjusted = Math.ceil(baseCutHeightCm / patternRepeatCm) * patternRepeatCm;
          totalFabM = Math.ceil(((widths * adjusted) / 100) * 2) / 2;
          totalLiningM = Math.ceil(((widths * baseCutHeightCm) / 100) * 2) / 2;

          matchDebug =
`Pattern match: NORMAL
Adjusted cut drop: ${adjusted.toFixed(2)}cm (${(adjusted/patternRepeatCm).toFixed(2)} PRs)`;
        } else if (matchType === 'half' && widths > 1) {
          const productType = isPair ? "pairCurtains" : "singleCurtain";
          const plan = this.calculateHalfDrop({
            cutDropCm: baseCutHeightCm,
            patternRepeatCm,
            numDrops: widths,
            productType
          });

          totalFabM = Math.ceil((plan.quantityCm / 100) * 2) / 2;
          totalLiningM = Math.ceil(((widths * baseCutHeightCm) / 100) * 2) / 2;

          matchDebug =
`Pattern match: HALF DROP
Method: ${plan.method}
Raw repeats: ${plan.rawRepeats.toFixed(4)}
Adjusted cut drop: ${plan.adjustedCutDropCm.toFixed(2)}cm (${plan.adjustedCutDropRepeats.toFixed(2)} PRs)
Fabric qty: ${Math.ceil(plan.quantityCm)}cm (${plan.quantityText})`;

          makeupCost = widths * hConf.makeup;
          title = `curtains: ${headingType}`;

          // Half-drop canvas view (with marker strip)
          this.drawHalfDropCutPlan({
            railW,
            fabricWidthCm,
            patternRepeatCm,
            dropCm: finishedDropCm,
            headingType,
            isPair,
            openClosed01,
            hardware,
            planTitle: `Half Drop Cut Plan (${title.toUpperCase()})`,
            plan
          });

          return this.renderSummary({
            title, totalFabM, totalLiningM, widths,
            fabPrice, liningPrice, makeupCost, makeupUnitPrice: hConf.makeup, extraCost, hardwareCost, hardwareUnitCost,
            baseCutHeightCm, railW, finishedDropCm,
            fullnessText: fullness.toFixed(1) + "x",
            matchDebug,
            hardware
          });
        }
      } else {
        // no/none matching
        totalFabM = Math.ceil(((widths * baseCutHeightCm) / 100) * 2) / 2;
        totalLiningM = Math.ceil(((widths * baseCutHeightCm) / 100) * 2) / 2;
      }

      makeupCost = widths * hConf.makeup;
      title = `curtains: ${headingType}`;

      // Hanging view canvas
      this.drawHangingView({
        railW,
        dropCm: finishedDropCm,
        isPair,
        headingType,
        fabricWidthCm,
        openClosed01,
        hardware,
        isCurtain: true
      });

      return this.renderSummary({
        title, totalFabM, totalLiningM, widths,
        fabPrice, liningPrice, makeupCost, makeupUnitPrice: hConf.makeup, extraCost, hardwareCost, hardwareUnitCost,
        baseCutHeightCm, railW, finishedDropCm,
        fullnessText: document.getElementById('fullness').value + 'x',
        matchDebug,
        hardware
      });
    }

    // ROMAN BLIND
    widths = Math.ceil((railW + this.settings.roman.wAddon) / fabricWidthCm);
    baseCutHeightCm = finishedDropCm + this.settings.roman.hAddon;

    // Hardware is minimal for roman in this version (still draw a clean view)
    hardware = { kind:"hooks", total:0, split:{left:0,right:0}, positionsCm:[], tapeDepthCm:8 };
    document.getElementById('eyelet-info').style.display = 'none';

    const mechType = document.getElementById('roman-mech').value;
    const mechTable = mechType === 'standard' ? this.settings.roman.stdMech : this.settings.roman.elecMech;
    const bracket = mechTable.find(b => b[0] >= railW) || mechTable[mechTable.length - 1];
    extraCost = bracket ? bracket[1] : 0;
    title = `roman blind: ${mechType}`;

    if (patternRepeatCm > 0 && matchType !== 'none') {
      if (matchType === 'normal') {
        const adjusted = Math.ceil(baseCutHeightCm / patternRepeatCm) * patternRepeatCm;
        totalFabM = Math.ceil(((widths * adjusted) / 100) * 2) / 2;
        totalLiningM = totalFabM;
        matchDebug =
`Pattern match: NORMAL
Adjusted cut drop: ${adjusted.toFixed(2)}cm (${(adjusted/patternRepeatCm).toFixed(2)} PRs)`;
      } else if (matchType === 'half' && widths > 1) {
        const plan = this.calculateHalfDrop({
          cutDropCm: baseCutHeightCm,
          patternRepeatCm,
          numDrops: widths,
          productType: "blind"
        });
        totalFabM = Math.ceil((plan.quantityCm / 100) * 2) / 2;
        totalLiningM = totalFabM;

        matchDebug =
`Pattern match: HALF DROP
Method: ${plan.method}
Raw repeats: ${plan.rawRepeats.toFixed(4)}
Adjusted cut drop: ${plan.adjustedCutDropCm.toFixed(2)}cm (${plan.adjustedCutDropRepeats.toFixed(2)} PRs)
Fabric qty: ${Math.ceil(plan.quantityCm)}cm (${plan.quantityText})`;

        // show cut plan for blinds too
        this.drawHalfDropCutPlan({
          railW,
          fabricWidthCm,
          patternRepeatCm,
          dropCm: finishedDropCm,
          headingType: "roman",
          isPair: false,
          openClosed01: 0.5,
          hardware: { kind:"hooks", total:0, split:{left:0,right:0}, positionsCm:[], tapeDepthCm:8 },
          planTitle: `Half Drop Cut Plan (${title.toUpperCase()})`,
          plan
        });

        makeupCost = this.settings.roman.baseMakeup + (widths * this.settings.roman.perWidthMakeup);
        return this.renderSummary({
          title, totalFabM, totalLiningM, widths,
          fabPrice, liningPrice, makeupCost, makeupUnitPrice: 0, extraCost, hardwareCost: 0, hardwareUnitCost: 0,
          baseCutHeightCm, railW, finishedDropCm,
          fullnessText: 'N/A',
          matchDebug,
          hardware: null
        });
      }
    } else {
      totalFabM = Math.ceil(((widths * baseCutHeightCm) / 100) * 2) / 2;
      totalLiningM = totalFabM;
    }

    makeupCost = this.settings.roman.baseMakeup + (widths * this.settings.roman.perWidthMakeup);

    // draw roman hanging view
    this.drawHangingView({
      railW,
      dropCm: finishedDropCm,
      isPair: false,
      headingType: "roman",
      fabricWidthCm,
      openClosed01: 0.5,
      hardware: { kind:"hooks", total:0, split:{left:0,right:0}, positionsCm:[], tapeDepthCm:8 },
      isCurtain: false
    });

    return this.renderSummary({
      title, totalFabM, totalLiningM, widths,
      fabPrice, liningPrice, makeupCost, makeupUnitPrice: 0, extraCost, hardwareCost: 0, hardwareUnitCost: 0,
      baseCutHeightCm, railW, finishedDropCm,
      fullnessText: 'N/A',
      matchDebug,
      hardware: null
    });
  },

  renderSummary({
    title, totalFabM, totalLiningM, widths,
    fabPrice, liningPrice, makeupCost, makeupUnitPrice = 0, extraCost, hardwareCost = 0, hardwareUnitCost = 0,
    baseCutHeightCm, railW, finishedDropCm,
    fullnessText, matchDebug, hardware
  }) {
    const fabTotalCost = totalFabM * fabPrice;
    const liningTotalCost = totalLiningM * liningPrice;
    const grandTotal = fabTotalCost + liningTotalCost + makeupCost + extraCost + hardwareCost;

    let hardwareLine = "";
    if (hardware && hardware.total > 0) {
      const label = hardware.kind === "eyelets" ? "Eyelets" : "Hooks";
      const split = (hardware.split && (hardware.split.right > 0))
        ? ` (${hardware.split.left} L / ${hardware.split.right} R)`
        : "";
      hardwareLine = `\n${label.padEnd(14)}: ${hardware.total}${split}`;
    }

    const summary =
`${title.toUpperCase()}
/====================================/
Fabric (£${fabPrice}/m)   ${totalFabM.toFixed(2)}    £${fabTotalCost.toFixed(2)}
Lining (£${liningPrice}/m)   ${totalLiningM.toFixed(2)}    £${liningTotalCost.toFixed(2)}
Makeup${makeupUnitPrice > 0 ? ' (£' + makeupUnitPrice.toFixed(2) + '/w)' : ''}   ${widths} wds  £${makeupCost.toFixed(2)}
${hardwareCost > 0 ? 'Eyelets (£' + hardwareUnitCost.toFixed(2) + '/ea)   ' + (hardware?.total || 0) + ' ea  £' + hardwareCost.toFixed(2) + '\n' : ''}${extraCost > 0 ? 'Mechanism             £' + extraCost.toFixed(2) + '\n' : ''}------------------------------------
Total                £${grandTotal.toFixed(2)}
/====================================/
Est Cut Height  : ${baseCutHeightCm.toFixed(0)}cm
Dimensions      : ${railW}cm x ${finishedDropCm}cm
Fabric Price    : £${fabPrice}/m
Fullness Used   : ${fullnessText}${hardwareLine}
${matchDebug ? "\n" + matchDebug : ""}`;

    document.getElementById('output-text').value = summary;
  },

  renderSettings() {
    const container = document.getElementById('settings-ui');
    if (!container) {
      return;
    }
    container.innerHTML = '<h4>Pricing Per Heading</h4><div style="grid-column: 1 / -1;"></div>';
    for (let key in this.settings.headings) {
      container.innerHTML += `
        <div class="cp-settings-card">
          <strong>${key}</strong>
          <label>Price £
            <input type="number" value="${this.settings.headings[key].makeup}"
              oninput="app.settings.headings['${key}'].makeup=parseFloat(this.value||0);app.update()">
          </label>
          <label>Addon cm
            <input type="number" value="${this.settings.headings[key].addon}"
              oninput="app.settings.headings['${key}'].addon=parseFloat(this.value||0);app.update()">
          </label>
          ${key === "eyelet" ? `
          <label>Eyelet £ each
            <input type="number" value="${this.settings.headings[key].unitPrice}"
              oninput="app.settings.headings['${key}'].unitPrice=parseFloat(this.value||0);app.update()">
          </label>` : ''}
        </div>`;
    }
  },

  copyText() {
    const txt = document.getElementById('output-text');
    if (!txt) {
      return;
    }
    txt.select();
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(txt.value).catch(() => {
        document.execCommand('copy');
      });
      return;
    }
    document.execCommand('copy');
  },

  addToJobNotes() {
    const txt = document.getElementById('output-text');
    if (!txt || !txt.value.trim()) {
      return;
    }

    window.parent.postMessage({
      type: 'curtainPricing:addToJobNotes',
      payload: {
        text: txt.value
      }
    }, window.location.origin);
  }
};

window.app = app;
document.addEventListener('DOMContentLoaded', () => {
  app.init();
});
})();
