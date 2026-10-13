(function(root, factory) {
  const calculateCurtainWidthUsage = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = calculateCurtainWidthUsage;
  }
  if (root) {
    root.calculateCurtainWidthUsage = calculateCurtainWidthUsage;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  return function calculateCurtainWidthUsage({
    railWidthCm,
    fabricWidthCm,
    requestedFullness,
    widthAllowanceCm = 0
  }) {
    const rail = Number(railWidthCm);
    const fabric = Number(fabricWidthCm);
    const fullness = Number(requestedFullness);
    const allowance = Math.max(0, Number(widthAllowanceCm) || 0);

    if (!(rail > 0) || !(fabric > 0) || !(fullness > 0)) {
      return {
        requestedFullness: Math.max(0, fullness || 0),
        targetWidthCm: 0,
        widthsRequired: 0,
        grossFabricWidthCm: 0,
        usableFabricWidthCm: 0,
        actualFullness: 0,
        previousWidthThreshold: 0,
        nextWidthThreshold: 0,
        positionWithinRange: 0
      };
    }

    const targetWidthCm = rail * fullness;
    const widthsRequired = Math.max(1, Math.ceil((targetWidthCm + allowance) / fabric));
    const grossFabricWidthCm = widthsRequired * fabric;
    const usableFabricWidthCm = Math.max(0, grossFabricWidthCm - allowance);
    const actualFullness = usableFabricWidthCm / rail;
    const previousWidthThreshold = Math.max(0, (((widthsRequired - 1) * fabric) - allowance) / rail);
    const nextWidthThreshold = Math.max(previousWidthThreshold, ((widthsRequired * fabric) - allowance) / rail);
    const range = nextWidthThreshold - previousWidthThreshold;
    const positionWithinRange = range > 0
      ? Math.max(0, Math.min(1, (fullness - previousWidthThreshold) / range))
      : 0;

    return {
      requestedFullness: fullness,
      targetWidthCm,
      widthsRequired,
      grossFabricWidthCm,
      usableFabricWidthCm,
      actualFullness,
      previousWidthThreshold,
      nextWidthThreshold,
      positionWithinRange
    };
  };
});
