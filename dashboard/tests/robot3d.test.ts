// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import Robot3D from '../src/components/Robot3D';

describe('Robot3D', () => {
  it('is memoised so parent re-renders at telemetry rate do not re-render the scene', () => {
    expect((Robot3D as unknown as { $$typeof: symbol }).$$typeof).toBe(Symbol.for('react.memo'));
  });
});
