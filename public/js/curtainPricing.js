(function() {
const app = {
  config: null,
  savedConfig: null,
  settings: {
    curtain: { widthAllowancePerFinishedCurtainCm: 20 },
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
  recommendationLabel(headingType, requestedFullness) {
    const recommended = Number(this.settings.headings[headingType]?.mult || 0);
    const names = { pencil: 'Full', triple: 'Full', eyelet: 'Standard', wave: 'Full' };
    const description = names[headingType] || 'Selected';
    return Math.abs(requestedFullness - recommended) < 0.001
      ? `${description} / Recommended`
      : description;
  },
  safeSliderValue(value) {
    const slider = document.getElementById('fullness');
    const step = Number(slider?.step) || 0.1;
    const min = Number(slider?.min) || 0;
    const steps = Math.floor(((value - min) / step) + 1e-9);
    return Math.max(min, min + (steps * step));
  },
  renderWidthUsage(usage, headingType) {
    const widths = usage.widthsRequired;
    const requested = usage.requestedFullness;
    const previousWidths = Math.max(0, widths - 1);
    const nextWidths = widths + 1;
    const plural = count => `${count} ${count === 1 ? 'width' : 'widths'}`;
    const setText = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = value; };

    setText('fullness-recommendation', this.recommendationLabel(headingType, requested));
    setText('fabric-width-count', plural(widths));
    setText('fabric-usage-left', plural(previousWidths));
    setText('fabric-usage-right', plural(nextWidths));
    setText('fabric-usage-selected', `${requested.toFixed(1)}×`);
    setText('fabric-fullness-result', `Selected: ${requested.toFixed(1)}×  ·  Finished: ~${usage.actualFullness.toFixed(2)}×`);

    const marker = document.getElementById('fabric-usage-marker');
    if (marker) marker.style.left = `${(usage.positionWithinRange * 100).toFixed(2)}%`;

    const distanceFromPrevious = requested - usage.previousWidthThreshold;
    const distanceToNext = usage.nextWidthThreshold - requested;
    const message = document.getElementById('fabric-usage-message');
    if (message) {
      const closeThreshold = 0.1;
      if (widths > 1 && distanceFromPrevious <= closeThreshold + 1e-9) {
        const savingFullness = this.safeSliderValue(usage.previousWidthThreshold);
        message.className = 'cp-usage-message';
        message.innerHTML = `<strong>Close to ${plural(previousWidths)}</strong>Reduce fullness to ${savingFullness.toFixed(1)}× to save one fabric width.`;
      } else if (distanceToNext <= closeThreshold + 1e-9) {
        const safeFullness = this.safeSliderValue(usage.nextWidthThreshold);
        message.className = 'cp-usage-message';
        message.innerHTML = `<strong>Close to ${plural(nextWidths)}</strong>Above ${safeFullness.toFixed(1)}× will require another fabric width.`;
      } else {
        const safeFullness = this.safeSliderValue(usage.nextWidthThreshold);
        message.className = 'cp-usage-message is-good';
        message.innerHTML = `<strong>✓ Good use of ${plural(widths)}</strong>You can increase fullness to ${safeFullness.toFixed(1)}× without requiring another width.`;
      }
    }

    const meter = document.getElementById('fabric-usage-meter');
    if (meter) {
      meter.setAttribute('aria-label', `${plural(widths)} required. Selected fullness ${requested.toFixed(1)} times. Finished fullness approximately ${usage.actualFullness.toFixed(2)} times.`);
    }
  },
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
  async init() {
    if (!document.getElementById('curtainPricingApp')) {
      return;
    }
    this.configureContextActions();
    await this.loadSettings();
    this.renderSettings();
    document.getElementById('settings-dialog')?.addEventListener('cancel', event => {
      event.preventDefault();
      this.closeSettings();
    });
    window.addEventListener("resize", () => this.update());
    this.update();
  },

  async loadSettings() {
    const warning = document.getElementById('settings-load-warning');
    try {
      const response = await fetch('/settings/curtain-pricing', { headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error('The saved pricing settings could not be loaded.');
      this.config = await response.json();
      this.savedConfig = structuredClone(this.config);
      this.applyConfig();
      if (warning) warning.hidden = true;
    } catch (error) {
      const lining = document.getElementById('lining');
      if (lining) {
        lining.innerHTML = '<option value="7">Standard (£7.00/m)</option><option value="8">Blackout (£8.00/m)</option><option value="9">Fleece Backed Standard (£9.00/m)</option><option value="10">Fleece Backed Blackout (£10.00/m)</option>';
      }
      if (warning) {
        warning.textContent = `${error.message} Built-in fallback prices are being used and cannot be saved until the connection is restored.`;
        warning.hidden = false;
      }
    }
  },

  applyConfig() {
    if (!this.config) return;
    this.settings.curtain.widthAllowancePerFinishedCurtainCm = this.config.curtainConstruction.widthAllowancePerFinishedCurtainCm;
    for (const [key, heading] of Object.entries(this.config.headings)) {
      this.settings.headings[key] = {
        mult: heading.fullness,
        addon: heading.dropAllowanceCm,
        makeup: heading.makingPricePerWidth,
        ...(key === 'eyelet' ? { unitPrice: heading.hardwarePriceEach } : {})
      };
    }
    const roman = this.config.romanBlinds;
    this.settings.roman = {
      hAddon: roman.dropAllowanceCm,
      wAddon: roman.widthAllowanceCm,
      baseMakeup: roman.baseMakingPrice,
      perWidthMakeup: roman.makingPricePerWidth,
      stdMech: roman.mechanisms.standard.rows.map(row => [row.maximumWidthCm, row.price]),
      elecMech: roman.mechanisms.electric.rows.map(row => [row.maximumWidthCm, row.price])
    };
    this.populateLinings();
  },

  populateLinings() {
    const select = document.getElementById('lining');
    if (!select || !this.config) return;
    const selectedId = select.selectedOptions[0]?.dataset.id;
    select.replaceChildren(...this.config.linings.options.map(option => {
      const element = document.createElement('option');
      element.value = String(option.pricePerMetre);
      element.dataset.id = option.id;
      element.textContent = `${option.label} (£${Number(option.pricePerMetre).toFixed(2)}/m)`;
      element.selected = option.id === selectedId;
      return element;
    }));
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

      const finishedCurtainCount = isPair ? 2 : 1;
      const widthAllowanceCm = this.settings.curtain.widthAllowancePerFinishedCurtainCm * finishedCurtainCount;
      const widthUsage = window.calculateCurtainWidthUsage({
        railWidthCm: railW,
        fabricWidthCm,
        requestedFullness: fullness,
        widthAllowanceCm
      });
      widths = widthUsage.widthsRequired;
      this.renderWidthUsage(widthUsage, headingType);
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
            fullnessText: `${fullness.toFixed(1)}x requested / ${widthUsage.actualFullness.toFixed(2)}x finished`,
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
        fullnessText: `${fullness.toFixed(1)}x requested / ${widthUsage.actualFullness.toFixed(2)}x finished`,
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
    if (!container || !this.config) return;
    const esc = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
    const numberField = (path, label, description, value, options = {}) => `
      <label class="cp-setting-field"><span>${esc(label)}</span><small>${esc(description)}</small>
        <div class="cp-number-input"><input type="number" data-setting-path="${esc(path)}" value="${Number(value)}" min="${options.min ?? 0}" max="${options.max ?? 100000}" step="${options.step ?? 0.01}">${options.unit ? `<b>${esc(options.unit)}</b>` : ''}</div>
      </label>`;
    const headings = Object.entries(this.config.headings).map(([key, heading]) => `
      <article class="cp-settings-card"><div class="cp-settings-card-heading"><h4>${esc(heading.label)}</h4><p>${esc(heading.description)}</p></div>
        <div class="cp-settings-field-grid">
          ${numberField(`headings.${key}.fullness`, 'Default fullness', 'Fabric-to-track width multiplier.', heading.fullness, { min: 1, max: 3.5, step: 0.1, unit: '×' })}
          ${numberField(`headings.${key}.dropAllowanceCm`, 'Drop allowance', 'Added to the finished curtain drop.', heading.dropAllowanceCm, { step: 1, unit: 'cm' })}
          ${numberField(`headings.${key}.makingPricePerWidth`, 'Making price', 'Labour charge for each fabric width.', heading.makingPricePerWidth, { unit: '£ / width' })}
          ${key === 'eyelet' ? numberField('headings.eyelet.hardwarePriceEach', 'Eyelet price', 'Hardware price for each eyelet.', heading.hardwarePriceEach, { unit: '£ each' }) : ''}
        </div></article>`).join('');
    const roman = this.config.romanBlinds;
    const construction = this.config.curtainConstruction;
    const mechanisms = ['standard', 'electric'].map(type => {
      const mechanism = roman.mechanisms[type];
      const rows = mechanism.rows.map((row, index) => `
        <div class="cp-price-row">
          <label><span>Up to</span><div class="cp-number-input"><input type="number" min="1" step="1" value="${row.maximumWidthCm}" data-mechanism="${type}" data-row="${index}" data-column="maximumWidthCm"><b>cm</b></div></label>
          <label><span>Price</span><div class="cp-number-input"><input type="number" min="0" step="0.01" value="${row.price}" data-mechanism="${type}" data-row="${index}" data-column="price"><b>£</b></div></label>
          <button type="button" class="cp-row-remove" onclick="app.removeMechanismRow('${type}', ${index})" aria-label="Remove price band">×</button>
        </div>`).join('');
      return `<section class="cp-mechanism"><div class="cp-subsection-heading"><h4>${esc(mechanism.label)}</h4><button type="button" onclick="app.addMechanismRow('${type}')">+ Add band</button></div>${rows}</section>`;
    }).join('');
    const linings = this.config.linings.options.map((option, index) => `
      <div class="cp-price-row cp-lining-row">
        <label><span>Name</span><input type="text" value="${esc(option.label)}" data-lining-row="${index}" data-column="label" maxlength="80"></label>
        <label><span>Price per metre</span><div class="cp-number-input"><input type="number" min="0" step="0.01" value="${option.pricePerMetre}" data-lining-row="${index}" data-column="pricePerMetre"><b>£ / m</b></div></label>
        <button type="button" class="cp-row-remove" onclick="app.removeLining(${index})" aria-label="Remove lining option">×</button>
      </div>`).join('');
    container.innerHTML = `
      <section class="cp-settings-section"><div class="cp-section-heading"><span>01</span><div><h3>Curtain headings</h3><p>Default fullness, allowances and making charges.</p></div></div><article class="cp-settings-card"><div class="cp-settings-field-grid">${numberField('curtainConstruction.widthAllowancePerFinishedCurtainCm', 'Width allowance per curtain', 'Side-turn allowance deducted from each finished curtain.', construction.widthAllowancePerFinishedCurtainCm, { step: 1, unit: 'cm' })}</div></article><div class="cp-settings-grid">${headings}</div></section>
      <section class="cp-settings-section"><div class="cp-section-heading"><span>02</span><div><h3>Roman blinds</h3><p>${esc(roman.description)}</p></div></div>
        <article class="cp-settings-card"><div class="cp-settings-field-grid">${numberField('romanBlinds.dropAllowanceCm', 'Drop allowance', 'Added to the finished blind drop.', roman.dropAllowanceCm, { step: 1, unit: 'cm' })}${numberField('romanBlinds.widthAllowanceCm', 'Width allowance', 'Added before calculating fabric widths.', roman.widthAllowanceCm, { step: 1, unit: 'cm' })}${numberField('romanBlinds.baseMakingPrice', 'Base making price', 'Fixed charge for each blind.', roman.baseMakingPrice, { unit: '£' })}${numberField('romanBlinds.makingPricePerWidth', 'Price per width', 'Additional charge for each fabric width.', roman.makingPricePerWidth, { unit: '£ / width' })}</div></article>
        <div class="cp-mechanism-grid">${mechanisms}</div></section>
      <section class="cp-settings-section"><div class="cp-section-heading"><span>03</span><div><h3>${esc(this.config.linings.label)}</h3><p>${esc(this.config.linings.description)}</p></div></div><div class="cp-lining-list">${linings}</div><button type="button" class="cp-add-option" onclick="app.addLining()">+ Add lining option</button></section>`;
    container.querySelectorAll('[data-setting-path]').forEach(input => input.addEventListener('input', event => { this.setConfigPath(event.target.dataset.settingPath, Number(event.target.value)); this.previewSettings(); }));
    container.querySelectorAll('[data-mechanism]').forEach(input => input.addEventListener('input', event => { const { mechanism, row, column } = event.target.dataset; this.config.romanBlinds.mechanisms[mechanism].rows[Number(row)][column] = Number(event.target.value); this.previewSettings(); }));
    container.querySelectorAll('[data-lining-row]').forEach(input => input.addEventListener('input', event => { const { liningRow, column } = event.target.dataset; this.config.linings.options[Number(liningRow)][column] = column === 'pricePerMetre' ? Number(event.target.value) : event.target.value; this.previewSettings(); }));
    const updated = document.getElementById('settings-updated');
    if (updated && this.config.updatedAt) updated.textContent = `Last saved ${new Date(this.config.updatedAt).toLocaleString()}`;
  },

  setConfigPath(path, value) {
    const parts = path.split('.');
    const key = parts.pop();
    parts.reduce((object, part) => object[part], this.config)[key] = value;
  },

  previewSettings() {
    this.applyConfig();
    this.update();
    this.showSettingsStatus('Changes are previewed in the calculator. Save when you are ready.', 'info');
  },

  openSettings() {
    if (!this.config) return;
    this.config = structuredClone(this.savedConfig);
    this.applyConfig();
    this.renderSettings();
    this.showSettingsStatus('', 'info');
    document.getElementById('settings-dialog').showModal();
  },

  closeSettings() {
    if (this.savedConfig) {
      this.config = structuredClone(this.savedConfig);
      this.applyConfig();
      this.update();
    }
    document.getElementById('settings-dialog').close();
  },

  showSettingsStatus(message, type) {
    const status = document.getElementById('settings-status');
    if (!status) return;
    status.textContent = message;
    status.className = `cp-alert cp-alert-${type}`;
    status.hidden = !message;
  },

  addMechanismRow(type) {
    const rows = this.config.romanBlinds.mechanisms[type].rows;
    const last = rows[rows.length - 1] || { maximumWidthCm: 0, price: 0 };
    rows.push({ maximumWidthCm: last.maximumWidthCm + 50, price: last.price });
    this.renderSettings(); this.previewSettings();
  },

  removeMechanismRow(type, index) {
    const rows = this.config.romanBlinds.mechanisms[type].rows;
    if (rows.length <= 1) return this.showSettingsStatus('Each mechanism needs at least one price band.', 'error');
    rows.splice(index, 1); this.renderSettings(); this.previewSettings();
  },

  addLining() {
    this.config.linings.options.push({ id: `lining-${Date.now()}`, label: 'New lining', pricePerMetre: 0 });
    this.renderSettings(); this.previewSettings();
  },

  removeLining(index) {
    if (this.config.linings.options.length <= 1) return this.showSettingsStatus('At least one lining option is required.', 'error');
    this.config.linings.options.splice(index, 1); this.renderSettings(); this.previewSettings();
  },

  async saveSettings() {
    const button = document.getElementById('settings-save');
    button.disabled = true; button.textContent = 'Saving…';
    this.showSettingsStatus('', 'info');
    try {
      const response = await fetch('/settings/curtain-pricing', { method: 'PUT', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(this.config) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || 'Settings could not be saved.');
      this.config = result.settings;
      this.savedConfig = structuredClone(result.settings);
      this.applyConfig(); this.renderSettings(); this.update();
      this.showSettingsStatus('Pricing settings saved successfully.', 'success');
    } catch (error) {
      this.showSettingsStatus(error.message, 'error');
    } finally {
      button.disabled = false; button.textContent = 'Save changes';
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
