const test = require('node:test');
const assert = require('node:assert/strict');
const calculateCurtainWidthUsage = require('../public/js/curtainWidthUsage');

test('calculates requested and finished fullness using a pair allowance', () => {
  const result = calculateCurtainWidthUsage({
    railWidthCm: 200,
    fabricWidthCm: 140,
    requestedFullness: 2,
    widthAllowanceCm: 40
  });

  assert.equal(result.targetWidthCm, 400);
  assert.equal(result.widthsRequired, 4);
  assert.equal(result.grossFabricWidthCm, 560);
  assert.equal(result.usableFabricWidthCm, 520);
  assert.equal(result.actualFullness, 2.6);
  assert.equal(result.previousWidthThreshold, 1.9);
  assert.equal(result.nextWidthThreshold, 2.6);
  assert.ok(Math.abs(result.positionWithinRange - (1 / 7)) < 1e-12);
});

test('uses 20cm allowance for one finished curtain', () => {
  const result = calculateCurtainWidthUsage({
    railWidthCm: 200,
    fabricWidthCm: 140,
    requestedFullness: 2,
    widthAllowanceCm: 20
  });

  assert.equal(result.widthsRequired, 3);
  assert.equal(result.usableFabricWidthCm, 400);
  assert.equal(result.actualFullness, 2);
});

test('keeps the lower exact boundary in the smaller width count', () => {
  const result = calculateCurtainWidthUsage({
    railWidthCm: 200,
    fabricWidthCm: 140,
    requestedFullness: 1.9,
    widthAllowanceCm: 40
  });

  assert.equal(result.widthsRequired, 3);
  assert.equal(result.nextWidthThreshold, 1.9);
  assert.equal(result.positionWithinRange, 1);
});

test('returns a safe empty result for incomplete dimensions', () => {
  const result = calculateCurtainWidthUsage({
    railWidthCm: 0,
    fabricWidthCm: 140,
    requestedFullness: 2,
    widthAllowanceCm: 20
  });

  assert.equal(result.widthsRequired, 0);
  assert.equal(result.actualFullness, 0);
  assert.equal(result.positionWithinRange, 0);
});
